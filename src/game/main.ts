import * as THREE from 'three';
import { KettlerSerialDevice } from '../device/KettlerSerialDevice';
import { MockDevice, WASD_KEYS } from '../device/MockDevice';
import type { DeviceStatus, TrainerDevice, Unsubscribe } from '../device/types';
import { RideEngine, type RideState } from '../engine/rideEngine';
import { RideSession } from '../engine/rideSession';
import { RiderOnNetwork } from '../world/rider';
import { createWorld } from '../world/world';
import { CameraRig } from './cameraRig';
import { createProps } from './props';
import { RiderModel } from './riderModel';
import { createRoadMesh } from './roadMesh';
import { createScene, followSun } from './scene';
import { createTerrainMesh, createWater } from './terrainMesh';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// --- Welt und Szene -----------------------------------------------------------

const world = createWorld();
const { renderer, scene, camera, sun } = createScene($<HTMLCanvasElement>('scene'));
scene.add(createTerrainMesh(world.terrain, world.roads, world.seed));
scene.add(createWater());
scene.add(createRoadMesh(world.roads));
scene.add(createProps(world.terrain, world.roads, world.seed));

const rider = new RiderOnNetwork(world.roads, world.spawn.edgeId, world.spawn.s, world.spawn.dir);
const model = new RiderModel();
scene.add(model.root);
const rig = new CameraRig(camera, world.terrain);

/** Fahrer fährt rechts auf der Fahrbahn. */
const LANE_OFFSET = 1.2;
const riderPos = new THREE.Vector3();
const forward = new THREE.Vector3();
let heading = 0;

function placeRider(dt: number) {
  const p = rider.position;
  const d = rider.direction;
  riderPos.set(p.x - d.dz * LANE_OFFSET, p.y + 0.12, p.z + d.dx * LANE_OFFSET);
  forward.set(d.dx, 0, d.dz);
  // Richtung weich nachführen (kürzester Winkel)
  const target = Math.atan2(d.dx, d.dz);
  let diff = target - heading;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  heading += diff * Math.min(1, dt * 8);
  model.root.position.copy(riderPos);
  model.root.rotation.set(-Math.atan(rider.grade), heading, 0, 'YXZ');
}

// --- Gerät und Fahrt ------------------------------------------------------------

const engine = new RideEngine();
let device: TrainerDevice | null = null;
let session: RideSession | null = null;
let cleanup: Unsubscribe[] = [];
let lastDistance = 0;

const menu = $('menu');
const pausedPanel = $('paused');
const estopBtn = $<HTMLButtonElement>('estop');
const statusEl = $('status');

if (!KettlerSerialDevice.isSupported()) {
  $<HTMLButtonElement>('start-kettler').disabled = true;
  $('serial-hint').hidden = false;
}

const STATUS_TEXT: Record<DeviceStatus, string> = {
  disconnected: 'Gerät getrennt',
  connecting: 'Verbinde …',
  connected: '',
  reconnecting: 'Verbindung verloren – verbinde neu …',
  error: 'Gerätefehler',
};

function onDeviceStatus(s: DeviceStatus) {
  const text = STATUS_TEXT[s];
  statusEl.hidden = !text;
  statusEl.textContent = text;
  if (s !== 'connected' && session && !session.isPaused) pause('Verbindung unterbrochen', 'Widerstand ist auf dem Minimum.');
}

async function start(kind: 'mock' | 'kettler') {
  try {
    if (kind === 'mock') {
      const mock = new MockDevice();
      cleanup.push(mock.attachKeyboard(window, WASD_KEYS));
      device = mock;
    } else {
      device = new KettlerSerialDevice();
    }
    cleanup.push(device.onStatus(onDeviceStatus));
    await device.connect();
  } catch (err) {
    for (const fn of cleanup) fn();
    cleanup = [];
    device = null;
    alert(err instanceof Error ? err.message : String(err));
    return;
  }
  session = new RideSession(engine, device, { gradeProvider: () => rider.grade });
  session.start();
  lastDistance = engine.state().distance;
  menu.hidden = true;
  estopBtn.hidden = false;
}

function pause(title = 'Pause', text = 'Widerstand ist auf dem Minimum.') {
  if (!session) return;
  session.pause();
  $('paused-title').textContent = title;
  $('paused-text').textContent = text;
  pausedPanel.hidden = false;
}

function resume() {
  if (!session || device?.status !== 'connected') return;
  session.resume();
  pausedPanel.hidden = true;
}

function emergencyStop() {
  device?.emergencyStop();
  pause('Notstopp', 'Widerstand wurde sofort auf das Minimum gesetzt.');
}

$('start-mock').addEventListener('click', () => void start('mock'));
$('start-kettler').addEventListener('click', () => void start('kettler'));
$('resume').addEventListener('click', resume);
estopBtn.addEventListener('click', emergencyStop);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return emergencyStop();
  const key = e.key.toLowerCase();
  if (key === 'p') {
    if (session?.isPaused) resume();
    else pause();
  } else if (key === 'q') engine.shiftDown();
  else if (key === 'e') engine.shiftUp();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') pause();
});
window.addEventListener('pagehide', () => device?.emergencyStop());

// --- HUD ------------------------------------------------------------------------

const hud = {
  power: $('h-power'), speed: $('h-speed'), cadence: $('h-cadence'), hr: $('h-hr'),
  grade: $('h-grade'), gear: $('h-gear'), target: $('h-target'),
  dist: $('h-dist'), elev: $('h-elev'), time: $('h-time'), road: $('h-road'),
};

function updateHud(s: RideState) {
  hud.power.textContent = String(Math.round(s.power));
  hud.speed.textContent = (s.speed * 3.6).toFixed(1);
  hud.cadence.textContent = String(Math.round(s.cadence));
  hud.hr.textContent = s.heartRate > 0 ? String(Math.round(s.heartRate)) : '–';
  hud.grade.textContent = `${(rider.grade * 100).toFixed(1)} %`;
  hud.gear.textContent = `${s.gearIndex + 1}/${engine.gears.ratios.length}`;
  hud.target.textContent = String(device?.sentPower ?? s.targetPower);
  hud.dist.textContent = (s.distance / 1000).toFixed(2);
  hud.elev.textContent = String(Math.round(s.elevationGain));
  const t = Math.floor(s.timeSec);
  hud.time.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  const next = rider.nextNode;
  const roadName = rider.edge.name ?? '';
  const towards = next.name ? `→ ${next.name} ${Math.round(rider.distanceToNode)} m` : '';
  hud.road.textContent = [roadName, towards].filter(Boolean).join('  ·  ');
}

// --- Spielschleife ------------------------------------------------------------------

let last = performance.now();
let hudTimer = 0;
placeRider(1);

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  let state = engine.state();
  if (session) {
    state = session.advance(dt);
    rider.advance(Math.max(0, state.distance - lastDistance));
    lastDistance = state.distance;
  }

  placeRider(dt);
  model.animate(dt, state.speed, state.cadence);
  rig.update(dt, riderPos, forward);
  followSun(sun, riderPos);

  hudTimer += dt;
  if (hudTimer > 0.1) {
    hudTimer = 0;
    updateHud(state);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Entwicklung: ?demo startet sofort den Simulator (nie das echte Gerät) ----------
const params = new URLSearchParams(location.search);
if (params.has('demo')) {
  void start('mock').then(() => {
    if (device instanceof MockDevice) device.cadence = Number(params.get('cadence') ?? 85);
    const skip = Number(params.get('skip') ?? 0);
    if (skip > 0) rider.advance(skip);
  });
}
