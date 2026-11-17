import { toFit } from '../history/fit';
import { exportFileName, type RideMeta, type RideSummary, type RideTrack } from '../history/rideLog';
import { toTcx } from '../history/tcx';
import { deleteRide, listRides, loadRideTrack } from './storage';

/** Dauer als h:mm:ss bzw. m:ss. */
export function formatDuration(sec: number): string {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const de = (v: number, digits = 0) => v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Kennzahlen einer Fahrt als Wertepaare für die Anzeige. */
export function summaryFacts(s: RideSummary): [string, string][] {
  const facts: [string, string][] = [
    ['Fahrzeit', formatDuration(s.movingSec)],
    ['Strecke', `${de(s.distance / 1000, 2)} km`],
    ['Höhenmeter', `${de(s.elevationGain)} Hm`],
    ['Ø Tempo', `${de(s.avgSpeed * 3.6, 1)} km/h`],
    ['Ø Leistung', `${de(s.avgPower)} W`],
    ['max. Leistung', `${de(s.maxPower)} W`],
    ['Ø Trittfrequenz', `${de(s.avgCadence)} U/min`],
    ['Arbeit', `${de(s.kj)} kJ`],
  ];
  if (s.avgHr > 0) facts.push(['Ø Puls', `${de(s.avgHr)} /min`]);
  return facts;
}

function rideTitle(meta: RideMeta): string {
  const d = new Date(meta.startedAt);
  const date = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Datei im Browser speichern. */
function saveFile(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = el('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Exportiert eine Fahrt als TCX oder FIT (Download). */
export async function exportRide(meta: RideMeta, kind: 'tcx' | 'fit', track?: RideTrack | null): Promise<void> {
  const t = track ?? (await loadRideTrack(meta.id));
  if (!t || t.ts.length === 0) {
    alert('Für diese Fahrt sind keine Messpunkte gespeichert.');
    return;
  }
  if (kind === 'tcx') saveFile(exportFileName(meta, 'tcx'), toTcx(meta, t), 'application/vnd.garmin.tcx+xml');
  else saveFile(exportFileName(meta, 'fit'), toFit(meta, t), 'application/vnd.ant.fit');
}

function exportButtons(meta: RideMeta, track?: RideTrack): HTMLElement {
  const row = el('div', 'ride-actions');
  for (const kind of ['tcx', 'fit'] as const) {
    const b = el('button', undefined, kind.toUpperCase());
    b.title = kind === 'tcx' ? 'Als TCX exportieren (Strava, Garmin Connect, …)' : 'Als FIT exportieren (Strava, Garmin Connect, intervals.icu, …)';
    b.addEventListener('click', () => void exportRide(meta, kind, track));
    row.append(b);
  }
  return row;
}

function factsTable(s: RideSummary): HTMLElement {
  const dl = el('dl', 'ride-facts');
  for (const [k, v] of summaryFacts(s)) dl.append(el('dt', undefined, k), el('dd', undefined, v));
  return dl;
}

/**
 * Fahrten-Historie: Liste aller gespeicherten Fahrten mit Export und Löschen.
 * Die laufende Fahrt (falls gespeichert) ist markiert und lässt sich nicht löschen.
 */
export class HistoryPanel {
  constructor(
    private readonly root: HTMLElement,
    private readonly onClose: () => void,
    private readonly currentId: () => string | null = () => null,
  ) {}

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  async open(): Promise<void> {
    this.root.hidden = false;
    this.root.replaceChildren(el('h2', undefined, 'Fahrten'), el('p', 'hint', 'Lade …'));
    const rides = await listRides();
    this.render(rides);
  }

  close(): void {
    this.root.hidden = true;
    this.onClose();
  }

  private render(rides: RideMeta[]): void {
    const head = el('div', 'history-head');
    const close = el('button', 'link', 'Schließen');
    close.addEventListener('click', () => this.close());
    head.append(el('h2', undefined, 'Fahrten'), close);

    const total = rides.reduce((a, r) => ({ km: a.km + r.summary.distance / 1000, sec: a.sec + r.summary.movingSec }), { km: 0, sec: 0 });
    const intro = el('p', 'sub', rides.length
      ? `${rides.length} ${rides.length === 1 ? 'Fahrt' : 'Fahrten'} · ${de(total.km, 1)} km · ${formatDuration(total.sec)}`
      : 'Noch keine Fahrten gespeichert. Gespeichert wird jede Fahrt ab einer Minute.');

    const list = el('ul', 'ride-list');
    for (const r of rides) {
      const li = el('li', 'ride');
      const title = el('div', 'ride-title');
      title.append(el('strong', undefined, rideTitle(r)));
      if (r.startPlace) title.append(el('span', 'ride-place', ` · ${r.startPlace}`));
      if (r.device === 'simulator') title.append(el('span', 'ride-badge', 'Simulator'));
      if (r.id === this.currentId()) title.append(el('span', 'ride-badge live', 'läuft'));
      const s = r.summary;
      const stats = el('div', 'ride-stats',
        `${formatDuration(s.movingSec)} · ${de(s.distance / 1000, 1)} km · ${de(s.elevationGain)} Hm · ` +
        `Ø ${de(s.avgPower)} W · Ø ${de(s.avgSpeed * 3.6, 1)} km/h`);
      const actions = exportButtons(r);
      if (r.id !== this.currentId()) {
        const del = el('button', 'link danger', 'Löschen');
        del.addEventListener('click', async () => {
          if (!confirm(`Fahrt vom ${rideTitle(r)} löschen?`)) return;
          await deleteRide(r.id);
          this.render(rides.filter((x) => x.id !== r.id));
        });
        actions.append(del);
      }
      li.append(title, stats, actions);
      list.append(li);
    }
    const hint = el('p', 'hint', 'Export ohne GPS-Position: Strava, Garmin Connect & Co. zeigen die Fahrt als virtuelle Indoor-Fahrt mit Leistung, Trittfrequenz und Höhenprofil.');
    this.root.replaceChildren(head, intro, list, hint);
  }
}

/** Zusammenfassung nach „Fahrt beenden“. */
export function showRideDone(
  root: HTMLElement,
  meta: RideMeta | null,
  track: RideTrack | null,
  saved: boolean,
  actions: { menu: () => void; history: () => void },
): void {
  root.hidden = false;
  const children: HTMLElement[] = [el('h2', undefined, 'Fahrt beendet')];
  if (meta && track) {
    const note = saved ? 'gespeichert' : 'Demo-Modus: nicht gespeichert, Export geht trotzdem';
    children.push(el('p', 'sub', `${rideTitle(meta)} · ${note}`), factsTable(meta.summary), exportButtons(meta, track));
  } else {
    children.push(el('p', 'sub', 'Die Fahrt war kürzer als eine Minute und wurde nicht gespeichert.'));
  }
  const nav = el('div', 'choices');
  const menu = el('button', 'primary', 'Zum Startmenü');
  menu.addEventListener('click', actions.menu);
  const hist = el('button', undefined, 'Alle Fahrten');
  hist.addEventListener('click', actions.history);
  nav.append(menu, hist);
  children.push(nav);
  root.replaceChildren(...children);
}
