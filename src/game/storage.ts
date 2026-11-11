import { openDB, type IDBPDatabase } from 'idb';
import type { SaveData } from '../world/saveGame';

const DB_NAME = 'freeride-ng';
const STORE = 'saves';
const SLOT = 'slot1';

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore(STORE);
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
