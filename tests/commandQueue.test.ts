import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandQueue, CommandTimeoutError } from '../src/device/commandQueue';

describe('CommandQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('hat immer nur einen Befehl offen', async () => {
    const written: string[] = [];
    const q = new CommandQueue(async (c) => void written.push(c));
    const a = q.send('CM');
    const b = q.send('ST');
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual(['CM']);

    q.handleLine('ACK');
    await expect(a).resolves.toBe('ACK');
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual(['CM', 'ST']);

    q.handleLine('000\t000');
    await expect(b).resolves.toBe('000\t000');
  });

  it('läuft nach einer Zeitüberschreitung weiter', async () => {
    const written: string[] = [];
    const q = new CommandQueue(async (c) => void written.push(c), 1000);
    const a = q.send('ST');
    const b = q.send('ST');
    const aErr = expect(a).rejects.toBeInstanceOf(CommandTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await aErr;
    expect(written).toHaveLength(2);
    q.handleLine('ok');
    await expect(b).resolves.toBe('ok');
  });

  it('sendNext überholt die Warteschlange', async () => {
    const written: string[] = [];
    const q = new CommandQueue(async (c) => void written.push(c));
    void q.send('ST');
    void q.send('ST');
    void q.sendNext('PW 25');
    await vi.advanceTimersByTimeAsync(0);
    q.handleLine('x');
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual(['ST', 'PW 25']);
  });

  it('ignoriert unaufgeforderte Zeilen', () => {
    const q = new CommandQueue(async () => undefined);
    expect(q.handleLine('RUN')).toBe(false);
  });

  it('rejectAll bricht alles ab', async () => {
    const q = new CommandQueue(async () => undefined);
    const a = q.send('ST');
    const b = q.send('ST');
    q.rejectAll(new Error('weg'));
    await expect(a).rejects.toThrow('weg');
    await expect(b).rejects.toThrow('weg');
    expect(q.pending).toBe(0);
  });

  it('meldet Schreibfehler', async () => {
    const q = new CommandQueue(async () => {
      throw new Error('Port zu');
    });
    await expect(q.send('ST')).rejects.toThrow('Port zu');
  });
});
