/**
 * Befehlswarteschlange: Es ist immer nur ein Befehl offen. Die nächste
 * empfangene Zeile gilt als Antwort auf den offenen Befehl.
 */

export class CommandTimeoutError extends Error {
  constructor(readonly command: string) {
    super(`Keine Antwort auf "${command}"`);
    this.name = 'CommandTimeoutError';
  }
}

interface PendingCommand {
  command: string;
  resolve: (line: string) => void;
  reject: (err: Error) => void;
}

export class CommandQueue {
  private queue: PendingCommand[] = [];
  private active: PendingCommand | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param write schreibt einen Befehl (ohne Zeilenende) auf die Leitung
   * @param timeoutMs Wartezeit auf eine Antwort
   */
  constructor(
    private readonly write: (command: string) => Promise<void>,
    private readonly timeoutMs = 1500,
  ) {}

  get pending(): number {
    return this.queue.length + (this.active ? 1 : 0);
  }

  /** Reiht einen Befehl ein und liefert die Antwortzeile. */
  send(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ command, resolve, reject });
      this.pump();
    });
  }

  /**
   * Stellt einen Befehl an den Anfang der Warteschlange (z.B. Notstopp).
   * Ein bereits offener Befehl wird nicht abgebrochen.
   */
  sendNext(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.unshift({ command, resolve, reject });
      this.pump();
    });
  }

  /** Vom Leser aufzurufen, sobald eine vollständige Zeile ankommt. */
  handleLine(line: string): boolean {
    const active = this.active;
    if (!active) return false;
    this.finish();
    active.resolve(line);
    return true;
  }

  /** Bricht alle offenen Befehle ab (z.B. bei Verbindungsverlust). */
  rejectAll(err: Error): void {
    const all = [...(this.active ? [this.active] : []), ...this.queue];
    this.queue = [];
    this.finish();
    for (const c of all) c.reject(err);
  }

  private finish(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.active = null;
    queueMicrotask(() => this.pump());
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) return;
    const next = this.queue.shift()!;
    this.active = next;
    this.timer = setTimeout(() => {
      if (this.active !== next) return;
      this.finish();
      next.reject(new CommandTimeoutError(next.command));
    }, this.timeoutMs);
    this.write(next.command).catch((err: unknown) => {
      if (this.active !== next) return;
      this.finish();
      next.reject(err instanceof Error ? err : new Error(String(err)));
    });
  }
}
