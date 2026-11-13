import { describe, expect, it } from 'vitest';
import {
  arcDirection, clockHours, CYCLE, formatClock, lightState, phaseOf, sunAngle, timeForClock, TWILIGHT_ELEVATION,
} from '../src/game/dayCycle';

describe('Tag-Nacht-Zyklus', () => {
  it('30 Minuten: 18 Tag, 12 Nacht mit je 1 Minute Dämmerung', () => {
    expect(CYCLE.length).toBe(1800);
    expect(phaseOf(0)).toBe('tag');
    expect(phaseOf(18 * 60 - 1)).toBe('tag');
    expect(phaseOf(18 * 60 + 30)).toBe('abenddaemmerung');
    expect(phaseOf(19 * 60 + 1)).toBe('nacht');
    expect(phaseOf(29 * 60 + 1)).toBe('morgendaemmerung');
    expect(phaseOf(30 * 60 + 5)).toBe('tag');
  });

  it('Sonne geht im Osten auf, steht mittags hoch im Süden und geht im Westen unter', () => {
    const rise = arcDirection(sunAngle(0));
    const noon = arcDirection(sunAngle(540));
    const set = arcDirection(sunAngle(1079.9));
    expect(rise[0]).toBeGreaterThan(0.9); // Osten = +x
    expect(set[0]).toBeLessThan(-0.9);
    expect(noon[1]).toBeGreaterThan(0.8);
    expect(noon[2]).toBeGreaterThan(0.3); // Süden = +z
  });

  it('die Dämmerung endet eine Minute nach Sonnenuntergang', () => {
    expect(Math.sin(sunAngle(18 * 60 + 60))).toBeCloseTo(TWILIGHT_ELEVATION, 6);
  });

  it('Uhrzeit: Aufgang 6:00, Untergang 18:00, Mitternacht in der Mitte der Nacht', () => {
    expect(clockHours(0)).toBeCloseTo(6);
    expect(clockHours(540)).toBeCloseTo(12);
    expect(clockHours(1080)).toBeCloseTo(18);
    expect(clockHours(1440)).toBeCloseTo(0);
    expect(formatClock(1440)).toBe('0:00');
    for (const h of [0, 3.5, 6, 12, 18, 21.25]) expect(clockHours(timeForClock(h))).toBeCloseTo(h, 6);
  });

  it('nachts: Mond als Licht, Sterne und Lampen an, Tageslicht aus', () => {
    const night = lightState(timeForClock(0));
    expect(night.moon).toBe(true);
    expect(night.stars).toBeCloseTo(1);
    expect(night.lamps).toBeCloseTo(1);
    expect(night.daylight).toBe(0);
    // Mondnacht, nicht stockdunkel: Himmelslicht bleibt bei knapp der Hälfte
    expect(night.hemiIntensity).toBeGreaterThan(0.4);
    expect(night.lightIntensity).toBeGreaterThan(0.4);
  });

  it('tagsüber: Sonne, keine Sterne, Lampen aus', () => {
    const day = lightState(timeForClock(13));
    expect(day.moon).toBe(false);
    expect(day.stars).toBe(0);
    expect(day.lamps).toBe(0);
    expect(day.daylight).toBe(1);
  });

  it('der Übergang ist stetig (keine Sprünge in der Helligkeit)', () => {
    let prev = lightState(0);
    for (let t = 1; t <= CYCLE.length; t++) {
      const s = lightState(t);
      expect(Math.abs(s.hemiIntensity - prev.hemiIntensity)).toBeLessThan(0.05);
      expect(Math.abs(s.lightIntensity - prev.lightIntensity)).toBeLessThan(0.1);
      prev = s;
    }
  });
});
