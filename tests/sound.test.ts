import { describe, expect, it } from 'vitest';
import { seaNearness, soundMix, type SoundInput } from '../src/game/soundMix';

const base: SoundInput = {
  speed: 0, cadence: 0, gravel: false, paused: false, rain: 0, overcast: 0,
  daylight: 1, sea: 0, steppe: 0, coast: 0, height: 50,
};

describe('Geräuschmischung', () => {
  it('im Stand rollt nichts, Fahrtwind wächst mit dem Tempo', () => {
    const still = soundMix(base);
    expect(still.tyre.gain).toBe(0);
    expect(still.freewheel).toBe(0);
    const slow = soundMix({ ...base, speed: 5, cadence: 80 });
    const fast = soundMix({ ...base, speed: 12, cadence: 80 });
    expect(fast.wind.gain).toBeGreaterThan(slow.wind.gain);
    expect(fast.wind.cutoff).toBeGreaterThan(slow.wind.cutoff);
    expect(fast.wind.gain).toBeLessThanOrEqual(0.9);
  });

  it('der Freilauf klickt nur beim Rollen ohne Treten', () => {
    expect(soundMix({ ...base, speed: 8, cadence: 85 }).freewheel).toBe(0);
    const coast = soundMix({ ...base, speed: 8, cadence: 0 }).freewheel;
    expect(coast).toBeGreaterThan(0);
    expect(soundMix({ ...base, speed: 14, cadence: 0 }).freewheel).toBeGreaterThan(coast);
  });

  it('Schotter knirscht, Asphalt nicht', () => {
    expect(soundMix({ ...base, speed: 6, cadence: 80 }).tyre.grain).toBe(0);
    const gravel = soundMix({ ...base, speed: 6, cadence: 80, gravel: true });
    expect(gravel.tyre.grain).toBeGreaterThan(0);
    expect(gravel.tyre.gain).toBeGreaterThan(soundMix({ ...base, speed: 6, cadence: 80 }).tyre.gain);
  });

  it('Vögel am Tag, Grillen in der Nacht, bei Regen beide still', () => {
    expect(soundMix(base).birds).toBeGreaterThan(5);
    expect(soundMix(base).crickets).toBe(0);
    const night = soundMix({ ...base, daylight: 0 });
    expect(night.birds).toBe(0);
    expect(night.crickets).toBeGreaterThan(0);
    const rain = soundMix({ ...base, rain: 1 });
    expect(rain.birds).toBe(0);
    expect(rain.rain).toBeGreaterThan(0);
    expect(soundMix({ ...base, daylight: 0, rain: 1 }).crickets).toBe(0);
  });

  it('in der Steppe kaum Vögel, an der Küste Brandung und Möwen', () => {
    expect(soundMix({ ...base, steppe: 1 }).birds).toBeLessThan(soundMix(base).birds * 0.2);
    expect(soundMix(base).gulls).toBe(0);
    const coast = soundMix({ ...base, sea: 1, coast: 1 });
    expect(coast.sea).toBeGreaterThan(0.4);
    expect(coast.gulls).toBeGreaterThan(3);
  });

  it('in der Pause schweigt das Rad, die Umgebung wird leiser', () => {
    const ride = soundMix({ ...base, speed: 10, cadence: 0, sea: 1 });
    const pause = soundMix({ ...base, speed: 10, cadence: 0, sea: 1, paused: true });
    expect(pause.tyre.gain).toBe(0);
    expect(pause.freewheel).toBe(0);
    expect(pause.sea).toBeCloseTo(ride.sea / 2);
  });
});

describe('Nähe zum Meer', () => {
  it('landeinwärts 0, an der Küste fast voll, auf dem Wasser 1', () => {
    expect(seaNearness(() => 50, 0, 0)).toBe(0);
    expect(seaNearness(() => -5, 0, 0)).toBe(1);
    // Meer nördlich (z < -30): halber Kreis nass
    expect(seaNearness((_x, z) => (z < -30 ? -5 : 20), 0, 0)).toBeGreaterThan(0.8);
  });
});
