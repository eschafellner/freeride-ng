import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHYSICS,
  MAX_SPEED_MS,
  msToKmh,
  powerRequired,
  speedFromPower,
  stepSpeed,
} from '../src/engine/physics';

/** Simuliert bis zum Gleichgewicht und liefert das Endtempo. */
function settle(power: number, grade: number, seconds = 300, v0 = 0) {
  let v = v0;
  for (let t = 0; t < seconds; t += 0.05) v = stepSpeed(v, power, grade, 0.05);
  return v;
}

describe('powerRequired', () => {
  it('ist 0 im Stand', () => expect(powerRequired(0, 0.05)).toBe(0));
  it('steigt mit Tempo und Steigung', () => {
    expect(powerRequired(8, 0)).toBeLessThan(powerRequired(9, 0));
    expect(powerRequired(5, 0)).toBeLessThan(powerRequired(5, 0.05));
  });
  it('ist bergab bei langsamem Tempo negativ', () => {
    expect(powerRequired(5, -0.05)).toBeLessThan(0);
  });
  it('rechnet einen Referenzwert nach (Ebene, 30 km/h ≈ 150 W)', () => {
    const v = 30 / 3.6;
    const expected =
      v * (85 * 9.81 * 0.005 + 0.5 * 1.2 * 0.32 * v * v); // cos(0)=1, sin(0)=0
    expect(powerRequired(v, 0)).toBeCloseTo(expected, 6);
    expect(expected).toBeGreaterThan(140);
    expect(expected).toBeLessThan(160);
  });
});

describe('speedFromPower (Gleichgewicht, 85 kg)', () => {
  it.each([
    // [Beschreibung, Watt, Steigung, min km/h, max km/h]
    ['Ebene 200 W', 200, 0, 32, 36],
    ['Ebene 100 W', 100, 0, 25, 28],
    ['5 % mit 200 W', 200, 0.05, 13.5, 16],
    ['10 % mit 200 W', 200, 0.1, 7.5, 9],
    ['−5 % rollend mit 25 W', 25, -0.05, 48, 54],
  ])('%s', (_name, watts, grade, minKmh, maxKmh) => {
    const kmh = msToKmh(speedFromPower(watts, grade));
    expect(kmh).toBeGreaterThan(minKmh);
    expect(kmh).toBeLessThan(maxKmh);
  });

  it('ist die Umkehrung von powerRequired', () => {
    for (const grade of [-0.08, -0.02, 0, 0.03, 0.07, 0.12]) {
      for (const watts of [25, 100, 180, 300]) {
        const v = speedFromPower(watts, grade);
        expect(powerRequired(v, grade)).toBeCloseTo(watts, 3);
      }
    }
  });

  it('bleibt bergauf ohne Leistung stehen', () => {
    expect(speedFromPower(0, 0.05)).toBe(0);
  });

  it('begrenzt auf das Höchsttempo', () => {
    expect(speedFromPower(2000, -0.2)).toBe(MAX_SPEED_MS);
  });

  it('wird mit höherem Gewicht bergauf langsamer', () => {
    const heavy = { ...DEFAULT_PHYSICS, massKg: 100 };
    expect(speedFromPower(200, 0.05, heavy)).toBeLessThan(speedFromPower(200, 0.05));
  });
});

describe('stepSpeed (Fahrdynamik)', () => {
  it.each([
    ['Ebene', 200, 0],
    ['5 %', 200, 0.05],
    ['10 %', 200, 0.1],
    ['Abfahrt −5 %', 25, -0.05],
  ])('läuft gegen das Gleichgewichtstempo: %s', (_name, watts, grade) => {
    expect(settle(watts, grade)).toBeCloseTo(speedFromPower(watts, grade), 2);
  });

  it('fährt aus dem Stand an', () => {
    expect(stepSpeed(0, 200, 0, 0.05)).toBeGreaterThan(0);
  });

  it('rollt nicht rückwärts', () => {
    expect(settle(0, 0.1, 30, 5)).toBe(0);
  });

  it('rollt nach dem Aufhören auf der Ebene aus', () => {
    const v = settle(0, 0, 60, 9);
    expect(v).toBeLessThan(9);
    expect(v).toBeGreaterThanOrEqual(0);
  });

  it('beschleunigt bergab auch ohne Treten', () => {
    expect(settle(0, -0.06, 60)).toBeGreaterThan(10);
  });

  it('ignoriert negative Leistung', () => {
    expect(stepSpeed(5, -500, 0, 0.05)).toBeCloseTo(stepSpeed(5, 0, 0, 0.05), 10);
  });
});
