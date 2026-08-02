(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrderHelperSyncV2 = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 2;
  const CONSTITUTION_SHA256 = '8cd45de2922894fe2be8b8e7424fe91cc490ec20d2ec9cea0a60164fcf21a575';
  const CANONICAL_NODE = '/order/desk_q7m9r3a8/syncV2/canonical';
  // The live v1 snapshot contains roughly 2 MiB of SFA evidence and derived
  // candidates. V2 deliberately excludes those read models, but 110 stable
  // inventory entries plus user-confirmed mappings still need more than the
  // original foundation-only 64 KiB fixture budget. Keep a 128 KiB hard
  // ceiling well below the legacy payload while allowing the real state.
  const MAX_CANONICAL_BYTES = 128 * 1024;
  const DEFAULT_STORAGE_KEYS = Object.freeze({
    actor: 'orderhelper_v2_actor_v1',
    outbox: 'orderhelper_v2_outbox_v1',
    migration: 'orderhelper_v2_legacy_migration_v1'
  });
  const COLLECTIONS = Object.freeze([
    'inventory', 'entries', 'zones', 'usage', 'sales', 'mappings',
    'manualItems', 'acceptedAdvisory', 'settings'
  ]);
  const activeFlushActors = new WeakMap();

  class SyncValidationError extends Error {
    constructor(message) { super(message); this.name = 'SyncValidationError'; }
  }
  class SyncCorruptionError extends Error {
    constructor(message) { super(message); this.name = 'SyncCorruptionError'; }
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneJson(value) {
    if (value === undefined) throw new SyncValidationError('undefined is not a canonical JSON value');
    return JSON.parse(JSON.stringify(value));
  }

  function assertFirebaseJsonKeys(value) {
    if (Array.isArray(value)) {
      value.forEach(assertFirebaseJsonKeys);
      return;
    }
    if (!isRecord(value)) return;
    Object.keys(value).forEach(key => {
      canonicalKey(key, 'nested field key');
      assertFirebaseJsonKeys(value[key]);
    });
  }

  function canonicalJson(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }

  function stableHash(value) {
    const text = typeof value === 'string' ? value : canonicalJson(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function utf8Bytes(value) {
    const text = String(value);
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
    return Array.from(unescape(encodeURIComponent(text)), character => character.charCodeAt(0));
  }

  function base64UrlEncode(value) {
    const bytes = utf8Bytes(value);
    let output = '';
    for (let index = 0; index < bytes.length; index += 3) {
      const a = bytes[index];
      const b = bytes[index + 1];
      const c = bytes[index + 2];
      output += BASE64URL_ALPHABET[a >> 2];
      output += BASE64URL_ALPHABET[((a & 3) << 4) | (b === undefined ? 0 : b >> 4)];
      if (b !== undefined) output += BASE64URL_ALPHABET[((b & 15) << 2) | (c === undefined ? 0 : c >> 6)];
      if (c !== undefined) output += BASE64URL_ALPHABET[c & 63];
    }
    return output;
  }

  function base64UrlDecode(value) {
    const encoded = String(value || '');
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) {
      throw new SyncValidationError('invalid encoded mapping key');
    }
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (const character of encoded) {
      const digit = BASE64URL_ALPHABET.indexOf(character);
      if (digit < 0) throw new SyncValidationError('invalid encoded mapping key');
      buffer = (buffer << 6) | digit;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 255);
      }
    }
    try {
      return decodeURIComponent(bytes.map(byte => '%' + byte.toString(16).padStart(2, '0')).join(''));
    } catch (_) {
      throw new SyncValidationError('invalid UTF-8 mapping key');
    }
  }

  function normalizeActorId(value) {
    const actorId = String(value || '').trim();
    if (!/^[A-Za-z0-9._-]{3,120}$/.test(actorId)) throw new SyncValidationError('invalid actor id');
    return actorId;
  }

  function canonicalKey(value, label = 'canonical key') {
    const key = String(value ?? '');
    const bytes = typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(key).length
      : unescape(encodeURIComponent(key)).length;
    if (!key || bytes > 768 || /[.#$\/\[\]\u0000-\u001F\u007F]/.test(key)) {
      throw new SyncValidationError('invalid Firebase ' + label);
    }
    return key;
  }

  function validateStamp(stamp) {
    if (!isRecord(stamp)) throw new SyncValidationError('missing stamp');
    const epoch = Number(stamp.epoch);
    const counter = Number(stamp.counter);
    if (!Number.isSafeInteger(epoch) || epoch < 0) throw new SyncValidationError('invalid stamp epoch');
    if (!Number.isSafeInteger(counter) || counter < 0) throw new SyncValidationError('invalid Lamport counter');
    return { epoch, counter, actorId: normalizeActorId(stamp.actorId) };
  }

  function compareStamp(left, right) {
    const a = validateStamp(left);
    const b = validateStamp(right);
    if (a.epoch !== b.epoch) return a.epoch < b.epoch ? -1 : 1;
    if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
    return a.actorId.localeCompare(b.actorId);
  }

  function compareRegister(left, right) {
    const stampOrder = compareStamp(left.stamp, right.stamp);
    if (stampOrder) return stampOrder;
    return canonicalJson({ tombstone: Boolean(left.tombstone), value: left.tombstone ? null : left.value })
      .localeCompare(canonicalJson({ tombstone: Boolean(right.tombstone), value: right.tombstone ? null : right.value }));
  }

  function normalizeRegister(register) {
    if (!isRecord(register)) {
      throw new SyncValidationError('invalid field register');
    }
    if (register.tombstone === true) return { tombstone: true, stamp: validateStamp(register.stamp) };
    if (!Object.prototype.hasOwnProperty.call(register, 'value')) throw new SyncValidationError('register needs value or tombstone');
    const value = cloneJson(register.value);
    assertFirebaseJsonKeys(value);
    return { value, tombstone: false, stamp: validateStamp(register.stamp) };
  }

  function emptyDocument(epoch = 0) {
    if (!Number.isSafeInteger(epoch) || epoch < 0) throw new SyncValidationError('invalid epoch');
    return {
      schemaVersion: SCHEMA_VERSION,
      reset: { epoch, stamp: { epoch, counter: 0, actorId: 'system.v2' } },
      collections: Object.fromEntries(COLLECTIONS.map(collection => [collection, {}])),
      sfaHead: null,
      meta: { maxCounter: 0 }
    };
  }

  function normalizeDocument(source) {
    if (source === null || source === undefined) return emptyDocument();
    if (!isRecord(source) || Number(source.schemaVersion) !== SCHEMA_VERSION) {
      throw new SyncValidationError('unsupported canonical document');
    }
    const resetEpoch = Number(source.reset?.epoch || 0);
    const out = emptyDocument(resetEpoch);
    out.reset = {
      epoch: resetEpoch,
      stamp: source.reset?.stamp ? validateStamp(source.reset.stamp) : out.reset.stamp
    };
    COLLECTIONS.forEach(collection => {
      const rows = source.collections?.[collection] || {};
      if (!isRecord(rows)) throw new SyncValidationError('invalid collection ' + collection);
      Object.keys(rows).sort().forEach(key => {
        canonicalKey(key, 'row key');
        if (!isRecord(rows[key])) throw new SyncValidationError('invalid row ' + collection + '/' + key);
        const fields = {};
        Object.keys(rows[key]).sort().forEach(field => {
          canonicalKey(field, 'field key');
          const register = normalizeRegister(rows[key][field]);
          if (register.stamp.epoch >= resetEpoch) fields[field] = register;
          out.meta.maxCounter = Math.max(out.meta.maxCounter, register.stamp.counter);
        });
        if (Object.keys(fields).length) out.collections[collection][key] = fields;
      });
    });
    if (source.sfaLedger !== undefined) throw new SyncValidationError('full SFA ledger is forbidden in canonical state');
    if (source.sfaHead) {
      const register = normalizeRegister(source.sfaHead);
      if (register.stamp.epoch >= resetEpoch) out.sfaHead = register;
      out.meta.maxCounter = Math.max(out.meta.maxCounter, register.stamp.counter);
    }
    out.meta.maxCounter = Math.max(out.meta.maxCounter, Number(source.meta?.maxCounter || 0), out.reset.stamp.counter);
    return out;
  }

  function conflictFor(path, left, right, winner) {
    if (canonicalJson({ tombstone: Boolean(left.tombstone), value: left.tombstone ? null : left.value }) ===
        canonicalJson({ tombstone: Boolean(right.tombstone), value: right.tombstone ? null : right.value })) return null;
    const candidates = [left, right].map(normalizeRegister).sort(compareRegister);
    return {
      conflictId: stableHash({ path, candidates }),
      path,
      status: 'resolved_deterministically',
      candidates,
      winner: normalizeRegister(winner)
    };
  }

  function mergeRegister(left, right, path, conflicts) {
    if (!left) return normalizeRegister(right);
    if (!right) return normalizeRegister(left);
    const a = normalizeRegister(left);
    const b = normalizeRegister(right);
    const winner = compareRegister(a, b) >= 0 ? a : b;
    const conflict = conflictFor(path, a, b, winner);
    const sameStampFromSharedActor = a.stamp.actorId === b.stamp.actorId && a.stamp.counter === b.stamp.counter;
    if (conflict && a.stamp.epoch === b.stamp.epoch
        && (a.stamp.actorId !== b.stamp.actorId || sameStampFromSharedActor)) conflicts.push(conflict);
    return winner;
  }

  function mergeDocuments(leftSource, rightSource) {
    const left = normalizeDocument(leftSource);
    const right = normalizeDocument(rightSource);
    const resetWinner = compareStamp(left.reset.stamp, right.reset.stamp) >= 0 ? left.reset : right.reset;
    const epoch = Math.max(left.reset.epoch, right.reset.epoch, resetWinner.epoch);
    const merged = emptyDocument(epoch);
    merged.reset = cloneJson(resetWinner.epoch === epoch ? resetWinner : {
      epoch,
      stamp: compareStamp(left.reset.stamp, right.reset.stamp) >= 0 ? left.reset.stamp : right.reset.stamp
    });
    const conflicts = [];
    COLLECTIONS.forEach(collection => {
      const rowKeys = new Set([...Object.keys(left.collections[collection]), ...Object.keys(right.collections[collection])]);
      Array.from(rowKeys).sort().forEach(key => {
        const leftRow = left.collections[collection][key] || {};
        const rightRow = right.collections[collection][key] || {};
        const fields = {};
        const fieldKeys = new Set([...Object.keys(leftRow), ...Object.keys(rightRow)]);
        Array.from(fieldKeys).sort().forEach(field => {
          const register = mergeRegister(leftRow[field], rightRow[field], collection + '/' + key + '/' + field, conflicts);
          if (register.stamp.epoch >= epoch) fields[field] = register;
        });
        if (Object.keys(fields).length) merged.collections[collection][key] = fields;
      });
    });
    if (left.sfaHead || right.sfaHead) {
      const register = mergeRegister(left.sfaHead, right.sfaHead, 'sfaHead', conflicts);
      if (register.stamp.epoch >= epoch) merged.sfaHead = register;
    }
    merged.meta.maxCounter = Math.max(left.meta.maxCounter, right.meta.maxCounter);
    conflicts.sort((a, b) => a.conflictId.localeCompare(b.conflictId));
    return { document: normalizeDocument(merged), conflicts };
  }

  function createActor(storage, options = {}) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new SyncValidationError('storage adapter required');
    }
    const key = options.storageKey || DEFAULT_STORAGE_KEYS.actor;
    const raw = storage.getItem(key);
    if (raw !== null) {
      let parsed;
      try { parsed = JSON.parse(raw); } catch (_) { throw new SyncCorruptionError('actor storage is malformed'); }
      const actor = { actorId: normalizeActorId(parsed.actorId), epoch: Number(parsed.epoch), counter: Number(parsed.counter) };
      if (!Number.isSafeInteger(actor.epoch) || actor.epoch < 0 || !Number.isSafeInteger(actor.counter) || actor.counter < 0) {
        throw new SyncCorruptionError('actor storage is invalid');
      }
      return actor;
    }
    const supplied = options.actorId;
    const generated = 'actor-' + stableHash(String(Date.now()) + '-' + String(options.seed || Math.random()));
    const actor = { actorId: normalizeActorId(supplied || generated), epoch: 0, counter: 0 };
    storage.setItem(key, JSON.stringify(actor));
    return actor;
  }

  function persistActor(storage, actor, storageKey = DEFAULT_STORAGE_KEYS.actor) {
    storage.setItem(storageKey, JSON.stringify({ actorId: normalizeActorId(actor.actorId), epoch: actor.epoch, counter: actor.counter }));
  }

  function nextStamp(actor, observedDocument) {
    if (!actor) throw new SyncValidationError('actor required');
    const observed = observedDocument ? normalizeDocument(observedDocument) : emptyDocument(actor.epoch);
    actor.epoch = Math.max(Number(actor.epoch || 0), observed.reset.epoch);
    actor.counter = Math.max(Number(actor.counter || 0), observed.meta.maxCounter) + 1;
    return { epoch: actor.epoch, counter: actor.counter, actorId: normalizeActorId(actor.actorId) };
  }

  function writeFields(documentSource, actor, collection, key, patch) {
    if (!COLLECTIONS.includes(collection)) throw new SyncValidationError('unknown collection');
    if (!isRecord(patch)) throw new SyncValidationError('field patch must be an object');
    const rowKey = canonicalKey(key, 'row key');
    const document = normalizeDocument(documentSource);
    const stamp = nextStamp(actor, document);
    const row = { ...(document.collections[collection][rowKey] || {}) };
    Object.keys(patch).sort().forEach(field => {
      canonicalKey(field, 'field key');
      row[field] = { value: cloneJson(patch[field]), stamp: cloneJson(stamp) };
    });
    document.collections[collection][rowKey] = row;
    document.meta.maxCounter = Math.max(document.meta.maxCounter, stamp.counter);
    return normalizeDocument(document);
  }

  function deleteFields(documentSource, actor, collection, key, fields) {
    if (!COLLECTIONS.includes(collection)) throw new SyncValidationError('unknown collection');
    if (!Array.isArray(fields) || !fields.length) throw new SyncValidationError('fields to delete required');
    const rowKey = canonicalKey(key, 'row key');
    const document = normalizeDocument(documentSource);
    const stamp = nextStamp(actor, document);
    const row = { ...(document.collections[collection][rowKey] || {}) };
    fields.forEach(field => {
      const fieldKey = canonicalKey(field, 'field key');
      row[fieldKey] = { tombstone: true, stamp: cloneJson(stamp) };
    });
    document.collections[collection][rowKey] = row;
    document.meta.maxCounter = Math.max(document.meta.maxCounter, stamp.counter);
    return normalizeDocument(document);
  }

  function normalizeSfaHead(head) {
    if (!isRecord(head)) throw new SyncValidationError('SFA head pointer required');
    const runId = String(head.runId || '').trim();
    const path = String(head.path || '').trim();
    const contentHash = String(head.contentHash || '').trim();
    const rowCount = Number(head.rowCount);
    if (!runId || !/^\/sfaAnalysisRuns\//.test(path) || !/^[a-f0-9]{8,128}$/i.test(contentHash) || !Number.isSafeInteger(rowCount) || rowCount < 0) {
      throw new SyncValidationError('invalid immutable SFA run pointer');
    }
    return { runId, path, contentHash: contentHash.toLowerCase(), rowCount };
  }

  function setSfaHead(documentSource, actor, head) {
    const document = normalizeDocument(documentSource);
    const stamp = nextStamp(actor, document);
    document.sfaHead = { value: normalizeSfaHead(head), tombstone: false, stamp };
    document.meta.maxCounter = Math.max(document.meta.maxCounter, stamp.counter);
    return normalizeDocument(document);
  }

  function normalizeSfaManifest(manifest) {
    if (!isRecord(manifest)) throw new SyncValidationError('SFA manifest required');
    const runs = {};
    Object.keys(manifest.runs || {}).sort().forEach(runId => {
      const pointer = normalizeSfaHead(manifest.runs[runId]);
      if (pointer.runId !== runId) throw new SyncValidationError('SFA manifest run key mismatch');
      runs[runId] = pointer;
    });
    return { schemaVersion: 1, runs };
  }

  function mergeSfaRunManifests(leftSource, rightSource) {
    const left = normalizeSfaManifest(leftSource || { runs: {} });
    const right = normalizeSfaManifest(rightSource || { runs: {} });
    const runs = {};
    const conflicts = [];
    new Set([...Object.keys(left.runs), ...Object.keys(right.runs)]).forEach(runId => {
      const a = left.runs[runId];
      const b = right.runs[runId];
      if (!a) runs[runId] = b;
      else if (!b) runs[runId] = a;
      else {
        const winner = canonicalJson(a).localeCompare(canonicalJson(b)) >= 0 ? a : b;
        runs[runId] = winner;
        if (canonicalJson(a) !== canonicalJson(b)) conflicts.push({ runId, status: 'immutable_run_conflict', candidates: [a, b].sort((x, y) => canonicalJson(x).localeCompare(canonicalJson(y))), winner });
      }
    });
    return { manifest: normalizeSfaManifest({ runs }), conflicts: conflicts.sort((a, b) => a.runId.localeCompare(b.runId)) };
  }

  function canonicalByteSize(document) {
    const text = JSON.stringify(normalizeDocument(document));
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : unescape(encodeURIComponent(text)).length;
  }

  function assertCanonicalSizeBudget(document, maxBytes = MAX_CANONICAL_BYTES) {
    const bytes = canonicalByteSize(document);
    if (bytes > maxBytes) throw new SyncValidationError('canonical state exceeds size budget: ' + bytes + ' > ' + maxBytes);
    return bytes;
  }

  function createReset(documentSource, actor) {
    const previous = normalizeDocument(documentSource);
    actor.epoch = Math.max(Number(actor.epoch || 0), previous.reset.epoch) + 1;
    actor.counter = Math.max(Number(actor.counter || 0), previous.meta.maxCounter) + 1;
    const document = emptyDocument(actor.epoch);
    document.reset = { epoch: actor.epoch, stamp: { epoch: actor.epoch, counter: actor.counter, actorId: actor.actorId } };
    document.meta.maxCounter = actor.counter;
    return normalizeDocument(document);
  }

  function emptyOutbox(actorId) {
    return { schemaVersion: SCHEMA_VERSION, actorId: normalizeActorId(actorId), active: null, queued: null, lastCanonicalReceipt: null, projectionRepair: null };
  }

  function validateIntent(intent) {
    if (!isRecord(intent) || !String(intent.intentId || '').trim()) throw new SyncCorruptionError('invalid outbox intent');
    return {
      intentId: String(intent.intentId),
      actorId: normalizeActorId(intent.actorId),
      createdAt: Number(intent.createdAt || 0),
      document: normalizeDocument(intent.document)
    };
  }

  function loadOutbox(storage, actorId, storageKey = DEFAULT_STORAGE_KEYS.outbox) {
    const raw = storage.getItem(storageKey);
    if (raw === null) return emptyOutbox(actorId);
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { throw new SyncCorruptionError('outbox JSON is malformed; sync is halted'); }
    if (!isRecord(parsed) || Number(parsed.schemaVersion) !== SCHEMA_VERSION || normalizeActorId(parsed.actorId) !== normalizeActorId(actorId)) {
      throw new SyncCorruptionError('outbox schema or actor mismatch; sync is halted');
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      actorId: normalizeActorId(actorId),
      active: parsed.active ? validateIntent(parsed.active) : null,
      queued: parsed.queued ? validateIntent(parsed.queued) : null,
      lastCanonicalReceipt: parsed.lastCanonicalReceipt ? cloneJson(parsed.lastCanonicalReceipt) : null,
      projectionRepair: parsed.projectionRepair ? cloneJson(parsed.projectionRepair) : null
    };
  }

  function saveOutbox(storage, outbox, storageKey = DEFAULT_STORAGE_KEYS.outbox) {
    const serialized = JSON.stringify(outbox);
    storage.setItem(storageKey, serialized);
    if (storage.getItem(storageKey) !== serialized) throw new SyncCorruptionError('outbox durable write verification failed');
  }

  function makeIntent(actor, document, options = {}) {
    const normalized = normalizeDocument(document);
    return {
      intentId: String(options.intentId || actor.actorId + '-' + actor.epoch + '-' + normalized.meta.maxCounter + '-' + stableHash(normalized)),
      actorId: normalizeActorId(actor.actorId),
      createdAt: Number(options.createdAt || Date.now()),
      document: normalized
    };
  }

  function enqueueIntent(outboxSource, intentSource) {
    const outbox = cloneJson(outboxSource);
    const intent = validateIntent(intentSource);
    if (!outbox.active) outbox.active = intent;
    else if (!outbox.queued) outbox.queued = intent;
    else {
      outbox.queued = {
        ...intent,
        document: mergeDocuments(outbox.queued.document, intent.document).document
      };
    }
    return outbox;
  }

  async function flushOutboxUnlocked(options) {
    const { storage, adapter, actorId } = options || {};
    const storageKey = options?.storageKey || DEFAULT_STORAGE_KEYS.outbox;
    const maxCasRetries = Math.max(0, Math.min(8, Number(options?.maxCasRetries ?? 3)));
    if (!adapter || typeof adapter.getCanonical !== 'function' || typeof adapter.putCanonical !== 'function') {
      throw new SyncValidationError('canonical adapter required');
    }
    let outbox = loadOutbox(storage, actorId, storageKey);
    const intent = outbox.active;
    if (!intent) return { status: 'idle', outbox };
    let response;
    let merged;
    let conflicts = [];
    let attempts = 0;
    for (let retry = 0; retry <= maxCasRetries; retry += 1) {
      attempts += 1;
      const read = await adapter.getCanonical(CANONICAL_NODE);
      if (!read || Number(read.status) < 200 || Number(read.status) >= 300 || !read.etag) throw new Error('canonical read failed');
      const result = mergeDocuments(read.body || emptyDocument(), intent.document);
      merged = result.document;
      conflicts = result.conflicts;
      assertCanonicalSizeBudget(merged);
      response = await adapter.putCanonical(CANONICAL_NODE, merged, read.etag);
      if (Number(response?.status) !== 412) break;
    }
    if (Number(response?.status) === 412) return { status: 'cas_retry_exhausted', attempts, outbox };
    if (!response || Number(response.status) < 200 || Number(response.status) >= 300) throw new Error('canonical write failed');

    const receipt = {
      status: 'canonical_committed',
      intentId: intent.intentId,
      canonicalNode: CANONICAL_NODE,
      etag: response.etag || null,
      canonicalFingerprint: stableHash(merged),
      attempts,
      conflicts
    };
    // Anything could have enqueued while GET/PUT was awaiting. Never write the
    // pre-await snapshot back over that newer durable state.
    const currentOutbox = loadOutbox(storage, actorId, storageKey);
    if (!currentOutbox.active || currentOutbox.active.intentId !== intent.intentId) {
      throw new SyncCorruptionError('outbox active intent changed during canonical commit; local queue left untouched');
    }
    currentOutbox.active = currentOutbox.queued;
    currentOutbox.queued = null;
    currentOutbox.lastCanonicalReceipt = receipt;
    currentOutbox.projectionRepair = { receipt, document: merged, reason: 'explicit_checkpoint_required' };
    saveOutbox(storage, currentOutbox, storageKey);
    return { status: 'canonical_committed', receipt, projection: { status: 'deferred_repair' }, document: merged, outbox: currentOutbox };
  }

  async function flushOutbox(options) {
    const storage = options?.storage;
    const actorId = normalizeActorId(options?.actorId);
    if (!storage || (typeof storage !== 'object' && typeof storage !== 'function')) {
      throw new SyncValidationError('storage adapter required');
    }
    let actors = activeFlushActors.get(storage);
    if (!actors) {
      actors = new Set();
      activeFlushActors.set(storage, actors);
    }
    if (actors.has(actorId)) return { status: 'busy' };
    actors.add(actorId);
    try {
      return await flushOutboxUnlocked({ ...options, actorId });
    } finally {
      actors.delete(actorId);
      if (actors.size === 0) activeFlushActors.delete(storage);
    }
  }

  async function repairLegacyProjection(options) {
    const { storage, actorId, projector } = options || {};
    const storageKey = options?.storageKey || DEFAULT_STORAGE_KEYS.outbox;
    if (typeof projector !== 'function') throw new SyncValidationError('legacy projector required');
    const outbox = loadOutbox(storage, actorId, storageKey);
    const repair = outbox.projectionRepair;
    if (!repair) return { status: 'idle', outbox };
    try {
      await projector(repair.document, repair.receipt);
      outbox.projectionRepair = null;
      saveOutbox(storage, outbox, storageKey);
      return { status: 'projected', receipt: repair.receipt, outbox };
    } catch (error) {
      outbox.projectionRepair = { ...repair, error: String(error?.message || error) };
      saveOutbox(storage, outbox, storageKey);
      return { status: 'repair_required', receipt: repair.receipt, error: outbox.projectionRepair.error, outbox };
    }
  }

  function legacyItemKeyForName(name) {
    return 'item_' + encodeURIComponent(String(name || '').trim());
  }

  function legacyItemKeyByName(source) {
    const index = new Map();
    Object.entries(source.inventoryByItemKey || {}).forEach(([key, value]) => {
      const name = String(value?.name || '').trim();
      if (name) index.set(name, String(value?.itemKey || key));
    });
    (Array.isArray(source.entries) ? source.entries : Object.values(source.entries || {})).forEach(entry => {
      const name = String(entry?.name || '').trim();
      const itemKey = String(entry?.itemKey || '').trim();
      if (name && itemKey) index.set(name, itemKey);
    });
    return index;
  }

  function compactAliasDrafts(source) {
    const rows = Array.isArray(source) ? source : Object.values(source || {});
    return rows.filter(row => ['confirmed', 'manual', 'unlinked'].includes(String(row?.status || ''))).map(row => {
      const output = {};
      [
        'aliasName', 'aliasUnit', 'actualName', 'actualUnit', 'savedActualName',
        'savedActualUnit', 'status', 'conversionStatus', 'conversionFactor',
        'orderUnitToStockFactor', 'factorMeaning', 'rejectedCandidate'
      ].forEach(key => {
        if (Object.prototype.hasOwnProperty.call(row || {}, key)) output[key] = cloneJson(row[key]);
      });
      return output;
    });
  }

  function mappingEntities(namespace, source) {
    const pairs = Array.isArray(source)
      ? source.map((value, index) => {
          const identity = isRecord(value)
            ? [value.aliasName, value.aliasUnit].map(part => String(part || '').trim()).filter(Boolean).join('|')
            : '';
          return [identity || ('legacy-' + index), value];
        })
      : Object.entries(isRecord(source) ? source : {});
    const seen = new Map();
    return pairs.map(([rawKey, value]) => {
      const sourceKey = String(rawKey);
      const rowKey = 'map-' + namespace + '-' + base64UrlEncode(sourceKey);
      if (seen.has(rowKey) && seen.get(rowKey) !== sourceKey) {
        throw new SyncValidationError('mapping key encoding collision');
      }
      if (seen.has(rowKey)) throw new SyncValidationError('duplicate mapping identity');
      seen.set(rowKey, sourceKey);
      // Namespace and source identity are reversibly encoded in the Firebase-
      // safe row key. Repeating either as another stamped register would break
      // the live 128 KiB gate.
      const fields = {};
      if (isRecord(value)) {
        Object.keys(value).sort().forEach(field => {
          const fieldKey = canonicalKey(field, 'mapping field key');
          if (fieldKey === 'mappingNamespace' || fieldKey === 'sourceKey') {
            throw new SyncValidationError('reserved mapping field key');
          }
          fields[fieldKey] = value[field];
        });
      } else {
        fields.value = value;
      }
      return { rowKey, fields };
    });
  }

  function mappingIdentityFromRowKey(rowKey) {
    const key = canonicalKey(rowKey, 'mapping row key');
    const namespaces = ['unitCorrections', 'aliasDrafts', 'alias', 'site'];
    const namespace = namespaces.find(candidate => key.startsWith('map-' + candidate + '-'));
    if (!namespace) throw new SyncValidationError('unknown mapping row namespace');
    const encoded = key.slice(('map-' + namespace + '-').length);
    return Object.freeze({ namespace, sourceKey: base64UrlDecode(encoded) });
  }

  function legacyBuckets(payload) {
    const source = isRecord(payload) ? payload : {};
    const itemKeyByName = legacyItemKeyByName(source);
    const mappings = {
      site: source.orderSiteMappings ?? {},
      alias: source.orderAliasMappings ?? {},
      aliasDrafts: compactAliasDrafts(source.orderAliasMappingDrafts),
      unitCorrections: source.orderUnitCorrections ?? {}
    };
    const usage = {};
    const hidden = {};
    Object.entries(source.overrides || {}).forEach(([name, value]) => {
      if (!isRecord(value)) return;
      const itemKey = itemKeyByName.get(name) || legacyItemKeyForName(name);
      const row = {};
      if (Object.prototype.hasOwnProperty.call(value, 'k')) row.buffer = value.k;
      if (Object.prototype.hasOwnProperty.call(value, 'l')) row.dailyUsage = value.l;
      if (Object.keys(row).length) usage[itemKey] = row;
      if (Object.prototype.hasOwnProperty.call(value, 'hideUntil')) hidden[itemKey] = value.hideUntil;
    });
    return {
      inventory: Array.isArray(source.entries) && source.entries.length ? {} : (source.inventoryByItemKey ?? {}),
      entries: source.entries ?? [],
      usage,
      hidden,
      mappings,
      manualItems: source.orderManualItems ?? [],
      settings: {
        orderDays: source.orderDays ?? null,
        zoneOrder: source.zoneOrder ?? [],
        dateKey: source.dateKey ?? null
      },
      acceptedAdvisory: source.aiUsageAccepted ?? null,
      sales: { dailySales: source.dailySales ?? [], baseSales: source.baseSales ?? null }
    };
  }

  function migrateLegacyPayload(payload, actor, options = {}) {
    const fingerprint = stableHash(payload || {});
    const marker = options.marker || null;
    if (marker?.fingerprint === fingerprint) return { status: 'already_migrated', document: normalizeDocument(options.document || emptyDocument()), marker };
    let document = normalizeDocument(options.document || emptyDocument());
    // Every v1 revision is outside the Lamport domain. A fresh epoch isolates both
    // ordinary wall-clock revisions and the observed 2058-scale corrupted value.
    document = createReset(document, actor);
    const buckets = legacyBuckets(payload);
    Object.keys(buckets.inventory).sort().forEach(key => {
      const value = buckets.inventory[key];
      document = writeFields(document, actor, 'inventory', key, isRecord(value) && Object.keys(value).length ? value : { value });
    });
    const usedEntryKeys = new Set();
    (Array.isArray(buckets.entries) ? buckets.entries : Object.values(buckets.entries || {})).forEach((entry, index) => {
      const baseKey = String(entry?.entryKey || entry?.id || entry?.key || ('legacy-' + index));
      let key = baseKey || ('legacy-' + index);
      while (usedEntryKeys.has(key)) key = baseKey + '-' + index;
      usedEntryKeys.add(key);
      const fields = isRecord(entry) && Object.keys(entry).length ? {
        itemKey: String(entry.itemKey || legacyItemKeyForName(entry.name || key)),
        zone: String(entry.zone || '')
      } : { value: entry };
      if (isRecord(entry) && Object.prototype.hasOwnProperty.call(entry, 'stock') && entry.stock !== null && entry.stock !== '') {
        fields.stock = entry.stock;
      }
      document = writeFields(document, actor, 'entries', key, fields);
    });
    Object.keys(buckets.usage).sort().forEach(itemKey => {
      document = writeFields(document, actor, 'usage', itemKey, buckets.usage[itemKey]);
    });
    Object.keys(buckets.mappings).sort().forEach(namespace => {
      mappingEntities(namespace, buckets.mappings[namespace]).forEach(({ rowKey, fields }) => {
        document = writeFields(document, actor, 'mappings', rowKey, fields);
      });
    });
    if (buckets.manualItems.length) {
      buckets.manualItems.forEach((item, index) => {
        const key = String(item?.itemKey || item?.key || item?.name || ('manual-' + index));
        document = writeFields(document, actor, 'manualItems', key, isRecord(item) ? item : { value: item });
      });
    }
    if (buckets.acceptedAdvisory !== null && buckets.acceptedAdvisory !== undefined) {
      document = writeFields(document, actor, 'acceptedAdvisory', 'latest', { value: buckets.acceptedAdvisory });
    }
    if (buckets.settings.orderDays !== null && buckets.settings.orderDays !== undefined) {
      document = writeFields(document, actor, 'settings', 'order', { days: buckets.settings.orderDays });
    }
    document = writeFields(document, actor, 'zones', 'order', { value: buckets.settings.zoneOrder });
    document = writeFields(document, actor, 'settings', 'migration', {
      dateKey: buckets.settings.dateKey,
      source: 'legacy_v1'
    });
    Object.keys(buckets.hidden).sort().forEach(itemKey => {
      const raw = buckets.hidden[itemKey];
      const parsed = typeof raw === 'string' ? Date.parse(raw + (raw.length <= 10 ? 'T23:59:59+09:00' : '')) : Number(raw);
      document = writeFields(document, actor, 'settings', 'item:' + itemKey, {
        hiddenUntil: Number.isFinite(parsed) && parsed > 0 ? parsed : false
      });
    });
    if (buckets.sales.baseSales !== null && buckets.sales.baseSales !== undefined) {
      document = writeFields(document, actor, 'sales', 'base', { amount: buckets.sales.baseSales });
    }
    (Array.isArray(buckets.sales.dailySales) ? buckets.sales.dailySales : Object.values(buckets.sales.dailySales || {})).slice(0, 31).forEach((value, index) => {
      document = writeFields(document, actor, 'sales', 'day-' + (index + 1), { amount: value });
    });
    if (options.sfaHead) document = setSfaHead(document, actor, options.sfaHead);
    assertCanonicalSizeBudget(document);
    return {
      status: 'migrated',
      document,
      marker: {
        fingerprint,
        schemaVersion: SCHEMA_VERSION,
        epoch: document.reset.epoch,
        sourceEtag: options.sourceEtag || null,
        localSnapshotHash: options.localSnapshotHash || null,
        importedDomains: COLLECTIONS.filter(collection => Object.keys(document.collections[collection]).length > 0),
        ignoredLargeFields: ['sfaOrderLedger', 'sfaAnalysisHistory', 'sourceTable']
      }
    };
  }

  function sfaOrderTuple(row) {
    const sfaSeq = Number(row.masterSfaSeq ?? row.sfaSeq);
    if (Number.isFinite(sfaSeq)) {
      return [0, sfaSeq, String(row.canonicalName || row.name || ''), String(row.entryKey || row.itemKey || '')];
    }
    if (row.sourceOnly === true) {
      return [1, Number(row.sourceRowIndex ?? row.rowIndex ?? row.row_index ?? Number.MAX_SAFE_INTEGER), String(row.eventId || '')];
    }
    const canonicalSeq = Number(row.canonicalSeq);
    return [2, Number.isFinite(canonicalSeq) ? canonicalSeq : Number.MAX_SAFE_INTEGER, String(row.canonicalName || row.name || ''), String(row.entryKey || row.itemKey || '')];
  }

  function compareTuple(left, right) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const a = left[index];
      const b = right[index];
      if (typeof a === 'number' && typeof b === 'number' && a !== b) return a < b ? -1 : 1;
      const order = String(a ?? '').localeCompare(String(b ?? ''), 'ko', { numeric: true });
      if (order) return order;
    }
    return 0;
  }

  function sfaFirstOrder(rows) {
    return [...rows].sort((left, right) => compareTuple(sfaOrderTuple(left), sfaOrderTuple(right)));
  }

  return Object.freeze({
    SCHEMA_VERSION,
    CONSTITUTION_SHA256,
    CANONICAL_NODE,
    MAX_CANONICAL_BYTES,
    DEFAULT_STORAGE_KEYS,
    SyncValidationError,
    SyncCorruptionError,
    canonicalJson,
    stableHash,
    emptyDocument,
    normalizeDocument,
    mergeDocuments,
    createActor,
    persistActor,
    nextStamp,
    writeFields,
    deleteFields,
    setSfaHead,
    normalizeSfaManifest,
    mergeSfaRunManifests,
    canonicalByteSize,
    assertCanonicalSizeBudget,
    createReset,
    emptyOutbox,
    loadOutbox,
    saveOutbox,
    makeIntent,
    enqueueIntent,
    flushOutbox,
    repairLegacyProjection,
    migrateLegacyPayload,
    mappingIdentityFromRowKey,
    sfaFirstOrder
  });
}));
