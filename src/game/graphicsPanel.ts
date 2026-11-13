import {
  LIMITS, presetSettings, QUALITY_LABEL, type GraphicsSettings, type QualityLevel,
} from './quality';

const SHADOW_LABEL: Record<number, string> = { 0: 'Aus', 1024: 'Niedrig', 2048: 'Mittel', 4096: 'Hoch' };
const WAVE_LABEL: Record<number, string> = { 0: 'Flach', 16: 'Grob', 8: 'Fein' };

/**
 * Grafikmenü: Voreinstellungen und einzelne Regler. Jede Änderung geht sofort
 * an `onChange`; wer einen Regler bewegt, landet bei der Voreinstellung „Eigene“.
 */
export class GraphicsPanel {
  private settings: GraphicsSettings;

  constructor(
    private readonly el: HTMLElement,
    initial: GraphicsSettings,
    private readonly onChange: (s: GraphicsSettings) => void,
  ) {
    this.settings = { ...initial };
    this.build();
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  show(visible: boolean): void {
    this.el.hidden = !visible;
    if (visible) this.sync();
  }

  private build(): void {
    const levels: QualityLevel[] = ['niedrig', 'mittel', 'hoch'];
    const range = (id: string, l: { min: number; max: number; step: number }) =>
      `<input type="range" id="${id}" min="${l.min}" max="${l.max}" step="${l.step}">`;
    const select = (id: string, values: readonly number[], labels: Record<number, string>) =>
      `<select id="${id}">${values.map((v) => `<option value="${v}">${labels[v]}</option>`).join('')}</select>`;
    this.el.innerHTML = `
      <h2>Grafik <small id="g-preset"></small></h2>
      <div class="g-presets">${levels.map((l) => `<button data-preset="${l}">${QUALITY_LABEL[l]}</button>`).join('')}</div>
      <div class="g-grid">
        <label for="g-grass">Grasweite</label>${range('g-grass', LIMITS.grassDistance)}<output id="g-grass-v"></output>
        <label for="g-density">Grasdichte</label>${range('g-density', LIMITS.grassDensity)}<output id="g-density-v"></output>
        <label for="g-ratio">Bildschärfe</label>${range('g-ratio', LIMITS.pixelRatio)}<output id="g-ratio-v"></output>
        <label for="g-detail">Detailweite</label>${range('g-detail', LIMITS.detailDistance)}<output id="g-detail-v"></output>
        <label for="g-surfaces">Hausoberflächen</label><input type="checkbox" id="g-surfaces"><span></span>
        <label for="g-shadow">Schatten</label>${select('g-shadow', LIMITS.shadowMapSize, SHADOW_LABEL)}<span></span>
        <label for="g-waves">Wellen</label>${select('g-waves', LIMITS.waveCell, WAVE_LABEL)}<span></span>
        <label for="g-ao">Kontaktschatten</label><input type="checkbox" id="g-ao"><span></span>
        <label for="g-bloom">Leuchten (Bloom)</label><input type="checkbox" id="g-bloom"><span></span>
        <label for="g-daynight">Tageszeit</label><select id="g-daynight"><option value="zyklus">Tag-Nacht-Zyklus</option><option value="tag">Immer Tag</option></select><span></span>
        <label for="g-hud">Anzeige</label><select id="g-hud"><option value="standard">Standard</option><option value="radcomputer">Fahrradcomputer</option></select><span></span>
        <label>Bildrate</label><b id="g-fps">–</b><span></span>
      </div>
      <p class="hint">Änderungen wirken sofort. Kontaktschatten, Bloom und große Grasweite kosten am meisten.</p>
      <button id="g-close" class="primary">Fertig <kbd>G</kbd></button>`;

    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
      b.addEventListener('click', () => this.set(presetSettings(b.dataset.preset as QualityLevel, this.settings.hud, this.settings.dayNight)));
    }
    const $ = <T extends HTMLElement>(id: string) => this.el.querySelector<T>(`#${id}`)!;
    const custom = (patch: Partial<GraphicsSettings>) => this.set({ ...this.settings, ...patch, preset: 'eigene' });
    $<HTMLInputElement>('g-grass').addEventListener('input', (e) => custom({ grassDistance: Number((e.target as HTMLInputElement).value) }));
    $<HTMLInputElement>('g-density').addEventListener('input', (e) => custom({ grassDensity: Number((e.target as HTMLInputElement).value) }));
    $<HTMLInputElement>('g-ratio').addEventListener('input', (e) => custom({ pixelRatio: Number((e.target as HTMLInputElement).value) }));
    $<HTMLInputElement>('g-detail').addEventListener('input', (e) => custom({ detailDistance: Number((e.target as HTMLInputElement).value) }));
    $<HTMLInputElement>('g-surfaces').addEventListener('change', (e) => custom({ surfaces: (e.target as HTMLInputElement).checked }));
    $<HTMLSelectElement>('g-shadow').addEventListener('change', (e) => custom({ shadowMapSize: Number((e.target as HTMLSelectElement).value) }));
    $<HTMLSelectElement>('g-waves').addEventListener('change', (e) => custom({ waveCell: Number((e.target as HTMLSelectElement).value) }));
    $<HTMLInputElement>('g-ao').addEventListener('change', (e) => custom({ ao: (e.target as HTMLInputElement).checked }));
    $<HTMLInputElement>('g-bloom').addEventListener('change', (e) => custom({ bloom: (e.target as HTMLInputElement).checked }));
    // Die Anzeige ist keine Grafiklast: Voreinstellung bleibt erhalten
    $<HTMLSelectElement>('g-hud').addEventListener('change', (e) =>
      this.set({ ...this.settings, hud: (e.target as HTMLSelectElement).value === 'radcomputer' ? 'radcomputer' : 'standard' }));
    $<HTMLSelectElement>('g-daynight').addEventListener('change', (e) =>
      this.set({ ...this.settings, dayNight: (e.target as HTMLSelectElement).value === 'tag' ? 'tag' : 'zyklus' }));
    $('g-close').addEventListener('click', () => this.onClose?.());
  }

  /** Aktuelle Bildrate anzeigen (nur bei offenem Menü sichtbar). */
  showFps(fps: number, ms: number): void {
    if (this.el.hidden) return;
    this.el.querySelector('#g-fps')!.textContent = `${Math.round(fps)} fps · ${ms.toFixed(1)} ms`;
  }

  /** Wird beim Klick auf „Fertig“ aufgerufen. */
  onClose: (() => void) | null = null;

  private set(s: GraphicsSettings): void {
    this.settings = s;
    this.sync();
    this.onChange({ ...s });
  }

  private sync(): void {
    const s = this.settings;
    const $ = <T extends HTMLElement>(id: string) => this.el.querySelector<T>(`#${id}`)!;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
      b.classList.toggle('active', b.dataset.preset === s.preset);
    }
    $('g-preset').textContent = s.preset === 'eigene' ? 'eigene Einstellung' : '';
    $<HTMLInputElement>('g-grass').value = String(s.grassDistance);
    $('g-grass-v').textContent = s.grassDistance === 0 ? 'aus' : `${s.grassDistance} m`;
    $<HTMLInputElement>('g-density').value = String(s.grassDensity);
    $('g-density-v').textContent = String(s.grassDensity);
    $<HTMLInputElement>('g-ratio').value = String(s.pixelRatio);
    $('g-ratio-v').textContent = `${String(s.pixelRatio).replace('.', ',')}×`;
    $<HTMLInputElement>('g-detail').value = String(s.detailDistance);
    $('g-detail-v').textContent = `${String(s.detailDistance).replace('.', ',')}×`;
    $<HTMLInputElement>('g-surfaces').checked = s.surfaces;
    $<HTMLSelectElement>('g-shadow').value = String(s.shadowMapSize);
    $<HTMLSelectElement>('g-waves').value = String(s.waveCell);
    $<HTMLInputElement>('g-ao').checked = s.ao;
    $<HTMLInputElement>('g-bloom').checked = s.bloom;
    $<HTMLSelectElement>('g-hud').value = s.hud;
    $<HTMLSelectElement>('g-daynight').value = s.dayNight;
  }
}
