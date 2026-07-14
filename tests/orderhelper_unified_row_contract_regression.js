const assert = require('assert');
const fixture = require('./fixtures/orderhelper_unified_order_row_contract.json');
const { api, plain, sandbox } = require('./orderhelper_static_checks.js');

assert.strictEqual(fixture.version, 1, 'unified row fixture version must be explicit');
assert.strictEqual(new Set(fixture.statusEnum).size, fixture.statusEnum.length, 'status enum must be mutually exclusive');

const item = api.MASTER.find(row => row.name === '신선육(10호)-뼈한마리');
assert(item, 'factor-10 unified-row fixture item missing');
const actualName = '실발주품목';
const now = Date.UTC(2026, 6, 14, 12);

function ledger(events) {
  return {
    version: 2,
    records: [{
      id: 'fixture-record',
      runId: 'fixture-record',
      dateKey: '20260714',
      savedAt: now,
      updatedAt: now,
      source: 'excel',
      fileName: '실발주.xlsx',
      items: events,
    }],
  };
}

function setBaseState() {
  sandbox.document.getElementById('orderDays').value = '2';
  api.setEntriesForCheck([{ id: 'unified-target', entryKey: 'unified-target', name: item.name, zone: '주방', stock: 0 }]);
  api.setOverridesForCheck({ [item.name]: { l: 25, k: 0 } });
  api.setSiteMappingsForCheck({});
  api.setAliasMappingsForCheck({
    [item.name]: {
      aliasName: item.name,
      actualName,
      actualUnit: 'BOX',
      status: 'confirmed',
      source: 'user',
      conversionFactor: 10,
      conversionStatus: 'confirmed',
    },
  });
}

function targetRow() {
  const rows = plain(api.resolveUnifiedOrderRows(null, null, 2, now));
  const matches = rows.filter(row => row.itemKey === api.itemKeyForName(item.name));
  assert.strictEqual(matches.length, 1, 'one itemKey must resolve to exactly one row');
  return { row: matches[0], rows };
}

setBaseState();
api.setSfaActualHistoryForCheck({});
api.setSfaAnalysisHistoryForCheck(ledger([{
  runId: 'run-new',
  dateKey: '20260714',
  eventAt: now,
  originalName: actualName,
  mappedName: item.name,
  aliasName: actualName,
  actualOrderQty: 5,
  quantity: 5,
  amount: '12,000',
  unit: 'BOX',
  rowIndex: 1,
  rawIdentity: 'matched-price-row',
}]));
let result = targetRow();
assert.strictEqual(result.row.matchStatus, 'MATCHED', 'confirmed alias and factor must resolve MATCHED');
assert.strictEqual(result.row.orderQty, 3, 'stock need 25 at factor 10 must resolve three order units');
assert.strictEqual(result.row.unitPrice, 2400, 'Excel amount 12,000 / order qty 5 must resolve unit price 2,400');
assert.strictEqual(result.row.expectedAmount, 7200, 'recommended order 3 * unit price 2,400 must resolve 7,200');
assert.deepStrictEqual(result.row.issues, [], 'valid matched price row must have no issues');
assert.strictEqual(result.rows.filter(row => row.matchStatus === 'ITEM_UNMATCHED' && row.itemKey === result.row.itemKey).length, 0, 'matched item must never also appear unmatched');
assert.strictEqual(result.rows.reduce((sum, row) => sum + (Number.isFinite(row.expectedAmount) ? row.expectedAmount : 0), 0), 7200, 'today expected total must sum each resolver row once');

setBaseState();
api.setSfaAnalysisHistoryForCheck(ledger([
  {
    runId: 'run-old', dateKey: '20260713', eventAt: now - 86400000, originalName: actualName,
    mappedName: item.name, actualOrderQty: 4, quantity: 4, amount: 8000, unit: 'BOX', rowIndex: 1, rawIdentity: 'old-valid-price',
  },
  {
    runId: 'run-new', dateKey: '20260714', eventAt: now, originalName: actualName,
    mappedName: item.name, actualOrderQty: 0, quantity: 0, amount: 0, unit: 'BOX', rowIndex: 2, rawIdentity: 'new-zero-price',
  },
]));
result = targetRow();
assert.strictEqual(result.row.priceEvidence.runId, 'run-old', 'zero-quantity newest row must fall back to latest older positive price evidence');
assert.strictEqual(result.row.priceEvidence.fallbackFromNewerZeroQty, true, 'older-price fallback must remain explicit evidence');
assert.strictEqual(result.row.unitPrice, 2000);
assert.strictEqual(result.row.expectedAmount, 6000);

setBaseState();
api.setSfaAnalysisHistoryForCheck({ records: [] });
result = targetRow();
assert.strictEqual(result.row.matchStatus, 'MATCHED', 'missing price must not erase an explicit alias match');
assert.strictEqual(result.row.unitPrice, null, 'missing price must stay null, never fabricated zero');
assert.strictEqual(result.row.expectedAmount, null, 'missing price must keep expected amount unresolved');
assert(result.row.issues.some(issue => issue.code === 'PRICE_JOIN_BUG' && issue.message.includes('엑셀 금액 행')), 'matched alias without price must raise Korean PRICE_JOIN_BUG');

api.setAliasMappingsForCheck({});
api.setSiteMappingsForCheck({});
api.setSfaAnalysisHistoryForCheck({ records: [] });
result = targetRow();
assert.strictEqual(result.row.matchStatus, 'ITEM_UNMATCHED', 'no explicit alias or candidate must resolve one unmatched status');
assert(result.row.issues.some(issue => issue.code === 'ITEM_UNMATCHED'), 'true unmatched row must expose the exact reason code');

console.log('OrderHelper unified order row contract regression OK');
