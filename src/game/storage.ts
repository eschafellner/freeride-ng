import { openDB, type IDBPDatabase } from 'idb';
import type { RideMeta, RideTrack } from '../history/rideLog';
import type { SaveData } from '../world/saveGame';

const DB_NAME = 'freeride-ng';
const STORE = 'saves';
const SLOT = 'slot1';

let dbPromise: Promise<IDBPDatabase> | null = null;

/** Fahrten-Historie: Liste (klein) und Messpunkte (groß) getrennt, damit die Liste schnell lädt. */
const RIDES = 'rides';
const TRACKS = 'rideTracks';

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) d.createObjectStore(STORE);
      if (oldVersion < 2) {
        d.createObjectStore(RIDES);
        d.createObjectStore(TRACKS);
      }
    },
  });
  return dbPromise;
}

/** Spätestens nach dieser Zeit startet das Spiel ohne Spielstand. */
const LOAD_TIMEOUT_MS = 2000;

/**
 * Roh geladener Stand; vor Verwendung mit `sanitizeSave` prüfen.
 * Hängt IndexedDB (blockiert, privates Fenster …), geht es nach einem
 * Zeitlimit ohne Spielstand weiter, statt den Start zu blockieren.
 */
export async function loadSave(): Promise<unknown> {
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => {
      console.warn('Spielstand: Zeitüberschreitung beim Laden, starte ohne');
      resolve(null);
    }, LOAD_TIMEOUT_MS),
  );
  try {
    return await Promise.race([db().then((d) => d.get(STORE, SLOT)), timeout]);
  } catch (err) {
    console.warn('Spielstand konnte nicht geladen werden', err);
    return null;
  }
}

export async function writeSave(data: SaveData): Promise<void> {
  try {
    await (await db()).put(STORE, data, SLOT);
  } catch (err) {
    console.warn('Spielstand konnte nicht gespeichert werden', err);
  }
}

export async function deleteSave(): Promise<void> {
  try {
    await (await db()).delete(STORE, SLOT);
  } catch (err) {
    console.warn('Spielstand konnte nicht gelöscht werden', err);
  }
}

// --- Fahrten-Historie -------------------------------------------------------------------

export async function writeRide(meta: RideMeta, track: RideTrack): Promise<void> {
  try {
    const tx = (await db()).transaction([RIDES, TRACKS], 'readwrite');
    await Promise.all([tx.objectStore(RIDES).put(meta, meta.id), tx.objectStore(TRACKS).put(track, meta.id), tx.done]);
  } catch (err) {
    console.warn('Fahrt konnte nicht gespeichert werden', err);
  }
}

/** Alle Fahrten, neueste zuerst (ohne Messpunkte). */
export async function listRides(): Promise<RideMeta[]> {
  try {
    const all = (await (await db()).getAll(RIDES)) as RideMeta[];
    return all.filter((r) => r?.version === 1 && r.summary).sort((a, b) => b.startedAt - a.startedAt);
  } catch (err) {
    console.warn('Fahrten konnten nicht geladen werden', err);
    return [];
  }
}

export async function loadRideTrack(id: string): Promise<RideTrack | null> {
  try {
    return ((await (await db()).get(TRACKS, id)) as RideTrack | undefined) ?? null;
  } catch (err) {
    console.warn('Fahrt konnte nicht geladen werden', err);
    return null;
  }
}

export async function deleteRide(id: string): Promise<void> {
  try {
    const tx = (await db()).transaction([RIDES, TRACKS], 'readwrite');
    await Promise.all([tx.objectStore(RIDES).delete(id), tx.objectStore(TRACKS).delete(id), tx.done]);
  } catch (err) {
    console.warn('Fahrt konnte nicht gelöscht werden', err);
  }
}
