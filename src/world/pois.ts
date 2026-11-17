import type { RoadNetwork } from './roadNetwork';

/**
 * Punkte in der Welt: Sammelobjekte, Aussichtspunkte, Ortsschilder.
 * Position entweder an einem Knoten oder als Anteil t (0…1) entlang einer Kante.
 */

export type PoiType = 'collectible' | 'viewpoint' | 'sign';

export interface PoiDef {
  id: string;
  type: PoiType;
  name?: string;
  edgeId?: string;
  t?: number;
  nodeId?: string;
}

export interface Poi extends PoiDef {
  x: number;
  y: number;
  z: number;
  /** Wegrichtung (x, z) an der Stelle, für die Ausrichtung von Schildern. */
  dirX: number;
  dirZ: number;
  /** Abstand, ab dem der Punkt ausgelöst wird, in m. */
  radius: number;
}

export const POI_RADIUS: Record<PoiType, number> = {
  collectible: 7,
  viewpoint: 30,
  sign: 14,
};

const c = (id: string, edgeId: string, t: number): PoiDef => ({ id, type: 'collectible', edgeId, t });
const sign = (id: string, name: string, edgeId: string, t: number): PoiDef => ({ id, type: 'sign', name, edgeId, t });

/** 15 Sammelobjekte in Lumen und Rebland, je 5 in Glutsteppe, am Kogel und an den Spiegelseen, bevorzugt abseits der Hauptrunde. */
export const MVP_POIS: PoiDef[] = [
  c('k01', 'prom-w', 0.5),
  c('k02', 'westhafen', 0.6),
  c('k03', 'gasse-e', 0.5),
  c('k04', 'kuestenweg', 0.7),
  c('k05', 'feldweg', 0.4),
  c('k06', 'rebstrasse', 0.6),
  c('k07', 'weinberg-s', 0.5),
  c('k08', 'weinberg-w', 0.45),
  c('k09', 'dorfstrasse', 0.5),
  c('k10', 'kapellenweg', 0.75),
  c('k11', 'kapelle-o', 0.35),
  c('k12', 'strand-n', 0.5),
  c('k13', 'kammweg', 0.6),
  c('k14', 'waldweg', 0.5),
  c('k15', 'passstrasse', 0.55),

  { id: 'v-kapelle', type: 'viewpoint', name: 'Kapelle', nodeId: 'kapelle' },
  { id: 'v-ostkamm', type: 'viewpoint', name: 'Aussicht Ostkamm', nodeId: 'aussicht' },
  { id: 'v-westmole', type: 'viewpoint', name: 'Westmole', nodeId: 'westmole' },
  { id: 'v-waldrand', type: 'viewpoint', name: 'Waldrand', nodeId: 'waldrand' },

  // Ortsschilder an den Einfahrten
  sign('s-lumen-w', 'Lumen', 'rebstrasse', 0.12),
  sign('s-lumen-n', 'Lumen', 'torstrasse', 0.06),
  sign('s-lumen-o', 'Lumen', 'feldweg', 0.88),
  sign('s-lumen-s', 'Lumen', 'strandweg', 0.12),
  sign('s-rebdorf-o', 'Rebdorf', 'rebstrasse', 0.88),
  sign('s-rebdorf-w', 'Rebdorf', 'weinberg-s', 0.14),
  sign('s-rebdorf-n', 'Rebdorf', 'dorfstrasse', 0.14),
  sign('s-hangdorf-s', 'Hangdorf', 'torstrasse', 0.93),
  sign('s-hangdorf-w', 'Hangdorf', 'hangweg', 0.88),
  sign('s-hangdorf-n', 'Hangdorf', 'passstrasse', 0.07),
  sign('s-hangdorf-o', 'Hangdorf', 'aussicht-w', 0.92),

  // Glutsteppe (ab Level 3)
  c('k16', 'rotklamm', 0.45),
  c('k17', 'sandweg', 0.5),
  c('k18', 'kuestenstrasse', 0.6),
  c('k19', 'plateauweg', 0.8),
  c('k20', 'kammabstieg', 0.5),
  { id: 'v-tafelberg', type: 'viewpoint', name: 'Tafelberg', nodeId: 'tafel' },
  { id: 'v-glutplateau', type: 'viewpoint', name: 'Glutplateau', nodeId: 'plateau' },
  sign('s-glutdorf-w', 'Glutdorf', 'steppenstrasse', 0.7),
  sign('s-glutdorf-n', 'Glutdorf', 'lange-gerade', 0.12),
  sign('s-glutdorf-o', 'Glutdorf', 'kapweg', 0.85),

  // Hoher Kogel (ab Level 6)
  c('k21', 'kogelstrasse', 0.35),
  c('k22', 'kogelstrasse', 0.8),
  c('k23', 'gipfelstrasse', 0.55),
  c('k24', 'westrampe', 0.3),
  c('k25', 'westrampe', 0.75),
  { id: 'v-kogelalm', type: 'viewpoint', name: 'Kogelalm', nodeId: 'kogelalm' },
  { id: 'v-kogel', type: 'viewpoint', name: 'Hoher Kogel', nodeId: 'gipfel' },

  // Spiegelseen (ab Level 4)
  c('k26', 'unterseeweg', 0.5),
  c('k27', 'waldstrasse', 0.7),
  c('k28', 'nordufer-o', 0.45),
  c('k29', 'obersee-nw', 0.5),
  c('k30', 'klippenweg', 0.45),
  { id: 'v-westbucht', type: 'viewpoint', name: 'Westbucht', nodeId: 'westbucht' },
  { id: 'v-oberseeblick', type: 'viewpoint', name: 'Oberseeblick', nodeId: 'oberseeblick' },
  sign('s-seedorf-s', 'Seedorf', 'seeweg', 0.82),
  sign('s-seedorf-o', 'Seedorf', 'unterseeweg', 0.14),
  sign('s-seedorf-w', 'Seedorf', 'waldstrasse', 0.12),
];

export function resolvePois(net: RoadNetwork, defs: PoiDef[] = MVP_POIS): Poi[] {
  return defs.map((d) => {
    let x: number, y: number, z: number, dirX: number, dirZ: number;
    if (d.nodeId) {
      const n = net.node(d.nodeId);
      const e = net.edge(n.edges[0]!);
      const dir = e.directionAt(e.from === n.id ? 0 : e.length);
      ({ x, y, z } = n);
      dirX = dir.dx;
      dirZ = dir.dz;
    } else if (d.edgeId !== undefined && d.t !== undefined) {
      const e = net.edge(d.edgeId);
      const s = Math.min(1, Math.max(0, d.t)) * e.length;
      ({ x, y, z } = e.pointAt(s));
      const dir = e.directionAt(s);
      dirX = dir.dx;
      dirZ = dir.dz;
    } else {
      throw new Error(`POI ${d.id} braucht nodeId oder edgeId + t`);
    }
    return { ...d, x, y, z, dirX, dirZ, radius: POI_RADIUS[d.type] };
  });
}
