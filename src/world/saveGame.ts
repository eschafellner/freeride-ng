import type { World } from './world';

/** Spielstand. Wird in IndexedDB gespeichert (strukturiertes Klonen, kein JSON nötig). */
export interface SaveData {
  version: 1;
  seed: number;
  savedAt: number;
  position: { edgeId: string; s: number; dir: 1 | -1 };
  totals: { distance: number; elevationGain: number; timeSec: number };
  gearIndex: number;
  collected: string[];
  viewpoints: string[];
  fog: Uint8Array;
}

/**
 * Prüft einen geladenen Spielstand gegen die aktuelle Welt.
 * Unbrauchbare Teile werden ersetzt statt den ganzen Stand zu verwerfen.
 * @returns bereinigter Stand oder null, wenn er nicht zu dieser Welt passt
 */
export function sanitizeSave(raw: unknown, world: World): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<SaveData>;
  if (s.version !== 1 || s.seed !== world.seed) return null;

  const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

  let position = world.spawn;
  const p = s.position;
  if (p && typeof p.edgeId === 'string' && world.roads.edges.has(p.edgeId)) {
    const edge = world.roads.edge(p.edgeId);
    position = {
      edgeId: p.edgeId,
      s: Math.min(edge.length, num(p.s)),
      dir: p.dir === -1 ? -1 : 1,
    };
  }

  return {
    version: 1,
    seed: world.seed,
    savedAt: num(s.savedAt, Date.now()),
    position,
    totals: {
      distance: num(s.totals?.distance),
      elevationGain: num(s.totals?.elevationGain),
      timeSec: num(s.totals?.timeSec),
    },
    gearIndex: Math.floor(num(s.gearIndex, -1)),
    collected: strings(s.collected),
    viewpoints: strings(s.viewpoints),
    fog: s.fog instanceof Uint8Array ? s.fog : new Uint8Array(0),
  };
}
