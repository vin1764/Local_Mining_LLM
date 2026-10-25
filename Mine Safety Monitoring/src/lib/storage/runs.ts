/**
 * Saved runs, stored in the browser's IndexedDB on this computer.
 * Nothing here talks to a server. Data is tied to the app's address
 * (http://127.0.0.1:8080 by default), so keep the same host and port.
 */
import type { DatasetInsights } from "@/lib/dataset";

export interface SavedRun {
  id: string;
  name: string;
  savedAt: string; // ISO timestamp
  rowCount: number;
  csvText: string;
  insights: DatasetInsights | null;
  model: string | null;
  analysedAt: string | null;
}

export type SavedRunSummary = Omit<SavedRun, "csvText">;

const DB_NAME = "strata-local";
const DB_VERSION = 1;
const STORE = "runs";
export const MAX_SAVED_RUNS = 50;

function available(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!available()) {
      reject(
        new Error(
          "This browser does not allow local storage (IndexedDB) for this page.",
        ),
      );
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("savedAt", "savedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("Could not open local storage."));
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        t.onerror = () => {
          db.close();
          reject(t.error ?? new Error("Local storage operation failed."));
        };
        t.onabort = () => {
          db.close();
          const err = t.error;
          reject(
            err && err.name === "QuotaExceededError"
              ? new Error(
                  "Browser storage is full. Delete some saved runs and try again.",
                )
              : (err ?? new Error("Local storage operation was aborted.")),
          );
        };
      }),
  );
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function listRuns(): Promise<SavedRunSummary[]> {
  const all = await tx<SavedRun[]>(
    "readonly",
    (s) => s.getAll() as IDBRequest<SavedRun[]>,
  );
  return all
    .map(({ csvText: _csv, ...rest }) => rest)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function getRun(id: string): Promise<SavedRun | null> {
  const run = await tx<SavedRun | undefined>(
    "readonly",
    (s) => s.get(id) as IDBRequest<SavedRun | undefined>,
  );
  return run ?? null;
}

export async function saveRun(
  input: Omit<SavedRun, "id" | "savedAt"> & { id?: string },
): Promise<SavedRun> {
  const existing = await listRuns();
  if (!input.id && existing.length >= MAX_SAVED_RUNS) {
    throw new Error(
      `You already have ${MAX_SAVED_RUNS} saved runs. Delete one first.`,
    );
  }
  const run: SavedRun = {
    ...input,
    id: input.id ?? newId(),
    savedAt: new Date().toISOString(),
  };
  await tx("readwrite", (s) => s.put(run));
  return run;
}

export async function deleteRun(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}
