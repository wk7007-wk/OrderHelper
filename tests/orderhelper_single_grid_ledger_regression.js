const assert = require('assert');
const { api, plain, sandbox } = require('./orderhelper_static_checks.js');

const orderedMaster = api.MASTER.slice().sort((left, right) =>
  (left.sfaSeq || 9999) - (right.sfaSeq || 9999) || left.name.localeCompare(right.name, 'ko')
);
const firstSfa = orderedMaster[0];
const laterSfa = orderedMaster.find(item => (item.sfaSeq || 9999) > (firstSfa.sfaSeq || 9999));
assert(laterSfa, 'sort fixture needs two different initial SFA positions');

const sortFixture = [
  { id: 'later-zone-a', entryKey: 'later-zone-a', name: laterSfa.name, zone: '가', stock: 1 },
  { id: 'first-zone-b', entryKey: 'first-zone-b', name: firstSfa.name, zone: '나', stock: 1 },
];
assert.deepStrictEqual(
  plain(api.gridRowsForCheck(sortFixture, 'input')),
  ['later-zone-a', 'first-zone-b'],
  'input context must sort the same rows by category/zone'
);
assert.deepStrictEqual(
  plain(api.gridRowsForCheck(sortFixture, 'sfa')),
  ['first-zone-b', 'later-zone-a'],
  'order context must sort the same rows by initial SFA order'
);

const focusSource = {
  value: '12.3',
  selectionStart: 2,
  selectionEnd: 4,
  dataset: { id: 'focus-id', entryKey: 'focus-key', field: 'stock' },
  classList: { contains(value) { return value === 'cell'; } },
};
const focusSnapshot = plain(api.gridFocusSnapshot(focusSource));
let focused = false;
let restoredSelection = null;
const focusTarget = {
  value: '12.3',
  dataset: { id: 'focus-id', entryKey: 'focus-key', field: 'stock' },
  focus() { focused = true; },
  setSelectionRange(start, end) { restoredSelection = [start, end]; },
};
const originalQuerySelectorAll = sandbox.document.querySelectorAll;
sandbox.document.querySelectorAll = selector => selector === 'input.cell' ? [focusTarget] : [];
assert.strictEqual(api.restoreGridFocus(focusSnapshot), true, 'sort rerender must restore the stable keyed input');
assert.strictEqual(focused, true, 'restored keyed input must receive focus');
assert.deepStrictEqual(restoredSelection, [2, 4], 'sort rerender must preserve the caret selection');
sandbox.document.querySelectorAll = originalQuerySelectorAll;

sandbox.document.getElementById('orderDays').value = '3';
api.resetGridPerfForCheck();
for (let index = 0; index < 150; index += 1) api.scheduleGridInputForCheck(firstSfa.name);
api.flushGridInputForCheck();
const perf = plain(api.gridPerfForCheck());
assert.strictEqual(perf.fullRenders, 0, '150 keyed edits must not full-render the table');
assert.strictEqual(perf.scheduledFrames, 1, '150 edits in one burst must share one deferred frame');
assert.strictEqual(perf.deferredRuns, 1, '150 edits in one burst must run one deferred batch');
assert.strictEqual(perf.deferredRevision, 150, 'deferred work must retain the latest input revision');
assert.strictEqual(perf.keyedRowPatches, 151, 'each edit patches immediately and the one deferred batch patches the latest value once');

const targetName = firstSfa.name;
const targetUnit = firstSfa.unit || 'EA';
api.setSiteMappingsForCheck({});
api.setAliasMappingsForCheck({});
api.setSfaActualHistoryForCheck({
  '20260713': {
    runId: 'actual-run-0',
    rows: [
      { row_index: 1, expected_name: targetName, sfa_name: '외부 중복', sfa_qty: 0, sfa_unit: 'BOX', sfa_amount: 0 },
      { row_index: 2, expected_name: targetName, sfa_name: '외부 중복', sfa_qty: 2, sfa_unit: 'BOX', sfa_amount: 12000 },
    ],
  },
});
const actualLedger = plain(api.sfaActualHistoryLedgerForPayload());
assert.strictEqual(actualLedger.eventCount, 2, 'SFA actual-history payload must preserve duplicate item rows');
assert(actualLedger.records[0].items.some(row => row.quantity === 0 && row.actualOrderQty === 0), 'SFA actual-history ledger must preserve explicit zero quantities');
api.setSfaActualHistoryForCheck({});
api.setSfaAnalysisHistoryForCheck({ records: [] });

const runA = {
  runId: 'run-A',
  savedAt: Date.UTC(2026, 6, 14),
  orderDateKey: '20260714',
  file: { name: '발주A.xlsx' },
  items: [
    { name: '중복 원품목', qty: 0, unit: 'BOX', amount: 0, row_index: 10 },
    { name: '중복 원품목', qty: 2, unit: 'BOX', amount: 12000, row_index: 11 },
  ],
  comparison: {
    matched: [
      { row_index: 10, sfa_name: '중복 원품목', sfa_qty: 0, sfa_unit: 'BOX', expected_name: targetName, score: 0.98 },
      { row_index: 11, sfa_name: '중복 원품목', sfa_qty: 2, sfa_unit: 'BOX', expected_name: targetName, score: 0.98 },
    ],
    missing: [],
    extra: [],
  },
};
api.appendSfaAnalysisHistory(runA, 'excel');
let ledger = plain(api.sfaOrderLedgerForPayload());
assert.strictEqual(ledger.records.length, 1, 'first run must append one ledger run');
assert.strictEqual(ledger.records[0].items.length, 2, 'duplicate same-name order rows must remain separate events');
assert.strictEqual(new Set(ledger.records[0].items.map(row => row.eventId)).size, 2, 'duplicate rows need distinct stable event ids');
assert(ledger.records[0].items.some(row => row.quantity === 0 && row.actualOrderQty === 0 && row.amount === 0), 'zero qty/amount/actual order values must be preserved');

api.appendSfaAnalysisHistory({
  ...runA,
  savedAt: Date.UTC(2026, 6, 14, 1),
  items: [{ name: '중복 원품목', qty: 3, unit: 'BOX', amount: 18000, row_index: 10 }],
  comparison: { matched: [{ row_index: 10, sfa_name: '중복 원품목', sfa_qty: 3, sfa_unit: 'BOX', expected_name: targetName, score: 0.98 }], missing: [], extra: [] },
}, 'excel');
ledger = plain(api.sfaOrderLedgerForPayload());
assert.strictEqual(ledger.records.length, 1, 'same run retry must be idempotently merged');
assert.strictEqual(ledger.records[0].items.length, 2, 'partial same-run retry must not drop an earlier row event');
assert.strictEqual(ledger.records[0].items.find(row => row.rowIndex === 10).quantity, 3, 'same event retry must refresh its latest row value');

api.appendSfaAnalysisHistory({
  runId: 'run-B',
  savedAt: Date.UTC(2026, 6, 14, 2),
  orderDateKey: '20260714',
  file: { name: '발주B.xlsx' },
  items: [{ name: '중복 원품목', qty: 4, unit: 'BOX', amount: 24000, row_index: 10 }],
  comparison: { matched: [{ row_index: 10, sfa_name: '중복 원품목', sfa_qty: 4, sfa_unit: 'BOX', expected_name: targetName, score: 0.98 }], missing: [], extra: [] },
}, 'excel');
ledger = plain(api.sfaOrderLedgerForPayload());
assert.strictEqual(ledger.records.length, 2, 'a new run for the same item must append');
assert.strictEqual(ledger.eventCount, 3, 'ledger event count must include all distinct run/row events');

const remoteLedger = {
  version: 2,
  records: [{
    id: 'run-C', runId: 'run-C', dateKey: '20260714', savedAt: Date.UTC(2026, 6, 14, 3), source: 'excel', fileName: 'remote.xlsx',
    items: [{ runId: 'run-C', dateKey: '20260714', source: 'excel', originalName: '원격행', mappedName: targetName, aliasName: '원격별명', quantity: 5, actualOrderQty: 5, unit: targetUnit, amount: 30000, rowIndex: 7, rawIdentity: 'remote-7' }],
  }],
};
api.mergeSfaAnalysisHistoryForCheck(remoteLedger);
ledger = plain(api.sfaOrderLedgerForPayload());
assert.strictEqual(ledger.records.length, 3, 'current remote ledger merge must preserve local runs and append remote runs');
api.mergeSfaAnalysisHistoryForCheck({ version: 2, records: [] });
assert.strictEqual(api.sfaOrderLedgerForPayload().records.length, 3, 'an explicit empty remote ledger must not erase existing events');

api.setOverridesForCheck({ [targetName]: { l: 7 } });
const evidence = plain(api.buildAiUsageEvidence(90, Date.UTC(2026, 6, 14, 12)));
const targetTotal = evidence.ledger.totals[targetName];
assert(targetTotal, 'AI evidence must aggregate ledger rows by mapped canonical item');
assert.strictEqual(targetTotal.rowCount, 4, 'AI evidence total must include all distinct cumulative ledger events');
assert.strictEqual(targetTotal.quantity, 14, 'AI evidence must total retry-updated and appended quantities without double counting');
assert.strictEqual(evidence.manualUsage[targetName].value, 7, 'AI evidence must expose the manual usage value');
assert.strictEqual(evidence.manualUsage[targetName].overridden, true, 'AI evidence must mark manual overrides as protected');
assert.strictEqual(api.getOverridesForCheck()[targetName].l, 7, 'building AI evidence must never overwrite manual usage');
assert.strictEqual(evidence.protection.advisoryOnly, true, 'AI result contract must remain advisory only');
assert.strictEqual(evidence.protection.browserModelCall, false, 'browser-side model calls must remain forbidden');
assert.strictEqual(evidence.workerContract.queuePath, '/monitor/main_pc/sfa_order_request', 'AI evidence must use the existing server worker queue pointer');

console.log('OrderHelper single-grid/ledger regression OK');
