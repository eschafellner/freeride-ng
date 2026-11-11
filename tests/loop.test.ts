import { describe, expect, it } from 'vitest';
import { MockDevice } from '../src/device/MockDevice';
import { FixedStepLoop } from '../src/engine/fixedStepLoop';
import { RideEngine } from '../src/engine/rideEngine';
import { RideSession } from '../src/engine/rideSession';

describe('FixedStepLoop', () => {
  it('zerlegt Zeit in feste Schritte und merkt sich den Rest', () => {
    const steps: number[] = [];
    const loop = new FixedStepLoop(0.05, (dt) => steps.push(dt));
    expect(loop.advance(0.016)).toBe(0);
    expect(loop.advance(0.016)).toBe(0);
    expect(loop.advance(0.02)).toBe(1);
    expect(loop.alpha).toBeCloseTo(0.04, 5);
    expect(steps).toEqual([0.05]);
  });

  it('verwirft großen Rückstand statt nachzuholen', () => {
    let n = 0;
    const loop = new FixedStepLoop(0.05, () => n++, 10);
    expect(loop.advance(30)).toBe(10);
    expect(loop.advance(0.01)).toBe(0);
    expect(n).toBe(10);
  });

  it('ignoriert negative und NaN-Zeit', () => {
    const loop = new FixedStepLoop(0.05, () => undefined);
    expect(loop.advance(-1)).toBe(0);
    expect(loop.advance(NaN)).toBe(0);
  });
});

describe('RideSession mit MockDevice', () => {
  function setup(grade = 0.05) {
    let now = 0;
    const device = new MockDevice({ random: () => 0.5, now: () => now });
    const engine = new RideEngine({ difficulty: 1 });
    const session = new RideSession(engine, device, { now: () => now, gradeProvider: () => grade });
    /** Simuliert Echtzeit: Gerät tickt 1×/s, Grafik mit 60 fps. */
    const run = (seconds: number) => {
      for (let f = 0; f < seconds * 60; f++) {
        const prev = now;
        now += 1000 / 60;
        if (Math.floor(now / 1000) > Math.floor(prev / 1000)) device.tick();
        session.advance(1 / 60);
      }
    };
    return { device, engine, session, run };
  }

  it('Messwerte → Engine → Zielwatt → Gerät', async () => {
    const { device, session, run } = setup(0.05);
    await device.connect();
    session.start();
    device.cadence = 85;
    run(60);
    expect(session.state.speed).toBeGreaterThan(2);
    expect(session.state.targetPower).toBeGreaterThan(100);
    // Gerät folgt der Engine (mit eigener Rampe und Trägheit)
    expect(Math.abs(device.sentPower - session.state.targetPower)).toBeLessThanOrEqual(25);
    session.stop();
    await device.disconnect();
  });

  it('Pause setzt das Gerät sofort aufs Minimum und hält die Physik an', async () => {
    const { device, session, run } = setup(0.05);
    await device.connect();
    session.start();
    device.cadence = 85;
    run(30);
    const before = session.state.distance;
    session.pause();
    expect(device.sentPower).toBe(25);
    run(10);
    expect(session.state.distance).toBe(before);
    session.resume();
    run(2);
    expect(session.state.distance).toBeGreaterThan(before);
    session.stop();
    await device.disconnect();
  });
});
