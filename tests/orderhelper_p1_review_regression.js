const assert = require('assert');
const { performance } = require('perf_hooks');
const { api, plain, sandbox } = require('./orderhelper_static_checks.js');

const target = api.MASTER[0];

function rawLedger(runId, fileName, quantity, savedAt, rowIndex = 1) {
  return {
    version: 2,
    records: [{
      id: runId,
      runId,
      dateKey: '20260714',
      savedAt,
      updatedAt: savedAt,
      source: 'fixture',
      fileName,
      items: [{
        runId,
        dateKey: '20260714',
        source: 'fixture',
        originalName: `원천-${runId}`,
        mappedName: target.name,
        quantity,
        actualOrderQty: quantity,
        unit: target.unit || 'EA',
        rowIndex,
        rawIdentity: `${runId}-${rowIndex}`,
        eventAt: savedAt,
      }],
    }],
  };
}

assert.strictEqual(api.normalizedSfaFileName({ name: 'C:\\Downloads\\실발주.xlsx' }), '실발주.xlsx', 'SiteBot file objects must normalize to a basename');
assert.notStrictEqual(api.normalizedSfaFileName({ name: '실발주.xlsx' }), '[object Object]', 'file objects must never leak as [object Object]');

api.setSfaAnalysisHistoryForCheck({ records: [] });
api.setSfaActualHistoryForCheck({});
api.appendSfaAnalysisHistory({
  runId: 'local-copy-run',
  savedAt: 1000,
  updatedAt: 1000,
  orderDateKey: '20260714',
  file: { name: 'C:\\Downloads\\동일물리원천.xlsx' },
  items: [{ name: '동일 원천품목', qty: 7, unit: 'BOX', row_index: 4 }],
  comparison: {
    matched: [{ row_index: 4, sfa_name: '동일 원천품목', sfa_qty: 7, sfa_unit: 'BOX', expected_name: target.name, score: 0.99 }],
    missing: [],
    extra: [],
  },
}, 'excel');
api.setSfaActualHistoryForCheck({
  '20260714': {
    runId: 'firebase-copy-run',
    savedAt: 2000,
    file: { name: '동일물리원천.xlsx' },
    rows: [{ row_index: 4, sfa_name: '동일 원천품목', sfa_qty: 9, sfa_unit: 'BOX', expected_name: target.name }],
  },
});
let ledger = plain(api.sfaOrderLedgerForPayload());
assert.strictEqual(ledger.eventCount, 1, 'the local and Firebase copies of one physical SFA row must not double count');
assert.strictEqual(ledger.records[0].items[0].quantity, 9, 'physical-origin dedupe must retain the newest event value');
assert.deepStrictEqual(
  new Set(ledger.records[0].items[0].sourceRunIds),
  new Set(['local-copy-run', 'firebase-copy-run']),
  'physical-origin dedupe must retain provenance for both source run ids'
);

api.setSfaActualHistoryForCheck({});
api.setSfaAnalysisHistoryForCheck({ records: [] });
const sameRunBase = {
  runId: 'same-run-latest-wins',
  orderDateKey: '20260714',
  file: { name: 'retry.xlsx' },
  comparison: { missing: [], extra: [] },
};
api.appendSfaAnalysisHistory({
  ...sameRunBase,
  savedAt: 9000,
  updatedAt: 9000,
  items: [{ name: '재시도품목', qty: 9, unit: 'BOX', row_index: 8 }],
  comparison: { ...sameRunBase.comparison, matched: [{ row_index: 8, sfa_name: '재시도품목', sfa_qty: 9, sfa_unit: 'BOX', expected_name: target.name }] },
}, 'excel');
api.appendSfaAnalysisHistory({
  ...sameRunBase,
  savedAt: 2000,
  updatedAt: 2000,
  items: [{ name: '재시도품목', qty: 2, unit: 'BOX', row_index: 8 }],
  comparison: { ...sameRunBase.comparison, matched: [{ row_index: 8, sfa_name: '재시도품목', sfa_qty: 2, sfa_unit: 'BOX', expected_name: target.name }] },
}, 'excel');
ledger = plain(api.sfaOrderLedgerForPayload());
assert.strictEqual(ledger.eventCount, 1, 'same-run retry must remain one event');
assert.strictEqual(ledger.records[0].items[0].quantity, 9, 'an older same-run retry must not regress a newer quantity');

const sfaOrdered = api.MASTER.slice().sort((a, b) => (a.sfaSeq || 9999) - (b.sfaSeq || 9999));
const early = sfaOrdered[0];
const late = sfaOrdered.find(item => (item.sfaSeq || 9999) > (early.sfaSeq || 9999));
assert(late, 'same-zone input-order fixture needs distinct SFA positions');
assert.deepStrictEqual(
  plain(api.gridRowsForCheck([
    { id: 'typed-first', entryKey: 'typed-first', name: late.name, zone: '주방', stock: null },
    { id: 'typed-second', entryKey: 'typed-second', name: early.name, zone: '주방', stock: null },
  ], 'input')),
  ['typed-first', 'typed-second'],
  'same-zone input mode must preserve the original entry order instead of falling through to SFA order'
);

async function verifyFirebaseCas() {
  // Let the page's fire-and-forget initial registration-window probe finish
  // against the harness default fetch before counting CAS-only requests.
  await new Promise(resolve => setImmediate(resolve));
  const localPayload = { savedAt: 5000, stateRevision: 50, inventoryRevision: 50, sfaOrderLedger: rawLedger('local-run', 'local.xlsx', 1, 5000), aiUsageEvidence: {} };
  const remoteV1 = { savedAt: 4000, remoteOnly: 'preserve-me', sfaOrderLedger: rawLedger('remote-run', 'remote.xlsx', 2, 4000) };
  const remoteV2 = api.mergeFirebasePayloadLedger(remoteV1, { sfaOrderLedger: rawLedger('concurrent-run', 'concurrent.xlsx', 3, 4500) });
  let getCount = 0;
  let putCount = 0;
  const putBodies = [];
  sandbox.fetch = async (_url, options = {}) => {
    if (!options.method) {
      getCount += 1;
      const body = getCount === 1 ? remoteV1 : remoteV2;
      return {
        ok: true,
        status: 200,
        headers: { get(name) { return String(name).toLowerCase() === 'etag' ? `"v${getCount}"` : null; } },
        json: async () => body,
      };
    }
    putCount += 1;
    putBodies.push({ headers: options.headers, body: JSON.parse(options.body) });
    if (putCount === 1) return { ok: false, status: 412, text: async () => 'conflict' };
    return { ok: true, status: 200, text: async () => '' };
  };
  const result = await api.putFirebasePayloadWithLedgerCas('https://fixture.invalid/current.json', localPayload, 4);
  assert.strictEqual(result.response.ok, true, 'CAS must succeed after re-reading a 412 conflict');
  assert.strictEqual(result.attempts, 2, 'CAS must retry exactly once for the fixture conflict');
  assert.strictEqual(getCount, 2, 'a 412 must trigger a fresh remote read');
  assert.strictEqual(putCount, 2, 'a 412 must trigger a conditional retry write');
  assert.strictEqual(putBodies[0].headers['If-Match'], '"v1"', 'first conditional write must use the first ETag');
  assert.strictEqual(putBodies[1].headers['If-Match'], '"v2"', 'retry write must use the refreshed ETag');
  assert.strictEqual(putBodies[1].body.remoteOnly, 'preserve-me', 'CAS merge must retain unknown remote fields');
  assert.strictEqual(putBodies[1].body.sfaOrderLedger.eventCount, 3, 'CAS retry must preserve remote, concurrent, and local ledger events');

  let emptyWrite = null;
  sandbox.fetch = async (_url, options = {}) => {
    if (!options.method) {
      return {
        ok: true,
        status: 200,
        headers: { get(name) { return String(name).toLowerCase() === 'etag' ? '"empty"' : null; } },
        json: async () => null,
      };
    }
    emptyWrite = JSON.parse(options.body);
    return { ok: true, status: 200, text: async () => '' };
  };
  await api.putFirebasePayloadWithLedgerCas('https://fixture.invalid/history.json', localPayload, 2);
  assert.strictEqual(emptyWrite.sfaOrderLedger.eventCount, 1, 'an empty remote node must preserve the complete local ledger');
}

function verifyBoundedPayloadPerformance() {
  const records = [];
  let serial = 0;
  for (let run = 0; run < 20; run += 1) {
    const items = [];
    for (let rowIndex = 0; rowIndex < 100; rowIndex += 1) {
      serial += 1;
      items.push({
        originalName: `부하품목-${serial}`,
        mappedName: target.name,
        quantity: serial % 11,
        actualOrderQty: serial % 11,
        unit: 'BOX',
        rowIndex,
        rawIdentity: `load-${run}-${rowIndex}`,
        eventAt: 10000 + run,
      });
    }
    records.push({
      id: `load-run-${run}`,
      runId: `load-run-${run}`,
      dateKey: '20260714',
      savedAt: 10000 + run,
      updatedAt: 10000 + run,
      source: 'fixture',
      fileName: `load-${run}.xlsx`,
      items,
    });
  }
  api.setSfaActualHistoryForCheck({});
  api.setSfaAnalysisHistoryForCheck({ version: 2, records });
  const started = performance.now();
  const state = plain(api.buildSfaAnalysisPayloadState(null));
  const elapsedMs = performance.now() - started;
  const payloadBytes = Buffer.byteLength(JSON.stringify(state));
  assert.strictEqual(state.sfaOrderLedger.eventCount, 2000, 'performance fixture must keep all 2000 canonical events');
  assert.strictEqual(state.sfaAnalysisHistory.records, undefined, 'legacy analysisHistory must be a compact canonical pointer');
  assert.strictEqual(state.sfaActualHistory.ledger, undefined, 'legacy actualHistory must not duplicate the canonical ledger');
  assert(state.aiUsageEvidence.ledger.events.length <= 100, 'AI evidence must include only the bounded exact events contract');
  assert(state.aiUsageEvidence.ledger.totals[target.name].eventIds.length <= 20, 'AI aggregate event-id evidence must stay bounded');
  assert(elapsedMs < 3000, `2000-event payload build is too slow: ${elapsedMs.toFixed(1)}ms`);
  assert(payloadBytes < 1800000, `2000-event payload is too large: ${payloadBytes} bytes`);
  assert.strictEqual(api.sfaOrderLedgerForPayload(), api.sfaOrderLedgerForPayload(), 'unchanged ledger revisions must reuse the memoized canonical object');
  return { elapsedMs, payloadBytes };
}

verifyFirebaseCas()
  .then(() => {
    const perf = verifyBoundedPayloadPerformance();
    console.log(`OrderHelper P1 review regression OK (${perf.elapsedMs.toFixed(1)}ms, ${perf.payloadBytes} bytes)`);
    console.log('Producer dependency: an upstream overwrite without runId/zero rows cannot be reconstructed by this browser ledger and remains an external E2E gate.');
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
