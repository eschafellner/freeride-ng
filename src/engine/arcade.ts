/**
 * Arcade-Modus: Tempo per Tempomat in Stufen statt über Leistung am Rad.
 * Für Fahrten nur mit Controller oder auf dem E5 ohne Verbindung zum PC.
 *
 * Vereinfachte Physik: Jede Stufe hat ein Wunschtempo in der Ebene. Bergauf wird es
 * etwas langsamer, bergab etwas schneller, Gänge spielen keine Rolle. In Stufe 0
 * rollt man aus (bergab rollt man weiter).
 */

/** Wunschtempo je Stufe in km/h (Stufe 0 = nicht treten, ausrollen). */
export const ARCADE_LEVELS_KMH = [0, 12, 18, 24, 30, 36, 42] as const;
export const ARCADE_MAX_LEVEL = ARCADE_LEVELS_KMH.length - 1;
/** Beschleunigen und Abbremsen zum Wunschtempo in m/s². */
export const ARCADE_ACCEL = 0.8;
export const ARCADE_DECEL = 0.9;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Wie stark die Steigung das Tempo verändert: 10 % bergauf → 75 %, 10 % bergab → 125 %. */
export function arcadeHillFactor(grade: number): number {
  return clamp(1 - 2.5 * grade, 0.6, 1.35);
}

/** Wunschtempo in m/s für Stufe und Steigung. */
export function arcadeTargetSpeed(level: number, grade: number): number {
  const l = clamp(Math.round(level), 0, ARCADE_MAX_LEVEL);
  if (l === 0) {
    // Ausrollen; ab gut 1,5 % Gefälle rollt man von selbst (bei 10 % etwa 14 km/h)
    return clamp((-grade - 0.015) * 160, 0, 30) / 3.6;
  }
  return (ARCADE_LEVELS_KMH[l]! / 3.6) * arcadeHillFactor(grade);
}

/** Ein Zeitschritt: Tempo nähert sich dem Wunschtempo mit begrenzter Beschleunigung. */
export function stepArcadeSpeed(speed: number, target: number, dt: number): number {
  if (target > speed) return Math.min(target, speed + ARCADE_ACCEL * dt);
  return Math.max(target, speed - ARCADE_DECEL * dt);
}

/** Angezeigte Trittfrequenz je Stufe (für Figur, Anzeige und Freilauf-Geräusch). */
export function arcadeCadence(level: number): number {
  return level <= 0 ? 0 : 62 + level * 5;
}
