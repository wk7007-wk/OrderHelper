(function (root, factory) {
  const syncApi = root?.OrderHelperSyncV2 || (typeof require === 'function' ? require('../sync/order-sync-v2.js') : null);
  const storageApi = root?.OrderHelperStorageV2 || (typeof require === 'function' ? require('./order-storage-v2.js') : null);
  const modelApi = root?.OrderHelperV2 || (typeof require === 'function' ? require('./orderhelper-v2.js') : null);
  const cutoverApi = root?.OrderHelperCutoverV2 || (typeof require === 'function' ? require('./order-cutover-v2.js') : null);
  const api = factory(syncApi, storageApi, modelApi, cutoverApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrderHelperSyncControllerV2 = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Sync, StorageV2, ModelV2, CutoverV2) {
  'use strict';

  if (!Sync || !StorageV2 || !ModelV2) throw new Error('OrderHelper v2 sync, storage, and model dependencies are required');

  const CONFIRM_REASONS = new Set(['enter', 'change']);
  const MAX_SEQUENTIAL_FLUSHES = 8;
  const controllerByDocument = new WeakMap();

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createController(options = {}) {
    const storage = options.storage;
    let remoteAdapter = options.remoteAdapter ? validateRemoteAdapter(options.remoteAdapter) : null;
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
    let syncPromise = null;
    let autoFlushScheduled = false;
    let resyncRequested = false;
    let dirtyPaths = new Set((draft.dirtyPaths || []).map(path => JSON.stringify(path)));
    let pullRefreshPending = draft.pullRefreshPending === true;

    function fieldPath(collection, key, field) {
      return JSON.stringify([collection, String(key), String(field)]);
    }

    function markDirtyFields(collection, key, fields) {
      Object.keys(fields).forEach(field => dirtyPaths.add(fieldPath(collection, key, field)));
    }

    function persistDraft() {
      draft.dirtyPaths = Array.from(dirtyPaths).sort().map(encoded => JSON.parse(encoded));
      draft.pullRefreshPending = pullRefreshPending;
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
      markDirtyFields(collection, key, fields);
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
      markDirtyFields(collection, key, { [field]: true });
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
      dirtyPaths = new Set();
      persistDraft();
      lastStatus = 'confirmed_pending';
      scheduleAutoFlush();
      return { status: 'enqueued', reason, intentId: intent.intentId };
    }

    function validateRemoteAdapter(adapter) {
      if (!adapter || typeof adapter.getCanonical !== 'function' || typeof adapter.putCanonical !== 'function') {
        throw new TypeError('remote adapter requires canonical GET and PUT');
      }
      return adapter;
    }

    function authorizeOfficialRemoteAdapter(adapter) {
      if (adapter?.officialCanonicalAdapter !== true) return;
      if (!CutoverV2 || typeof CutoverV2.claimWriteOwner !== 'function' || !CutoverV2.claimWriteOwner('v2')) {
        throw new TypeError('canonical remote bootstrap is blocked until an active cutover route is installed');
      }
    }

    function attachRemoteAdapter(adapter) {
      validateRemoteAdapter(adapter);
      if (remoteAdapter === adapter) return { status: 'already_attached' };
      if (remoteAdapter) throw new TypeError('remote adapter replacement is denied');
      authorizeOfficialRemoteAdapter(adapter);
      remoteAdapter = adapter;
      if (getOutbox().active || pullRefreshPending) scheduleAutoFlush();
      return { status: 'attached' };
    }

    // Initial injection is also a remote-enable path.  Keep the check here,
    // after the helper declarations, so it cannot bypass attachRemoteAdapter.
    if (remoteAdapter) authorizeOfficialRemoteAdapter(remoteAdapter);

    function scheduleAutoFlush() {
      if (!remoteAdapter) return;
      if (syncPromise) {
        resyncRequested = true;
        return;
      }
      if (autoFlushScheduled) return;
      autoFlushScheduled = true;
      queueMicrotask(() => {
        autoFlushScheduled = false;
        syncNow().catch(() => {});
      });
    }

    function visibleDocument(document) {
      const collections = {};
      Object.entries(document.collections || {}).forEach(([collection, rows]) => {
        collections[collection] = {};
        Object.entries(rows || {}).forEach(([key, fields]) => {
          collections[collection][key] = {};
          Object.entries(fields || {}).forEach(([field, register]) => {
            collections[collection][key][field] = register.tombstone
              ? { tombstone: true }
              : { tombstone: false, value: register.value };
          });
        });
      });
      return Sync.canonicalJson({ collections, sfaHead: document.sfaHead?.value || null });
    }

    function preserveDirtyFields(mergedDocument, localDocument) {
      if (!draft.dirty) return mergedDocument;
      let output = mergedDocument;
      const paths = Array.from(dirtyPaths);
      paths.forEach(encoded => {
        const [collection, key, field] = JSON.parse(encoded);
        const register = localDocument.collections?.[collection]?.[key]?.[field];
        if (!register) return;
        output = register.tombstone
          ? Sync.deleteFields(output, actor, collection, key, [field])
          : Sync.writeFields(output, actor, collection, key, { [field]: register.value });
      });
      return output;
    }

    async function runSyncNow() {
      conflictCount = 0;
      if (!remoteAdapter) {
        lastStatus = 'remote_unavailable';
        return { status: 'remote_unavailable' };
      }
      remoteAttemptCount += 1;
      let lastCommit = null;
      let currentConflictCount = 0;
      try {
        for (let index = 0; index < MAX_SEQUENTIAL_FLUSHES; index += 1) {
          if (!getOutbox().active) break;
          const result = await Sync.flushOutbox({
            storage,
            actorId: actor.actorId,
            adapter: remoteAdapter,
            maxCasRetries: options.maxCasRetries
          });
          if (result.status !== 'canonical_committed') {
            lastStatus = result.status;
            return result;
          }
          lastCommit = result;
          currentConflictCount = Math.max(currentConflictCount, result.receipt.conflicts.length);
          if (typeof options.onReceipt === 'function') options.onReceipt(cloneJson(result.receipt));
        }
        if (getOutbox().active) {
          lastStatus = 'flush_limit_reached';
          return { status: 'flush_limit_reached' };
        }

        const read = await remoteAdapter.getCanonical(Sync.CANONICAL_NODE);
        if (!read || Number(read.status) < 200 || Number(read.status) >= 300) throw new Error('canonical pull failed');
        const before = visibleDocument(draft.document);
        const pulled = Sync.mergeDocuments(draft.document, read.body || Sync.emptyDocument());
        draft.document = preserveDirtyFields(pulled.document, draft.document);
        actor.epoch = Math.max(actor.epoch, draft.document.reset.epoch);
        actor.counter = Math.max(actor.counter, draft.document.meta.maxCounter);
        pullRefreshPending = false;
        persistDraft();
        const changed = before !== visibleDocument(draft.document);
        if (changed && typeof options.onHydrate === 'function') options.onHydrate(cloneJson(draft.document));
        if (pulled.conflicts.length && typeof options.onReceipt === 'function') {
          options.onReceipt({
            status: 'canonical_pulled',
            canonicalFingerprint: Sync.stableHash(draft.document),
            conflicts: cloneJson(pulled.conflicts)
          });
        }
        conflictCount = Math.max(currentConflictCount, pulled.conflicts.length);
        lastStatus = conflictCount ? 'canonical_conflict_resolved' : (lastCommit ? 'canonical_committed' : 'canonical_pulled');
        return lastCommit
          ? { ...lastCommit, document: cloneJson(draft.document) }
          : { status: 'canonical_pulled', document: cloneJson(draft.document), conflicts: cloneJson(pulled.conflicts) };
      } catch (error) {
        if (lastCommit) {
          pullRefreshPending = true;
          persistDraft();
          lastStatus = currentConflictCount ? 'canonical_conflict_resolved_pull_pending' : 'canonical_committed_pull_pending';
          conflictCount = currentConflictCount;
          return {
            ...lastCommit,
            status: 'canonical_committed',
            pull: { status: 'retry_pending', error: String(error?.message || error) }
          };
        }
        lastStatus = 'retry_pending';
        return { status: 'retry_pending', error: String(error?.message || error) };
      }
    }

    function syncNow() {
      if (syncPromise) return syncPromise;
      syncPromise = runSyncNow().finally(() => {
        syncPromise = null;
        if (resyncRequested) {
          resyncRequested = false;
          scheduleAutoFlush();
        }
      });
      return syncPromise;
    }

    function flush() {
      return syncNow();
    }

    function getStatus() {
      return { lastStatus, conflictCount, remoteAttemptCount, pullRefreshPending };
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
      syncNow,
      attachRemoteAdapter,
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

    if (remoteAdapter && (getOutbox().active || pullRefreshPending)) scheduleAutoFlush();

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
    if (controllerByDocument.has(documentRef)) return controllerByDocument.get(documentRef);
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

    function hydrateRuntime(document) {
      const active = documentRef.activeElement;
      const identity = active?.dataset ? {
        entryKey: active.dataset.entryKey || '',
        field: active.dataset.field || '',
        itemKey: active.closest?.('[data-item-key]')?.dataset.itemKey || '',
        start: active.selectionStart,
        end: active.selectionEnd
      } : null;
      runtime.hydrateCanonicalDocument(document);
      if (!identity?.field || typeof documentRef.querySelectorAll !== 'function') return;
      const replacement = Array.from(documentRef.querySelectorAll('input[data-field]')).find(input =>
        input.dataset.field === identity.field &&
        (identity.entryKey ? input.dataset.entryKey === identity.entryKey : input.closest?.('[data-item-key]')?.dataset.itemKey === identity.itemKey));
      if (!replacement) return;
      replacement.focus?.({ preventScroll: true });
      if (Number.isInteger(identity.start) && typeof replacement.setSelectionRange === 'function') {
        const length = String(replacement.value || '').length;
        replacement.setSelectionRange(Math.min(identity.start, length), Math.min(identity.end, length));
      }
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
        onReceipt: showReceipt,
        onHydrate: hydrateRuntime
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
    controllerByDocument.set(documentRef, controller);
    return controller;
  }

  function requireDomController(documentRef) {
    const controller = controllerByDocument.get(documentRef);
    if (!controller) throw new Error('OrderHelper v2 DOM controller is not bound');
    return controller;
  }

  if (typeof document !== 'undefined') {
    const bootstrap = () => bindDom(document);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
    else bootstrap();
  }

  return Object.freeze({ CONFIRM_REASONS, MAX_SEQUENTIAL_FLUSHES, createController, bindDom, requireDomController });
}));
