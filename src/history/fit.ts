import { activeSpans, type RideMeta, type RideTrack } from './rideLog';

/**
 * Export als FIT-Aktivität (Garmin Flexible and Interoperable Data Transfer), ohne
 * fremde Bibliothek. Aufbau: file_id, Timer-Start, Messpunkte (record) mit Stopp/Start
 * an Pausen, Runde (lap), Einheit (session, Radfahren/virtuell) und activity.
 * Ohne GPS-Position, wie bei Indoor-Fahrten. Feldnummern laut FIT-Profil.
 */

/** Sekunden zwischen 1970-01-01 und dem FIT-Nullpunkt 1989-12-31 (UTC). */
export const FIT_EPOCH_OFFSET = 631065600;

/** FIT-Zeitstempel (s seit 1989-12-31 UTC) aus ms seit 1970. */
export const fitTime = (ms: number): number => Math.round(ms / 1000) - FIT_EPOCH_OFFSET;

/** Basistypen: Code und Größe in Byte. */
export const BASE = {
  enum: { code: 0x00, size: 1, invalid: 0xff },
  uint8: { code: 0x02, size: 1, invalid: 0xff },
  uint16: { code: 0x84, size: 2, invalid: 0xffff },
  uint32: { code: 0x86, size: 4, invalid: 0xffffffff },
} as const;
type BaseName = keyof typeof BASE;

/** Globale Nachrichtennummern. */
export const MESG = { fileId: 0, session: 18, lap: 19, record: 20, event: 21, activity: 34 } as const;

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

/** CRC-16 des FIT-Formats. */
export function fitCrc(bytes: Uint8Array, start = 0, end = bytes.length, crc = 0): number {
  for (let i = start; i < end; i++) {
    const b = bytes[i]!;
    let tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[b & 0xf]!;
    tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf]!;
  }
  return crc;
}

type Field = [num: number, type: BaseName];

/** Schreibt Definitions- und Datennachrichten (Little Endian). */
class FitWriter {
  private readonly bytes: number[] = [];
  private readonly defs = new Map<number, Field[]>();

  define(local: number, global: number, fields: Field[]): void {
    this.defs.set(local, fields);
    this.bytes.push(0x40 | local, 0, 0, global & 0xff, global >> 8, fields.length);
    for (const [num, type] of fields) this.bytes.push(num, BASE[type].size, BASE[type].code);
  }

  /** Datennachricht; `undefined` oder nicht endliche Werte werden als „ungültig“ geschrieben. */
  write(local: number, values: (number | undefined)[]): void {
    const fields = this.defs.get(local);
    if (!fields) throw new Error(`Keine Definition für lokale Nachricht ${local}`);
    this.bytes.push(local);
    fields.forEach(([, type], k) => {
      const t = BASE[type];
      const raw = values[k];
      let v = raw === undefined || !Number.isFinite(raw) ? t.invalid : Math.round(raw);
      // Zu große Werte als „ungültig“, negative auf 0
      if (v > t.invalid) v = t.invalid;
      if (v < 0) v = 0;
      for (let b = 0; b < t.size; b++) this.bytes.push(Math.floor(v / 2 ** (8 * b)) & 0xff);
    });
  }

  /** Fertige Datei mit Kopf und CRC. */
  finish(): Uint8Array<ArrayBuffer> {
    const data = this.bytes.length;
    const out = new Uint8Array(14 + data + 2);
    const view = new DataView(out.buffer);
    out[0] = 14;
    out[1] = 0x20; // Protokoll 2.0
    view.setUint16(2, 2132, true); // Profilversion 21.32
    view.setUint32(4, data, true);
    out.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT"
    view.setUint16(12, fitCrc(out, 0, 12), true);
    out.set(this.bytes, 14);
    view.setUint16(14 + data, fitCrc(out, 0, 14 + data), true);
    return out;
  }
}

/** Ungültig, wenn 0 (z. B. kein Pulsgurt). */
const orNone = (v: number) => (v > 0 ? v : undefined);

export function toFit(meta: RideMeta, track: RideTrack): Uint8Array<ArrayBuffer> {
  const s = meta.summary;
  const w = new FitWriter();
  const n = track.ts.length;
  const first = fitTime(n ? track.ts[0]! : meta.startedAt);
  const last = fitTime(n ? track.ts[n - 1]! : meta.endedAt);

  // file_id: Aktivität, Hersteller „Entwicklung“ (255)
  w.define(0, MESG.fileId, [[0, 'enum'], [1, 'uint16'], [2, 'uint16'], [4, 'uint32']]);
  w.write(0, [4, 255, 0, first]);

  // Timer-Ereignisse: Start/Stopp an jeder Pause
  w.define(1, MESG.event, [[253, 'uint32'], [0, 'enum'], [1, 'enum'], [4, 'uint8']]);
  const TIMER = 0;
  const START = 0;
  const STOP_ALL = 4;

  // record: Höhe (Maßstab 5, Versatz 500), Puls, Kadenz, Strecke (×100), Tempo (×1000), Leistung
  w.define(2, MESG.record, [
    [253, 'uint32'], [2, 'uint16'], [3, 'uint8'], [4, 'uint8'], [5, 'uint32'], [6, 'uint16'], [7, 'uint16'],
  ]);
  const spans = activeSpans(track);
  if (spans.length === 0) {
    w.write(1, [first, TIMER, START, 0]);
  }
  for (const [a, b] of spans) {
    w.write(1, [fitTime(track.ts[a]!), TIMER, START, 0]);
    for (let i = a; i <= b; i++) {
      w.write(2, [
        fitTime(track.ts[i]!),
        (track.alt[i]! + 500) * 5,
        orNone(track.hr[i]!),
        Math.min(254, track.cadence[i]!),
        track.dist[i]! * 100,
        track.speed[i]! * 1000,
        track.power[i]!,
      ]);
    }
    w.write(1, [fitTime(track.ts[b]!), TIMER, STOP_ALL, 0]);
  }

  // Gemeinsame Kennzahlen von Runde und Einheit
  const totals = (): (number | undefined)[] => [
    last, first, s.elapsedSec * 1000, s.movingSec * 1000, s.distance * 100,
    s.avgSpeed * 1000, s.maxSpeed * 1000, orNone(s.avgHr), orNone(s.maxHr),
    orNone(s.avgCadence), orNone(s.maxCadence), s.avgPower, s.maxPower, s.elevationGain, s.kj,
  ];

  // lap
  w.define(3, MESG.lap, [
    [253, 'uint32'], [2, 'uint32'], [7, 'uint32'], [8, 'uint32'], [9, 'uint32'],
    [13, 'uint16'], [14, 'uint16'], [15, 'uint8'], [16, 'uint8'],
    [17, 'uint8'], [18, 'uint8'], [19, 'uint16'], [20, 'uint16'], [21, 'uint16'], [11, 'uint16'],
    [0, 'enum'], [1, 'enum'], [25, 'enum'], [254, 'uint16'],
  ]);
  w.write(3, [...totals(), 9 /* lap */, 1 /* stop */, 2 /* Radfahren */, 0]);

  // session: Radfahren (2), virtuelle Aktivität (58)
  w.define(4, MESG.session, [
    [253, 'uint32'], [2, 'uint32'], [7, 'uint32'], [8, 'uint32'], [9, 'uint32'],
    [14, 'uint16'], [15, 'uint16'], [16, 'uint8'], [17, 'uint8'],
    [18, 'uint8'], [19, 'uint8'], [20, 'uint16'], [21, 'uint16'], [22, 'uint16'], [11, 'uint16'],
    [0, 'enum'], [1, 'enum'], [5, 'enum'], [6, 'enum'], [25, 'uint16'], [26, 'uint16'], [254, 'uint16'],
  ]);
  w.write(4, [...totals(), 8 /* session */, 1 /* stop */, 2, 58, 0, 1, 0]);

  // activity: Gesamtzeit, eine Einheit, Ortszeit für die Anzeige
  const tzSec = -new Date(meta.startedAt).getTimezoneOffset() * 60;
  w.define(5, MESG.activity, [[253, 'uint32'], [0, 'uint32'], [1, 'uint16'], [2, 'enum'], [3, 'enum'], [4, 'enum'], [5, 'uint32']]);
  w.write(5, [last, s.movingSec * 1000, 1, 0 /* manuell */, 26 /* activity */, 1 /* stop */, last + tzSec]);

  return w.finish();
}
