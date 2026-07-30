(function (root, factory) {
  const syncApi = root?.OrderHelperSyncV2 || (typeof require === 'function' ? require('../sync/order-sync-v2.js') : null);
  const storageApi = root?.OrderHelperStorageV2 || (typeof require === 'function' ? require('./order-storage-v2.js') : null);
  const modelApi = root?.OrderHelperV2 || (typeof require === 'function' ? require('./orderhelper-v2.js') : null);
  const api = factory(syncApi, storageApi, modelApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrderHelperSyncControllerV2 = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Sync, StorageV2, ModelV2) {
  'use strict';

  if (!Sync || !StorageV2 || !ModelV2) throw new Error('OrderHelper v2 sync, storage, and model dependencies are required');

  const CONFIRM_REASONS = new Set(['enter', 'change']);

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createController(options = {}) {
    const storage = options.storage;
    const remoteAdapter = options.remoteAdapter || null;
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const actor = Sync.createActor(storage, options.actorId ? { actorId: options.actorId } : {});
    let draft = StorageV2.loadDraft(storage, actor.actorId, Sync.emptyDocument(actor.epoch));
    draft.document = Sync.normalizeDocument(draft.document);
    actor.epoch = Math.max(actor.epoch, draft.document.reset.epoch);
    actor.counter = Math.max(actor.counter, draft.document.meta.maxCounter);
    Sync.persistActor(storage, actor);
    // Loading the outbox is an intentional fail-closed startup validation.
    Sync.loadOutbox(storage, actor.actorId);

    let lastStatus = 'ready';
    let conflictCount = 0;
    let remoteAttemptCount = 0;

    function persistDraft() {
      draft = StorageV2.saveDraft(storage, draft);
      Sync.persistActor(storage, actor);
    }

    function getOutbox() {
      return Sync.loadOutbox(storage, actor.actorId);
    }

    function updateDraftFields(collection, key, fields, metadata = {}) {
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length === 0) {
        throw new TypeError('draft field patch must be a non-empty object');
      }
      // metadata.composing is deliberately informational. Composition and normal
      // input take the same local-only path and never call flush().
      draft.document = Sync.writeFields(draft.document, actor, collection, key, fields);
      draft.dirty = true;
      draft.mutationCount += 1;
      draft.updatedAt = Number(now());
      persistDraft();
      lastStatus = metadata.composing ? 'draft_composing' : 'draft_dirty';
      return cloneJson(draft);
    }

    function updateDraftField(collection, key, field, value, metadata = {}) {
      return updateDraftFields(collection, key, { [field]: value }, metadata);
    }

    function deleteDraftField(collection, key, field) {
      draft.document = Sync.deleteFields(draft.document, actor, collection, key, [field]);
      draft.dirty = true;
      draft.mutationCount += 1;
      draft.updatedAt = Number(now());
      persistDraft();
      lastStatus = 'draft_dirty';
      return cloneJson(draft);
    }

    function confirm(reason) {
      if (!CONFIRM_REASONS.has(reason)) throw new TypeError('confirmed intent requires Enter or change');
      if (!draft.dirty) return { status: 'no_change', reason };
      const intent = Sync.makeIntent(actor, draft.document, { createdAt: Number(now()) });
      const outbox = Sync.enqueueIntent(getOutbox(), intent);
      Sync.saveOutbox(storage, outbox);
      draft.dirty = false;
      draft.lastConfirmedFingerprint = Sync.stableHash(intent.document);
      draft.updatedAt = Number(now());
      persistDraft();
      lastStatus = 'confirmed_pending';
      return { status: 'enqueued', reason, intentId: intent.intentId };
    }

    async function flush() {
      if (!remoteAdapter) {
        lastStatus = 'remote_unavailable';
        return { status: 'remote_unavailable' };
      }
      remoteAttemptCount += 1;
      try {
        const result = await Sync.flushOutbox({
          storage,
          actorId: actor.actorId,
          adapter: remoteAdapter,
          maxCasRetries: options.maxCasRetries
        });
        if (result.status === 'canonical_committed') {
          draft.document = Sync.mergeDocuments(draft.document, result.document).document;
          conflictCount = result.receipt.conflicts.length;
          lastStatus = conflictCount ? 'canonical_conflict_resolved' : 'canonical_committed';
          persistDraft();
          if (typeof options.onReceipt === 'function') options.onReceipt(cloneJson(result.receipt));
        } else {
          lastStatus = result.status;
        }
        return result;
      } catch (error) {
        lastStatus = 'retry_pending';
        return { status: 'retry_pending', error: String(error?.message || error) };
      }
    }

    function getStatus() {
      return { lastStatus, conflictCount, remoteAttemptCount };
    }

    function probeSnapshot() {
      const outbox = getOutbox();
      return {
        activeIntentCount: outbox.active ? 1 : 0,
        conflictCount,
        draftDirty: draft.dirty,
        lastStatus,
        queuedIntentCount: outbox.queued ? 1 : 0,
        remoteAttemptCount
      };
    }

    const controller = Object.freeze({
      updateDraftField,
      updateDraftFields,
      deleteDraftField,
      confirm,
      flush,
      getDraft: () => cloneJson(draft),
      getOutbox: () => cloneJson(getOutbox()),
      getStatus: () => ({ ...getStatus() }),
      getActor: () => ({ ...actor })
    });

    if (options.testProbeTarget && typeof options.testProbeTarget === 'object') {
      if (options.testProbeTarget.document || options.testProbeTarget.window === options.testProbeTarget) {
        throw new TypeError('browser window test probes are forbidden');
      }
      Object.defineProperty(options.testProbeTarget, '__ORDERHELPER_V2_TEST__', {
        configurable: true,
        enumerable: false,
        value: Object.freeze({ snapshot: probeSnapshot })
      });
    }

    return controller;
  }

  function rootStorage() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
  }

  function preflightStoredRuntime(storage) {
    const actorRaw = storage.getItem(Sync.DEFAULT_STORAGE_KEYS.actor);
    const draftRaw = storage.getItem(StorageV2.DRAFT_KEY);
    const outboxRaw = storage.getItem(Sync.DEFAULT_STORAGE_KEYS.outbox);
    if (actorRaw === null) {
      if (draftRaw !== null || outboxRaw !== null) throw new StorageV2.StorageCorruptionError('orphaned v2 state');
      return { draftDocument: null };
    }
    // Existing-state validation is deliberately read-only so malformed raw bytes
    // survive intact and no actor metadata is written before the bootstrap gate.
    const actor = Sync.createActor(storage);
    let draftDocument = null;
    if (draftRaw !== null) {
      const draft = StorageV2.loadDraft(storage, actor.actorId, Sync.emptyDocument(actor.epoch));
      draftDocument = Sync.normalizeDocument(draft.document);
    }
    if (outboxRaw !== null) Sync.loadOutbox(storage, actor.actorId);
    return { draftDocument };
  }

  function bindDom(documentRef, options = {}) {
    if (!documentRef || typeof documentRef.querySelector !== 'function') return null;
    const app = documentRef.querySelector('[data-orderhelper-v2]');
    const storage = options.storage || rootStorage();
    if (!app || !storage) return null;

    function setStatus(text) {
      const output = documentRef.querySelector('#syncStatus');
      if (output) output.textContent = text;
    }

    function failClosed(statusText = '내부 계약 오류 · 입력 및 저장 중지') {
      app.dataset.runtimeState = 'blocked';
      const controls = typeof app.querySelectorAll === 'function' ? app.querySelectorAll('input, select, button') : [];
      for (const control of controls) {
        control.disabled = true;
        control.setAttribute('aria-disabled', 'true');
      }
      setStatus(statusText);
      return null;
    }

    if (!ModelV2.RUNTIME_CONTRACT || typeof ModelV2.requireDomRuntime !== 'function') return failClosed();
    let runtime;
    try {
      runtime = ModelV2.requireDomRuntime(documentRef);
      if (runtime.contractVersion !== ModelV2.RUNTIME_CONTRACT.version) return failClosed();
    } catch (_) {
      return failClosed();
    }

    function showReceipt(receipt) {
      const output = documentRef.querySelector('#canonicalReceipt');
      if (!output) return;
      const conflicts = Array.isArray(receipt?.conflicts) ? receipt.conflicts.length : 0;
      output.textContent = conflicts
        ? '충돌 ' + conflicts + '건 결정론 병합 · ' + String(receipt.canonicalFingerprint || '')
        : '저장됨 · ' + String(receipt?.canonicalFingerprint || '');
    }

    let controller;
    let unsubscribe = () => {};
    try {
      const preflight = preflightStoredRuntime(storage);
      if (preflight.draftDocument) runtime.hydrateCanonicalDocument(preflight.draftDocument);
      controller = createController({
        storage,
        remoteAdapter: options.remoteAdapter || null,
        actorId: options.actorId,
        now: options.now,
        testProbeTarget: options.testProbeTarget,
        onReceipt: showReceipt
      });
      if (!preflight.draftDocument) runtime.hydrateCanonicalDocument(controller.getDraft().document);
      unsubscribe = runtime.subscribe(event => {
        try {
          if (event.type === ModelV2.RUNTIME_CONTRACT.events.DRAFT) {
            controller.updateDraftFields(event.collection, event.key, event.fields, {
              source: 'input', composing: Boolean(event.composing)
            });
            setStatus(event.composing ? '입력 조합 중 · 로컬만 저장' : '로컬 입력됨 · 완료 시 저장');
            return;
          }
          if (event.type === ModelV2.RUNTIME_CONTRACT.events.CONFIRM) {
            const result = controller.confirm(event.reason);
            if (result.status === 'enqueued') setStatus('확정 저장 대기 · 연결 시 동기화');
            return;
          }
          throw new TypeError('unknown runtime event');
        } catch (_) {
          unsubscribe();
          failClosed();
        }
      });
    } catch (_) {
      unsubscribe();
      return failClosed('로컬 저장 데이터 오류 · 입력 및 저장 중지');
    }

    app.dataset.runtimeState = 'bound-local';
    setStatus(controller.getDraft().dirty ? '로컬 입력 복구됨 · Enter 저장' : '로컬 준비됨');
    return controller;
  }

  if (typeof document !== 'undefined') {
    const bootstrap = () => bindDom(document);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
    else bootstrap();
  }

  return Object.freeze({ CONFIRM_REASONS, createController, bindDom });
}));
