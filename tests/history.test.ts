import { describe, expect, it } from 'vitest';
import { FIT_EPOCH_OFFSET, fitCrc, MESG, toFit } from '../src/history/fit';
import {
  activeSpans, exportFileName, MIN_RIDE_SEC, RideRecorder, summarize, type RideSampleInput,
} from '../src/history/rideLog';
import { toTcx } from '../src/history/tcx';

const T0 = Date.UTC(2026, 10, 17, 17, 30, 0);

/** Fährt mit dem Recorder: `sec` Sekunden bei 60 fps, optional mit Pause in der Mitte. */
function ride(sec: number, opts: { pauseAt?: number; pauseSec?: number; hr?: number; base?: Partial<RideSampleInput> } = {}) {
  const rec = new RideRecorder(T0, 'simulator', 'Hafenplatz');
  // Die Engine zählt über alle Fahrten: Startwerte ungleich 0
  const s: RideSampleInput = { timeSec: 500, distance: 12000, elevationGain: 300, speed: 8, power: 150, cadence: 85, heartRate: opts.hr ?? 0, ...opts.base };
  let wall = T0;
  const dt = 1 / 60;
  for (let t = 0; t < sec; t += dt) {
    if (opts.pauseAt !== undefined && Math.abs(t - opts.pauseAt) < dt / 2) wall += (opts.pauseSec ?? 30) * 1000;
    s.timeSec += dt;
    s.distance += s.speed * dt;
    s.elevationGain += 0.05 * dt;
    s.power = 150 + 50 * Math.sin(t / 10);
    wall += dt * 1000;
    rec.sample(wall, s, 20 + t * 0.05);
  }
  return rec;
}

/** Minimaler FIT-Leser für die Tests: prüft Kopf und CRC, liefert die Datennachrichten. */
function readFit(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = bytes[0]!;
  const dataSize = view.getUint32(4, true);
  const sig = String.fromCharCode(...bytes.slice(8, 12));
  const defs = new Map<number, { global: number; fields: { num: number; size: number }[] }>();
  const messages: { global: number; values: Map<number, number> }[] = [];
  let p = headerSize;
  while (p < headerSize + dataSize) {
    const h = bytes[p++]!;
    const local = h & 0x0f;
    if (h & 0x40) {
      const global = view.getUint16(p + 2, true);
      const count = bytes[p + 4]!;
      p += 5;
      const fields = [];
      for (let k = 0; k < count; k++, p += 3) fields.push({ num: bytes[p]!, size: bytes[p + 1]! });
      defs.set(local, { global, fields });
    } else {
      const def = defs.get(local)!;
      const values = new Map<number, number>();
      for (const f of def.fields) {
        let v = 0;
        for (let b = 0; b < f.size; b++) v += bytes[p + b]! * 2 ** (8 * b);
        values.set(f.num, v);
        p += f.size;
      }
      messages.push({ global: def.global, values });
    }
  }
  return {
    headerSize, dataSize, sig, messages,
    headerCrcOk: view.getUint16(12, true) === fitCrc(bytes, 0, 12),
    fileCrcOk: fitCrc(bytes) === 0, // CRC über alles inkl. angehängter CRC ergibt 0
    end: p,
  };
}

describe('Fahrten-Aufzeichnung', () => {
  it('nimmt einen Punkt pro Sekunde Fahrzeit auf, relativ zum Start', () => {
    const rec = ride(120);
    expect(rec.samples).toBeGreaterThanOrEqual(119);
    expect(rec.samples).toBeLessThanOrEqual(121);
    const t = rec.track;
    expect(t.dist[0]).toBeLessThan(1);
    expect(t.time[0]).toBeLessThan(0.1);
    const s = rec.summary();
    expect(s.distance).toBeCloseTo(8 * 120, -1);
    expect(s.movingSec).toBeCloseTo(120, 0);
    expect(s.elevationGain).toBeCloseTo(6, 0);
    expect(s.avgPower).toBeGreaterThan(130);
    expect(s.avgPower).toBeLessThan(170);
    expect(s.maxPower).toBeLessThanOrEqual(200);
    expect(s.avgCadence).toBe(85);
    expect(s.avgHr).toBe(0);
    expect(s.avgSpeed).toBeCloseTo(8, 1);
    // ≈ 150 W × 120 s
    expect(s.kj).toBeGreaterThan(15);
    expect(s.kj).toBeLessThan(21);
  });

  it('speichert erst ab einer Mindestlänge', () => {
    expect(ride(MIN_RIDE_SEC - 10).worthKeeping()).toBe(false);
    expect(ride(MIN_RIDE_SEC + 10).worthKeeping()).toBe(true);
    expect(ride(200, { base: { speed: 0.2 } }).worthKeeping()).toBe(false);
  });

  it('Pausen erscheinen als Lücke in der Uhrzeit, nicht in der Fahrzeit', () => {
    const rec = ride(120, { pauseAt: 60, pauseSec: 45 });
    const s = rec.summary();
    expect(s.movingSec).toBeCloseTo(120, 0);
    expect(s.elapsedSec).toBeCloseTo(120 + 45, 0);
    const spans = activeSpans(rec.track);
    expect(spans).toHaveLength(2);
    expect(spans[0]![0]).toBe(0);
    expect(spans[1]![1]).toBe(rec.samples - 1);
  });

  it('Metadaten und Dateiname', () => {
    const m = ride(90).meta();
    expect(m.id).toBe(`ride-${T0}`);
    expect(m.device).toBe('simulator');
    expect(m.startPlace).toBe('Hafenplatz');
    expect(m.endedAt).toBeGreaterThan(m.startedAt);
    expect(exportFileName(m, 'fit')).toMatch(/^freeride-2026-11-17-\d{4}\.fit$/);
  });

  it('leere Fahrt ergibt Nullen', () => {
    const s = summarize({ ts: [], time: [], dist: [], speed: [], power: [], cadence: [], hr: [], alt: [] }, 0);
    expect(s.distance).toBe(0);
    expect(s.avgPower).toBe(0);
  });
});

describe('TCX-Export', () => {
  const rec = ride(90, { hr: 128 });
  const xml = toTcx(rec.meta(), rec.track);

  it('ist eine Radfahrt mit allen Messpunkten', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<Activity Sport="Biking">');
    expect(xml.match(/<Trackpoint>/g)).toHaveLength(rec.samples);
    expect(xml).toContain(`<Id>${new Date(T0 + 17).toISOString().slice(0, 19)}Z</Id>`);
    expect(xml).toContain('<ns3:Watts>');
    expect(xml).toContain('<HeartRateBpm><Value>128</Value></HeartRateBpm>');
    expect(xml).toContain('<AverageHeartRateBpm><Value>128</Value></AverageHeartRateBpm>');
    expect(xml).toContain('Hafenplatz');
    expect(xml).not.toContain('<Position>');
  });

  it('ist wohlgeformt (jedes geöffnete Element wird geschlossen)', () => {
    const stack: string[] = [];
    for (const m of xml.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
      if (m[0].startsWith('<?')) continue;
      if (m[3]) continue;
      if (m[1]) expect(stack.pop()).toBe(m[2]);
      else stack.push(m[2]!);
    }
    expect(stack).toHaveLength(0);
  });

  it('ohne Pulsgurt keine Pulswerte', () => {
    const r = ride(90);
    expect(toTcx(r.meta(), r.track)).not.toContain('HeartRate');
  });
});

describe('FIT-Export', () => {
  const rec = ride(120, { pauseAt: 60, pauseSec: 45, hr: 130 });
  const meta = rec.meta();
  const fit = readFit(toFit(meta, rec.track));
  const of = (g: number) => fit.messages.filter((m) => m.global === g);

  it('hat gültigen Kopf und gültige Prüfsummen', () => {
    expect(fit.headerSize).toBe(14);
    expect(fit.sig).toBe('.FIT');
    expect(fit.headerCrcOk).toBe(true);
    expect(fit.fileCrcOk).toBe(true);
    expect(fit.end).toBe(14 + fit.dataSize);
  });

  it('enthält file_id, Messpunkte, Runde, Einheit und Aktivität', () => {
    expect(of(MESG.fileId)[0]!.values.get(0)).toBe(4); // Aktivität
    expect(of(MESG.record)).toHaveLength(rec.samples);
    expect(of(MESG.lap)).toHaveLength(1);
    expect(of(MESG.session)).toHaveLength(1);
    expect(of(MESG.activity)).toHaveLength(1);
  });

  it('Messpunkte mit Zeit, Strecke, Tempo, Leistung, Kadenz, Puls und Höhe', () => {
    const r = of(MESG.record);
    const first = r[0]!.values;
    expect(first.get(253)).toBe(Math.round(rec.track.ts[0]! / 1000) - FIT_EPOCH_OFFSET);
    expect(first.get(7)).toBe(rec.track.power[0]);
    expect(first.get(4)).toBe(85);
    expect(first.get(3)).toBe(130);
    expect(first.get(2)! / 5 - 500).toBeCloseTo(rec.track.alt[0]!, 0);
    const last = r[r.length - 1]!.values;
    expect(last.get(5)! / 100).toBeCloseTo(rec.track.dist[rec.samples - 1]!, 1);
    expect(last.get(6)! / 1000).toBeCloseTo(8, 2);
  });

  it('Timer startet und stoppt an der Pause', () => {
    const ev = of(MESG.event).map((m) => m.values.get(1));
    expect(ev).toEqual([0, 4, 0, 4]); // Start, Stopp, Start, Stopp
  });

  it('Einheit: Radfahren, virtuell, Zeiten und Strecke', () => {
    const s = of(MESG.session)[0]!.values;
    expect(s.get(5)).toBe(2);
    expect(s.get(6)).toBe(58);
    expect(s.get(8)! / 1000).toBeCloseTo(meta.summary.movingSec, 0);
    expect(s.get(7)! / 1000).toBeCloseTo(meta.summary.elapsedSec, 0);
    expect(s.get(9)! / 100).toBeCloseTo(meta.summary.distance, 0);
    expect(s.get(20)).toBe(Math.round(meta.summary.avgPower));
    expect(s.get(16)).toBe(130);
  });

  it('ohne Puls steht „ungültig“ im Feld', () => {
    const r = ride(90);
    const f = readFit(toFit(r.meta(), r.track));
    expect(f.messages.find((m) => m.global === MESG.record)!.values.get(3)).toBe(0xff);
    expect(f.messages.find((m) => m.global === MESG.session)!.values.get(16)).toBe(0xff);
  });
});
