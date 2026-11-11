import { describe, expect, it } from 'vitest';
import type { Measurement } from '../src/device/types';
import { Gearbox, speedFromCadence } from '../src/engine/gears';
import { powerRequired } from '../src/engine/physics';
import { RideEngine, type RideConfig, type RideState } from '../src/engine/rideEngine';

const DT = 0.05;

function measurement(power: number, cadence: number, timestamp: number): Measurement {
  return {
    timestamp, power, cadence, heartRate: 120, targetPower: 0,
    speedKmh: 0, distanceKm: 0, energyKj: 0, elapsedSec: 0,
  };
}

/** Fährt `seconds` lang mit konstanten Messwerten und Steigung. */
function ride(engine: RideEngine, opts: { power: number; cadence: number; grade: number; seconds: number }, t0 = 0) {
  let now = t0;
  let state!: RideState;
  for (let t = 0; t < opts.seconds; t += DT) {
    now += DT * 1000;
    engine.setMeasurement(measurement(opts.power, opts.cadence, now));
    state = engine.update(DT, opts.grade, now);
  }
  return { state, now };
}

/** Reine Physik: volle Steigung, kein Knick, alte Anstiegsrate. */
const make = (config: Partial<RideConfig> = {}) =>
  new RideEngine({ difficulty: 1, softKneeWatts: Infinity, maxRiseWattsPerSec: 20, ...config });

describe('RideEngine – Simulationsmodus (virtuelle Gänge)', () => {
  it('Zielwatt entsprechen der Physik für das Wunschtempo', () => {
    const e = make();
    const { state } = ride(e, { power: 150, cadence: 90, grade: 0.03, seconds: 60 });
    const wish = speedFromCadence(90, e.gears.ratio);
    expect(state.targetPower).toBeCloseTo(Math.min(300, powerRequired(wish, 0.03)), 0);
  });

  it('Ebene, 5 % und 10 %: Zielwatt steigen mit der Steigung', () => {
    const at = (grade: number) => ride(make({ maxWatts: 1000 }), { power: 150, cadence: 80, grade, seconds: 60 }).state.targetPower;
    const flat = at(0);
    const five = at(0.05);
    const ten = at(0.1);
    expect(five).toBeGreaterThan(flat);
    expect(ten).toBeGreaterThan(five);
  });

  it('Abfahrt: Zielwatt fallen aufs Minimum, das Rad rollt schnell', () => {
    const { state } = ride(make(), { power: 25, cadence: 60, grade: -0.06, seconds: 90 });
    expect(state.targetPower).toBe(25);
    expect(state.speed * 3.6).toBeGreaterThan(45);
  });

  it('leichter schalten senkt die Zielwatt am Berg', () => {
    const e = make();
    const before = ride(e, { power: 150, cadence: 80, grade: 0.06, seconds: 30 });
    for (let i = 0; i < 4; i++) e.shiftDown();
    const after = ride(e, { power: 150, cadence: 80, grade: 0.06, seconds: 5 }, before.now);
    expect(after.state.targetPower).toBeLessThan(before.state.targetPower);
  });

  it('Schwierigkeitsgrad skaliert den spürbaren Widerstand, nicht das Tempo', () => {
    const full = ride(make({ difficulty: 1 }), { power: 200, cadence: 70, grade: 0.08, seconds: 120 }).state;
    const half = ride(make({ difficulty: 0.5 }), { power: 200, cadence: 70, grade: 0.08, seconds: 120 }).state;
    expect(half.targetPower).toBeLessThan(full.targetPower);
    expect(half.speed).toBeCloseTo(full.speed, 5); // gleiche gemessene Leistung → gleiches Tempo
  });

  it('ohne Treten: Minimum', () => {
    const { state } = ride(make(), { power: 0, cadence: 0, grade: 0.08, seconds: 10 });
    expect(state.targetPower).toBe(25);
  });
});

describe('RideEngine – Zielwatt-Begrenzung', () => {
  it('hält Minimum und Maximum ein', () => {
    const e = make({ maxWatts: 250 });
    const { state } = ride(e, { power: 250, cadence: 110, grade: 0.15, seconds: 120 });
    expect(state.targetPower).toBe(250);
  });

  it('steigt höchstens 20 W/s', () => {
    const e = make({ maxWatts: 1000, smoothingSec: 0 });
    const s1 = ride(e, { power: 100, cadence: 90, grade: 0, seconds: 1 });
    // plötzliche Rampe
    const s2 = ride(e, { power: 100, cadence: 90, grade: 0.12, seconds: 1 }, s1.now);
    expect(s2.state.targetPower - s1.state.targetPower).toBeLessThanOrEqual(20 + 1);
  });

  it('fällt sofort, wenn es leichter wird', () => {
    const e = make();
    const up = ride(e, { power: 200, cadence: 80, grade: 0.08, seconds: 60 });
    expect(up.state.targetPower).toBeGreaterThan(150);
    const down = ride(e, { power: 200, cadence: 80, grade: -0.05, seconds: DT }, up.now);
    expect(down.state.targetPower).toBe(25);
  });

  it('glättet Sprünge in der Kadenz', () => {
    const e = make({ maxRiseWattsPerSec: 1000, maxWatts: 1000, smoothingSec: 2 });
    const a = ride(e, { power: 100, cadence: 60, grade: 0.02, seconds: 30 });
    const b = ride(e, { power: 100, cadence: 100, grade: 0.02, seconds: 0.5 }, a.now);
    const goal = powerRequired(speedFromCadence(100, e.gears.ratio), 0.02);
    expect(b.state.targetPower).toBeGreaterThan(a.state.targetPower);
    expect(b.state.targetPower).toBeLessThan(goal - 10);
  });

  it('bleibt bei NaN-Steigung sicher', () => {
    const e = make();
    const s = e.update(DT, NaN, 0);
    expect(s.grade).toBe(0);
    expect(Number.isFinite(s.targetPower)).toBe(true);
  });
});

describe('RideEngine – Zustand', () => {
  it('zählt Distanz und Höhenmeter', () => {
    const e = make();
    const { state } = ride(e, { power: 200, cadence: 80, grade: 0.05, seconds: 300 });
    expect(state.distance).toBeGreaterThan(1000);
    // Höhenmeter ≈ Strecke × sin(atan(5 %))
    expect(state.elevationGain).toBeCloseTo(state.distance * Math.sin(Math.atan(0.05)), -1);
    expect(state.timeSec).toBeCloseTo(300, 0);
  });

  it('zählt bergab keine Höhenmeter', () => {
    const { state } = ride(make(), { power: 25, cadence: 60, grade: -0.05, seconds: 60 });
    expect(state.elevationGain).toBe(0);
  });

  it('veraltete Messwerte gelten als 0 W und 0 Kadenz', () => {
    const e = make();
    e.setMeasurement(measurement(200, 90, 0));
    const s = e.update(DT, 0, 5000);
    expect(s.power).toBe(0);
    expect(s.cadence).toBe(0);
    expect(s.targetPower).toBe(25);
  });
});

describe('RideEngine – andere Modi', () => {
  it("'simple': Basis × (1 + k × Steigung%)", () => {
    const e = make({ mode: 'simple', simpleBaseWatts: 100, simpleK: 0.1 });
    const { state } = ride(e, { power: 100, cadence: 80, grade: 0.05, seconds: 60 });
    expect(state.targetPower).toBe(150);
  });

  it("'erg': feste Zielwatt unabhängig von der Steigung", () => {
    const e = make({ mode: 'erg', ergWatts: 140 });
    const { state } = ride(e, { power: 140, cadence: 80, grade: 0.1, seconds: 60 });
    expect(state.targetPower).toBe(140);
  });
});

describe('RideEngine – Fahrgefühl mit Standardwerten', () => {
  const target = (grade: number, cadence = 85) =>
    ride(new RideEngine(), { power: 150, cadence, grade, seconds: 120 }).state.targetPower;

  it('Ebene im Startgang: moderate Grundlast (40–90 W)', () => {
    expect(target(0)).toBeGreaterThan(40);
    expect(target(0)).toBeLessThan(90);
  });

  it('5 % im Startgang bleibt unter 200 W', () => {
    expect(target(0.05)).toBeLessThan(200);
  });

  it('10 % im Startgang erreicht nicht das Maximum', () => {
    expect(target(0.1)).toBeLessThan(300);
  });

  it('Kurve wird mit der Steigung flacher (Knick)', () => {
    const d1 = target(0.03) - target(0);
    const d2 = target(0.1) - target(0.07);
    expect(d2).toBeLessThan(d1);
  });

  it('weicher Knick: unter 150 W unverändert, darüber halbiert', () => {
    const e = new RideEngine();
    expect(e.applySoftKnee(120)).toBe(120);
    expect(e.applySoftKnee(250)).toBe(200);
  });

  it('Zielwatt steigen höchstens 10 W/s', () => {
    const e = new RideEngine({ smoothingSec: 0 });
    const a = ride(e, { power: 100, cadence: 85, grade: 0, seconds: 30 });
    const b = ride(e, { power: 100, cadence: 85, grade: 0.1, seconds: 1 }, a.now);
    expect(b.state.targetPower - a.state.targetPower).toBeLessThanOrEqual(11);
  });

  it('ein Gang schwerer kostet nie mehr als ~15 % (keine Sprünge)', () => {
    const e = new RideEngine();
    for (let i = 1; i < e.gears.ratios.length; i++) {
      expect(e.gears.ratios[i]! / e.gears.ratios[i - 1]!).toBeLessThan(1.15);
    }
  });
});

describe('Gearbox', () => {
  it('bleibt in den Grenzen', () => {
    const g = new Gearbox([1, 2, 3], 1);
    g.up(); g.up(); g.up();
    expect(g.ratio).toBe(3);
    g.down(); g.down(); g.down();
    expect(g.ratio).toBe(1);
  });
  it('startet im Gang für ≈ 20 km/h bei 85 U/min', () => {
    const g = new Gearbox();
    expect(speedFromCadence(85, g.ratio) * 3.6).toBeGreaterThan(17);
    expect(speedFromCadence(85, g.ratio) * 3.6).toBeLessThan(23);
  });
  it('Wunschtempo: 90 U/min, Übersetzung 50/15 ≈ 37,8 km/h', () => {
    expect(speedFromCadence(90, 50 / 15) * 3.6).toBeCloseTo(37.8, 1);
  });
});
