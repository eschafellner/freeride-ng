import { describe, expect, it } from 'vitest';
import { NoDevice } from '../src/device/NoDevice';
import {
  ARCADE_LEVELS_KMH, ARCADE_MAX_LEVEL, arcadeHillFactor, arcadeTargetSpeed, stepArcadeSpeed,
} from '../src/engine/arcade';
import { RideEngine } from '../src/engine/rideEngine';
import { RideSession } from '../src/engine/rideSession';
import { sanitizeSave } from '../src/world/saveGame';
import { createWorld } from '../src/world/world';

const kmh = (v: number) => v * 3.6;

/** Engine im Arcade-Modus n Sekunden auf fester Steigung laufen lassen. */
function ride(engine: RideEngine, sec: number, grade = 0) {
  let s = engine.state();
  for (let t = 0; t < sec; t += 0.05) s = engine.update(0.05, grade, 0);
  return s;
}

describe('Arcade: Tempomat in Stufen', () => {
  it('jede Stufe hat ihr Wunschtempo in der Ebene', () => {
    for (let l = 1; l <= ARCADE_MAX_LEVEL; l++) expect(kmh(arcadeTargetSpeed(l, 0))).toBeCloseTo(ARCADE_LEVELS_KMH[l]!);
    expect(arcadeTargetSpeed(0, 0)).toBe(0);
  });

  it('Berge bremsen nur leicht, bergab geht es schneller', () => {
    expect(arcadeHillFactor(0.1)).toBeCloseTo(0.75);
    expect(arcadeHillFactor(-0.1)).toBeCloseTo(1.25);
    expect(arcadeHillFactor(0.5)).toBe(0.6);
    expect(kmh(arcadeTargetSpeed(3, 0.08))).toBeGreaterThan(17);
  });

  it('in Stufe 0 rollt man aus, bergab rollt man weiter', () => {
    expect(arcadeTargetSpeed(0, 0.02)).toBe(0);
    expect(kmh(arcadeTargetSpeed(0, -0.1))).toBeGreaterThan(10);
  });

  it('beschleunigt sanft, ohne über das Ziel zu schießen', () => {
    let v = 0;
    for (let i = 0; i < 20; i++) v = stepArcadeSpeed(v, 10, 0.05);
    expect(v).toBeCloseTo(0.8, 5);
    for (let i = 0; i < 400; i++) v = stepArcadeSpeed(v, 10, 0.05);
    expect(v).toBe(10);
  });
});

describe('Arcade in der Ride-Engine', () => {
  it('fährt nur mit dem Tempomat, Zielwatt bleiben auf dem Minimum', () => {
    const e = new RideEngine({ mode: 'arcade' });
    expect(ride(e, 5).speed).toBe(0);
    e.setCruise(3);
    const s = ride(e, 20);
    expect(kmh(s.speed)).toBeCloseTo(24, 0);
    expect(s.targetPower).toBe(e.config.minWatts);
    // Geschätzte Leistung und Trittfrequenz für Anzeige und Historie
    expect(s.power).toBeGreaterThan(30);
    expect(s.cadence).toBeGreaterThan(60);
    expect(s.distance).toBeGreaterThan(50);
  });

  it('Stufen sind begrenzt, Gänge spielen keine Rolle', () => {
    const e = new RideEngine({ mode: 'arcade' });
    e.setCruise(99);
    expect(e.cruiseLevel).toBe(ARCADE_MAX_LEVEL);
    e.setCruise(-3);
    expect(e.cruiseLevel).toBe(0);
    e.setCruise(2);
    const a = ride(e, 20).speed;
    e.shiftUp();
    e.shiftUp();
    expect(ride(e, 5).speed).toBeCloseTo(a, 5);
  });

  it('ausrollen: Trittfrequenz 0, Tempo sinkt', () => {
    const e = new RideEngine({ mode: 'arcade' });
    e.setCruise(4);
    const fast = ride(e, 20).speed;
    e.setCruise(0);
    const s = ride(e, 3);
    expect(s.cadence).toBe(0);
    expect(s.power).toBe(0);
    expect(s.speed).toBeLessThan(fast);
  });
});

describe('Arcade ohne Gerät', () => {
  it('NoDevice sendet nie Leistung', async () => {
    const d = new NoDevice();
    await d.connect();
    expect(d.status).toBe('connected');
    d.setTargetPower(300);
    expect(d.sentPower).toBeNull();
    const e = new RideEngine({ mode: 'arcade' });
    e.setCruise(5);
    const session = new RideSession(e, d, { gradeProvider: () => 0.1, now: () => 0 });
    session.start();
    for (let i = 0; i < 200; i++) session.advance(0.05);
    expect(d.sentPower).toBeNull();
    expect(session.state.speed).toBeGreaterThan(5);
    await d.disconnect();
    expect(d.status).toBe('disconnected');
  });

  it('Spielstand: Arcade-Bestzeiten getrennt, alte Stände bekommen eine leere Liste', () => {
    const world = createWorld();
    const base = {
      version: 1, seed: world.seed, savedAt: 1, position: world.spawn,
      totals: { distance: 0, elevationGain: 0, timeSec: 0 }, gearIndex: 0, collected: [], viewpoints: [],
      fog: new Uint8Array(0), achievements: [], bonusXp: 0, segments: { 'sprint-promenade': { best: 60, runs: 1, improvements: 0, ghost: null } },
    };
    const old = sanitizeSave(base, world)!;
    expect(old.arcadeSegments).toEqual({});
    const withArcade = sanitizeSave({ ...base, arcadeSegments: { 'sprint-promenade': { best: 40, runs: 2, improvements: 1, ghost: null } } }, world)!;
    expect(withArcade.segments['sprint-promenade']!.best).toBe(60);
    expect(withArcade.arcadeSegments['sprint-promenade']!.best).toBe(40);
  });
});
