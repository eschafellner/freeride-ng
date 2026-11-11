/**
 * Virtuelle Gänge für den Simulationsmodus:
 *   Wunschtempo v = Kadenz / 60 × Übersetzung × Radumfang
 */

export const WHEEL_CIRCUMFERENCE_M = 2.1;

/** 2×11-ähnliche Abstufung, als Übersetzungsverhältnis Kettenblatt/Ritzel. */
export const DEFAULT_GEARS: readonly number[] = [
  34 / 32, 34 / 28, 34 / 25, 34 / 22, 34 / 19, 34 / 17, // klein
  50 / 19, 50 / 17, 50 / 15, 50 / 14, 50 / 13, 50 / 12, 50 / 11, // groß
];

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
    startIndex = Math.floor(ratios.length / 2),
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
