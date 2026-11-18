import { CYCLE_START } from './dayCycle';
import type { WeatherMode } from './quality';
import { LOOKS, localLook, WeatherTimeline, type WeatherKind, type WeatherLook } from './weatherCycle';

/**
 * Wetter zur Laufzeit: Zeit der Wetterfolge (läuft nur während der Fahrt), Modus aus
 * dem Grafikmenü und regionale Eigenheiten am Ort des Fahrers (weich nachgeführt).
 */
export class Weather {
  time = 0;
  private readonly timeline: WeatherTimeline;
  private steppe = 0;
  private coast = 0;
  private look: WeatherLook = { ...LOOKS.heiter };

  constructor(
    private mode: WeatherMode,
    seed = Math.floor(Math.random() * 2 ** 31),
    /** Fest eingestellte Lage (Demo: `&wetter=regen`). */
    private readonly fixed: WeatherKind | null = null,
  ) {
    this.timeline = new WeatherTimeline(seed ^ CYCLE_START);
  }

  setMode(mode: WeatherMode): void {
    this.mode = mode;
  }

  /** Aktuelle Wetterlage (für Anzeige). */
  get kind(): WeatherKind {
    if (this.fixed) return this.fixed;
    return this.mode === 'schoen' ? 'heiter' : this.timeline.kindAt(this.time);
  }

  /**
   * @param running Zeit läuft nur während der Fahrt
   * @param steppe Anteil Glutsteppe am Fahrer, @param coast Anteil Nordkap
   */
  update(dt: number, running: boolean, steppe: number, coast: number): WeatherLook {
    if (running) this.time += dt;
    // Übergang zwischen Regionen über gut 20 s
    const k = Math.min(1, dt / 20);
    this.steppe += (steppe - this.steppe) * k;
    this.coast += (coast - this.coast) * k;
    const base = this.fixed ? LOOKS[this.fixed] : this.mode === 'schoen' ? LOOKS.heiter : this.timeline.lookAt(this.time);
    this.look = this.fixed ? { ...base } : localLook(base, this.steppe, this.coast);
    return this.look;
  }

  get current(): WeatherLook {
    return this.look;
  }
}
