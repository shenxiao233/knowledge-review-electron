/**
 * kr-db.js — Structured IndexedDB database using Dexie
 * Dependencies: dexie.min.js (loaded before this file)
 * Provides: db, loadFromDexie, saveCard, saveCards, saveDocument, saveReviewEvent,
 *           saveMeta, saveFullState, deleteCard, deleteDocument, getTodayReviewCards,
 *           getCardIndex, rebuildCardIndex, migrateOldData
 *
 * Object Stores:
 *   cards        — keyPath 'id', indexes: folder, dueAt, type, suspended
 *   documents    — keyPath 'id', indexes: folder, updatedAt
 *   reviewEvents — auto-increment 'id', indexes: cardId, reviewedAt
 *   meta         — key-value store, keyPath 'key'
 */

const DB_NAME = 'knowledge-review-v2';

const db = new Dexie(DB_NAME);

// Version 1: structured stores with indexes
db.version(1).stores({
  cards:        'id, folder, dueAt, type, suspended',
  documents:    'id, folder, updatedAt',
  reviewEvents: '++id, cardId, reviewedAt',
  meta:         'key',
});

// ─── In-memory card index for O(1) lookups by ID ───
let cardIndex = new Map();
function rebuildCardIndex() {
  cardIndex = new Map((state.cards || []).map((c) => [c.id, c]));
}
function getCardIndex() {
  return cardIndex;
}

// ─── Load: read all data from Dexie into a state-like object ───
async function loadFromDexie() {
  const [cards, documents, reviewEvents, metaRecords] = await Promise.all([
    db.cards.toArray(),
    db.documents.toArray(),
    db.reviewEvents.toArray(),
    db.meta.toArray(),
  ]);

  const meta = {};
  for (const record of metaRecords) {
    meta[record.key] = record.value;
  }

  return {
    cards: cards || [],
    documents: documents || [],
    reviewEvents: reviewEvents || [],
    ...meta,
  };
}

// ─── Incremental save functions ───

async function saveCard(card) {
  if (!card?.id) return;
  await db.cards.put(card);
  // Keep in-memory index in sync
  cardIndex.set(card.id, card);
}

async function saveCards(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return;
  await db.cards.bulkPut(cards);
  for (const card of cards) {
    if (card?.id) cardIndex.set(card.id, card);
  }
}

async function deleteCard(id) {
  await db.transaction('rw', [db.cards, db.reviewEvents], async () => {
    await db.cards.delete(id);
    await db.reviewEvents.where('cardId').equals(id).delete();
  });
  cardIndex.delete(id);
}

async function saveDocument(doc) {
  if (!doc?.id) return;
  await db.documents.put(doc);
}

async function deleteDocument(id) {
  await db.documents.delete(id);
}

async function saveReviewEvent(event) {
  if (event.id !== undefined) {
    await db.reviewEvents.put(event);
  } else {
    const id = await db.reviewEvents.add(event);
    return id;
  }
}

async function saveReviewEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return;
  await db.reviewEvents.bulkPut(events);
}

const META_KEYS = [
  'settings', 'groups', 'folders', 'reviewLog', 'reviewPlan',
  'profile', 'favorites', 'market', 'syncMeta',
  'selectedCardId', 'activeDocId', 'extractedText',
  'schemaVersion', 'algorithm',
];

async function saveMeta(key, value) {
  await db.meta.put({ key, value });
}

async function saveAllMeta(stateObj) {
  const entries = META_KEYS
    .filter((k) => stateObj[k] !== undefined)
    .map((k) => ({ key: k, value: stateObj[k] }));
  if (entries.length === 0) return;
  await db.meta.bulkPut(entries);
}

// ─── Full state save (transactional, for compatibility with save()) ───
async function saveFullState(stateObj) {
  const now = new Date().toISOString();
  await db.transaction('rw', [db.cards, db.documents, db.reviewEvents, db.meta], async () => {
    await db.cards.clear();
    await db.cards.bulkPut(stateObj.cards || []);
    await db.documents.clear();
    await db.documents.bulkPut(stateObj.documents || []);
    await db.reviewEvents.clear();
    await db.reviewEvents.bulkPut(stateObj.reviewEvents || []);
    await db.meta.clear();
    await saveAllMeta(stateObj);
    await db.meta.put({ key: 'lastSavedAt', value: now });
  });
  rebuildCardIndex();
}

// ─── Incremental save: meta + review events only (no clearing) ───
// Used by scheduleDexieSave() for the common case where cards/documents
// were already saved incrementally by saveCardChange/saveDocChange.
// Only meta keys and review events need periodic full writes.
async function saveMetaAndEvents(stateObj) {
  const now = new Date().toISOString();
  await db.transaction('rw', [db.reviewEvents, db.meta], async () => {
    if (stateObj.reviewEvents?.length) {
      await db.reviewEvents.bulkPut(stateObj.reviewEvents);
    }
    await saveAllMeta(stateObj);
    await db.meta.put({ key: 'lastSavedAt', value: now });
  });
}

// ─── Bulk sync: write all cards + delete orphans ───
// Used when cards were bulk-modified (import, dedup, delete) and
// incremental saveCardChange wasn't called for each card.
async function syncCards(cards) {
  const ids = new Set(cards.map((c) => c.id));
  await db.transaction('rw', db.cards, async () => {
    // Delete records that are no longer in state
    const existingKeys = await db.cards.toCollection().primaryKeys();
    const toDelete = existingKeys.filter((key) => !ids.has(key));
    if (toDelete.length) await db.cards.bulkDelete(toDelete);
    // Upsert all current cards
    await db.cards.bulkPut(cards);
  });
  rebuildCardIndex();
}

// ─── Bulk sync: write all documents + delete orphans ───
async function syncDocuments(documents) {
  const ids = new Set(documents.map((d) => d.id));
  await db.transaction('rw', db.documents, async () => {
    const existingKeys = await db.documents.toCollection().primaryKeys();
    const toDelete = existingKeys.filter((key) => !ids.has(key));
    if (toDelete.length) await db.documents.bulkDelete(toDelete);
    await db.documents.bulkPut(documents);
  });
}

// ─── Get last saved timestamp from Dexie meta store ───
async function getDexieSavedAt() {
  try {
    const record = await db.meta.get('lastSavedAt');
    return record?.value || '';
  } catch { return ''; }
}

// ─── Query helpers using Dexie indexes ───

async function getTodayReviewCards(now) {
  const cutoff = new Date(now ?? Date.now()).toISOString();
  return db.cards
    .where('dueAt')
    .belowOrEqual(cutoff)
    .and((card) => !card.suspended)
    .toArray();
}

async function getCardsByFolder(folder) {
  if (!folder || folder === 'all') return db.cards.toArray();
  return db.cards.where('folder').equals(folder).toArray();
}

async function getDocument(id) {
  return db.documents.get(id);
}

async function getReviewEventsByDate(from, to) {
  const collection = db.reviewEvents.where('reviewedAt');
  if (from && to) return collection.between(from, to, true, true).toArray();
  if (from) return collection.aboveOrEqual(from).toArray();
  if (to) return collection.belowOrEqual(to).toArray();
  return db.reviewEvents.toArray();
}

// ─── Migration from old single-blob IDB format ───
async function migrateOldData() {
  try {
    // Check old IDB store (from idb-store.js) for existing data
    const oldData = await idbGet('app-state');
    if (!oldData?.data) return false;

    console.log('[DB] Migrating from old single-blob format to structured stores...');
    const oldState = JSON.parse(oldData.data);

    await saveFullState(oldState);

    // Don't delete old data yet — keep as backup
    // await idbDelete('app-state');

    console.log('[DB] Migration complete.');
    return true;
  } catch (e) {
    console.warn('[DB] Migration failed (non-fatal):', e.message);
    return false;
  }
}

// ─── Wipe all data (used by resetLocalStateForNewUser) ───
async function wipeDexieData() {
  await db.transaction('rw', [db.cards, db.documents, db.reviewEvents, db.meta], async () => {
    await db.cards.clear();
    await db.documents.clear();
    await db.reviewEvents.clear();
    await db.meta.clear();
  });
  cardIndex.clear();
}
