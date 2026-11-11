/**
 * Wegenetz des MVP-Ausschnitts (Lumen + Rebland), siehe docs/welt.md.
 * Koordinaten in m: x nach Osten, z nach Süden, Ursprung in der Inselmitte.
 * Zum Nachbessern einfach Punkte verschieben; Höhen kommen aus dem Gelände.
 */

export interface LayoutNode {
  id: string;
  x: number;
  z: number;
  name?: string;
  /** Wegende, das später freigeschaltet wird (gesperrte Brücke, Baustelle …). */
  gate?: boolean;
}

export type Surface = 'asphalt' | 'town' | 'gravel';

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  /** Stützpunkte zwischen den Knoten; der Weg läuft als Spline hindurch. */
  via?: [number, number][];
  name?: string;
  surface?: Surface;
}

export interface RoadLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export const MVP_LAYOUT: RoadLayout = {
  nodes: [
    // Lumen
    { id: 'hafen', x: 400, z: 900, name: 'Hafenplatz' },
    { id: 'westmole', x: -250, z: 935, name: 'Westmole' },
    { id: 'ostkai', x: 1000, z: 910, name: 'Ostkai' },
    { id: 'bruecke', x: 1300, z: 930, name: 'Hafenbrücke', gate: true },
    { id: 'markt', x: 400, z: 650, name: 'Marktplatz' },
    { id: 'altW', x: 150, z: 650 },
    { id: 'altE', x: 650, z: 650 },
    { id: 'altNW', x: 150, z: 460 },
    { id: 'altNE', x: 650, z: 460 },
    { id: 'stadttor', x: 400, z: 300, name: 'Stadttor' },
    { id: 'ostweg', x: 1050, z: 150 },
    // Rebland
    { id: 'rebdorf', x: -550, z: 250, name: 'Rebdorf' },
    { id: 'weinW', x: -1150, z: 450 },
    { id: 'weinN', x: -1050, z: -250 },
    { id: 'kapelle', x: -620, z: -640, name: 'Kapelle' },
    { id: 'hangdorf', x: -150, z: -330, name: 'Hangdorf' },
    { id: 'pass', x: -100, z: -1350, name: 'Passweg', gate: true },
    { id: 'strand', x: -900, z: 860, name: 'Weststrand' },
    { id: 'aussicht', x: 850, z: -450, name: 'Aussicht Ostkamm' },
    { id: 'waldrand', x: -950, z: -1150, name: 'Waldrand' },
  ],
  edges: [
    // Promenade
    { id: 'prom-w', from: 'westmole', to: 'hafen', via: [[0, 955], [200, 930]], name: 'Promenade', surface: 'town' },
    { id: 'prom-e', from: 'hafen', to: 'ostkai', via: [[650, 935], [850, 925]], name: 'Promenade', surface: 'town' },
    { id: 'brueckenweg', from: 'ostkai', to: 'bruecke', via: [[1150, 925]] },
    // Altstadt
    { id: 'hafengasse', from: 'hafen', to: 'markt', via: [[410, 780]], surface: 'town' },
    { id: 'markt-w', from: 'altW', to: 'markt', name: 'Marktstraße', surface: 'town' },
    { id: 'markt-e', from: 'markt', to: 'altE', name: 'Marktstraße', surface: 'town' },
    { id: 'gasse-w', from: 'altW', to: 'altNW', surface: 'town' },
    { id: 'gasse-e', from: 'altE', to: 'altNE', surface: 'town' },
    { id: 'tor-w', from: 'altNW', to: 'stadttor', via: [[260, 370]], surface: 'town' },
    { id: 'tor-e', from: 'altNE', to: 'stadttor', via: [[540, 370]], surface: 'town' },
    { id: 'westhafen', from: 'westmole', to: 'altW', via: [[-120, 820], [40, 710]], surface: 'town' },
    // Osten
    { id: 'kuestenweg', from: 'ostkai', to: 'ostweg', via: [[1120, 700], [1130, 380]] },
    { id: 'feldweg', from: 'ostweg', to: 'stadttor', via: [[800, 160], [580, 230]] },
    // Rebland
    { id: 'rebstrasse', from: 'altNW', to: 'rebdorf', via: [[-80, 420], [-330, 320]], name: 'Rebstraße' },
    { id: 'weinberg-s', from: 'rebdorf', to: 'weinW', via: [[-800, 360], [-1000, 500]], name: 'Weinbergschleife' },
    { id: 'weinberg-w', from: 'weinW', to: 'weinN', via: [[-1320, 200], [-1260, -60]], name: 'Weinbergschleife' },
    { id: 'dorfstrasse', from: 'rebdorf', to: 'weinN', via: [[-650, 20], [-860, -160]], name: 'Dorfstraße' },
    {
      id: 'kapellenweg', from: 'weinN', to: 'kapelle', name: 'Kapellenanstieg',
      via: [[-1150, -480], [-1000, -720], [-860, -560], [-780, -780]],
    },
    {
      id: 'kapelle-o', from: 'kapelle', to: 'hangdorf',
      via: [[-480, -860], [-260, -830], [-400, -620], [-190, -500]],
    },
    { id: 'hangweg', from: 'rebdorf', to: 'hangdorf', via: [[-380, -20]] },
    {
      id: 'torstrasse', from: 'stadttor', to: 'hangdorf',
      via: [[300, 150], [520, 20], [360, -120], [110, -60], [-40, -230]],
    },
    // Ergänzungen für mehr Strecke und Schleifen
    { id: 'hafenstrasse', from: 'altE', to: 'ostkai', via: [[820, 760]], surface: 'town' },
    { id: 'strandweg', from: 'westmole', to: 'strand', via: [[-500, 930], [-720, 900]], name: 'Strandweg' },
    { id: 'strand-n', from: 'strand', to: 'weinW', via: [[-1080, 760], [-1200, 600]] },
    { id: 'kammweg', from: 'ostweg', to: 'aussicht', via: [[1150, -100], [1050, -320]], name: 'Kammweg' },
    { id: 'aussicht-w', from: 'aussicht', to: 'hangdorf', via: [[550, -560], [200, -480]] },
    { id: 'waldweg', from: 'weinN', to: 'waldrand', via: [[-1250, -700], [-1150, -1000]], name: 'Waldweg' },
    { id: 'waldrand-o', from: 'waldrand', to: 'pass', via: [[-650, -1250], [-350, -1300]] },
    // Richtung Kogel (gesperrt)
    { id: 'passstrasse', from: 'hangdorf', to: 'pass', via: [[-40, -700], [-260, -930], [60, -1150]], name: 'Passstraße' },
  ],
};
