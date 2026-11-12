import type { SegmentRecord } from './segments';

/**
 * Erfahrungspunkte, Level und Erfolge.
 *
 * Der Großteil der XP wird aus dem Spielstand abgeleitet (Kilometer, Höhenmeter,
 * Entdecktes, Erfolge). Gespeichert wird nur der Bonus für Segmentfahrten,
 * der sich nicht aus den Summen ergibt. So passen XP auch zu alten Spielständen.
 */

export const XP = {
  perKm: 20,
  perHm: 2,
  crystal: 50,
  viewpoint: 100,
  perExploredPercent: 20,
  segmentFinish: 25,
  segmentBest: 50,
} as const;

export interface PlayerStats {
  distance: number;
  elevationGain: number;
  timeSec: number;
  collected: number;
  collectibleTotal: number;
  viewpoints: number;
  viewpointTotal: number;
  /** Erkundeter Anteil der Landfläche, 0…1. */
  explored: number;
  segments: ReadonlyMap<string, SegmentRecord>;
}

export interface AchievementDef {
  id: string;
  name: string;
  text: string;
  xp: number;
  test: (s: PlayerStats) => boolean;
}

const km = (n: number) => (s: PlayerStats) => s.distance >= n * 1000;
const hm = (n: number) => (s: PlayerStats) => s.elevationGain >= n;
const runs = (id: string, n = 1) => (s: PlayerStats) => (s.segments.get(id)?.runs ?? 0) >= n;

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'km-1', name: 'Losgerollt', text: 'Den ersten Kilometer gefahren', xp: 25, test: km(1) },
  { id: 'km-10', name: 'Zehner', text: '10 km gefahren', xp: 100, test: km(10) },
  { id: 'km-50', name: 'Ausdauernd', text: '50 km gefahren', xp: 250, test: km(50) },
  { id: 'km-100', name: 'Hunderter', text: '100 km gefahren', xp: 500, test: km(100) },
  { id: 'km-500', name: 'Vielfahrer', text: '500 km gefahren', xp: 1000, test: km(500) },
  { id: 'hm-250', name: 'Bergauf', text: '250 Höhenmeter gesammelt', xp: 50, test: hm(250) },
  { id: 'hm-1000', name: 'Gipfelsammler', text: '1000 Höhenmeter gesammelt', xp: 200, test: hm(1000) },
  { id: 'hm-5000', name: 'Bergziege', text: '5000 Höhenmeter gesammelt', xp: 600, test: hm(5000) },
  { id: 'time-1h', name: 'Eine Stunde im Sattel', text: 'Insgesamt 1 Stunde gefahren', xp: 100, test: (s) => s.timeSec >= 3600 },
  { id: 'time-10h', name: 'Zehn Stunden im Sattel', text: 'Insgesamt 10 Stunden gefahren', xp: 500, test: (s) => s.timeSec >= 36000 },
  { id: 'gem-1', name: 'Es glitzert', text: 'Den ersten Kristall gefunden', xp: 25, test: (s) => s.collected >= 1 },
  {
    id: 'gem-all', name: 'Schatzsucher', text: 'Alle Kristalle gefunden', xp: 300,
    test: (s) => s.collectibleTotal > 0 && s.collected >= s.collectibleTotal,
  },
  {
    id: 'vp-all', name: 'Rundumblick', text: 'Alle Aussichtspunkte entdeckt', xp: 200,
    test: (s) => s.viewpointTotal > 0 && s.viewpoints >= s.viewpointTotal,
  },
  { id: 'map-25', name: 'Neugierig', text: '25 % der Insel erkundet', xp: 50, test: (s) => s.explored >= 0.25 },
  { id: 'map-50', name: 'Entdecker', text: '50 % der Insel erkundet', xp: 150, test: (s) => s.explored >= 0.5 },
  { id: 'map-90', name: 'Kartograf', text: '90 % der Insel erkundet', xp: 400, test: (s) => s.explored >= 0.9 },
  { id: 'seg-sprint', name: 'Sprinter', text: 'Die Sprintzone Promenade gefahren', xp: 50, test: runs('sprint-promenade') },
  { id: 'seg-climb', name: 'Bergwertung', text: 'Den Kapellenanstieg bezwungen', xp: 75, test: runs('climb-kapelle') },
  { id: 'seg-tt', name: 'Gegen die Uhr', text: 'Das Zeitfahren Weinbergrunde beendet', xp: 75, test: runs('tt-weinberg') },
  { id: 'climb-5', name: 'Stammgast an der Kapelle', text: 'Den Kapellenanstieg 5-mal gefahren', xp: 150, test: runs('climb-kapelle', 5) },
  {
    id: 'pb-1', name: 'Schneller als gestern', text: 'Eine eigene Bestzeit verbessert', xp: 75,
    test: (s) => [...s.segments.values()].some((r) => r.improvements > 0),
  },
];

/** Erfolge, die jetzt erfüllt, aber noch nicht freigeschaltet sind. */
export function newAchievements(stats: PlayerStats, unlocked: ReadonlySet<string>): AchievementDef[] {
  return ACHIEVEMENTS.filter((a) => !unlocked.has(a.id) && a.test(stats));
}

export function totalXp(stats: PlayerStats, unlocked: ReadonlySet<string>, bonusXp: number): number {
  let xp =
    (stats.distance / 1000) * XP.perKm +
    stats.elevationGain * XP.perHm +
    stats.collected * XP.crystal +
    stats.viewpoints * XP.viewpoint +
    stats.explored * 100 * XP.perExploredPercent +
    bonusXp;
  for (const a of ACHIEVEMENTS) if (unlocked.has(a.id)) xp += a.xp;
  return Math.floor(xp);
}

/** XP für den Schritt von Level `level` auf `level + 1`. */
export const xpForNextLevel = (level: number): number => 150 + 50 * level;

export interface LevelInfo {
  level: number;
  /** XP seit Beginn des aktuellen Levels. */
  into: number;
  /** XP für das nächste Level. */
  needed: number;
}

export function levelFor(xp: number): LevelInfo {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp));
  while (rest >= xpForNextLevel(level)) {
    rest -= xpForNextLevel(level);
    level++;
  }
  return { level, into: rest, needed: xpForNextLevel(level) };
}

/** Bonus-XP für eine beendete Segmentfahrt. */
export function segmentXp(newBest: boolean, first: boolean): number {
  return XP.segmentFinish + (newBest && !first ? XP.segmentBest : 0);
}
