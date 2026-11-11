import type { PowerLimits } from './types';

/**
 * Sicherheitsregeln für die Zielleistung. Lebt bewusst im Treiber-Ordner,
 * damit kein Spielfehler die Grenzen umgehen kann.
 *
 * - harte Grenzen (Gerät und persönliches Maximum)
 * - Rundung auf die Schrittweite des Geräts
 * - Anstieg höchstens maxRiseWattsPerSec; Absenken ist immer sofort erlaubt
 */
export class PowerLimiter {
  /** Freigegebener, auf die Schrittweite gerundeter Wert. */
  private current: number;
  /** Ungerundete Rampe, damit auch kleine Zeitschritte vorankommen. */
  private ramp: number;

  constructor(private readonly limits: PowerLimits) {
    if (limits.minWatts > limits.maxWatts) {
      throw new Error('minWatts > maxWatts');
    }
    this.current = limits.minWatts;
    this.ramp = limits.minWatts;
  }

  get upperBound(): number {
    return Math.min(this.limits.maxWatts, this.limits.personalMaxWatts);
  }

  get minWatts(): number {
    return this.limits.minWatts;
  }

  /** Zuletzt freigegebener Wert. */
  get value(): number {
    return this.current;
  }

  /** Begrenzt einen Wert auf [min, upperBound] und rundet auf die Schrittweite. */
  clamp(watts: number): number {
    const { minWatts, stepWatts } = this.limits;
    const max = this.upperBound;
    if (!Number.isFinite(watts)) return minWatts;
    const bounded = Math.min(max, Math.max(minWatts, watts));
    // Abrunden auf die Schrittweite: im Zweifel leichter, nie schwerer
    const stepped = Math.floor(bounded / stepWatts) * stepWatts;
    return Math.max(minWatts, stepped);
  }

  /**
   * Bewegt den freigegebenen Wert Richtung `desired`.
   * @param dtSec vergangene Zeit seit dem letzten Aufruf in Sekunden
   */
  step(desired: number, dtSec: number): number {
    const target = this.clamp(desired);
    if (target <= this.ramp) {
      this.ramp = target;
    } else {
      const maxRise = this.limits.maxRiseWattsPerSec * Math.max(0, dtSec);
      this.ramp = Math.min(target, this.ramp + maxRise);
    }
    this.current = this.clamp(this.ramp);
    return this.current;
  }

  /** Sofort auf das Minimum (Notstopp, Pause, Verbindungsende). */
  reset(): number {
    this.current = this.limits.minWatts;
    this.ramp = this.limits.minWatts;
    return this.current;
  }
}
