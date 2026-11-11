import * as THREE from 'three';
import { KettlerSerialDevice } from '../device/KettlerSerialDevice';
import { GAME_KEYS, MAX_POWER_OFFSET, MockDevice } from '../device/MockDevice';
import type { DeviceStatus, TrainerDevice, Unsubscribe } from '../device/types';
import { speedFromCadence } from '../engine/gears';
import { RideEngine, type RideState } from '../engine/rideEngine';
import { RideSession } from '../engine/rideSession';
import { FogGrid } from '../world/exploration';
import { JunctionSelector } from '../world/junction';
import { resolvePois } from '../world/pois';
import { GameProgress, type ProgressEvent } from '../world/progress';
import { RiderOnNetwork } from '../world/rider';
import { sanitizeSave, type SaveData } from '../world/saveGame';
import { createWorld } from '../world/world';
import { CameraRig } from './cameraRig';
import { Input, type Action } from './input';
import { WorldMap } from './minimap';
import { JUNCTION_SHOW_DISTANCE, JunctionHud, Toasts } from './overlays';
import { PoiMeshes } from './poiMeshes';
import { createDetails } from './details';
import { createLandmarks } from './landmarks';
import { createProps } from './props';
import { RiderModel } from './riderModel';
import { createRoadMesh } from './roadMesh';
import { createScene, followSun } from './scene';
import { deleteSave, loadSave, writeSave } from './storage';
import { createTerrainMesh, createWater } from './terrainMesh';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Fahrer fährt rechts auf der Fahrbahn. */
const LANE_OFFSET = 1.2;
/** Radius, in dem der Nebel beim Fahren aufgedeckt wird. */
const REVEAL_RADIUS = 120;
const AUTOSAVE_SEC = 10;
const MINIMAP_METERS = 700;

async function main() {
  // --- Welt, Spielstand, Szene ------------------------------------------------

  const params = new URLSearchParams(location.search);
  /** Demo-Modus (Entwicklung): lädt und speichert nie, damit der echte Spielstand unberührt bleibt. */
  const demo = params.has('demo');

  const world = createWorld();
  const save = demo ? null : sanitizeSave(await loadSave(), world);
  const pois = resolvePois(world.roads);
  const fog = new FogGrid(world.terrain.size, 20, save?.fog);
  const progress = new GameProgress(pois, save ?? undefined);

  const { renderer, scene, camera, sun } = createScene($<HTMLCanvasElement>('scene'));
  scene.add(createTerrainMesh(world.terrain, world.roads, world.seed));
  scene.add(createWater());
  scene.add(createRoadMesh(world.roads));
  const landmarks = createLandmarks(world.terrain, world.roads);
  scene.add(landmarks.group);
  scene.add(createProps(world.terrain, world.roads, world.seed, landmarks.reserved));
  scene.add(createDetails(world.terrain, world.roads, world.seed));
  const poiMeshes = new PoiMeshes(pois, world.terrain, progress.collected);
  scene.add(poiMeshes.group);

  // Demo: Startpunkt per URL wählbar (?edge=…&s=…&dir=-1), für Screenshots und Tests
  const demoEdge = demo ? params.get('edge') : null;
  const start =
    demoEdge && world.roads.edges.has(demoEdge)
      ? { edgeId: demoEdge, s: Number(params.get('s') ?? 0), dir: params.get('dir') === '-1' ? (-1 as const) : (1 as const) }
      : (save?.position ?? world.spawn);
  const rider = new RiderOnNetwork(world.roads, start.edgeId, start.s, start.dir);
  const selector = new JunctionSelector();
  rider.chooser = selector.chooser;

  const engine = new RideEngine();
  if (save) {
    engine.restoreTotals(save.totals);
    if (save.gearIndex >= 0) engine.gears.set(save.gearIndex);
  }

  const model = new RiderModel();
  scene.add(model.root);
  const rig = new CameraRig(camera, world.terrain);

  const worldMap = new WorldMap(world.terrain, world.roads, fog, pois);
  const minimap = $<HTMLCanvasElement>('minimap');
  const minimapCtx = minimap.getContext('2d')!;
  const bigmap = $('bigmap');
  const bigmapCanvas = $<HTMLCanvasElement>('bigmap-canvas');
  const bigmapCtx = bigmapCanvas.getContext('2d')!;
  const junctionHud = new JunctionHud($('junction'));
  const toasts = new Toasts($('toasts'));
  const input = new Input();

  // Landzellen für den Erkundungsanteil (Meer zählt nicht)
  const landCells = (i: number, j: number) => {
    const half = world.terrain.half;
    return world.terrain.sample(-half + (i + 0.5) * fog.cellSize, -half + (j + 0.5) * fog.cellSize) > 0;
  };

  // --- Fahrerposition -----------------------------------------------------------

  const riderPos = new THREE.Vector3();
  const forward = new THREE.Vector3();
  let heading = Math.atan2(rider.direction.dx, rider.direction.dz);

  function placeRider(dt: number) {
    const p = rider.position;
    const d = rider.direction;
    riderPos.set(p.x - d.dz * LANE_OFFSET, p.y + 0.12, p.z + d.dx * LANE_OFFSET);
    forward.set(d.dx, 0, d.dz);
    const target = Math.atan2(d.dx, d.dz);
    let diff = target - heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    heading += diff * Math.min(1, dt * 8);
    model.root.position.copy(riderPos);
    model.root.rotation.set(-Math.atan(rider.grade), heading, 0, 'YXZ');
  }

  // --- Spielstand -------------------------------------------------------------------

  function snapshot(): SaveData {
    const s = engine.state();
    return {
      version: 1,
      seed: world.seed,
      savedAt: Date.now(),
      position: { edgeId: rider.edge.id, s: rider.s, dir: rider.dir },
      totals: { distance: s.distance, elevationGain: s.elevationGain, timeSec: s.timeSec },
      gearIndex: engine.gears.index,
      collected: [...progress.collected],
      viewpoints: [...progress.viewpoints],
      fog: fog.cells.slice(),
    };
  }

  let dirty = false;
  function saveNow() {
    if (!session || demo) return;
    dirty = false;
    void writeSave(snapshot());
  }

  if (save) {
    $('save-info').hidden = false;
    $('save-text').textContent =
      `Spielstand: ${(save.totals.distance / 1000).toFixed(1)} km, ` +
      `${progress.collectedCount}/${progress.collectibleTotal} Kristalle`;
  }
  $('new-game').addEventListener('click', async () => {
    if (!confirm('Spielstand löschen und neu beginnen?')) return;
    await deleteSave();
    location.reload();
  });

  // --- Gerät und Fahrt --------------------------------------------------------------

  let device: TrainerDevice | null = null;
  let session: RideSession | null = null;
  let cleanup: Unsubscribe[] = [];
  let lastDistance = engine.state().distance;

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
    if (s !== 'connected' && session && !session.isPaused) pause('Verbindung unterbrochen');
  }

  async function startRide(kind: 'mock' | 'kettler') {
    try {
      if (kind === 'mock') {
        const mock = new MockDevice();
        cleanup.push(mock.attachKeyboard(window, GAME_KEYS));
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
    testPanel.hidden = kind !== 'mock';
    $('tp-sim').hidden = kind !== 'mock';
    session = new RideSession(engine, device, { gradeProvider: () => rider.grade });
    session.start();
    lastDistance = engine.state().distance;
    menu.hidden = true;
    estopBtn.hidden = false;
    if (save) toasts.show('Willkommen zurück', 'Spielstand geladen');
  }

  function pause(title = 'Pause', text = 'Widerstand ist auf dem Minimum.') {
    if (!session) return;
    session.pause();
    $('paused-title').textContent = title;
    $('paused-text').textContent = text;
    pausedPanel.hidden = false;
    saveNow();
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

  function toggleMap(force?: boolean) {
    bigmap.hidden = force === undefined ? !bigmap.hidden : !force;
    if (!bigmap.hidden) drawBigMap();
  }

  $('start-mock').addEventListener('click', () => void startRide('mock'));
  $('start-kettler').addEventListener('click', () => void startRide('kettler'));
  $('resume').addEventListener('click', resume);
  estopBtn.addEventListener('click', emergencyStop);
  bigmap.addEventListener('click', () => toggleMap(false));

  input.on((a: Action) => {
    switch (a) {
      case 'estop':
        if (!bigmap.hidden) toggleMap(false);
        emergencyStop();
        break;
      case 'pause':
        if (session?.isPaused) resume();
        else pause();
        break;
      case 'map':
        toggleMap();
        break;
      case 'testPanel':
        testPanel.hidden = !testPanel.hidden;
        break;
      case 'shiftDown':
        engine.shiftDown();
        break;
      case 'shiftUp':
        engine.shiftUp();
        break;
      case 'turnLeft':
      case 'turnRight': {
        const exits = rider.upcomingExits();
        if (exits.length > 1 && rider.distanceToNode < JUNCTION_SHOW_DISTANCE) {
          selector.step(rider.nextNode, exits, a === 'turnLeft' ? -1 : 1);
        }
        break;
      }
      case 'straight':
        selector.clear();
        break;
      case 'uturn':
        rider.reverse();
        selector.clear();
        toasts.show('Kehrtwende');
        break;
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pause();
  });
  window.addEventListener('pagehide', () => {
    device?.emergencyStop();
    saveNow();
  });

  // --- Fortschritt ------------------------------------------------------------------

  function onProgress(ev: ProgressEvent) {
    dirty = true;
    switch (ev.type) {
      case 'collect':
        poiMeshes.collect(ev.poi.id);
        toasts.show('Kristall gefunden', `${ev.collected} von ${ev.total}`, 'gold');
        if (ev.collected === ev.total) toasts.show('Alle Kristalle gefunden!', 'Lumen und Rebland sind komplett', 'gold');
        saveNow();
        break;
      case 'viewpoint':
        toasts.show(`Aussichtspunkt: ${ev.poi.name ?? ''}`, `${ev.discovered} von ${ev.total} entdeckt`);
        saveNow();
        break;
      case 'sign':
        toasts.show(ev.poi.name ?? '', '', 'place');
        break;
    }
  }

  // --- HUD und Karten ------------------------------------------------------------------

  const hud = {
    power: $('h-power'), speed: $('h-speed'), cadence: $('h-cadence'), hr: $('h-hr'),
    grade: $('h-grade'), gear: $('h-gear'), target: $('h-target'),
    dist: $('h-dist'), elev: $('h-elev'), time: $('h-time'), road: $('h-road'), gems: $('h-gems'),
  };

  const fmtTime = (sec: number) => {
    const t = Math.floor(sec);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = String(t % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
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
    hud.time.textContent = fmtTime(s.timeSec);
    hud.gems.textContent = `${progress.collectedCount}/${progress.collectibleTotal}`;
    const next = rider.nextNode;
    const roadName = rider.edge.name ?? '';
    const towards = next.name ? `→ ${next.name} ${Math.round(rider.distanceToNode)} m` : '';
    hud.road.textContent = [roadName, towards].filter(Boolean).join('  ·  ');
  }

  // --- Testanzeige: die ganze Kette von Kadenz bis Ist-Leistung -----------------------

  const testPanel = $('testpanel');
  const tp = (id: string) => $(`tp-${id}`);

  function updateTestPanel(s: RideState) {
    if (testPanel.hidden) return;
    const mock = device instanceof MockDevice ? device : null;
    if (mock) {
      const off = Math.max(-MAX_POWER_OFFSET, Math.min(MAX_POWER_OFFSET, mock.powerOffset));
      tp('offset').textContent = `${off > 0 ? '+' : ''}${off} W`;
      const bar = tp('offset-bar');
      const pct = (Math.abs(off) / MAX_POWER_OFFSET) * 50;
      bar.style.left = off >= 0 ? '50%' : `${50 - pct}%`;
      bar.style.width = `${pct}%`;
    }
    const cad = s.cadence;
    tp('cadence').textContent = mock ? `${Math.round(cad)} U/min (Soll ${mock.cadence})` : `${Math.round(cad)} U/min`;
    tp('gear').textContent = `${s.gearIndex + 1}/${engine.gears.ratios.length} · ${s.gearRatio.toFixed(2)}`;
    tp('wish').textContent = `${(speedFromCadence(cad, s.gearRatio) * 3.6).toFixed(1)} km/h`;
    const felt = rider.grade * engine.config.difficulty;
    tp('grade').textContent = `${(rider.grade * 100).toFixed(1)} % · ${(felt * 100).toFixed(1)} %`;
    tp('target').textContent = `${s.targetPower} W`;
    tp('sent').textContent = device?.sentPower == null ? '–' : `${device.sentPower} W`;
    tp('power').textContent = `${Math.round(s.power)} W`;
    const torque = cad > 0 ? s.power / ((2 * Math.PI * cad) / 60) : 0;
    tp('torque').textContent = `${torque.toFixed(1)} Nm`;
    tp('speed').textContent = `${(s.speed * 3.6).toFixed(1)} km/h`;
  }

  function riderInfo() {
    const d = rider.direction;
    return { x: riderPos.x, z: riderPos.z, dx: d.dx, dz: d.dz };
  }

  function drawMinimap() {
    const w = minimap.width;
    minimapCtx.save();
    minimapCtx.beginPath();
    minimapCtx.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2);
    minimapCtx.clip();
    worldMap.draw(
      minimapCtx, w, w,
      { cx: riderPos.x, cz: riderPos.z, metersAcross: MINIMAP_METERS },
      riderInfo(), progress.collected, progress.viewpoints,
    );
    minimapCtx.restore();
  }

  function drawBigMap() {
    const size = Math.floor(Math.min(window.innerWidth - 300, window.innerHeight - 40, 900));
    const px = Math.max(240, size);
    const dpr = Math.min(2, window.devicePixelRatio);
    bigmapCanvas.width = px * dpr;
    bigmapCanvas.height = px * dpr;
    bigmapCanvas.style.width = `${px}px`;
    bigmapCanvas.style.height = `${px}px`;
    bigmapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    worldMap.draw(
      bigmapCtx, px, px,
      { cx: 0, cz: 0, metersAcross: world.terrain.size },
      riderInfo(), progress.collected, progress.viewpoints,
    );
    const s = engine.state();
    const explored = Math.round(fog.fraction(landCells) * 100);
    $('bigmap-stats').innerHTML = [
      ['Erkundet', `${explored} %`],
      ['Kristalle', `${progress.collectedCount} / ${progress.collectibleTotal}`],
      ['Aussichtspunkte', `${progress.viewpointCount} / ${progress.viewpointTotal}`],
      ['Strecke', `${(s.distance / 1000).toFixed(1)} km`],
      ['Höhenmeter', `${Math.round(s.elevationGain)} m`],
      ['Fahrzeit', fmtTime(s.timeSec)],
    ].map(([k, v]) => `<span class="label">${k}</span><span>${v}</span>`).join('');
  }
  window.addEventListener('resize', () => {
    if (!bigmap.hidden) drawBigMap();
  });

  // --- Spielschleife ---------------------------------------------------------------------

  let last = performance.now();
  let hudTimer = 0;
  let mapTimer = 0;
  let saveTimer = 0;
  placeRider(1);
  fog.reveal(riderPos.x, riderPos.z, REVEAL_RADIUS);
  worldMap.syncFog();

  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    input.pollGamepads();

    let state = engine.state();
    if (session) {
      state = session.advance(dt);
      rider.advance(Math.max(0, state.distance - lastDistance));
      lastDistance = state.distance;
    }

    placeRider(dt);
    model.animate(dt, state.speed, state.cadence);
    poiMeshes.animate(dt);
    landmarks.animate(dt);
    rig.update(dt, riderPos, forward);
    followSun(sun, riderPos);

    if (session && !session.isPaused) {
      if (fog.reveal(riderPos.x, riderPos.z, REVEAL_RADIUS) > 0) dirty = true;
      for (const ev of progress.update(rider.position, state.timeSec)) onProgress(ev);
      saveTimer += dt;
      if (saveTimer > AUTOSAVE_SEC) {
        saveTimer = 0;
        if (dirty || state.speed > 0) saveNow();
      }
    }
    junctionHud.update(rider, selector);

    hudTimer += dt;
    if (hudTimer > 0.1) {
      hudTimer = 0;
      updateHud(state);
      updateTestPanel(state);
    }
    mapTimer += dt;
    if (mapTimer > 1 / 15) {
      mapTimer = 0;
      worldMap.syncFog();
      drawMinimap();
      if (!bigmap.hidden) drawBigMap();
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // --- Entwicklung: ?demo startet sofort den Simulator (nie das echte Gerät) ----------
  if (demo) {
    await startRide('mock');
    const started = device as TrainerDevice | null;
    if (started instanceof MockDevice) started.cadence = Number(params.get('cadence') ?? 85);
    const skip = Number(params.get('skip') ?? 0);
    if (skip > 0) rider.advance(skip);
    if (params.has('map')) toggleMap(true);
  }
}

void main();
