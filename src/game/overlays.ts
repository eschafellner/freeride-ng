import { labelExit, sortExits, TURN_ARROW, type JunctionSelector } from '../world/junction';
import { straightest, type RiderOnNetwork } from '../world/rider';

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

/** Kurze Meldungen am oberen Bildrand. */
export class Toasts {
  constructor(private readonly el: HTMLElement) {}

  show(title: string, text = '', kind: 'info' | 'gold' | 'place' = 'info'): void {
    const div = document.createElement('div');
    div.className = `toast ${kind}`;
    div.innerHTML = `<b>${escapeHtml(title)}</b>${text ? `<span>${escapeHtml(text)}</span>` : ''}`;
    this.el.appendChild(div);
    setTimeout(() => div.classList.add('out'), 3200);
    setTimeout(() => div.remove(), 3800);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
