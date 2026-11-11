import type { Unsubscribe } from './types';

/** Minimaler typisierter Event-Strom. */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  on(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
    for (const l of this.listeners) {
      try {
        l(value);
      } catch (err) {
        console.error('Listener-Fehler', err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
