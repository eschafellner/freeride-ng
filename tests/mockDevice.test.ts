import { describe, expect, it } from 'vitest';
import { MockDevice } from '../src/device/MockDevice';

function makeMock() {
  let t = 0;
  const dev = new MockDevice({ random: () => 0.5, now: () => t });
  return { dev, advance: (sec: number) => (t += sec * 1000) };
}

describe('MockDevice', () => {
  it('liefert 0 W, solange nicht getreten wird', async () => {
    const { dev, advance } = makeMock();
    await dev.connect();
    dev.setTargetPower(150);
    advance(1);
    expect(dev.tick().power).toBe(0);
    await dev.disconnect();
  });

  it('folgt im ERG-Modus der Zielleistung mit Anstiegsbegrenzung', async () => {
    const { dev, advance } = makeMock();
    await dev.connect();
    dev.cadence = 90;
    dev.setTargetPower(150);
    advance(1);
    expect(dev.tick().targetPower).toBe(45);
    let m = dev.tick();
    for (let i = 0; i < 30; i++) {
      advance(1);
      m = dev.tick();
    }
    expect(m.targetPower).toBe(150);
    expect(m.power).toBeGreaterThan(140);
    expect(m.power).toBeLessThan(160);
    expect(m.cadence).toBe(90);
    expect(m.distanceKm).toBeGreaterThan(0);
    await dev.disconnect();
  });

  it('Notstopp setzt das Ziel sofort aufs Minimum', async () => {
    const { dev, advance } = makeMock();
    await dev.connect();
    dev.cadence = 80;
    dev.setTargetPower(200);
    for (let i = 0; i < 20; i++) {
      advance(1);
      dev.tick();
    }
    dev.emergencyStop();
    expect(dev.sentPower).toBe(25);
    advance(1);
    expect(dev.tick().targetPower).toBe(25);
    await dev.disconnect();
  });

  it('Trittstärke ist auf ±100 W begrenzt', async () => {
    const { dev, advance } = makeMock();
    await dev.connect();
    dev.cadence = 90;
    dev.powerOffset = 5000; // z.B. Taste gedrückt gehalten
    dev.setTargetPower(100);
    let m = dev.tick();
    for (let i = 0; i < 60; i++) {
      advance(1);
      m = dev.tick();
    }
    expect(m.power).toBeLessThanOrEqual(100 + 100 + 5);
    await dev.disconnect();
  });

  it('bei sehr niedriger Trittfrequenz bricht die Leistung ein', async () => {
    const { dev, advance } = makeMock();
    await dev.connect();
    dev.cadence = 3;
    dev.setTargetPower(150);
    let m = dev.tick();
    for (let i = 0; i < 60; i++) {
      advance(1);
      m = dev.tick();
    }
    expect(m.power).toBeLessThan(20);
    await dev.disconnect();
  });

  it('meldet Statuswechsel', async () => {
    const { dev } = makeMock();
    const seen: string[] = [];
    dev.onStatus((s) => seen.push(s));
    await dev.connect();
    await dev.disconnect();
    expect(seen).toEqual(['connecting', 'connected', 'disconnected']);
  });
});
