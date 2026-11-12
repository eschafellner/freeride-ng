import { clamp } from './random';

/**
 * Quadratische Höhenkarte. Weltkoordinaten in m, Ursprung in der Mitte,
 * x nach Osten, z nach Süden, Höhe y nach oben. Index i läuft entlang x, j entlang z.
 */
export class Heightfield {
  readonly data: Float32Array;

  constructor(
    /** Kantenlänge in m. */
    readonly size: number,
    /** Punkte pro Kante. */
    readonly res: number,
    data?: Float32Array,
  ) {
    if (res < 2) throw new Error('res muss ≥ 2 sein');
    this.data = data ?? new Float32Array(res * res);
    if (this.data.length !== res * res) throw new Error('Datenlänge passt nicht zu res');
  }

  /** Abstand zweier Gitterpunkte in m. */
  get cell(): number {
    return this.size / (this.res - 1);
  }

  get half(): number {
    return this.size / 2;
  }

  worldX(i: number): number {
    return -this.half + i * this.cell;
  }

  worldZ(j: number): number {
    return -this.half + j * this.cell;
  }

  get(i: number, j: number): number {
    return this.data[j * this.res + i]!;
  }

  set(i: number, j: number, h: number): void {
    this.data[j * this.res + i] = h;
  }

  contains(x: number, z: number): boolean {
    return Math.abs(x) <= this.half && Math.abs(z) <= this.half;
  }

  /** Bilinear interpolierte Höhe; außerhalb wird auf den Rand geklemmt. */
  sample(x: number, z: number): number {
    const fx = clamp((x + this.half) / this.cell, 0, this.res - 1);
    const fz = clamp((z + this.half) / this.cell, 0, this.res - 1);
    const i0 = Math.min(this.res - 2, Math.floor(fx));
    const j0 = Math.min(this.res - 2, Math.floor(fz));
    const tx = fx - i0;
    const tz = fz - j0;
    const h00 = this.get(i0, j0);
    const h10 = this.get(i0 + 1, j0);
    const h01 = this.get(i0, j0 + 1);
    const h11 = this.get(i0 + 1, j0 + 1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /**
   * Höhe genau auf der Dreiecksfläche des Geländemeshes (gleiche Diagonalen wie
   * `createTerrainMesh`: abwechselnd je nach (i + j) gerade/ungerade).
   * Gras und Wasser im Shader rechnen genauso (`TERRAIN_GLSL`).
   */
  meshHeight(x: number, z: number): number {
    const fx = clamp((x + this.half) / this.cell, 0, this.res - 1);
    const fz = clamp((z + this.half) / this.cell, 0, this.res - 1);
    const i = Math.min(this.res - 2, Math.floor(fx));
    const j = Math.min(this.res - 2, Math.floor(fz));
    const tx = fx - i;
    const tz = fz - j;
    const h00 = this.get(i, j);
    const h10 = this.get(i + 1, j);
    const h01 = this.get(i, j + 1);
    const h11 = this.get(i + 1, j + 1);
    if ((i + j) % 2 === 0) {
      // Diagonale (i, j+1) – (i+1, j)
      return tx + tz <= 1
        ? h00 + (h10 - h00) * tx + (h01 - h00) * tz
        : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
    }
    // Diagonale (i, j) – (i+1, j+1)
    return tz >= tx
      ? h00 + (h01 - h00) * tz + (h11 - h01) * tx
      : h00 + (h10 - h00) * tx + (h11 - h10) * tz;
  }

  /** Geländeneigung als Betrag des Gradienten (0.1 = 10 %). */
  slope(x: number, z: number): number {
    const d = this.cell;
    const gx = (this.sample(x + d, z) - this.sample(x - d, z)) / (2 * d);
    const gz = (this.sample(x, z + d) - this.sample(x, z - d)) / (2 * d);
    return Math.hypot(gx, gz);
  }
}
