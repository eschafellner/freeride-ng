import type { FogGrid } from '../world/exploration';
import type { Heightfield } from '../world/heightfield';
import { waterLevelAt } from '../world/lakes';
import type { Poi } from '../world/pois';
import type { RoadNetwork } from '../world/roadNetwork';

/** Pixel pro Meter der vorgerenderten Grundkarte. */
const BASE_PX_PER_M = 0.25;
const FOG_COLOR = 'rgb(28, 34, 44)';

const ROAD_STYLE = {
  town: { color: '#f2ede4', width: 7 },
  asphalt: { color: '#ffffff', width: 5 },
  gravel: { color: '#e9d7b0', width: 4 },
  bridge: { color: '#ffffff', width: 5 },
} as const;

/**
 * Karte mit Erkundungsnebel. Die Grundkarte (Gelände, Wasser, Wege) wird einmal
 * vorgerendert; der Nebel liegt als kleines Bild darüber und wird beim
 * Aufdecken nur zellweise aktualisiert.
 */
/** Linienzug, der auf der Karte farbig hervorgehoben wird. */
export interface MapRoute {
  color: string;
  points: { x: number; z: number }[];
}

export class WorldMap {
  private readonly base: HTMLCanvasElement;
  private readonly fogCanvas: HTMLCanvasElement;
  private readonly fogCtx: CanvasRenderingContext2D;
  private readonly fogImage: ImageData;

  constructor(
    private readonly terrain: Heightfield,
    roads: RoadNetwork,
    private readonly fog: FogGrid,
    private readonly pois: Poi[],
  ) {
    this.base = renderBase(terrain, roads);
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = fog.res;
    this.fogCanvas.height = fog.res;
    this.fogCtx = this.fogCanvas.getContext('2d')!;
    this.fogImage = this.fogCtx.createImageData(fog.res, fog.res);
    for (let k = 0; k < fog.cells.length; k++) this.paintFogCell(k);
    this.fogCtx.putImageData(this.fogImage, 0, 0);
    fog.dirty.length = 0;
  }

  /** Übernimmt neu aufgedeckte Zellen in das Nebelbild. */
  syncFog(): void {
    if (this.fog.dirty.length === 0) return;
    for (const k of this.fog.dirty) this.paintFogCell(k);
    this.fog.dirty.length = 0;
    this.fogCtx.putImageData(this.fogImage, 0, 0);
  }

  private paintFogCell(k: number): void {
    const o = k * 4;
    const d = this.fogImage.data;
    d[o] = 28;
    d[o + 1] = 34;
    d[o + 2] = 44;
    d[o + 3] = this.fog.cells[k] ? 0 : 235;
  }

  /**
   * Zeichnet einen Kartenausschnitt.
   * @param cx Mittelpunkt in Weltkoordinaten
   * @param metersAcross sichtbare Breite in m
   */
  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    view: { cx: number; cz: number; metersAcross: number },
    rider: { x: number; z: number; dx: number; dz: number },
    collected: Set<string>,
    viewpoints: Set<string>,
    routes: MapRoute[] = [],
  ): void {
    const scale = width / view.metersAcross; // px pro m
    const half = this.terrain.half;
    const toX = (x: number) => (x - view.cx) * scale + width / 2;
    const toY = (z: number) => (z - view.cz) * scale + height / 2;

    ctx.save();
    ctx.fillStyle = FOG_COLOR;
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, toX(-half), toY(-half), this.terrain.size * scale, this.terrain.size * scale);
    ctx.drawImage(this.fogCanvas, toX(-half), toY(-half), this.terrain.size * scale, this.terrain.size * scale);

    // Hervorgehobene Strecken (Segmente), nur dort, wo schon erkundet
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of routes) {
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(2.5, 5 * Math.min(1, scale * 2));
      ctx.beginPath();
      let pen = false;
      for (const p of r.points) {
        if (!this.fog.isRevealed(p.x, p.z)) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(toX(p.x), toY(p.z));
        else ctx.moveTo(toX(p.x), toY(p.z));
        pen = true;
      }
      ctx.stroke();
    }

    // Punkte nur in erkundeten Bereichen
    for (const p of this.pois) {
      if (p.type === 'sign' || !this.fog.isRevealed(p.x, p.z)) continue;
      const x = toX(p.x);
      const y = toY(p.z);
      if (x < -10 || y < -10 || x > width + 10 || y > height + 10) continue;
      if (p.type === 'collectible') {
        if (collected.has(p.id)) continue;
        ctx.fillStyle = '#ffd23f';
        ctx.strokeStyle = '#8a5a00';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x + 4.5, y);
        ctx.lineTo(x, y + 6);
        ctx.lineTo(x - 4.5, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        const done = viewpoints.has(p.id);
        ctx.fillStyle = done ? '#2f9e44' : '#ffffff';
        ctx.strokeStyle = '#1b1b1b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = done ? '#fff' : '#1b1b1b';
        ctx.font = 'bold 9px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('A', x, y + 0.5);
      }
    }

    // Fahrer als Pfeil
    const rx = toX(rider.x);
    const ry = toY(rider.z);
    const ang = Math.atan2(rider.dz, rider.dx);
    ctx.translate(rx, ry);
    ctx.rotate(ang);
    ctx.fillStyle = '#e4572e';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function renderBase(terrain: Heightfield, roads: RoadNetwork): HTMLCanvasElement {
  const px = Math.round(terrain.size * BASE_PX_PER_M);
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(px, px);
  const mPerPx = terrain.size / px;
  const half = terrain.half;

  for (let y = 0; y < px; y++) {
    const z = -half + (y + 0.5) * mPerPx;
    for (let x = 0; x < px; x++) {
      const wx = -half + (x + 0.5) * mPerPx;
      const h = terrain.sample(wx, z);
      // Schummerung: Licht von Nordwest
      const dx = terrain.sample(wx + mPerPx, z) - terrain.sample(wx - mPerPx, z);
      const dz = terrain.sample(wx, z + mPerPx) - terrain.sample(wx, z - mPerPx);
      const shade = Math.max(0.6, Math.min(1.25, 1 - (dx + dz) * 0.06));
      let r: number, g: number, b: number;
      const wl = waterLevelAt(wx, z);
      if (h < wl) {
        const deep = Math.min(1, (wl - h) / 10);
        [r, g, b] = [96 - 40 * deep, 160 - 50 * deep, 215 - 30 * deep];
      } else if (h < 2.5 || (wl > 0 && h < wl + 0.9)) [r, g, b] = [226, 207, 154];
      else {
        const t = Math.min(1, h / 220);
        [r, g, b] = [130 - 40 * t, 182 - 40 * t, 90 - 25 * t];
        r *= shade;
        g *= shade;
        b *= shade;
      }
      const o = (y * px + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Wege: dunkler Rand, heller Kern
  const toPx = (v: number) => (v + half) / mPerPx;
  for (const pass of ['outline', 'fill'] as const) {
    for (const e of roads.edges.values()) {
      const style = ROAD_STYLE[e.surface];
      ctx.strokeStyle = pass === 'outline' ? 'rgba(60, 60, 60, 0.8)' : style.color;
      ctx.lineWidth = (pass === 'outline' ? style.width + 3 : style.width) * BASE_PX_PER_M * 1.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < e.count; i += 3) {
        const x = toPx(e.xs[i]!);
        const y = toPx(e.zs[i]!);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(toPx(e.xs[e.count - 1]!), toPx(e.zs[e.count - 1]!));
      ctx.stroke();
    }
  }

  // Ortsnamen
  ctx.font = `bold ${Math.round(14)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(20, 20, 20, 0.85)';
  for (const n of roads.nodes.values()) {
    if (!n.name) continue;
    ctx.fillText(n.name, toPx(n.x), toPx(n.z) - 8);
  }
  return canvas;
}
