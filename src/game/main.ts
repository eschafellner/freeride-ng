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
import {
  ACHIEVEMENTS, levelFor, newAchievements, segmentXp, totalXp, type PlayerStats,
} from '../world/progression';
import {
  formatSegmentTime, pointOnSegment, resolveSegments, SEGMENT_KIND_LABEL, SegmentTracker, type SegmentEvent,
} from '../world/segments';
import { RiderOnNetwork, straightest } from '../world/rider';
import { sanitizeSave, type SaveData } from '../world/saveGame';
import { createWorld } from '../world/world';
import { CameraRig } from './cameraRig';
import { Input, type Action } from './input';
import { WorldMap, type MapRoute } from './minimap';
import { escapeHtml, formatDelta, JUNCTION_SHOW_DISTANCE, JunctionHud, SegmentHud, Toasts } from './overlays';
import { createSegmentMarkers, SEGMENT_COLOR } from './segmentMarkers';
import { PoiMeshes } from './poiMeshes';
import { createDetails } from './details';
import { createLandmarks } from './landmarks';
import { createMountainDetails } from './mountain';
import { createNordkapDetails } from './nordkap';
import { createProps } from './props';
import { RiderModel } from './riderModel';
import { createRoadMesh } from './roadMesh';
import { GraphicsController } from './graphics';
import { GraphicsPanel } from './graphicsPanel';
import { createPaving } from './paving';
import { loadSettings, storeSettings } from './quality';
import { createScene, driftClouds, followSun } from './scene';
import { addMaskLines, addMaskPolygons, createTerrainUniforms, PLAZAS } from './shaderChunks';
import { deleteSave, loadSave, writeRide, writeSave } from './storage';
import { HistoryPanel, showRideDone } from './historyPanel';
import { RideRecorder } from '../history/rideLog';
import { createTerrainMesh } from './terrainMesh';
import { createBridges } from './bridges';
import { formatClock, timeForClock } from './dayCycle';
import { REGIONS } from '../world/roadLayout';

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
  const segments = resolveSegments(world.roads);
  const tracker = new SegmentTracker(segments, save?.segments);
  const knownAchievements = new Set(ACHIEVEMENTS.map((a) => a.id));
  const unlocked = new Set((save?.achievements ?? []).filter((id) => knownAchievements.has(id)));
  let bonusXp = save?.bonusXp ?? 0;

  const bundle = createScene($<HTMLCanvasElement>('scene'));
  const { scene, camera, sun } = bundle;
  const terrainMesh = createTerrainMesh(world.terrain, world.roads, world.seed);
  terrainMesh.mesh.name = 'gelaende';
  scene.add(terrainMesh.mesh);
  const terrainUniforms = createTerrainUniforms(world.terrain, world.roads, terrainMesh.ground);
  // Demo: Uhrzeit per URL (&uhr=21.5) für Prüfungen von Dämmerung und Nacht
  const clockParam = demo ? Number(params.get('uhr')) : NaN;
  const graphics = new GraphicsController(bundle, terrainUniforms, loadSettings(),
    Number.isFinite(clockParam) && params.has('uhr') ? timeForClock(clockParam) : undefined);
  scene.add(Object.assign(createRoadMesh(world.roads), { name: 'wege' }));
  scene.add(Object.assign(createPaving(world.terrain, world.roads), { name: 'pflaster' }));
  const landmarks = createLandmarks(world.terrain, world.roads);
  // Gepflasterte Plätze frei von Häusern und Bäumen halten
  for (const p of PLAZAS) {
    const n = world.roads.nodes.get(p.node);
    if (n) landmarks.reserved.push({ x: n.x, z: n.z, r: p.radius + 6 });
  }
  landmarks.group.name = 'wahrzeichen';
  scene.add(landmarks.group);
  // Hoher Kogel: Almhütte, Gipfelkreuz, Kehrenschilder
  const mountain = createMountainDetails(world.terrain, world.roads, world.seed);
  landmarks.reserved.push(...mountain.reserved);
  scene.add(mountain.group);
  // Nordkap: Leuchtturm, Boote, Robben, Möwen
  const nordkap = createNordkapDetails(world.terrain, world.roads, world.seed);
  landmarks.reserved.push(...nordkap.reserved);
  scene.add(nordkap.group);
  const props = createProps(world.terrain, world.roads, world.seed, landmarks.reserved);
  props.name = 'gebaeude';
  scene.add(props);
  scene.add(createBridges(world.roads, world.terrain));
  // Gebiete sperren, bis das Level reicht (siehe updateRegions). Im Demo-Modus ist alles
  // offen, außer mit &locked (zum Prüfen der Schranken).
  const gates = props.userData.gates as Record<string, THREE.Object3D>;
  const lockAll = !demo || params.has('locked');
  if (lockAll) for (const r of REGIONS) world.roads.lockedRegions.add(r.id);
  for (const r of REGIONS) for (const g of r.gateNodes) gates[g]!.visible = lockAll;
  // Wege zu den Haustüren: kein Gras auf den Trittsteinen
  addMaskLines(terrainUniforms, props.userData.pathLines as { x: number; z: number }[][], 1.6);
  // Hausgrundrisse: kein Gras an den Wänden und vor den Fenstern
  addMaskPolygons(terrainUniforms, props.userData.footprints as { x: number; z: number }[][]);
  scene.add(Object.assign(createDetails(world.terrain, world.roads, world.seed), { name: 'details' }));
  const poiMeshes = new PoiMeshes(pois, world.terrain, progress.collected);
  poiMeshes.group.name = 'pois';
  scene.add(poiMeshes.group);
  scene.add(Object.assign(createSegmentMarkers(segments), { name: 'segmente' }));
  const segmentRoutes: MapRoute[] = segments.map((seg) => {
    const points: { x: number; z: number }[] = [];
    for (let d = 0; d <= seg.length; d += 10) points.push(pointOnSegment(seg, d));
    return { color: SEGMENT_COLOR[seg.kind], points };
  });

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

  const model = new RiderModel().addLight();
  // Fahrradlicht: Wahl bleibt im Browser gespeichert (nur Bequemlichkeit, kein Spielstand)
  const LIGHT_KEY = 'freeride-ng.licht';
  let bikeLight = false;
  try {
    bikeLight = localStorage.getItem(LIGHT_KEY) === 'an';
  } catch {
    // ohne Speicher bleibt das Licht aus
  }
  if (demo && params.has('licht')) bikeLight = true;
  model.setLight(bikeLight);
  $('h-light-box').addEventListener('click', () => toggleLight());
  function toggleLight() {
    bikeLight = !bikeLight;
    model.setLight(bikeLight);
    try {
      localStorage.setItem(LIGHT_KEY, bikeLight ? 'an' : 'aus');
    } catch {
      // egal
    }
    toasts.show(bikeLight ? 'Fahrradlicht an' : 'Fahrradlicht aus');
  }
  model.root.name = 'fahrer';
  scene.add(model.root);
  /** Ghost: die eigene Bestfahrt im laufenden Segment. */
  const ghost = new RiderModel().makeGhost();
  ghost.root.visible = false;
  ghost.root.name = 'ghost';
  scene.add(ghost.root);
  const rig = new CameraRig(camera, world.terrain);
  const aheadVec = new THREE.Vector3();

  const worldMap = new WorldMap(world.terrain, world.roads, fog, pois);
  const minimap = $<HTMLCanvasElement>('minimap');
  const minimapCtx = minimap.getContext('2d')!;
  const bigmap = $('bigmap');
  const bigmapCanvas = $<HTMLCanvasElement>('bigmap-canvas');
  const bigmapCtx = bigmapCanvas.getContext('2d')!;
  const junctionHud = new JunctionHud($('junction'));
  const toasts = new Toasts($('toasts'));
  const segmentHud = new SegmentHud($('segment'));
  const input = new Input();

  // Landzellen (Meer zählt nicht) und davon die erreichbaren: in Sichtweite eines Weges.
  // Der Anteil „Erkundet“ bezieht sich auf die erreichbaren, damit 100 % möglich bleiben.
  const landMask = new Uint8Array(fog.res * fog.res);
  const bigMapView = { cx: 0, cz: 0, metersAcross: world.terrain.size };
  const reachMask = new Uint8Array(fog.res * fog.res);
  {
    const half = world.terrain.half;
    for (let j = 0; j < fog.res; j++) {
      for (let i = 0; i < fog.res; i++) {
        landMask[j * fog.res + i] =
          world.terrain.sample(-half + (i + 0.5) * fog.cellSize, -half + (j + 0.5) * fog.cellSize) > 0 ? 1 : 0;
      }
    }
    // Ausschnitt der großen Karte: die Insel mit etwas Meer rundherum (sie sitzt nicht mittig)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let j = 0; j < fog.res; j++) {
      for (let i = 0; i < fog.res; i++) {
        if (!landMask[j * fog.res + i]) continue;
        const x = -half + (i + 0.5) * fog.cellSize;
        const z = -half + (j + 0.5) * fog.cellSize;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
    }
    if (x0 < x1) {
      bigMapView.cx = (x0 + x1) / 2;
      bigMapView.cz = (z0 + z1) / 2;
      bigMapView.metersAcross = Math.min(world.terrain.size, Math.max(x1 - x0, z1 - z0) + 400);
    }
    const reach = Math.ceil(REVEAL_RADIUS / fog.cellSize);
    for (const e of world.roads.edges.values()) {
      for (let s = 0; s <= e.length; s += fog.cellSize) {
        const p = e.pointAt(s);
        const ci = Math.floor((p.x + half) / fog.cellSize);
        const cj = Math.floor((p.z + half) / fog.cellSize);
        for (let j = cj - reach; j <= cj + reach; j++) {
          for (let i = ci - reach; i <= ci + reach; i++) {
            if (i < 0 || j < 0 || i >= fog.res || j >= fog.res) continue;
            if (Math.hypot(i - ci, j - cj) <= reach) reachMask[j * fog.res + i] = landMask[j * fog.res + i]!;
          }
        }
      }
    }
  }
  const landCells = (i: number, j: number) => reachMask[j * fog.res + i] === 1;
  const anyLand = (i: number, j: number) => landMask[j * fog.res + i] === 1;
  const cellKm2 = (fog.cellSize * fog.cellSize) / 1e6;

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
      achievements: [...unlocked],
      bonusXp,
      segments: Object.fromEntries(tracker.records),
    };
  }

  let dirty = false;
  function saveNow() {
    if (!session || demo) return;
    dirty = false;
    void writeSave(snapshot());
    // Laufende Fahrt in die Historie (gleiche ID, wird jedes Mal ersetzt)
    if (recorder?.worthKeeping()) void writeRide(recorder.meta(), recorder.track);
  }

  /** Name des nächsten benannten Orts (für die Fahrtenliste). */
  function nearestPlace(): string | undefined {
    let best: string | undefined;
    let bestD = Infinity;
    for (const n of world.roads.nodes.values()) {
      if (!n.name) continue;
      const d = Math.hypot(n.x - rider.position.x, n.z - rider.position.z);
      if (d < bestD) {
        bestD = d;
        best = n.name;
      }
    }
    return best;
  }

  if (save) {
    $('save-info').hidden = false;
    $('save-text').textContent =
      `Spielstand: ${(save.totals.distance / 1000).toFixed(1)} km, ` +
      `${progress.collectedCount}/${progress.collectibleTotal} Kristalle, ` +
      `Level ${levelFor(currentXp()).level}`;
  }
  $('new-game').addEventListener('click', async () => {
    if (!confirm('Spielstand löschen und neu beginnen?')) return;
    await deleteSave();
    location.reload();
  });

  // --- Gerät und Fahrt --------------------------------------------------------------

  let device: TrainerDevice | null = null;
  let session: RideSession | null = null;
  /** Aufzeichnung der laufenden Fahrt für die Historie (TCX/FIT). */
  let recorder: RideRecorder | null = null;
  let rideEnded = false;
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
    recorder = new RideRecorder(Date.now(), kind === 'mock' ? 'simulator' : 'kettler', nearestPlace());
    lastDistance = engine.state().distance;
    menu.hidden = true;
    estopBtn.hidden = false;
    if (save) {
      const lvl = levelFor(currentXp()).level;
      toasts.show('Willkommen zurück', `Spielstand geladen · Level ${lvl}`);
      if (retroactive > 0) toasts.show(`${retroactive} Erfolge nachgetragen`, 'für deine bisherigen Fahrten', 'gold');
    }
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

  // --- Fahrt beenden und Historie ------------------------------------------------------

  const rideDone = $('ride-done');
  const history = new HistoryPanel($('history'), () => {
    if (rideEnded) rideDone.hidden = false;
    else menu.hidden = false;
  }, () => (session ? (recorder?.id ?? null) : null));

  /** Fahrt beenden: Widerstand aufs Minimum, speichern, Gerät trennen, Zusammenfassung zeigen. */
  async function endRide() {
    if (!session) return;
    session.pause();
    saveNow();
    session.stop();
    session = null;
    rideEnded = true;
    pausedPanel.hidden = true;
    estopBtn.hidden = true;
    testPanel.hidden = true;
    try {
      await device?.disconnect();
    } catch (err) {
      console.warn('Trennen fehlgeschlagen', err);
    }
    for (const fn of cleanup) fn();
    cleanup = [];
    statusEl.hidden = true; // „Gerät getrennt“ ist hier gewollt
    const keep = recorder?.worthKeeping() ? recorder : null;
    showRideDone(rideDone, keep?.meta() ?? null, keep?.track ?? null, !demo, {
      menu: () => location.reload(),
      history: () => {
        rideDone.hidden = true;
        void history.open();
      },
    });
  }
  $('end-ride').addEventListener('click', () => {
    if (confirm('Fahrt beenden? Sie wird in der Historie gespeichert.')) void endRide();
  });
  $('open-history').addEventListener('click', () => {
    menu.hidden = true;
    void history.open();
  });

  function emergencyStop() {
    device?.emergencyStop();
    pause('Notstopp', 'Widerstand wurde sofort auf das Minimum gesetzt.');
  }

  function toggleMap(force?: boolean) {
    bigmap.hidden = force === undefined ? !bigmap.hidden : !force;
    if (!bigmap.hidden) drawBigMap();
  }

  const graphicsPanel = new GraphicsPanel($('graphics'), graphics.settings, (s) => {
    graphics.apply(s);
    storeSettings(s);
  });
  /** Grafikmenü: während der Fahrt wird dafür pausiert (Widerstand aufs Minimum). */
  function toggleGraphics(force?: boolean) {
    const open = force ?? !graphicsPanel.open;
    if (open && session && !session.isPaused) pause();
    graphicsPanel.show(open);
    // Pause-Fenster ausblenden, solange eingestellt wird (freie Sicht auf die Szene)
    if (session?.isPaused) pausedPanel.hidden = open;
  }
  graphicsPanel.onClose = () => toggleGraphics(false);
  $('open-graphics').addEventListener('click', () => toggleGraphics(true));
  $('pause-graphics').addEventListener('click', () => toggleGraphics(true));

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
      case 'graphics':
        toggleGraphics();
        break;
      case 'light':
        toggleLight();
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
        if (ev.collected === ev.total) toasts.show('Alle Kristalle gefunden!', 'Die ganze Insel ist abgesucht', 'gold');
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

  // --- Erfahrung, Erfolge, Segmente -----------------------------------------------

  function stats(): PlayerStats {
    const st = engine.state();
    return {
      distance: st.distance,
      elevationGain: st.elevationGain,
      timeSec: st.timeSec,
      collected: progress.collectedCount,
      collectibleTotal: progress.collectibleTotal,
      viewpoints: progress.viewpointCount,
      viewpointTotal: progress.viewpointTotal,
      explored: fog.fraction(landCells),
      exploredKm2: fog.countRevealed(anyLand) * cellKm2,
      segments: tracker.records,
    };
  }

  function currentXp(s = stats()): number {
    return totalXp(s, unlocked, bonusXp);
  }

  let shownLevel = levelFor(currentXp()).level;

  /** Beim Laden nachgetragene Erfolge (ältere Spielstände), werden beim Start gemeldet. */
  let retroactive = 0;

  /**
   * Prüft Erfolge und Levelaufstieg (etwa einmal pro Sekunde und nach Ereignissen).
   * @param silent ohne Meldungen (beim Laden)
   */
  function checkProgression(silent = false) {
    const s = stats();
    for (const a of newAchievements(s, unlocked)) {
      unlocked.add(a.id);
      dirty = true;
      if (silent) retroactive++;
      else toasts.show(`Erfolg: ${a.name}`, `${a.text} · +${a.xp} XP`, 'gold');
    }
    const lvl = levelFor(currentXp(s));
    if (lvl.level > shownLevel && !silent) {
      toasts.show(`Level ${lvl.level} erreicht!`, '', 'level');
      saveNow();
    }
    shownLevel = lvl.level;
    updateRegions(lvl.level, silent);
    hud.level.textContent = String(lvl.level);
    hud.xpbar.style.width = `${((lvl.into / lvl.needed) * 100).toFixed(1)}%`;
    hud.xp.textContent = `${lvl.into} / ${lvl.needed} XP`;
  }

  /** Schaltet Gebiete frei, sobald das Level reicht: Schranke weg, Wege befahrbar. */
  function updateRegions(level: number, silent: boolean) {
    for (const r of REGIONS) {
      if (!world.roads.lockedRegions.has(r.id) || level < r.unlockLevel) continue;
      world.roads.lockedRegions.delete(r.id);
      for (const g of r.gateNodes) gates[g]!.visible = false;
      if (!silent) toasts.show(`Neues Gebiet: ${r.name}`, `Jetzt offen ${r.via}`, 'level');
    }
  }

  function onSegment(ev: SegmentEvent) {
    const seg = ev.segment;
    const label = `${SEGMENT_KIND_LABEL[seg.kind]} ${seg.name}`;
    switch (ev.type) {
      case 'segmentStart':
        toasts.show(label, ev.best === null ? 'Erste Fahrt – los!' : `Bestzeit ${formatSegmentTime(ev.best)} · Ghost fährt mit`);
        break;
      case 'segmentFinish': {
        const first = ev.previousBest === null;
        const xp = segmentXp(ev.newBest, first);
        bonusXp += xp;
        const time = formatSegmentTime(ev.time);
        if (first) toasts.show(`${label}: ${time}`, `Erste Bestzeit · +${xp} XP`, 'segment-ok');
        else if (ev.newBest) toasts.show(`Neue Bestzeit: ${time}`, `${label} · ${formatDelta(ev.time - ev.previousBest!)} · +${xp} XP`, 'gold');
        else toasts.show(`${label}: ${time}`, `Bestzeit ${formatSegmentTime(ev.previousBest!)} · ${formatDelta(ev.time - ev.previousBest!)} · +${xp} XP`, 'segment-ok');
        dirty = true;
        checkProgression();
        saveNow();
        break;
      }
      case 'segmentAbort':
        toasts.show(`${label} abgebrochen`, 'Strecke verlassen', 'segment-bad');
        break;
    }
  }

  // Zeitnahme an Knoten: Zeit und Strecke auf den genauen Überfahrpunkt interpolieren
  const stepInfo = { t0: 0, t1: 0, d0: 0, ds: 0, active: false };
  rider.onNode = (node, exit, travelled) => {
    if (!stepInfo.active) return;
    const f = stepInfo.ds > 0 ? Math.min(1, travelled / stepInfo.ds) : 1;
    const t = stepInfo.t0 + (stepInfo.t1 - stepInfo.t0) * f;
    for (const ev of tracker.onNode(node.id, { edgeId: exit.edge.id, dir: exit.dir }, t, stepInfo.d0 + travelled)) onSegment(ev);
  };
  rider.onReverse = () => {
    for (const ev of tracker.onReverse()) onSegment(ev);
  };

  const ghostPos = new THREE.Vector3();
  let ghostLastD = 0;
  function placeGhost(dt: number, runs: ReturnType<SegmentTracker['runs']>) {
    const run = runs.find((r) => r.ghostDistance !== null);
    if (!run || run.ghostDistance === null) {
      ghost.root.visible = false;
      return;
    }
    const d = run.ghostDistance;
    const p = pointOnSegment(run.segment, d);
    const ahead = pointOnSegment(run.segment, Math.min(run.segment.length, d + 3));
    // Ghost fährt etwas weiter links als der Fahrer, damit beide sichtbar sind
    ghostPos.set(p.x - p.dz * (LANE_OFFSET - 1.4), p.y + 0.12, p.z + p.dx * (LANE_OFFSET - 1.4));
    ghost.root.position.copy(ghostPos);
    const run3 = Math.hypot(ahead.x - p.x, ahead.z - p.z) || 1;
    ghost.root.rotation.set(-Math.atan((ahead.y - p.y) / run3), Math.atan2(p.dx, p.dz), 0, 'YXZ');
    const speed = dt > 0 && ghost.root.visible ? Math.max(0, (d - ghostLastD) / dt) : 0;
    ghostLastD = d;
    ghost.animate(dt, speed, speed > 0.5 ? 85 : 0);
    ghost.root.visible = d < run.segment.length;
  }

  // --- HUD und Karten ------------------------------------------------------------------

  const hud = {
    power: $('h-power'), speed: $('h-speed'), cadence: $('h-cadence'), hr: $('h-hr'),
    grade: $('h-grade'), gear: $('h-gear'), target: $('h-target'),
    dist: $('h-dist'), elev: $('h-elev'), time: $('h-time'), road: $('h-road'), gems: $('h-gems'),
    clock: $('h-clock'), clockBox: $('h-clock-box'), light: $('h-light'), lightBox: $('h-light-box'),
    level: $('h-level'), xpbar: $('h-xpbar'), xp: $('h-xp'),
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
    const cycling = graphics.dayNight.cycling;
    hud.clockBox.hidden = !cycling;
    if (cycling) hud.clock.textContent = formatClock(graphics.dayNight.time);
    hud.light.textContent = bikeLight ? 'an' : 'aus';
    hud.lightBox.classList.toggle('on', bikeLight);
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
      riderInfo(), progress.collected, progress.viewpoints, segmentRoutes,
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
      bigMapView,
      riderInfo(), progress.collected, progress.viewpoints, segmentRoutes,
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
      ['Level', `${levelFor(currentXp()).level} (${currentXp()} XP)`],
      ...REGIONS.map((r) => [r.name, world.roads.lockedRegions.has(r.id) ? `gesperrt bis Level ${r.unlockLevel}` : 'offen']),
    ].map(([k, v]) => `<span class="label">${k}</span><span>${v}</span>`).join('');
    $('bigmap-segments').innerHTML = segments.map((seg) => {
      const r = tracker.record(seg.id);
      const best = r.best === null ? '–' : `${formatSegmentTime(r.best)} (${r.runs}×)`;
      return `<span class="label"><i style="background:${SEGMENT_COLOR[seg.kind]}"></i>${SEGMENT_KIND_LABEL[seg.kind]} ${escapeHtml(seg.name)}</span><span>${best}</span>`;
    }).join('');
    $('bigmap-ach-title').textContent = `Erfolge ${unlocked.size} / ${ACHIEVEMENTS.length}`;
    $('bigmap-achievements').innerHTML = ACHIEVEMENTS.map((a) => {
      const done = unlocked.has(a.id);
      return `<li class="${done ? 'done' : ''}"><b>${done ? '★' : '☆'}</b>${escapeHtml(a.name)} – ${escapeHtml(a.text)}</li>`;
    }).join('');
  }
  window.addEventListener('resize', () => {
    if (!bigmap.hidden) drawBigMap();
  });

  // --- Entwicklung: ?stats schreibt Zeichenaufrufe und die größten Meshes in die Konsole ----
  const statsLog = params.has('stats');
  let statsDone = false;
  function logSceneStats() {
    const info = bundle.renderer.info.render;
    console.log(`STATS fps-frame calls=${info.calls} triangles=${info.triangles}`);
    // Sichtbare Meshes je Gruppe (ohne Blickfeld-Test)
    const vis = new Map<string, { n: number; tris: number }>();
    scene.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      let top: THREE.Object3D = m;
      while (top.parent && top.parent !== scene) top = top.parent;
      const key = top.name || top.type;
      const g = m.geometry;
      const tris = ((g.index ? g.index.count : g.attributes.position!.count) / 3) * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
      const e = vis.get(key) ?? { n: 0, tris: 0 };
      e.n++;
      e.tris += tris;
      vis.set(key, e);
    });
    console.log(`STATS sichtbar ${[...vis].map(([k, v]) => `${k}:${v.n}/${Math.round(v.tris / 1000)}k`).join(' ')}`);
    if (statsDone) return;
    statsDone = true;
    const rows: { name: string; tris: number; count: number; total: number }[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const g = m.geometry;
      const tris = (g.index ? g.index.count : g.attributes.position!.count) / 3;
      const count = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
      let p: THREE.Object3D | null = m;
      const path: string[] = [];
      while (p) {
        if (p.name) path.unshift(p.name);
        p = p.parent;
      }
      rows.push({ name: path.join('/') || m.type, tris, count, total: tris * count });
    });
    rows.sort((a, b) => b.total - a.total);
    console.log(`STATS meshes=${rows.length} total=${rows.reduce((s, r) => s + r.total, 0)}`);
    for (const r of rows.slice(0, 25)) console.log(`STATS ${r.name} tris=${r.tris} x${r.count} = ${r.total}`);
  }

  // --- Spielschleife ---------------------------------------------------------------------

  let clock = 0;
  let fpsFrames = 0;
  let fpsTime = 0;
  let fpsLast = performance.now();
  // Demo: feste Kamera für Grafikprüfungen (?cam=x,y,z,zielX,zielY,zielZ)
  const camParam = demo ? params.get('cam')?.split(',').map(Number) : undefined;
  const fixedCam = camParam?.length === 6 && camParam.every(Number.isFinite) ? camParam : null;
  let last = performance.now();
  let hudTimer = 0;
  let mapTimer = 0;
  let saveTimer = 0;
  let progressTimer = 0;
  placeRider(1);
  checkProgression(true);
  fog.reveal(riderPos.x, riderPos.z, REVEAL_RADIUS);
  worldMap.syncFog();

  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    input.pollGamepads();

    let state = engine.state();
    if (session) {
      const t0 = state.timeSec;
      state = session.advance(dt);
      const ds = Math.max(0, state.distance - lastDistance);
      Object.assign(stepInfo, { t0, t1: state.timeSec, d0: lastDistance, ds, active: true });
      rider.advance(ds);
      stepInfo.active = false;
      lastDistance = state.distance;
    }

    placeRider(dt);
    model.animate(dt, state.speed, state.cadence);
    poiMeshes.animate(dt);
    landmarks.animate(dt);
    nordkap.animate(dt);
    // Blick voraus folgt der gewählten Abzweigung (Vorschau ohne die Wahl zu verbrauchen)
    const aheadP = rider.pointAhead(18, (node, exits) => {
      const sel = selector.selectionFor(node.id);
      return (sel && exits.find((e) => e.edge.id === sel.edge.id && e.dir === sel.dir)) || straightest(node, exits);
    });
    aheadVec.set(aheadP.x, aheadP.y, aheadP.z);
    rig.update(dt, riderPos, forward, aheadVec, state.speed);
    if (fixedCam) {
      camera.position.set(fixedCam[0]!, fixedCam[1]!, fixedCam[2]!);
      camera.lookAt(fixedCam[3]!, fixedCam[4]!, fixedCam[5]!);
    }
    followSun(sun, riderPos);
    clock += dt;
    graphics.dayNight.update(dt, session !== null && !session.isPaused);
    graphics.update(clock, camera);
    driftClouds(bundle.clouds, dt);

    if (session && !session.isPaused) {
      recorder?.sample(Date.now(), state, riderPos.y);
      if (fog.reveal(riderPos.x, riderPos.z, REVEAL_RADIUS) > 0) dirty = true;
      for (const ev of progress.update(rider.position, state.timeSec)) onProgress(ev);
      tracker.update(state.timeSec, state.distance);
      progressTimer += dt;
      if (progressTimer > 1) {
        progressTimer = 0;
        checkProgression();
      }
      saveTimer += dt;
      if (saveTimer > AUTOSAVE_SEC) {
        saveTimer = 0;
        if (dirty || state.speed > 0) saveNow();
      }
    }
    junctionHud.update(rider, selector);
    const runs = tracker.runs();
    placeGhost(dt, runs);

    hudTimer += dt;
    if (hudTimer > 0.1) {
      hudTimer = 0;
      updateHud(state);
      updateTestPanel(state);
      const run = runs[0];
      segmentHud.update(run, run ? tracker.record(run.segment.id).best : null);
    }
    mapTimer += dt;
    if (mapTimer > 1 / 15) {
      mapTimer = 0;
      worldMap.syncFog();
      drawMinimap();
      if (!bigmap.hidden) drawBigMap();
    }

    graphics.render();
    // Bildrate über eine halbe Sekunde gemittelt (für Testanzeige und Grafikmenü)
    fpsFrames++;
    fpsTime += (now - fpsLast) / 1000;
    fpsLast = now;
    if (fpsTime >= 0.5) {
      const fps = fpsFrames / fpsTime;
      const ms = (fpsTime / fpsFrames) * 1000;
      fpsFrames = 0;
      fpsTime = 0;
      if (!testPanel.hidden) {
        tp('fps').textContent = `${Math.round(fps)} fps · ${ms.toFixed(1)} ms`;
        const info = bundle.renderer.info.render;
        tp('draw').textContent = `${info.calls} · ${(info.triangles / 1000).toFixed(0)} k`;
      }
      if (statsLog) logSceneStats();
      graphicsPanel.showFps(fps, ms);
    }
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
