import type { RoadEdge, RoadNetwork, RoadNode } from './roadNetwork';

/**
 * Position eines Fahrers im Wegenetz. Das Rad folgt automatisch dem Weg;
 * nur an Kreuzungen wird eine Richtung gewählt (Phase 4: per Taste/Gamepad).
 */

/** Eine Abzweigung an einem Knoten. */
export interface Exit {
  edge: RoadEdge;
  /** +1: Kante wird from → to befahren, −1: to → from. */
  dir: 1 | -1;
  /** Richtungsänderung gegenüber der Ankunftsrichtung in rad (−π … π, positiv = rechts). */
  turn: number;
}

/**
 * Wählt an einem Knoten die nächste Kante.
 * @param exits mögliche Abzweigungen (ohne Umkehren, außer am Wegende)
 */
export type ExitChooser = (node: RoadNode, exits: Exit[]) => Exit;

/** Standard: möglichst geradeaus. */
export const straightest: ExitChooser = (_node, exits) =>
  exits.reduce((best, e) => (Math.abs(e.turn) < Math.abs(best.turn) ? e : best));

export class RiderOnNetwork {
  private _edge: RoadEdge;
  private _s: number;
  private _dir: 1 | -1;
  /** Zuletzt passierter Knoten. */
  lastNode: RoadNode | null = null;
  chooser: ExitChooser = straightest;
  /** Wird bei jedem passierten Knoten aufgerufen. */
  onNode: ((node: RoadNode, next: Exit) => void) | null = null;

  constructor(
    readonly network: RoadNetwork,
    edgeId: string,
    s = 0,
    dir: 1 | -1 = 1,
  ) {
    this._edge = network.edge(edgeId);
    this._s = Math.min(Math.max(0, s), this._edge.length);
    this._dir = dir;
  }

  get edge(): RoadEdge {
    return this._edge;
  }

  /** Strecke auf der aktuellen Kante, immer von `from` aus gemessen. */
  get s(): number {
    return this._s;
  }

  get dir(): 1 | -1 {
    return this._dir;
  }

  get position(): { x: number; y: number; z: number } {
    return this._edge.pointAt(this._s);
  }

  /** Fahrtrichtung (x, z), normiert. */
  get direction(): { dx: number; dz: number } {
    const d = this._edge.directionAt(this._s);
    return { dx: d.dx * this._dir, dz: d.dz * this._dir };
  }

  /** Steigung in Fahrtrichtung (0.05 = 5 % bergauf). */
  get grade(): number {
    return this._edge.gradeAt(this._s) * this._dir;
  }

  /** Knoten, auf den der Fahrer gerade zufährt. */
  get nextNode(): RoadNode {
    return this.network.node(this._dir === 1 ? this._edge.to : this._edge.from);
  }

  /** Verbleibende Strecke bis zum nächsten Knoten. */
  get distanceToNode(): number {
    return this._dir === 1 ? this._edge.length - this._s : this._s;
  }

  /** Abzweigungen am nächsten Knoten (für Vorschau/Auswahl in Phase 4). */
  upcomingExits(): Exit[] {
    return this.exitsAt(this.nextNode);
  }

  /** Bewegt den Fahrer um ds Meter (≥ 0) entlang des Netzes. */
  advance(ds: number): void {
    let remaining = Math.max(0, ds);
    // Schutz gegen Endlosschleifen bei entarteten Kanten
    for (let guard = 0; guard < 64 && remaining > 0; guard++) {
      const toNode = this.distanceToNode;
      if (remaining < toNode) {
        this._s += remaining * this._dir;
        return;
      }
      remaining -= toNode;
      const node = this.nextNode;
      const exit = this.chooser(node, this.exitsAt(node));
      this.lastNode = node;
      this.onNode?.(node, exit);
      this._edge = exit.edge;
      this._dir = exit.dir;
      this._s = exit.dir === 1 ? 0 : exit.edge.length;
    }
  }

  private exitsAt(node: RoadNode): Exit[] {
    const arrive = this.directionAtEnd();
    const all: Exit[] = [];
    for (const id of node.edges) {
      const edge = this.network.edge(id);
      // Eine Kante kann an beiden Enden am selben Knoten hängen (Schleife)
      const dirs: (1 | -1)[] = [];
      if (edge.from === node.id) dirs.push(1);
      if (edge.to === node.id) dirs.push(-1);
      for (const dir of dirs) {
        if (edge === this._edge && dir === -this._dir) continue; // Umkehren
        const d = edge.directionAt(dir === 1 ? 0 : edge.length);
        const dx = d.dx * dir;
        const dz = d.dz * dir;
        // Winkel zwischen Ankunft und Abfahrt; positiv = rechts (x Ost, z Süd)
        const cross = arrive.dx * dz - arrive.dz * dx;
        const dot = arrive.dx * dx + arrive.dz * dz;
        all.push({ edge, dir, turn: Math.atan2(cross, dot) });
      }
    }
    if (all.length > 0) return all;
    // Wegende: umkehren
    return [{ edge: this._edge, dir: (-this._dir) as 1 | -1, turn: Math.PI }];
  }

  private directionAtEnd(): { dx: number; dz: number } {
    const d = this._edge.directionAt(this._dir === 1 ? this._edge.length : 0);
    return { dx: d.dx * this._dir, dz: d.dz * this._dir };
  }
}
