import { KettlerSerialDevice, type RawLine } from '../device/KettlerSerialDevice';
import { MockDevice } from '../device/MockDevice';
import type { DeviceStatus, Measurement, TrainerDevice, Unsubscribe } from '../device/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const statusEl = $('status');
const connectBtn = $<HTMLButtonElement>('connect');
const disconnectBtn = $<HTMLButtonElement>('disconnect');
const targetInput = $<HTMLInputElement>('target');
const targetOut = $<HTMLOutputElement>('target-out');
const estopBtn = $<HTMLButtonElement>('estop');
const consoleCard = $('console-card');
const consoleForm = $<HTMLFormElement>('console-form');
const consoleInput = $<HTMLInputElement>('console-input');
const logEl = $('log');
const mockHelp = $('mock-help');

const STATUS_TEXT: Record<DeviceStatus, string> = {
  disconnected: 'getrennt',
  connecting: 'verbinde …',
  connected: 'verbunden',
  reconnecting: 'verbinde neu …',
  error: 'Fehler',
};

let device: TrainerDevice | null = null;
let cleanup: Unsubscribe[] = [];
const rawLog: RawLine[] = [];

if (!KettlerSerialDevice.isSupported()) {
  $('serial-hint').hidden = false;
  document.querySelector<HTMLInputElement>('input[value="kettler"]')!.disabled = true;
}

function selectedKind(): 'mock' | 'kettler' {
  return document.querySelector<HTMLInputElement>('input[name="device"]:checked')!.value as
    | 'mock'
    | 'kettler';
}

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="device"]')) {
  radio.addEventListener('change', () => {
    mockHelp.hidden = selectedKind() !== 'mock';
  });
}

function setText(id: string, value: string) {
  $(id).textContent = value;
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function showMeasurement(m: Measurement) {
  setText('v-power', String(m.power));
  setText('v-cadence', String(m.cadence));
  setText('v-hr', m.heartRate > 0 ? String(m.heartRate) : '–');
  setText('v-target', String(m.targetPower));
  setText('v-speed', m.speedKmh.toFixed(1));
  setText('v-dist', m.distanceKm.toFixed(1));
  setText('v-energy', String(m.energyKj));
  setText('v-time', formatTime(m.elapsedSec));
  const sent = device?.sentPower;
  setText('v-sent', sent == null ? '–' : String(sent));
}

function showStatus(s: DeviceStatus) {
  statusEl.dataset.status = s;
  statusEl.textContent = STATUS_TEXT[s];
  const active = s !== 'disconnected' && s !== 'error';
  connectBtn.disabled = active;
  disconnectBtn.disabled = !active;
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="device"]')) {
    r.disabled = active || (r.value === 'kettler' && !KettlerSerialDevice.isSupported());
  }
}

function appendLog(l: RawLine) {
  rawLog.push(l);
  const time = new Date(l.timestamp).toLocaleTimeString('de-AT');
  const arrow = l.direction === 'tx' ? '→' : '←';
  // Tabulatoren sichtbar machen, damit das ST-Format erkennbar ist
  logEl.textContent += `${time} ${arrow} ${l.text.replace(/\t/g, '⇥')}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

connectBtn.addEventListener('click', async () => {
  const kind = selectedKind();
  if (kind === 'mock') {
    const mock = new MockDevice();
    cleanup.push(mock.attachKeyboard());
    device = mock;
  } else {
    const kettler = new KettlerSerialDevice();
    cleanup.push(kettler.onRawLine(appendLog));
    device = kettler;
  }
  consoleCard.hidden = kind !== 'kettler';
  cleanup.push(device.onMeasurement(showMeasurement), device.onStatus(showStatus));
  targetInput.value = '25';
  targetOut.value = '25 W';
  try {
    await device.connect();
    device.setTargetPower(Number(targetInput.value));
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
    teardown();
  }
});

function teardown() {
  for (const fn of cleanup) fn();
  cleanup = [];
  device = null;
  showStatus('disconnected');
}

disconnectBtn.addEventListener('click', async () => {
  await device?.disconnect();
  teardown();
});

targetInput.addEventListener('input', () => {
  targetOut.value = `${targetInput.value} W`;
  device?.setTargetPower(Number(targetInput.value));
});

function emergencyStop() {
  device?.emergencyStop();
  targetInput.value = targetInput.min;
  targetOut.value = `${targetInput.min} W`;
}

estopBtn.addEventListener('click', emergencyStop);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') emergencyStop();
});

consoleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cmd = consoleInput.value.trim();
  if (!cmd || !(device instanceof KettlerSerialDevice)) return;
  consoleInput.value = '';
  try {
    await device.sendRaw(cmd);
  } catch (err) {
    appendLog({ direction: 'rx', text: `!! ${err instanceof Error ? err.message : err}`, timestamp: Date.now() });
  }
});

$('log-clear').addEventListener('click', () => {
  rawLog.length = 0;
  logEl.textContent = '';
});

$('log-download').addEventListener('click', () => {
  const text = rawLog
    .map((l) => `${new Date(l.timestamp).toISOString()}\t${l.direction}\t${l.text}`)
    .join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain' }));
  a.download = `kettler-mitschnitt-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.tsv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

window.addEventListener('beforeunload', () => {
  device?.emergencyStop();
});
