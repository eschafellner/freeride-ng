import type { Poi } from './pois';

export type ProgressEvent =
  | { type: 'collect'; poi: Poi; collected: number; total: number }
  | { type: 'viewpoint'; poi: Poi; discovered: number; total: number }
  | { type: 'sign'; poi: Poi };

/** Wiederholung eines Ortsschilds frühestens nach dieser Zeit (s Spielzeit). */
const SIGN_COOLDOWN_SEC = 90;

/**
 * Spielfortschritt: was eingesammelt und entdeckt wurde.
 * Prüft bei jedem Aufruf von `update`, ob der Fahrer einen Punkt erreicht hat.
 */
export class GameProgress {
  readonly collected = new Set<string>();
  readonly viewpoints = new Set<string>();
  private readonly signSeenAt = new Map<string, number>();
  private readonly totalCollectibles: number;
  private readonly totalViewpoints: number;

  constructor(
    readonly pois: Poi[],
    saved?: { collected?: string[]; viewpoints?: string[] },
  ) {
    const ids = new Set(pois.map((p) => p.id));
    for (const id of saved?.collected ?? []) if (ids.has(id)) this.collected.add(id);
    for (const id of saved?.viewpoints ?? []) if (ids.has(id)) this.viewpoints.add(id);
    this.totalCollectibles = pois.filter((p) => p.type === 'collectible').length;
    this.totalViewpoints = pois.filter((p) => p.type === 'viewpoint').length;
  }

  get collectedCount(): number {
    return this.collected.size;
  }

  get collectibleTotal(): number {
    return this.totalCollectibles;
  }

  get viewpointCount(): number {
    return this.viewpoints.size;
  }

  get viewpointTotal(): number {
    return this.totalViewpoints;
  }

  /**
   * @param pos Position des Fahrers
   * @param timeSec Spielzeit, für die Wiederholsperre der Ortsschilder
   */
  update(pos: { x: number; y: number; z: number }, timeSec: number): ProgressEvent[] {
    const events: ProgressEvent[] = [];
    for (const p of this.pois) {
      const d = Math.hypot(p.x - pos.x, p.y - pos.y, p.z - pos.z);
      if (d > p.radius) continue;
      if (p.type === 'collectible' && !this.collected.has(p.id)) {
        this.collected.add(p.id);
        events.push({ type: 'collect', poi: p, collected: this.collected.size, total: this.totalCollectibles });
      } else if (p.type === 'viewpoint' && !this.viewpoints.has(p.id)) {
        this.viewpoints.add(p.id);
        events.push({ type: 'viewpoint', poi: p, discovered: this.viewpoints.size, total: this.totalViewpoints });
      } else if (p.type === 'sign') {
        const last = this.signSeenAt.get(p.id);
        if (last === undefined || timeSec - last > SIGN_COOLDOWN_SEC) events.push({ type: 'sign', poi: p });
        this.signSeenAt.set(p.id, timeSec);
      }
    }
    return events;
  }
}
