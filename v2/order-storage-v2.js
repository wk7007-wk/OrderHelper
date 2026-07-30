(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrderHelperStorageV2 = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NAMESPACE = 'orderhelper_v2_';
  const DRAFT_KEY = NAMESPACE + 'draft_v1';
  const SCHEMA_VERSION = 1;

  class StorageCorruptionError extends Error {
    constructor(message) { super(message); this.name = 'StorageCorruptionError'; }
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function requireStorage(storage) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new TypeError('localStorage-compatible adapter required');
    }
  }

  function assertV2Key(key) {
    if (!String(key).startsWith(NAMESPACE)) throw new TypeError('legacy localStorage key is forbidden');
    return String(key);
  }

  function emptyDraft(actorId, document) {
    return {
      schemaVersion: SCHEMA_VERSION,
      actorId: String(actorId),
      document: cloneJson(document),
      dirty: false,
      mutationCount: 0,
      updatedAt: 0,
      lastConfirmedFingerprint: null
    };
  }

  function normalizeDraft(source, actorId) {
    if (!isRecord(source) || Number(source.schemaVersion) !== SCHEMA_VERSION) {
      throw new StorageCorruptionError('draft schema is invalid; persistence is halted');
    }
    if (String(source.actorId) !== String(actorId)) {
      throw new StorageCorruptionError('draft actor mismatch; persistence is halted');
    }
    if (!isRecord(source.document)) throw new StorageCorruptionError('draft document is invalid; persistence is halted');
    const mutationCount = Number(source.mutationCount);
    const updatedAt = Number(source.updatedAt);
    if (!Number.isSafeInteger(mutationCount) || mutationCount < 0 || !Number.isFinite(updatedAt) || updatedAt < 0) {
      throw new StorageCorruptionError('draft metadata is invalid; persistence is halted');
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      actorId: String(actorId),
      document: cloneJson(source.document),
      dirty: source.dirty === true,
      mutationCount,
      updatedAt,
      lastConfirmedFingerprint: source.lastConfirmedFingerprint === null || source.lastConfirmedFingerprint === undefined
        ? null
        : String(source.lastConfirmedFingerprint)
    };
  }

  function loadDraft(storage, actorId, fallbackDocument, key = DRAFT_KEY) {
    requireStorage(storage);
    assertV2Key(key);
    const raw = storage.getItem(key);
    if (raw === null) return emptyDraft(actorId, fallbackDocument);
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { throw new StorageCorruptionError('draft JSON is malformed; persistence is halted'); }
    return normalizeDraft(parsed, actorId);
  }

  function saveDraft(storage, draft, key = DRAFT_KEY) {
    requireStorage(storage);
    assertV2Key(key);
    const normalized = normalizeDraft(draft, draft.actorId);
    const serialized = JSON.stringify(normalized);
    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized) throw new StorageCorruptionError('draft durable write verification failed');
    return normalized;
  }

  return Object.freeze({
    NAMESPACE,
    DRAFT_KEY,
    SCHEMA_VERSION,
    StorageCorruptionError,
    assertV2Key,
    emptyDraft,
    normalizeDraft,
    loadDraft,
    saveDraft
  });
}));
