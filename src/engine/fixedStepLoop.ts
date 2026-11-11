/**
 * Spielschleife mit fester Taktung. Die reale Bildrate (requestAnimationFrame)
 * wird in feste Physikschritte zerlegt, damit die Physik unabhängig von fps ist.
 */
export class FixedStepLoop {
  private accumulator = 0;

  /**
   * @param stepSec Länge eines Physikschritts (0.05 = 20 Hz)
   * @param onStep wird pro Physikschritt aufgerufen
   * @param maxStepsPerAdvance Schutz gegen die „Todesspirale“ nach langen Pausen
   */
  constructor(
    readonly stepSec: number,
    private readonly onStep: (dtSec: number) => void,
    private readonly maxStepsPerAdvance = 10,
  ) {
    if (stepSec <= 0) throw new Error('stepSec muss > 0 sein');
  }

  /**
   * Schiebt die Zeit um `elapsedSec` weiter und führt die fälligen Schritte aus.
   * @returns Anzahl ausgeführter Schritte
   */
  advance(elapsedSec: number): number {
    if (!(elapsedSec > 0)) return 0;
    this.accumulator += elapsedSec;
    let steps = 0;
    while (this.accumulator >= this.stepSec && steps < this.maxStepsPerAdvance) {
      this.onStep(this.stepSec);
      this.accumulator -= this.stepSec;
      steps++;
    }
    // Rückstand verwerfen statt nachzuholen (z.B. nach Tab-Wechsel)
    if (steps === this.maxStepsPerAdvance) this.accumulator = 0;
    return steps;
  }

  /** Anteil bis zum nächsten Schritt (0..1), für Interpolation in der Grafik. */
  get alpha(): number {
    return this.accumulator / this.stepSec;
  }

  reset(): void {
    this.accumulator = 0;
  }
}
