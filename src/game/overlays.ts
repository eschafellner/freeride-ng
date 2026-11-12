import { labelExit, sortExits, TURN_ARROW, type JunctionSelector } from '../world/junction';
import { straightest, type RiderOnNetwork } from '../world/rider';
import { formatSegmentTime, SEGMENT_KIND_LABEL, type SegmentRun } from '../world/segments';
import { SEGMENT_COLOR } from './segmentMarkers';

/** Ab dieser Entfernung zur Kreuzung erscheint die Richtungswahl. */
export const JUNCTION_SHOW_DISTANCE = 160;

/** Anzeige der Abzweigungen vor einer Kreuzung. */
export class JunctionHud {
  private lastKey = '';

  constructor(private readonly el: HTMLElement) {}

  update(rider: RiderOnNetwork, selector: JunctionSelector): void {
    const node = rider.nextNode;
    const exits = rider.upcomingExits();
    const show = exits.length > 1 && rider.distanceToNode < JUNCTION_SHOW_DISTANCE;
    if (!show) {
      if (this.lastKey !== '') {
        this.el.hidden = true;
        this.lastKey = '';
      }
      return;
    }
    const chosen = selector.selectionFor(node.id) ?? straightest(node, exits);
    const sorted = sortExits(exits);
    const key = `${node.id}|${chosen.edge.id}|${chosen.dir}|${Math.round(rider.distanceToNode / 10)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const net = rider.network;
    const items = sorted
      .map((e) => {
        const l = labelExit(net, e);
        const active = e.edge.id === chosen.edge.id && e.dir === chosen.dir;
        const road = l.road ? `<small>${escapeHtml(l.road)}</small>` : '';
        return `<li class="${active ? 'active' : ''}"><b>${TURN_ARROW[l.kind]}</b><span>${escapeHtml(l.destination)}${road}</span></li>`;
      })
      .join('');
    this.el.innerHTML =
      `<div class="junction-title">Kreuzung in ${Math.round(rider.distanceToNode)} m</div><ul>${items}</ul>` +
      `<div class="junction-hint"><kbd>←</kbd> <kbd>→</kbd> wählen</div>`;
    this.el.hidden = false;
  }
}

export type ToastKind = 'info' | 'gold' | 'place' | 'level' | 'segment-ok' | 'segment-bad';

/** Abstand zur Bestzeit als „−3,2 s“ / „+1,0 s“. */
export function formatDelta(delta: number): string {
  const v = Math.abs(delta).toFixed(1).replace('.', ',');
  return `${delta < 0 ? '−' : '+'}${v} s`;
}

/** Anzeige eines laufenden Segmentversuchs mit Vergleich zur Bestzeit. */
export class SegmentHud {
  constructor(private readonly el: HTMLElement) {}

  update(run: SegmentRun | undefined, best: number | null): void {
    if (!run) {
      this.el.hidden = true;
      return;
    }
    const seg = run.segment;
    const frac = seg.length > 0 ? run.covered / seg.length : 0;
    const ghostFrac = run.ghostDistance !== null ? run.ghostDistance / seg.length : null;
    const delta = run.delta === null
      ? ''
      : `<div class="seg-row"><span>zur Bestzeit</span><b class="${run.delta <= 0 ? 'ahead' : 'behind'}">${formatDelta(run.delta)}</b></div>`;
    this.el.style.setProperty('--seg-color', SEGMENT_COLOR[seg.kind]);
    this.el.innerHTML =
      `<div class="seg-kind">${SEGMENT_KIND_LABEL[seg.kind]}</div>` +
      `<div class="seg-name">${escapeHtml(seg.name)}</div>` +
      `<div class="seg-time">${formatSegmentTime(run.elapsed)}</div>` +
      delta +
      `<div class="seg-row"><span>Bestzeit</span><b>${best === null ? '–' : formatSegmentTime(best)}</b></div>` +
      `<div class="seg-row"><span>noch</span><b>${Math.round(run.remaining)} m</b></div>` +
      `<div class="seg-progress"><i style="width:${(frac * 100).toFixed(1)}%"></i>` +
      (ghostFrac === null ? '' : `<b style="left:${(Math.min(1, ghostFrac) * 100).toFixed(1)}%" title="Ghost"></b>`) +
      `</div>`;
    this.el.hidden = false;
  }
}

/** Kurze Meldungen am oberen Bildrand. */
export class Toasts {
  constructor(private readonly el: HTMLElement) {}

  show(title: string, text = '', kind: ToastKind = 'info'): void {
    const div = document.createElement('div');
    div.className = `toast ${kind}`;
    div.innerHTML = `<b>${escapeHtml(title)}</b>${text ? `<span>${escapeHtml(text)}</span>` : ''}`;
    this.el.appendChild(div);
    setTimeout(() => div.classList.add('out'), 3200);
    setTimeout(() => div.remove(), 3800);
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
