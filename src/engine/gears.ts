/**
 * Virtuelle Gänge für den Simulationsmodus:
 *   Wunschtempo v = Kadenz / 60 × Übersetzung × Radumfang
 */

export const WHEEL_CIRCUMFERENCE_M = 2.1;

/**
 * 13 gleichmäßig abgestufte Gänge (je ~11 %), Übersetzung 1,0 bis 3,4.
 * Bei 85 U/min: Gang 1 ≈ 11 km/h, Gang 13 ≈ 36 km/h. Keine Sprünge wie beim
 * Kettenblattwechsel, damit ein Schaltvorgang nie plötzlich viel schwerer wird.
 */
export const DEFAULT_GEARS: readonly number[] = Array.from({ length: 13 }, (_, i) =>
  Math.round(3.4 ** (i / 12) * 1000) / 1000,
);

/** Startgang (Index): ≈ 20 km/h bei 85 U/min, in der Ebene ≈ 60 W. */
export const DEFAULT_START_GEAR = 6;

export function speedFromCadence(
  cadenceRpm: number,
  ratio: number,
  circumferenceM = WHEEL_CIRCUMFERENCE_M,
): number {
  return (Math.max(0, cadenceRpm) / 60) * ratio * circumferenceM;
}

export class Gearbox {
  private _index: number;

  constructor(
    readonly ratios: readonly number[] = DEFAULT_GEARS,
    startIndex = Math.min(DEFAULT_START_GEAR, ratios.length - 1),
  ) {
    if (ratios.length === 0) throw new Error('Mindestens ein Gang nötig');
    this._index = Math.min(ratios.length - 1, Math.max(0, startIndex));
  }

  get index(): number {
    return this._index;
  }

  get ratio(): number {
    return this.ratios[this._index]!;
  }

  /** Schwerer schalten. */
  up(): void {
    this._index = Math.min(this.ratios.length - 1, this._index + 1);
  }

  /** Leichter schalten. */
  down(): void {
    this._index = Math.max(0, this._index - 1);
  }
}
