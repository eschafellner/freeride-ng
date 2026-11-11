import type { Measurement } from './types';

/**
 * Kettler-Textprotokoll (9600 Baud, 8N1, Zeilenende CR+LF).
 *
 * ACHTUNG: Die Befehle und das ST-Format stammen von anderen Kettler-Modellen
 * und sind für den E5 noch unbestätigt (Bauplan, Phase 0).
 */
export const KETTLER_BAUD_RATE = 9600;
export const LINE_ENDING = '\r\n';

export const Cmd = {
  /** Gerätekennung */
  id: 'ID',
  /** Firmware-Version */
  version: 'VE',
  /** PC-Modus einschalten */
  computerMode: 'CM',
  /** Status abfragen */
  status: 'ST',
  /** Reset */
  reset: 'RS',
  /** Zielleistung setzen */
  power: (watts: number) => `PW ${Math.round(watts)}`,
} as const;

/** Parst "mm:ss" (oder "h:mm:ss") in Sekunden. */
export function parseClock(text: string): number | null {
  const parts = text.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (nums.some(Number.isNaN)) return null;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

function parseIntStrict(text: string): number | null {
  return /^\d+$/.test(text) ? Number(text) : null;
}

/**
 * Parst eine ST-Antwortzeile.
 *
 * Erwartet acht Felder, getrennt durch Tabulator (Leerzeichen werden ebenfalls
 * akzeptiert):
 *   Puls  Kadenz  Tempo×10  Distanz×10  Soll-Watt  Energie  mm:ss  Ist-Watt
 *
 * Annahmen (Phase 0 bestätigen): Tempo in 0,1 km/h, Distanz in 0,1 km
 * (100-m-Einheiten), Energie in kJ.
 *
 * @returns Messwert oder null, wenn die Zeile kein gültiges ST-Format hat.
 */
export function parseStatusLine(line: string, timestamp = Date.now()): Measurement | null {
  const fields = line.trim().split(/\s+/);
  if (fields.length !== 8) return null;

  const [hr, rpm, speed, dist, target, energy, clock, actual] = fields as [
    string, string, string, string, string, string, string, string,
  ];

  const nums = [hr, rpm, speed, dist, target, energy, actual].map(parseIntStrict);
  const elapsedSec = parseClock(clock);
  if (nums.some((n) => n === null) || elapsedSec === null) return null;

  const [heartRate, cadence, speed10, dist10, targetPower, energyKj, power] = nums as number[];

  return {
    timestamp,
    heartRate: heartRate!,
    cadence: cadence!,
    speedKmh: speed10! / 10,
    distanceKm: dist10! / 10,
    targetPower: targetPower!,
    energyKj: energyKj!,
    elapsedSec,
    power: power!,
  };
}

/**
 * Zerlegt einen eingehenden Zeichenstrom in Zeilen.
 * Akzeptiert CR+LF, LF und einzelnes CR als Zeilenende.
 */
export class LineSplitter {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let match: RegExpExecArray | null;
    const re = /\r\n|\n|\r/;
    while ((match = re.exec(this.buffer)) !== null) {
      // Ein CR am Pufferende könnte zu einem CR+LF gehören: abwarten
      if (match[0] === '\r' && match.index === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      if (line.length > 0) lines.push(line);
    }
    return lines;
  }

  reset(): void {
    this.buffer = '';
  }
}
