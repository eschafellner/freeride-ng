import type { SoundMix } from './soundMix';

/**
 * Geräusche per Web Audio, alles erzeugt (keine Tondateien): Fahrtwind, Reifen,
 * Freilauf, Brandung, Regen, Vögel, Grillen, Möwen und kurze Klänge für Ereignisse.
 *
 * Browser erlauben Ton erst nach einer Eingabe: `unlock()` bei Klick oder Taste aufrufen.
 */

export type SoundEffect = 'collect' | 'viewpoint' | 'level' | 'segmentStart' | 'segmentFinish' | 'segmentFail' | 'shift' | 'region';

interface NoiseLayer {
  gain: GainNode;
  filter: BiquadFilterNode;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private layers: Record<'wind' | 'tyre' | 'grain' | 'sea' | 'rain' | 'crickets', NoiseLayer> | null = null;
  private volume: number;
  private mix: SoundMix | null = null;
  // Zeitpunkte der nächsten Einzelgeräusche (Sekunden der AudioContext-Uhr)
  private nextTick = 0;
  private nextBird = 0;
  private nextGull = 0;
  private nextCricket = 0;

  constructor(volume: number) {
    this.volume = volume;
  }

  /** Nach der ersten Eingabe aufrufen (Autoplay-Sperre der Browser). */
  unlock(): void {
    if (this.volume <= 0) return;
    if (!this.ctx) this.build();
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  /** Lautstärke 0 … 1 (0 = aus). */
  setVolume(v: number): void {
    this.volume = v;
    if (v > 0 && !this.ctx) return; // wird beim nächsten unlock aufgebaut
    this.master?.gain.setTargetAtTime(v * 0.8, this.ctx!.currentTime, 0.05);
  }

  /** Tab im Hintergrund: Ton anhalten. */
  setSuspended(suspended: boolean): void {
    if (!this.ctx) return;
    if (suspended) void this.ctx.suspend();
    else if (this.volume > 0) void this.ctx.resume();
  }

  private build(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume * 0.8;
    // Sanfter Begrenzer gegen Übersteuern, wenn vieles zugleich klingt
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // Zwei Sekunden rosa-ähnliches Rauschen als Grundlage aller Flächen
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029591;
      b1 = 0.985 * b1 + w * 0.032534;
      b2 = 0.95 * b2 + w * 0.048056;
      d[i] = (b0 + b1 + b2 + w * 0.05) * 1.6;
    }

    const layer = (type: BiquadFilterType, freq: number, q = 0.7, offset = 0): NoiseLayer => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master!);
      src.start(0, offset);
      return { gain, filter };
    };
    this.layers = {
      wind: layer('lowpass', 500, 0.5, 0),
      tyre: layer('lowpass', 400, 0.9, 0.5),
      grain: layer('bandpass', 2200, 1.2, 0.9),
      sea: layer('lowpass', 600, 0.6, 1.3),
      rain: layer('highpass', 1400, 0.5, 1.7),
      crickets: layer('bandpass', 4600, 18, 0.2),
    };
    // Brandung: Lautstärke schwillt langsam an und ab (Wellen)
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const depth = ctx.createGain();
    lfo.connect(depth).connect(this.layers.sea.gain.gain);
    lfo.start();
    this.seaDepth = depth;
    depth.gain.value = 0;
    // Grillen: schnelles Zirpen als Amplitudenmodulation
    const chirp = ctx.createOscillator();
    chirp.type = 'square';
    chirp.frequency.value = 28;
    const chirpDepth = ctx.createGain();
    chirpDepth.gain.value = 0;
    chirp.connect(chirpDepth).connect(this.layers.crickets.gain.gain);
    chirp.start();
    this.cricketDepth = chirpDepth;
    const t = ctx.currentTime;
    this.nextTick = this.nextBird = this.nextGull = this.nextCricket = t + 1;
  }

  private cricketDepth: GainNode | null = null;
  private seaDepth: GainNode | null = null;

  /** Einmal pro Bild mit der aktuellen Mischung aufrufen. */
  update(mix: SoundMix): void {
    this.mix = mix;
    const ctx = this.ctx;
    const L = this.layers;
    if (!ctx || !L || ctx.state !== 'running' || this.volume <= 0) return;
    const t = ctx.currentTime;
    const set = (p: AudioParam, v: number, tc = 0.25) => p.setTargetAtTime(v, t, tc);
    set(L.wind.gain.gain, mix.wind.gain * 0.5);
    set(L.wind.filter.frequency, mix.wind.cutoff);
    set(L.tyre.gain.gain, mix.tyre.gain * 0.6);
    set(L.tyre.filter.frequency, mix.tyre.cutoff);
    // Schotter knirscht unregelmäßig
    set(L.grain.gain.gain, mix.tyre.grain * 0.35 * (0.5 + Math.random()), 0.03);
    set(L.sea.gain.gain, mix.sea * 0.6, 0.8);
    if (this.seaDepth) set(this.seaDepth.gain, mix.sea * 0.4, 0.8);
    set(L.rain.gain.gain, mix.rain * 0.5, 0.8);
    // Grillen zirpen in Gruppen: an und aus im Wechsel
    if (t >= this.nextCricket) {
      const on = mix.crickets > 0.01 && Math.random() < 0.7;
      set(L.crickets.gain.gain, on ? mix.crickets * 0.5 : 0, 0.05);
      if (this.cricketDepth) set(this.cricketDepth.gain, on ? mix.crickets * 0.5 : 0, 0.05);
      this.nextCricket = t + 0.4 + Math.random() * 1.2;
    }

    // Einzelgeräusche bis knapp in die Zukunft einplanen
    const ahead = t + 0.15;
    if (mix.freewheel > 0) {
      if (this.nextTick < t) this.nextTick = t;
      while (this.nextTick < ahead) {
        this.click(this.nextTick);
        this.nextTick += 1 / mix.freewheel;
      }
    } else this.nextTick = t;
    if (t >= this.nextBird) {
      if (mix.birds > 0.2) this.bird(t + 0.05);
      this.nextBird = t + this.interval(mix.birds);
    }
    if (t >= this.nextGull) {
      if (mix.gulls > 0.2) this.gull(t + 0.05);
      this.nextGull = t + this.interval(mix.gulls);
    }
  }

  /** Zufälliger Abstand (s) für eine Rate pro Minute. */
  private interval(perMinute: number): number {
    if (perMinute <= 0.2) return 3;
    return (60 / perMinute) * (0.4 + Math.random() * 1.2);
  }

  /** Kurzer, gefilterter Rauschimpuls (Freilauf). */
  private click(at: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3800;
    f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.09, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.018);
    src.connect(f).connect(g).connect(this.master!);
    src.start(at, Math.random() * 1.5, 0.03);
  }

  /** Ton mit Hüllkurve; optional Frequenzverlauf. */
  private tone(at: number, dur: number, freq: number, to: number, vol: number, type: OscillatorType = 'sine', attack = 0.01): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (to !== freq) o.frequency.exponentialRampToValueAtTime(to, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.master!);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  /** Vogelruf: eine kurze Folge pfeifender Töne. */
  private bird(at: number): void {
    const base = 2400 + Math.random() * 2200;
    const notes = 2 + Math.floor(Math.random() * 5);
    const style = Math.random();
    let t = at;
    for (let i = 0; i < notes; i++) {
      const f = base * (1 + (Math.random() - 0.5) * 0.25);
      const dur = 0.06 + Math.random() * 0.1;
      this.tone(t, dur, f, style < 0.5 ? f * 1.35 : f * 0.75, 0.035, 'sine', 0.008);
      t += dur + 0.03 + Math.random() * 0.08;
    }
  }

  /** Möwe: rauer, absinkender Ruf, oft zwei- bis dreimal. */
  private gull(at: number): void {
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t = at + i * 0.32;
      const f = 1250 + Math.random() * 250;
      this.tone(t, 0.26, f, f * 0.58, 0.022, 'sawtooth', 0.03);
      this.tone(t, 0.26, f * 2, f * 1.1, 0.008, 'triangle', 0.03);
    }
  }

  /** Kurzer Klang für ein Ereignis im Spiel. */
  play(effect: SoundEffect): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.volume <= 0) return;
    const t = ctx.currentTime + 0.02;
    const arp = (notes: number[], step: number, dur: number, vol: number, type: OscillatorType = 'triangle') =>
      notes.forEach((f, i) => this.tone(t + i * step, dur, f, f, vol, type));
    switch (effect) {
      case 'collect': // helles Glitzern
        arp([1319, 1568, 2093, 2637], 0.06, 0.35, 0.07, 'sine');
        break;
      case 'viewpoint': // weicher Akkord
        arp([523, 659, 784], 0.09, 1.1, 0.06);
        break;
      case 'level':
      case 'region': // aufsteigende Fanfare
        arp([523, 659, 784, 1047, 1319], 0.1, 0.5, 0.08);
        break;
      case 'segmentStart':
        arp([880, 880], 0.18, 0.12, 0.07, 'square');
        break;
      case 'segmentFinish':
        arp([784, 1047, 1568], 0.08, 0.6, 0.08);
        break;
      case 'segmentFail':
        arp([440, 330], 0.14, 0.25, 0.05);
        break;
      case 'shift': // Schaltwerk
        this.click(t);
        this.click(t + 0.03);
        break;
    }
  }

  /** Letzte Mischung (für die Testanzeige). */
  get lastMix(): SoundMix | null {
    return this.mix;
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }
}
