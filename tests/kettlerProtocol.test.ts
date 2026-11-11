import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Cmd, LineSplitter, parseClock, parseStatusLine } from '../src/device/kettlerProtocol';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const readLines = (name: string) =>
  readFileSync(fixture(name), 'utf8').split(/\r?\n/).filter((l) => l.trim().length > 0);

describe('parseClock', () => {
  it('parst mm:ss und h:mm:ss', () => {
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('05:30')).toBe(330);
    expect(parseClock('1:02:03')).toBe(3723);
  });
  it('lehnt Unsinn ab', () => {
    expect(parseClock('5')).toBeNull();
    expect(parseClock('ab:cd')).toBeNull();
    expect(parseClock('1:2:3:4')).toBeNull();
  });
});

describe('parseStatusLine', () => {
  it('parst eine typische Zeile', () => {
    const m = parseStatusLine('118\t088\t312\t012\t150\t0045\t05:30\t152', 1234);
    expect(m).toEqual({
      timestamp: 1234,
      heartRate: 118,
      cadence: 88,
      speedKmh: 31.2,
      distanceKm: 1.2,
      targetPower: 150,
      energyKj: 45,
      elapsedSec: 330,
      power: 152,
    });
  });

  it('akzeptiert Leerzeichen statt Tabulatoren und Zeilenenden', () => {
    expect(parseStatusLine(' 072 065 234 001 100 0003 00:42 098\r\n')?.power).toBe(98);
  });

  it.each([
    ['leer', ''],
    ['ACK', 'ACK'],
    ['zu wenige Felder', '072\t065\t234\t001\t100\t0003\t00:42'],
    ['zu viele Felder', '072\t065\t234\t001\t100\t0003\t00:42\t098\t1'],
    ['keine Zahl', '072\t06x\t234\t001\t100\t0003\t00:42\t098'],
    ['negative Zahl', '072\t-65\t234\t001\t100\t0003\t00:42\t098'],
    ['kaputte Zeit', '072\t065\t234\t001\t100\t0003\t0042\t098'],
  ])('lehnt ab: %s', (_name, line) => {
    expect(parseStatusLine(line)).toBeNull();
  });

  it('parst alle synthetischen Fixture-Zeilen', () => {
    for (const line of readLines('st-lines.synthetic.txt')) {
      expect(parseStatusLine(line), line).not.toBeNull();
    }
  });

  const real = 'st-lines.e5.txt';
  it.runIf(existsSync(fixture(real)))('parst alle echten E5-Zeilen aus Phase 0', () => {
    for (const line of readLines(real)) {
      expect(parseStatusLine(line), line).not.toBeNull();
    }
  });
});

describe('LineSplitter', () => {
  it('setzt Zeilen über Chunk-Grenzen zusammen', () => {
    const s = new LineSplitter();
    expect(s.push('07')).toEqual([]);
    expect(s.push('2\t065\r')).toEqual([]);
    expect(s.push('\nACK\r\nRU')).toEqual(['072\t065', 'ACK']);
    expect(s.push('N\n')).toEqual(['RUN']);
  });
  it('akzeptiert einzelnes CR als Zeilenende', () => {
    const s = new LineSplitter();
    expect(s.push('A\rB\r')).toEqual(['A']);
    expect(s.push('C')).toEqual(['B']);
  });
  it('überspringt Leerzeilen', () => {
    expect(new LineSplitter().push('\r\n\r\nX\r\n')).toEqual(['X']);
  });
});

describe('Cmd.power', () => {
  it('rundet auf ganze Watt', () => {
    expect(Cmd.power(102.6)).toBe('PW 103');
  });
});
