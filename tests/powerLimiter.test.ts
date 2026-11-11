import { describe, expect, it } from 'vitest';
import { PowerLimiter } from '../src/device/powerLimiter';
import { DEFAULT_POWER_LIMITS, type PowerLimits } from '../src/device/types';

const limits: PowerLimits = { ...DEFAULT_POWER_LIMITS, personalMaxWatts: 300 };

describe('PowerLimiter.clamp', () => {
  const l = new PowerLimiter(limits);
  it('hält die Untergrenze', () => expect(l.clamp(0)).toBe(25));
  it('hält das persönliche Maximum', () => expect(l.clamp(1000)).toBe(300));
  it('rundet auf 5 W ab', () => expect(l.clamp(149)).toBe(145));
  it('behandelt NaN und Infinity sicher', () => {
    expect(l.clamp(NaN)).toBe(25);
    expect(l.clamp(Infinity)).toBe(25);
  });
  it('nimmt das kleinere aus Geräte- und persönlichem Maximum', () => {
    expect(new PowerLimiter({ ...limits, maxWatts: 200 }).clamp(1000)).toBe(200);
  });
});

describe('PowerLimiter.step', () => {
  it('startet am Minimum', () => expect(new PowerLimiter(limits).value).toBe(25));

  it('steigt höchstens 20 W pro Sekunde', () => {
    const l = new PowerLimiter(limits);
    expect(l.step(300, 1)).toBe(45);
    expect(l.step(300, 1)).toBe(65);
    expect(l.step(300, 2)).toBe(105);
  });

  it('kommt auch mit kleinen Zeitschritten voran', () => {
    const l = new PowerLimiter(limits);
    for (let i = 0; i < 20; i++) l.step(300, 0.05); // 1 s in 20 Schritten
    expect(l.value).toBe(45);
  });

  it('senkt sofort ab', () => {
    const l = new PowerLimiter(limits);
    for (let i = 0; i < 10; i++) l.step(200, 1);
    expect(l.value).toBe(200);
    expect(l.step(50, 0.1)).toBe(50);
  });

  it('ignoriert negative Zeitschritte', () => {
    const l = new PowerLimiter(limits);
    expect(l.step(300, -5)).toBe(25);
  });

  it('reset geht sofort aufs Minimum und rampt danach neu', () => {
    const l = new PowerLimiter(limits);
    for (let i = 0; i < 10; i++) l.step(200, 1);
    expect(l.reset()).toBe(25);
    expect(l.step(200, 1)).toBe(45);
  });

  it('überschreitet nie die Grenzen, egal was kommt', () => {
    const l = new PowerLimiter(limits);
    let prev = l.value;
    for (let i = 0; i < 2000; i++) {
      const desired = [NaN, -50, 0, 99999, Math.random() * 600][i % 5]!;
      const dt = Math.random() * 3;
      const v = l.step(desired, dt);
      expect(v).toBeGreaterThanOrEqual(25);
      expect(v).toBeLessThanOrEqual(300);
      expect(v % 5).toBe(0);
      // Rasterung auf 5 W: pro Schritt höchstens eine Stufe über der Rate
      expect(v - prev).toBeLessThanOrEqual(20 * dt + 5);
      prev = v;
    }
  });

  it('hält die Anstiegsrate über ein Zeitfenster ein, auch bei feinen Schritten', () => {
    const l = new PowerLimiter(limits);
    const values: number[] = [];
    for (let i = 0; i < 400; i++) values.push(l.step(300, 0.05)); // 20 s
    // Über jedes 1-s-Fenster (20 Schritte) höchstens 20 W + eine Stufe Rasterung
    for (let i = 20; i < values.length; i++) {
      expect(values[i]! - values[i - 20]!).toBeLessThanOrEqual(25);
    }
    expect(values.at(-1)).toBe(300);
  });
});
