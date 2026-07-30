'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Sync = require('../sync/order-sync-v2.js');
const StorageV2 = require('../v2/order-storage-v2.js');
const ControllerV2 = require('../v2/order-sync-controller-v2.js');

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  const writes = [];
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); writes.push({ key, value: String(value) }); },
    removeItem(key) { values.delete(key); },
    keys() { return [...values.keys()]; },
    writes
  };
}

function fakeRemote(initial = Sync.emptyDocument()) {
  let document = initial;
  let etagNumber = 1;
  let offline = false;
  const calls = [];
  return {
    calls,
    setOffline(value) { offline = Boolean(value); },
    get document() { return document; },
    async getCanonical(path) {
      calls.push({ method: 'GET', path });
      if (offline) throw new Error('offline');
      return { status: 200, etag: 'etag-' + etagNumber, body: document };
    },
    async putCanonical(path, body, etag) {
      calls.push({ method: 'PUT', path, etag });
      if (offline) throw new Error('offline');
      if (etag !== 'etag-' + etagNumber) return { status: 412 };
      document = body;
      etagNumber += 1;
      return { status: 200, etag: 'etag-' + etagNumber };
    }
  };
}

function valueAt(document, collection, key, field) {
  return document.collections[collection][key][field].value;
}

async function testDraftTypingIsLocalOnlyAndReloadsExactly() {
  const storage = memoryStorage();
  const remote = fakeRemote();
  const controller = ControllerV2.createController({ storage, remoteAdapter: remote, actorId: 'phone.actor', now: () => 1000 });
  controller.updateDraftField('entries', 'entry_chicken_0', 'stock', '1.5', { source: 'input', composing: true });
  controller.updateDraftField('entries', 'entry_chicken_0', 'stock', '12.5', { source: 'input', composing: false });
  assert.strictEqual(remote.calls.length, 0, 'typing and IME composition must never access the remote');
  assert.strictEqual(controller.getOutbox().active, null, 'typing must not create a confirmed intent');

  const restored = ControllerV2.createController({ storage, remoteAdapter: remote, now: () => 1001 });
  assert.strictEqual(valueAt(restored.getDraft().document, 'entries', 'entry_chicken_0', 'stock'), '12.5');
  assert.strictEqual(restored.getDraft().dirty, true);
  assert.deepStrictEqual(storage.keys().filter(key => !key.startsWith('orderhelper_v2_')), [], 'v2 must not write legacy localStorage keys');
}

async function testEnterAndChangeEnqueueExactlyOneImmutableIntent() {
  const storage = memoryStorage();
  const controller = ControllerV2.createController({ storage, remoteAdapter: fakeRemote(), actorId: 'phone.actor', now: (() => { let value = 2000; return () => ++value; })() });
  controller.updateDraftField('entries', 'entry_chicken_0', 'stock', 3);
  const enter = controller.confirm('enter');
  assert.strictEqual(enter.status, 'enqueued');
  assert.ok(controller.getOutbox().active);
  assert.strictEqual(controller.getOutbox().queued, null);
  assert.strictEqual(controller.confirm('change').status, 'no_change', 'Enter followed by change must not duplicate the commit');

  const immutableBody = Sync.canonicalJson(controller.getOutbox().active.document);
  controller.updateDraftField('usage', 'chicken', 'buffer', 2);
  const change = controller.confirm('change');
  assert.strictEqual(change.status, 'enqueued');
  const queued = controller.getOutbox();
  assert.ok(queued.active && queued.queued);
  assert.strictEqual(Sync.canonicalJson(queued.active.document), immutableBody, 'the active confirmed intent must remain immutable');
}

async function testIndependentPhoneAndPcChangesSurviveAndConflictIsReported() {
  const remote = fakeRemote();
  let displayedReceipt = null;
  const phone = ControllerV2.createController({ storage: memoryStorage(), remoteAdapter: remote, actorId: 'phone.actor', now: () => 3000 });
  const pc = ControllerV2.createController({
    storage: memoryStorage(),
    remoteAdapter: remote,
    actorId: 'pc.actor',
    now: () => 3001,
    onReceipt(receipt) { displayedReceipt = receipt; }
  });
  phone.updateDraftField('entries', 'entry_chicken_0', 'stock', 4);
  phone.confirm('enter');
  assert.strictEqual((await phone.flush()).status, 'canonical_committed');
  pc.updateDraftField('mappings', 'chicken', 'actualName', '황금올리브');
  pc.confirm('change');
  assert.strictEqual((await pc.flush()).status, 'canonical_committed');
  assert.strictEqual(valueAt(remote.document, 'entries', 'entry_chicken_0', 'stock'), 4);
  assert.strictEqual(valueAt(remote.document, 'mappings', 'chicken', 'actualName'), '황금올리브');

  phone.updateDraftField('entries', 'entry_chicken_0', 'stock', 7);
  pc.updateDraftField('entries', 'entry_chicken_0', 'stock', 9);
  phone.confirm('enter');
  pc.confirm('enter');
  await phone.flush();
  const conflict = await pc.flush();
  assert.strictEqual(conflict.receipt.conflicts.length, 1);
  assert.strictEqual(conflict.receipt.conflicts[0].path, 'entries/entry_chicken_0/stock');
  assert.strictEqual(pc.getStatus().conflictCount, 1);
  assert.strictEqual(displayedReceipt.conflicts.length, 1, 'receipt presentation callback must receive the visible conflict');
}

async function testOfflineRetryAndOutboxReload() {
  const storage = memoryStorage();
  const remote = fakeRemote();
  const controller = ControllerV2.createController({ storage, remoteAdapter: remote, actorId: 'phone.actor', now: () => 4000 });
  controller.updateDraftField('sales', 'day-1', 'amount', 0);
  controller.confirm('change');
  remote.setOffline(true);
  const failed = await controller.flush();
  assert.strictEqual(failed.status, 'retry_pending');
  assert.ok(controller.getOutbox().active);

  const restored = ControllerV2.createController({ storage, remoteAdapter: remote, now: () => 4001 });
  assert.ok(restored.getOutbox().active, 'exact outbox must survive reload');
  remote.setOffline(false);
  assert.strictEqual((await restored.flush()).status, 'canonical_committed');
  assert.strictEqual(valueAt(remote.document, 'sales', 'day-1', 'amount'), 0);
}

async function testMinimalTestProbeAndNoBuiltInNetwork() {
  const storage = memoryStorage();
  const fakeWindow = {};
  const controller = ControllerV2.createController({ storage, actorId: 'test.actor', now: () => 5000, testProbeTarget: fakeWindow });
  controller.updateDraftField('settings', 'order', 'days', 3);
  assert.ok(fakeWindow.__ORDERHELPER_V2_TEST__);
  const probe = fakeWindow.__ORDERHELPER_V2_TEST__.snapshot();
  assert.deepStrictEqual(Object.keys(probe).sort(), ['activeIntentCount', 'conflictCount', 'draftDirty', 'lastStatus', 'queuedIntentCount', 'remoteAttemptCount']);
  assert.strictEqual(JSON.stringify(probe).includes('order'), false, 'probe must not expose item keys or values');
  assert.strictEqual(await controller.flush().then(result => result.status), 'remote_unavailable');
  const sources = ['order-storage-v2.js', 'order-sync-controller-v2.js']
    .map(file => fs.readFileSync(path.join(__dirname, '..', 'v2', file), 'utf8'))
    .join('\n');
  assert.doesNotMatch(sources, /\bfetch\s*\(|XMLHttpRequest|firebaseio|firebasedatabase|https?:\/\//i);
}

async function testMalformedDraftFailsClosed() {
  const raw = '{malformed';
  const storage = memoryStorage({ [StorageV2.DRAFT_KEY]: raw });
  assert.throws(
    () => ControllerV2.createController({ storage, actorId: 'phone.actor' }),
    StorageV2.StorageCorruptionError
  );
  assert.strictEqual(storage.getItem(StorageV2.DRAFT_KEY), raw, 'corrupt draft evidence must remain untouched');
}

async function testHydrateFieldsPreserveEntriesSalesAndHiddenSemantics() {
  const storage = memoryStorage();
  const itemKey = 'item-hydrate';
  const controller = ControllerV2.createController({ storage, actorId: 'hydrate.actor', now: () => 6000 });
  controller.updateDraftFields('entries', 'extra-zone-entry', {
    itemKey,
    zone: '창고',
    stock: 0.25
  });
  controller.updateDraftField('sales', 'day-1', 'amount', '');
  controller.updateDraftField('sales', 'day-2', 'amount', 0);
  controller.updateDraftField('settings', `item:${itemKey}`, 'hiddenUntil', 999999);

  const restored = ControllerV2.createController({ storage, now: () => 6001 });
  const document = restored.getDraft().document;
  assert.strictEqual(valueAt(document, 'entries', 'extra-zone-entry', 'itemKey'), itemKey);
  assert.strictEqual(valueAt(document, 'entries', 'extra-zone-entry', 'zone'), '창고');
  assert.strictEqual(valueAt(document, 'entries', 'extra-zone-entry', 'stock'), 0.25);
  assert.strictEqual(valueAt(document, 'sales', 'day-1', 'amount'), '', 'blank survives reload distinctly');
  assert.strictEqual(valueAt(document, 'sales', 'day-2', 'amount'), 0, 'explicit zero survives reload distinctly');
  assert.strictEqual(valueAt(document, 'settings', `item:${itemKey}`, 'hiddenUntil'), 999999);

  restored.updateDraftField('settings', `item:${itemKey}`, 'hiddenUntil', false);
  assert.strictEqual(valueAt(restored.getDraft().document, 'settings', `item:${itemKey}`, 'hiddenUntil'), false, 'explicit unhide is canonical false');
  restored.deleteDraftField('settings', `item:${itemKey}`, 'hiddenUntil');
  assert.strictEqual(
    restored.getDraft().document.collections.settings[`item:${itemKey}`].hiddenUntil.tombstone,
    true,
    'field removal remains a tombstone and is not collapsed into false'
  );
}

async function testMissingDomRuntimeFailsClosedWithoutStorageMutation() {
  const storage = memoryStorage();
  const app = { dataset: {} };
  const status = { textContent: '' };
  const fakeDocument = {
    querySelector(selector) {
      if (selector === '[data-orderhelper-v2]') return app;
      if (selector === '#syncStatus') return status;
      return null;
    }
  };
  assert.strictEqual(ControllerV2.bindDom(fakeDocument, { storage }), null);
  assert.strictEqual(app.dataset.runtimeState, 'blocked');
  assert.strictEqual(status.textContent, '내부 계약 오류 · 입력 및 저장 중지');
  assert.strictEqual(storage.writes.length, 0, 'missing private runtime must not start persistence');
}

async function main() {
  const tests = [
    testDraftTypingIsLocalOnlyAndReloadsExactly,
    testEnterAndChangeEnqueueExactlyOneImmutableIntent,
    testIndependentPhoneAndPcChangesSurviveAndConflictIsReported,
    testOfflineRetryAndOutboxReload,
    testMinimalTestProbeAndNoBuiltInNetwork,
    testMalformedDraftFailsClosed,
    testHydrateFieldsPreserveEntriesSalesAndHiddenSemantics,
    testMissingDomRuntimeFailsClosedWithoutStorageMutation
  ];
  for (const test of tests) {
    await test();
    console.log('PASS ' + test.name);
  }
  console.log('PASS OrderHelper v2 storage/controller (' + tests.length + ' tests)');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
