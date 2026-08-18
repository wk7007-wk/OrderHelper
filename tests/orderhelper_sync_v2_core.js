'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Sync = require('../sync/order-sync-v2.js');

async function testConstitutionBaseline() {
  const constitution = fs.readFileSync(path.join(__dirname, '..', 'ORDERHELPER_CONSTITUTION.md'));
  const digest = crypto.createHash('sha256').update(constitution).digest('hex');
  assert.strictEqual(digest, '8cd45de2922894fe2be8b8e7424fe91cc490ec20d2ec9cea0a60164fcf21a575');
  assert.strictEqual(Sync.CONSTITUTION_SHA256, digest);
}

async function testBrowserGlobalAndStableActor() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'sync', 'order-sync-v2.js'), 'utf8');
  const browserContext = { globalThis: {} };
  vm.runInNewContext(source, browserContext);
  assert.strictEqual(browserContext.globalThis.OrderHelperSyncV2.CONSTITUTION_SHA256, Sync.CONSTITUTION_SHA256);

  const storage = memoryStorage();
  const first = Sync.createActor(storage, { actorId: 'stable.phone' });
  first.epoch = 3;
  first.counter = 17;
  Sync.persistActor(storage, first);
  assert.deepStrictEqual(Sync.createActor(storage), first);
}

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    dump() { return Object.fromEntries(values); }
  };
}

function actor(actorId, epoch = 0, counter = 0) {
  return { actorId, epoch, counter };
}

function valueAt(document, collection, key, field) {
  return document.collections[collection][key][field].value;
}

function sameDocument(left, right, message) {
  assert.strictEqual(Sync.canonicalJson(left), Sync.canonicalJson(right), message);
}

async function testIndependentSimultaneousChangesSurvive() {
  const base = Sync.emptyDocument();
  const phone = Sync.writeFields(base, actor('phone.actor'), 'inventory', 'chicken', { stock: 3 });
  const pc = Sync.writeFields(base, actor('pc.actor'), 'inventory', 'sauce', { stock: 8 });
  const merged = Sync.mergeDocuments(phone, pc).document;
  assert.strictEqual(valueAt(merged, 'inventory', 'chicken', 'stock'), 3);
  assert.strictEqual(valueAt(merged, 'inventory', 'sauce', 'stock'), 8);
}

async function testSameFieldConflictIsDeterministicAndVisible() {
  const base = Sync.emptyDocument();
  const phone = Sync.writeFields(base, actor('phone.actor'), 'inventory', 'chicken', { stock: 3 });
  const pc = Sync.writeFields(base, actor('pc.actor'), 'inventory', 'chicken', { stock: 9 });
  const forward = Sync.mergeDocuments(phone, pc);
  const reverse = Sync.mergeDocuments(pc, phone);
  sameDocument(forward.document, reverse.document, 'commutative merge');
  assert.strictEqual(forward.conflicts.length, 1);
  assert.strictEqual(forward.conflicts[0].path, 'inventory/chicken/stock');
  assert.strictEqual(forward.conflicts[0].status, 'resolved_deterministically');
  assert.strictEqual(valueAt(forward.document, 'inventory', 'chicken', 'stock'), 3, 'actor-id tie-break is stable, not device priority');

  const third = Sync.writeFields(base, actor('tablet.actor'), 'settings', 'ui', { compact: true });
  sameDocument(
    Sync.mergeDocuments(Sync.mergeDocuments(phone, pc).document, third).document,
    Sync.mergeDocuments(phone, Sync.mergeDocuments(pc, third).document).document,
    'associative merge'
  );
  sameDocument(Sync.mergeDocuments(phone, phone).document, phone, 'idempotent merge');
}

async function testSharedActorSameStampConflictIsNeverSilent() {
  const base = Sync.emptyDocument();
  const firstTab = Sync.writeFields(base, actor('shared.browser'), 'inventory', 'chicken', { stock: 3 });
  const secondTab = Sync.writeFields(base, actor('shared.browser'), 'inventory', 'chicken', { stock: 9 });
  const merged = Sync.mergeDocuments(firstTab, secondTab);
  assert.strictEqual(merged.conflicts.length, 1, 'same-device tabs with an identical stamp must emit a conflict receipt');
  assert.strictEqual(merged.conflicts[0].path, 'inventory/chicken/stock');
  sameDocument(merged.document, Sync.mergeDocuments(secondTab, firstTab).document, 'same-actor tie must remain deterministic');
}

async function testOfflineQueueSurvivesReload() {
  const storage = memoryStorage();
  const localActor = Sync.createActor(storage, { actorId: 'phone.actor' });
  const document = Sync.writeFields(Sync.emptyDocument(), localActor, 'entries', 'salt', { qty: 0 });
  let outbox = Sync.emptyOutbox(localActor.actorId);
  outbox = Sync.enqueueIntent(outbox, Sync.makeIntent(localActor, document, { intentId: 'intent-offline', createdAt: 1 }));
  Sync.saveOutbox(storage, outbox);
  const reloaded = Sync.loadOutbox(storage, localActor.actorId);
  assert.strictEqual(reloaded.active.intentId, 'intent-offline');
  assert.strictEqual(valueAt(reloaded.active.document, 'entries', 'salt', 'qty'), 0);
}

async function testBounded412Retry() {
  const storage = memoryStorage();
  const localActor = actor('phone.actor');
  const document = Sync.writeFields(Sync.emptyDocument(), localActor, 'inventory', 'oil', { stock: 1 });
  const outbox = Sync.enqueueIntent(Sync.emptyOutbox(localActor.actorId), Sync.makeIntent(localActor, document, { intentId: 'retry-me' }));
  Sync.saveOutbox(storage, outbox);
  let puts = 0;
  const adapter = {
    async getCanonical(path) {
      assert.strictEqual(path, Sync.CANONICAL_NODE);
      return { status: 200, etag: 'etag-' + puts, body: Sync.emptyDocument() };
    },
    async putCanonical(path, body, etag) {
      puts += 1;
      return puts < 3 ? { status: 412 } : { status: 200, etag: 'committed' };
    }
  };
  const result = await Sync.flushOutbox({ storage, actorId: localActor.actorId, adapter, maxCasRetries: 2 });
  assert.strictEqual(result.status, 'canonical_committed');
  assert.strictEqual(result.receipt.attempts, 3);
  assert.strictEqual(puts, 3);

  const exhaustedStorage = memoryStorage();
  Sync.saveOutbox(exhaustedStorage, outbox);
  puts = 0;
  adapter.putCanonical = async () => { puts += 1; return { status: 412 }; };
  const exhausted = await Sync.flushOutbox({ storage: exhaustedStorage, actorId: localActor.actorId, adapter, maxCasRetries: 1 });
  assert.strictEqual(exhausted.status, 'cas_retry_exhausted');
  assert.strictEqual(puts, 2);
  assert.strictEqual(Sync.loadOutbox(exhaustedStorage, localActor.actorId).active.intentId, 'retry-me');
}

async function testProjectionFailureKeepsCanonicalReceipt() {
  const storage = memoryStorage();
  const localActor = actor('phone.actor');
  const document = Sync.writeFields(Sync.emptyDocument(), localActor, 'settings', 'order', { days: null });
  Sync.saveOutbox(storage, Sync.enqueueIntent(Sync.emptyOutbox(localActor.actorId), Sync.makeIntent(localActor, document, { intentId: 'canonical-first' })));
  const adapter = {
    async getCanonical() { return { status: 200, etag: 'old', body: Sync.emptyDocument() }; },
    async putCanonical() { return { status: 200, etag: 'new' }; }
  };
  const result = await Sync.flushOutbox({ storage, actorId: localActor.actorId, adapter });
  assert.strictEqual(result.status, 'canonical_committed');
  assert.strictEqual(result.projection.status, 'deferred_repair');
  const repair = await Sync.repairLegacyProjection({
    storage,
    actorId: localActor.actorId,
    async projector() { throw new Error('legacy current/history partial failure'); }
  });
  assert.strictEqual(repair.status, 'repair_required');
  const reloaded = Sync.loadOutbox(storage, localActor.actorId);
  assert.strictEqual(reloaded.active, null);
  assert.strictEqual(reloaded.lastCanonicalReceipt.intentId, 'canonical-first');
  assert.strictEqual(reloaded.projectionRepair.receipt.status, 'canonical_committed');
}

async function testEmptyZeroNullAndLegacyFutureRevisionIsolation() {
  const localActor = actor('migration.actor');
  const legacy = {
    stateRevision: 2784000000000,
    inventoryByItemKey: {
      zero: { stock: 0, note: '', optional: null, list: [], object: {} },
      emptyObject: {}
    },
    entries: [],
    orderAliasMappings: {},
    dailySales: {},
    baseSales: 0
  };
  const migrated = Sync.migrateLegacyPayload(legacy, localActor);
  assert.strictEqual(migrated.status, 'migrated');
  assert.strictEqual(migrated.document.reset.epoch, 1, 'future revision must be isolated by a fresh epoch');
  assert.strictEqual(valueAt(migrated.document, 'inventory', 'zero', 'stock'), 0);
  assert.strictEqual(valueAt(migrated.document, 'inventory', 'zero', 'note'), '');
  assert.strictEqual(valueAt(migrated.document, 'inventory', 'zero', 'optional'), null);
  assert.deepStrictEqual(valueAt(migrated.document, 'inventory', 'zero', 'list'), []);
  assert.deepStrictEqual(valueAt(migrated.document, 'inventory', 'zero', 'object'), {});
  assert.deepStrictEqual(valueAt(migrated.document, 'inventory', 'emptyObject', 'value'), {});
  const again = Sync.migrateLegacyPayload(legacy, localActor, { marker: migrated.marker, document: migrated.document });
  assert.strictEqual(again.status, 'already_migrated');
}

async function testResetEpochDropsPriorWrites() {
  const localActor = actor('phone.actor');
  const old = Sync.writeFields(Sync.emptyDocument(), localActor, 'inventory', 'old', { stock: 5 });
  const reset = Sync.createReset(old, localActor);
  const after = Sync.writeFields(reset, localActor, 'inventory', 'new', { stock: 2 });
  const merged = Sync.mergeDocuments(old, after).document;
  assert.strictEqual(merged.collections.inventory.old, undefined);
  assert.strictEqual(valueAt(merged, 'inventory', 'new', 'stock'), 2);
}

async function testTombstoneBeatsOlderValueWithoutConfusingNull() {
  const localActor = actor('phone.actor');
  const initial = Sync.writeFields(Sync.emptyDocument(), localActor, 'mappings', 'salt', { alias: '소금', optional: null });
  const deleted = Sync.deleteFields(initial, localActor, 'mappings', 'salt', ['alias']);
  const merged = Sync.mergeDocuments(initial, deleted).document;
  assert.strictEqual(merged.collections.mappings.salt.alias.tombstone, true);
  assert.strictEqual(merged.collections.mappings.salt.optional.tombstone, false);
  assert.strictEqual(merged.collections.mappings.salt.optional.value, null);
}

async function testSfaManifestUnionAndOriginalFirstOrder() {
  const runOne = {
    runId: 'run-new', path: '/sfaAnalysisRuns/run-new', contentHash: 'aaaaaaaa', rowCount: 2
  };
  const runOld = {
    runId: 'run-old', path: '/sfaAnalysisRuns/run-old', contentHash: 'bbbbbbbb', rowCount: 1
  };
  const union = Sync.mergeSfaRunManifests({ runs: { 'run-new': runOne } }, { runs: { 'run-old': runOld } });
  assert.deepStrictEqual(Object.keys(union.manifest.runs).sort(), ['run-new', 'run-old']);

  const base = Sync.emptyDocument();
  const withHead = Sync.setSfaHead(base, actor('phone.actor'), runOne);
  assert.strictEqual(withHead.sfaHead.value.path, '/sfaAnalysisRuns/run-new');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(withHead, 'sfaLedger'), false, 'canonical state must never copy the ledger');
  const ordered = Sync.sfaFirstOrder([
    { entryKey: 'master-b', canonicalName: '후라이드', sfaSeq: 2, qty: 10 },
    { entryKey: 'master-a', canonicalName: '양념', sfaSeq: 1, qty: 0 },
    { eventId: 'run-new#2', sourceOnly: true, sourceRowIndex: 2, qty: 20 },
    { eventId: 'run-new#1', sourceOnly: true, sourceRowIndex: 1, qty: 99 },
    { entryKey: 'manual-a', canonicalName: '수동', canonicalSeq: 1001, qty: 30 }
  ]);
  assert.deepStrictEqual(ordered.map(row => row.entryKey || row.eventId), ['master-a', 'master-b', 'run-new#1', 'run-new#2', 'manual-a']);
  assert.strictEqual(ordered[0].qty, 0, 'positive/actionable priority must not replace MASTER.sfaSeq');
}

async function testCanonicalTrafficBudgetAndNoNetworkOnOversize() {
  const storage = memoryStorage();
  const localActor = actor('phone.actor');
  let document = Sync.emptyDocument();
  document = Sync.writeFields(document, localActor, 'settings', 'oversize', { blob: 'x'.repeat(Sync.MAX_CANONICAL_BYTES) });
  assert.throws(() => Sync.assertCanonicalSizeBudget(document), Sync.SyncValidationError);
  Sync.saveOutbox(storage, Sync.enqueueIntent(Sync.emptyOutbox(localActor.actorId), Sync.makeIntent(localActor, document, { intentId: 'too-large' })));
  let writes = 0;
  const adapter = {
    async getCanonical() { return { status: 200, etag: 'one', body: Sync.emptyDocument() }; },
    async putCanonical() { writes += 1; return { status: 200 }; }
  };
  await assert.rejects(() => Sync.flushOutbox({ storage, actorId: localActor.actorId, adapter }), Sync.SyncValidationError);
  assert.strictEqual(writes, 0, 'oversized canonical document must fail before PUT');
  assert.strictEqual(Sync.loadOutbox(storage, localActor.actorId).active.intentId, 'too-large');
}

async function testMalformedQueueFailsClosed() {
  const raw = '{this is not json';
  const storage = memoryStorage({ [Sync.DEFAULT_STORAGE_KEYS.outbox]: raw });
  assert.throws(() => Sync.loadOutbox(storage, 'phone.actor'), Sync.SyncCorruptionError);
  assert.strictEqual(storage.getItem(Sync.DEFAULT_STORAGE_KEYS.outbox), raw, 'corrupt evidence must not be overwritten or cleared');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function testEnqueueDuringFlushSurvivesAndConcurrentFlushIsBusy() {
  const storage = memoryStorage();
  const localActor = actor('phone.actor');
  const firstDocument = Sync.writeFields(Sync.emptyDocument(), localActor, 'inventory', 'chicken', { stock: 1 });
  const firstIntent = Sync.makeIntent(localActor, firstDocument, { intentId: 'intent-first', createdAt: 1 });
  Sync.saveOutbox(storage, Sync.enqueueIntent(Sync.emptyOutbox(localActor.actorId), firstIntent));

  const firstRead = deferred();
  let remoteDocument = Sync.emptyDocument();
  let etag = 1;
  let putCount = 0;
  let getCount = 0;
  const adapter = {
    async getCanonical() {
      getCount += 1;
      if (getCount === 1) return firstRead.promise;
      return { status: 200, etag: 'etag-' + etag, body: remoteDocument };
    },
    async putCanonical(path, body, suppliedEtag) {
      putCount += 1;
      assert.strictEqual(suppliedEtag, 'etag-' + etag);
      remoteDocument = body;
      etag += 1;
      return { status: 200, etag: 'etag-' + etag };
    }
  };

  const firstFlush = Sync.flushOutbox({ storage, actorId: localActor.actorId, adapter });
  await Promise.resolve();
  const concurrent = await Sync.flushOutbox({ storage, actorId: localActor.actorId, adapter });
  assert.strictEqual(concurrent.status, 'busy', 'same storage/actor concurrent flush must not issue a duplicate PUT');

  const secondDocument = Sync.writeFields(firstDocument, localActor, 'mappings', 'chicken', { actualName: '황금올리브' });
  const secondIntent = Sync.makeIntent(localActor, secondDocument, { intentId: 'intent-second', createdAt: 2 });
  const duringFlush = Sync.enqueueIntent(Sync.loadOutbox(storage, localActor.actorId), secondIntent);
  Sync.saveOutbox(storage, duringFlush);
  firstRead.resolve({ status: 200, etag: 'etag-1', body: remoteDocument });

  assert.strictEqual((await firstFlush).status, 'canonical_committed');
  const afterFirst = Sync.loadOutbox(storage, localActor.actorId);
  assert.strictEqual(afterFirst.active.intentId, 'intent-second', 'queued intent created during await must be promoted, not erased');
  assert.strictEqual(afterFirst.queued, null);
  assert.strictEqual(putCount, 1);

  assert.strictEqual((await Sync.flushOutbox({ storage, actorId: localActor.actorId, adapter })).status, 'canonical_committed');
  assert.strictEqual(Sync.loadOutbox(storage, localActor.actorId).active, null);
  assert.strictEqual(remoteDocument.collections.mappings.chicken.actualName.value, '황금올리브');
  assert.strictEqual(putCount, 2);
}

async function testPostAwaitActorMismatchFailsClosedWithoutOverwrite() {
  const storage = memoryStorage();
  const localActor = actor('phone.actor');
  const document = Sync.writeFields(Sync.emptyDocument(), localActor, 'inventory', 'oil', { stock: 2 });
  const intent = Sync.makeIntent(localActor, document, { intentId: 'phone-active' });
  Sync.saveOutbox(storage, Sync.enqueueIntent(Sync.emptyOutbox(localActor.actorId), intent));
  const delayedRead = deferred();
  const adapter = {
    async getCanonical() { return delayedRead.promise; },
    async putCanonical() { return { status: 200, etag: 'etag-2' }; }
  };
  const flushing = Sync.flushOutbox({ storage, actorId: localActor.actorId, adapter });
  await Promise.resolve();
  const foreignSerialized = JSON.stringify(Sync.emptyOutbox('pc.actor'));
  storage.setItem(Sync.DEFAULT_STORAGE_KEYS.outbox, foreignSerialized);
  delayedRead.resolve({ status: 200, etag: 'etag-1', body: Sync.emptyDocument() });
  await assert.rejects(flushing, /actor mismatch/);
  assert.strictEqual(storage.getItem(Sync.DEFAULT_STORAGE_KEYS.outbox), foreignSerialized, 'post-await actor mismatch must never be overwritten');
}

async function main() {
  const tests = [
    testConstitutionBaseline,
    testBrowserGlobalAndStableActor,
    testIndependentSimultaneousChangesSurvive,
    testSameFieldConflictIsDeterministicAndVisible,
    testSharedActorSameStampConflictIsNeverSilent,
    testOfflineQueueSurvivesReload,
    testBounded412Retry,
    testProjectionFailureKeepsCanonicalReceipt,
    testEmptyZeroNullAndLegacyFutureRevisionIsolation,
    testResetEpochDropsPriorWrites,
    testTombstoneBeatsOlderValueWithoutConfusingNull,
    testSfaManifestUnionAndOriginalFirstOrder,
    testCanonicalTrafficBudgetAndNoNetworkOnOversize,
    testMalformedQueueFailsClosed,
    testEnqueueDuringFlushSurvivesAndConcurrentFlushIsBusy,
    testPostAwaitActorMismatchFailsClosedWithoutOverwrite
  ];
  for (const test of tests) {
    await test();
    process.stdout.write('PASS ' + test.name + '\n');
  }
  process.stdout.write('PASS OrderHelper sync v2 core (' + tests.length + ' tests)\n');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
