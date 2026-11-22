const DB_NAME = 'dictaphone';
const DB_VERSION = 2;
const CLIPS = 'audio_clips';
const ITEMS = 'review_items';

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CLIPS)) {
        const clips = db.createObjectStore(CLIPS, { keyPath: 'clip_id' });
        clips.createIndex('created_at', 'created_at');
      }
      if (!db.objectStoreNames.contains(ITEMS)) {
        const items = db.createObjectStore(ITEMS, { keyPath: 'item_id' });
        items.createIndex('clip_id', 'clip_id');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Dictaphone tabs and try again.'));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction was aborted.'));
  });
}

export async function saveClip(clip) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(CLIPS, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(CLIPS).add(clip);
    await done;
  } finally { db.close(); }
}

export async function getClips() {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(CLIPS, 'readonly').objectStore(CLIPS).getAll();
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.created_at.localeCompare(a.created_at)));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function clearClips() {
  const db = await openDatabase();
  try {
    const tx = db.transaction(CLIPS, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(CLIPS).clear();
    await done;
  } finally { db.close(); }
}

export async function getItems() {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(ITEMS, 'readonly').objectStore(ITEMS).getAll();
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.captured_at.localeCompare(a.captured_at)));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function saveProcessing(clipId, transcript, suggestions, source) {
  const db = await openDatabase();
  try {
    const clip = await new Promise((resolve, reject) => {
      const request = db.transaction(CLIPS, 'readonly').objectStore(CLIPS).get(clipId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!clip || clip.status !== 'unprocessed') throw new Error('Clip already processed or missing.');
    const normalized = suggestions.slice(0, 8).filter(x => x && typeof x.text === 'string' && x.text.trim());
    if (!normalized.length) normalized.push({ text: transcript, category: 'Observation', priority: null });
    const tx = db.transaction([CLIPS, ITEMS], 'readwrite');
    const done = transactionDone(tx);
    const itemStore = tx.objectStore(ITEMS);
    for (const suggestion of normalized) {
      itemStore.add({
        item_id: crypto.randomUUID(), clip_id: clipId, captured_at: clip.created_at,
        text: suggestion.text.trim().slice(0, 2000),
        category: ['Task', 'Idea', 'Observation', 'Gym_Log', 'Noise'].includes(suggestion.category) ? suggestion.category : 'Observation',
        priority: Number.isInteger(suggestion.priority) && suggestion.priority >= 1 && suggestion.priority <= 10 ? suggestion.priority : null,
        status: 'pending', source
      });
    }
    tx.objectStore(CLIPS).put({ ...clip, status: 'processed', transcript: transcript.slice(0, 6000) });
    await done;
  } finally { db.close(); }
}

export async function updateItem(itemId, patch) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(ITEMS, 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore(ITEMS);
    const item = await new Promise((resolve, reject) => {
      const request = store.get(itemId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!item) { tx.abort(); await done.catch(() => {}); throw new Error('Item missing.'); }
    store.put({ ...item, ...patch, modified_at: new Date().toISOString() });
    await done;
  } finally { db.close(); }
}
