/**
 * Erkundungsnebel: ein grobes Raster, dessen Zellen beim Fahren aufgedeckt werden.
 */
export class FogGrid {
  readonly cells: Uint8Array;
  readonly res: number;
  private revealedCount = 0;
  /** Zuletzt aufgedeckte Zellen (für inkrementelles Neuzeichnen der Karte). */
  readonly dirty: number[] = [];

  constructor(
    /** Kantenlänge der Welt in m. */
    readonly size: number,
    /** Zellgröße in m. */
    readonly cellSize = 20,
    cells?: Uint8Array,
  ) {
    this.res = Math.ceil(size / cellSize);
    this.cells = new Uint8Array(this.res * this.res);
    if (cells && cells.length === this.cells.length) {
      this.cells.set(cells);
      for (const v of this.cells) if (v) this.revealedCount++;
    }
  }

  private cellIndex(x: number, z: number): [number, number] {
    const half = this.size / 2;
    return [Math.floor((x + half) / this.cellSize), Math.floor((z + half) / this.cellSize)];
  }

  isRevealed(x: number, z: number): boolean {
    const [i, j] = this.cellIndex(x, z);
    if (i < 0 || j < 0 || i >= this.res || j >= this.res) return false;
    return this.cells[j * this.res + i] === 1;
  }

  /** Deckt alle Zellen im Kreis auf. @returns Anzahl neu aufgedeckter Zellen */
  reveal(x: number, z: number, radius: number): number {
    const [ci, cj] = this.cellIndex(x, z);
    const rc = Math.ceil(radius / this.cellSize);
    const half = this.size / 2;
    let added = 0;
    for (let j = cj - rc; j <= cj + rc; j++) {
      if (j < 0 || j >= this.res) continue;
      for (let i = ci - rc; i <= ci + rc; i++) {
        if (i < 0 || i >= this.res) continue;
        const k = j * this.res + i;
        if (this.cells[k]) continue;
        const cx = -half + (i + 0.5) * this.cellSize;
        const cz = -half + (j + 0.5) * this.cellSize;
        if (Math.hypot(cx - x, cz - z) > radius) continue;
        this.cells[k] = 1;
        this.dirty.push(k);
        added++;
      }
    }
    this.revealedCount += added;
    return added;
  }

  /** Anteil aufgedeckter Zellen (0…1), optional nur über eine Auswahl von Zellen. */
  fraction(countable?: (i: number, j: number) => boolean): number {
    if (!countable) return this.revealedCount / this.cells.length;
    let total = 0;
    let seen = 0;
    for (let j = 0; j < this.res; j++) {
      for (let i = 0; i < this.res; i++) {
        if (!countable(i, j)) continue;
        total++;
        if (this.cells[j * this.res + i]) seen++;
      }
    }
    return total === 0 ? 0 : seen / total;
  }
}
