/**
 * Physikmodell (Bauplan, Abschnitt „Steigung und Steuerung“):
 *
 *   P = v · ( m·g·(Crr·cosθ + sinθ) + ½·ρ·CdA·v² )
 *
 * Steigungen werden als Anteil angegeben: 0.05 = 5 % (Höhe / horizontale Strecke).
 */

export interface PhysicsParams {
  /** Fahrer plus Rad in kg. */
  massKg: number;
  gravity: number;
  /** Rollwiderstandsbeiwert. */
  crr: number;
  /** Luftwiderstandsfläche in m². */
  cdA: number;
  /** Luftdichte in kg/m³. */
  airDensity: number;
}

export const DEFAULT_PHYSICS: PhysicsParams = {
  massKg: 85,
  gravity: 9.81,
  crr: 0.005,
  cdA: 0.32,
  airDensity: 1.2,
};

/** Höchsttempo der Simulation (Schutz gegen Ausreißer), m/s ≈ 90 km/h. */
export const MAX_SPEED_MS = 25;

/** Steigungswinkel aus Anteil. */
export function gradeToAngle(grade: number): number {
  return Math.atan(grade);
}

/** Widerstandskraft in N bei Tempo v (m/s) und Steigung. Negativ = Hangabtrieb überwiegt. */
export function resistanceForce(v: number, grade: number, p: PhysicsParams = DEFAULT_PHYSICS): number {
  const theta = gradeToAngle(grade);
  const rolling = p.massKg * p.gravity * p.crr * Math.cos(theta);
  const slope = p.massKg * p.gravity * Math.sin(theta);
  const aero = 0.5 * p.airDensity * p.cdA * v * Math.abs(v);
  return rolling + slope + aero;
}

/** Nötige Leistung in W, um Tempo v (m/s) bei gegebener Steigung zu halten. */
export function powerRequired(v: number, grade: number, p: PhysicsParams = DEFAULT_PHYSICS): number {
  return v * resistanceForce(v, grade, p);
}

/**
 * Gleichgewichtstempo (m/s) für eine konstante Leistung, numerisch per Bisektion.
 * Für P ≥ 0 gibt es genau eine Lösung mit v ≥ 0. Gibt 0 zurück, wenn die Leistung
 * nicht einmal zum Anrollen reicht (sehr steil, P = 0).
 */
export function speedFromPower(power: number, grade: number, p: PhysicsParams = DEFAULT_PHYSICS): number {
  const P = Math.max(0, power);
  const f = (v: number) => powerRequired(v, grade, p) - P;
  let lo = 0;
  let hi = MAX_SPEED_MS;
  if (f(hi) < 0) return MAX_SPEED_MS;
  // Bergauf ohne Leistung: steht
  if (P === 0 && resistanceForce(0, grade, p) >= 0) return 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Ein Integrationsschritt der Fahrdynamik: m·dv/dt = P/v − F_Widerstand.
 * Bei sehr kleinem Tempo wird die Antriebskraft begrenzt, damit P/v nicht explodiert.
 * Das Rad rollt nicht rückwärts.
 */
export function stepSpeed(
  v: number,
  power: number,
  grade: number,
  dtSec: number,
  p: PhysicsParams = DEFAULT_PHYSICS,
): number {
  const MIN_V_FOR_DRIVE = 1; // m/s
  const drive = Math.max(0, power) / Math.max(v, MIN_V_FOR_DRIVE);
  const resist = resistanceForce(v, grade, p);
  const accel = (drive - resist) / p.massKg;
  const next = v + accel * dtSec;
  return Math.min(MAX_SPEED_MS, Math.max(0, next));
}

export const msToKmh = (v: number) => v * 3.6;
export const kmhToMs = (v: number) => v / 3.6;
