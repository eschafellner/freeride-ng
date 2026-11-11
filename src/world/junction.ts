import type { Exit, ExitChooser } from './rider';
import { straightest } from './rider';
import type { RoadNetwork, RoadNode } from './roadNetwork';

/**
 * Richtungswahl an Kreuzungen. Der Spieler wählt *vor* der Kreuzung eine
 * Abzweigung (links/rechts durchschalten); ohne Wahl geht es geradeaus.
 */

export type TurnKind = 'links' | 'halblinks' | 'geradeaus' | 'halbrechts' | 'rechts' | 'zurück';

export function turnKind(turn: number): TurnKind {
  const a = Math.abs(turn);
  if (a > 2.6) return 'zurück';
  if (a < 0.35) return 'geradeaus';
  if (a < 1.0) return turn < 0 ? 'halblinks' : 'halbrechts';
  return turn < 0 ? 'links' : 'rechts';
}

export const TURN_ARROW: Record<TurnKind, string> = {
  links: '←', halblinks: '↖', geradeaus: '↑', halbrechts: '↗', rechts: '→', zurück: '↓',
};

export interface ExitLabel {
  exit: Exit;
  kind: TurnKind;
  /** Wohin der Weg führt (Name des Zielknotens oder des Weges). */
  destination: string;
  /** Name des Weges, falls vorhanden und anders als das Ziel. */
  road?: string;
}

/** Ziel einer Abzweigung: der Knoten am anderen Ende der Kante. */
export function exitTarget(net: RoadNetwork, exit: Exit): RoadNode {
  return net.node(exit.dir === 1 ? exit.edge.to : exit.edge.from);
}

/**
 * Nächster benannter Ort hinter einer Abzweigung (kürzeste Wegstrecke),
 * ohne zurück über die Kreuzung `via` zu laufen.
 */
export function nearestNamedNode(net: RoadNetwork, start: RoadNode, via: RoadNode, maxDistance = 3000): RoadNode | null {
  if (start.name) return start;
  const dist = new Map<string, number>([[start.id, 0]]);
  const queue: RoadNode[] = [start];
  let best: { node: RoadNode; d: number } | null = null;
  while (queue.length > 0) {
    // Kleine Netze: lineare Suche nach dem nächsten Knoten genügt
    queue.sort((a, b) => dist.get(a.id)! - dist.get(b.id)!);
    const n = queue.shift()!;
    const d = dist.get(n.id)!;
    if (best && d >= best.d) break;
    for (const eid of n.edges) {
      const e = net.edge(eid);
      const otherId = e.from === n.id ? e.to : e.from;
      if (otherId === via.id) continue;
      const nd = d + e.length;
      if (nd > maxDistance || nd >= (dist.get(otherId) ?? Infinity)) continue;
      dist.set(otherId, nd);
      const other = net.node(otherId);
      if (other.name) {
        if (!best || nd < best.d) best = { node: other, d: nd };
      } else {
        queue.push(other);
      }
    }
  }
  return best?.node ?? null;
}

export function labelExit(net: RoadNetwork, exit: Exit): ExitLabel {
  const target = exitTarget(net, exit);
  const junction = net.node(exit.dir === 1 ? exit.edge.from : exit.edge.to);
  const named = nearestNamedNode(net, target, junction);
  const destination = named?.name ?? exit.edge.name ?? 'Weg';
  const road = exit.edge.name && exit.edge.name !== destination ? exit.edge.name : undefined;
  return { exit, kind: turnKind(exit.turn), destination, road };
}

/** Abzweigungen von links nach rechts sortiert. */
export function sortExits(exits: Exit[]): Exit[] {
  return [...exits].sort((a, b) => a.turn - b.turn);
}

const sameExit = (a: Exit, b: Exit) => a.edge.id === b.edge.id && a.dir === b.dir;

export class JunctionSelector {
  private nodeId: string | null = null;
  private selected: Exit | null = null;

  /** Aktuelle Wahl für einen Knoten, sonst null (= geradeaus). */
  selectionFor(nodeId: string): Exit | null {
    return this.nodeId === nodeId ? this.selected : null;
  }

  /**
   * Schaltet die Wahl um eine Position nach links (−1) oder rechts (+1).
   * Ausgangspunkt ist die aktuelle Wahl bzw. „geradeaus“.
   */
  step(node: RoadNode, exits: Exit[], delta: -1 | 1): Exit | null {
    if (exits.length === 0) return null;
    const sorted = sortExits(exits);
    const current = this.selectionFor(node.id) ?? straightest(node, exits);
    const idx = sorted.findIndex((e) => sameExit(e, current));
    const next = sorted[Math.min(sorted.length - 1, Math.max(0, idx + delta))]!;
    this.nodeId = node.id;
    this.selected = next;
    return next;
  }

  /** Zurück auf „geradeaus“. */
  clear(): void {
    this.nodeId = null;
    this.selected = null;
  }

  /** ExitChooser für RiderOnNetwork: nimmt die Wahl, sonst geradeaus. */
  readonly chooser: ExitChooser = (node, exits) => {
    const sel = this.selectionFor(node.id);
    const match = sel ? exits.find((e) => sameExit(e, sel)) : undefined;
    this.clear();
    return match ?? straightest(node, exits);
  };
}
