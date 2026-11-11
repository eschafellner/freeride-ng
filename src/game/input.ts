/**
 * Eingabe: Tastatur und Gamepad (Standard-Mapping der Gamepad API) auf
 * gemeinsame Spielaktionen abgebildet.
 *
 * Gamepad: Steuerkreuz/linker Stick ←/→ Abzweigung, ↑ geradeaus, ↓ Kehrtwende,
 * LB/RB schalten, Start Pause, Back/Select Karte.
 */

export type Action =
  | 'turnLeft'
  | 'turnRight'
  | 'straight'
  | 'uturn'
  | 'shiftDown'
  | 'shiftUp'
  | 'pause'
  | 'map'
  | 'estop'
  | 'testPanel';

const KEYS: Record<string, Action> = {
  ArrowLeft: 'turnLeft',
  ArrowRight: 'turnRight',
  a: 'turnLeft',
  d: 'turnRight',
  ArrowUp: 'straight',
  ArrowDown: 'uturn',
  q: 'shiftDown',
  e: 'shiftUp',
  p: 'pause',
  m: 'map',
  Escape: 'estop',
  t: 'testPanel',
};

const PAD_BUTTONS: Record<number, Action> = {
  14: 'turnLeft',
  15: 'turnRight',
  12: 'straight',
  13: 'uturn',
  4: 'shiftDown',
  5: 'shiftUp',
  9: 'pause',
  8: 'map',
};

const STICK_THRESHOLD = 0.6;

export class Input {
  private readonly listeners = new Set<(a: Action) => void>();
  private readonly prevButtons = new Map<number, boolean[]>();
  private readonly prevStick = new Map<number, number>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.repeat) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const action = KEYS[key];
      if (!action) return;
      e.preventDefault();
      this.emit(action);
    });
  }

  on(listener: (a: Action) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Einmal pro Frame aufrufen: fragt Gamepads ab und meldet neu gedrückte Tasten. */
  pollGamepads(): void {
    if (typeof navigator.getGamepads !== 'function') return;
    for (const pad of navigator.getGamepads()) {
      if (!pad || !pad.connected) continue;
      const prev = this.prevButtons.get(pad.index) ?? [];
      const now = pad.buttons.map((b) => b.pressed);
      now.forEach((pressed, i) => {
        const action = PAD_BUTTONS[i];
        if (action && pressed && !prev[i]) this.emit(action);
      });
      this.prevButtons.set(pad.index, now);

      // Linker Stick horizontal als Links/Rechts mit Flankenerkennung
      const x = pad.axes[0] ?? 0;
      const zone = x < -STICK_THRESHOLD ? -1 : x > STICK_THRESHOLD ? 1 : 0;
      const before = this.prevStick.get(pad.index) ?? 0;
      if (zone !== before && zone !== 0) this.emit(zone < 0 ? 'turnLeft' : 'turnRight');
      this.prevStick.set(pad.index, zone);
    }
  }

  private emit(a: Action): void {
    for (const l of this.listeners) l(a);
  }
}
