import {
  BUILTIN_PRESETS,
  DEFAULT_APPEARANCE,
  DEFAULT_SCRIPTS,
  DEFAULT_SPEECH_CONFIG,
} from './defaults';
import type { PersistedState, StoredVoskModelMeta } from './types';

const STORAGE_KEY = 'sufleur_state_v1';
const IDB_NAME = 'sufleur_offline_models';
const IDB_STORE = 'vosk_models';

interface StoredVoskRecord extends StoredVoskModelMeta {
  blob: Blob;
}

export function loadPersistedState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        scripts: DEFAULT_SCRIPTS,
        activeScriptId: DEFAULT_SCRIPTS[0].id,
        appearance: { ...DEFAULT_APPEARANCE },
        presets: [...BUILTIN_PRESETS],
        speech: { ...DEFAULT_SPEECH_CONFIG },
      };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const scripts =
      Array.isArray(parsed.scripts) && parsed.scripts.length > 0
        ? parsed.scripts
        : DEFAULT_SCRIPTS;
    const activeScriptId = scripts.some((s) => s.id === parsed.activeScriptId)
      ? (parsed.activeScriptId as string)
      : scripts[0].id;

    // Merge built-in presets with any user-saved custom presets
    const customPresets = Array.isArray(parsed.presets)
      ? parsed.presets.filter((p) => !p.builtIn)
      : [];

    return {
      scripts,
      activeScriptId,
      appearance: { ...DEFAULT_APPEARANCE, ...(parsed.appearance ?? {}) },
      presets: [...BUILTIN_PRESETS, ...customPresets],
      speech: { ...DEFAULT_SPEECH_CONFIG, ...(parsed.speech ?? {}) },
    };
  } catch {
    return {
      scripts: DEFAULT_SCRIPTS,
      activeScriptId: DEFAULT_SCRIPTS[0].id,
      appearance: { ...DEFAULT_APPEARANCE },
      presets: [...BUILTIN_PRESETS],
      speech: { ...DEFAULT_SPEECH_CONFIG },
    };
  }
}

export function savePersistedState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage quota exceeded or private browsing — fail gracefully
  }
}

// ── IndexedDB storage for offline Vosk WASM model archives ──

function openModelsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser.'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB.'));
  });
}

export async function saveVoskModelFile(file: File): Promise<StoredVoskModelMeta> {
  const db = await openModelsDb();
  const id = `vosk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const record: StoredVoskRecord = {
    id,
    name: file.name,
    sizeBytes: file.size,
    savedAt: Date.now(),
    blob: file,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(record);
    tx.oncomplete = () =>
      resolve({
        id: record.id,
        name: record.name,
        sizeBytes: record.sizeBytes,
        savedAt: record.savedAt,
      });
    tx.onerror = () => reject(tx.error ?? new Error('Failed to store model archive.'));
  });
}

export async function listVoskModels(): Promise<StoredVoskModelMeta[]> {
  try {
    const db = await openModelsDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => {
        const rows = (req.result as StoredVoskRecord[]) ?? [];
        resolve(
          rows.map(({ id, name, sizeBytes, savedAt }) => ({
            id,
            name,
            sizeBytes,
            savedAt,
          })),
        );
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function getVoskModelBlob(
  id: string,
): Promise<StoredVoskRecord | null> {
  try {
    const db = await openModelsDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(id);
      req.onsuccess = () => resolve((req.result as StoredVoskRecord) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function deleteVoskModel(id: string): Promise<void> {
  const db = await openModelsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
