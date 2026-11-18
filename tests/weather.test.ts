import { describe, expect, it } from 'vitest';
import { lightState } from '../src/game/dayCycle';
import { presetSettings, sanitizeSettings } from '../src/game/quality';
import {
  applyWeather, fogRange, localLook, LOOKS, WEATHER, WEATHER_KINDS, WeatherTimeline,
} from '../src/game/weatherCycle';

describe('Wetterfolge', () => {
  it('ist für einen Startwert immer gleich und beginnt heiter', () => {
    const a = new WeatherTimeline(42);
    const b = new WeatherTimeline(42);
    for (let t = 0; t < 3 * 3600; t += 97) expect(a.kindAt(t)).toBe(b.kindAt(t));
    expect(a.kindAt(0)).toBe('heiter');
    expect(a.lookAt(0)).toEqual(LOOKS.heiter);
  });

  it('jede Lage hält einige Minuten, alle Lagen kommen vor', () => {
    const tl = new WeatherTimeline(7);
    tl.kindAt(40 * 3600);
    const seen = new Set(tl.segments.map((s) => s.kind));
    expect([...seen].sort()).toEqual([...WEATHER_KINDS].sort());
    for (let i = 1; i < tl.segments.length; i++) {
      const hold = tl.segments[i]!.start - tl.segments[i - 1]!.start;
      expect(hold).toBeGreaterThanOrEqual(WEATHER.minHold);
      expect(hold).toBeLessThanOrEqual(WEATHER.maxHold);
    }
  });

  it('Regen kommt nie aus heiterem Himmel', () => {
    const tl = new WeatherTimeline(3);
    tl.kindAt(40 * 3600);
    for (let i = 1; i < tl.segments.length; i++) {
      if (tl.segments[i]!.kind === 'regen') expect(tl.segments[i - 1]!.kind).toBe('bedeckt');
    }
  });

  it('blendet weich über, ohne Sprung', () => {
    const tl = new WeatherTimeline(11);
    tl.kindAt(4 * 3600);
    const change = tl.segments[1]!.start;
    const before = tl.lookAt(change - 0.01);
    const after = tl.lookAt(change + 0.01);
    expect(Math.abs(after.cover - before.cover)).toBeLessThan(0.01);
    const done = tl.lookAt(change + WEATHER.blend + 1);
    expect(done).toEqual(LOOKS[tl.segments[1]!.kind]);
  });
});

describe('Wetter wirkt auf Licht und Sicht', () => {
  it('bei Regen ist die Sonne gedämpft, nachts keine Sterne hinter den Wolken', () => {
    const day = lightState(500);
    const rain = applyWeather(day, LOOKS.regen);
    expect(rain.lightIntensity).toBeLessThan(day.lightIntensity * 0.3);
    expect(applyWeather(day, LOOKS.klar).lightIntensity).toBeCloseTo(day.lightIntensity);
    const night = lightState(1500);
    expect(night.stars).toBeGreaterThan(0.5);
    expect(applyWeather(night, LOOKS.regen).stars).toBe(0);
  });

  it('Nebel verkürzt die Sicht, klares Wetter wie bisher', () => {
    expect(fogRange(LOOKS.klar)).toEqual({ near: 450, far: 2800 });
    expect(fogRange(LOOKS.nebel).far).toBeLessThan(300);
    expect(fogRange(LOOKS.regen).far).toBeLessThan(fogRange(LOOKS.bewoelkt).far);
  });

  it('in der Glutsteppe regnet es nicht, am Nordkap zieht Seenebel auf', () => {
    expect(localLook(LOOKS.regen, 1, 0).rain).toBe(0);
    expect(localLook(LOOKS.heiter, 0, 1).fog).toBeGreaterThan(0.2);
    expect(localLook(LOOKS.heiter, 0, 0)).toEqual(LOOKS.heiter);
  });

  it('Einstellung: wechselnd als Standard, bleibt bei Voreinstellungen erhalten', () => {
    expect(presetSettings('hoch').weather).toBe('wechselnd');
    expect(presetSettings('niedrig', 'standard', 'zyklus', 'schoen').weather).toBe('schoen');
    expect(sanitizeSettings({ weather: 'schoen' }).weather).toBe('schoen');
    expect(sanitizeSettings({ weather: 'quatsch' }).weather).toBe('wechselnd');
  });
});
