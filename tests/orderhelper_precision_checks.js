const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert(/const APP_VERSION = '\d{8}-\d+';/.test(html), 'APP_VERSION smoke check missing');
assert(/function resolveOrderUnitContract\(item\)/.test(html), 'unit contract resolver smoke check missing');
assert(/function actualCandidateCacheKey\(data = lastSfaCompareData\)/.test(html), 'actual-candidate cache smoke check missing');

const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g))
  .map(match => match[1])
  .join('\n');

function makeElement(id) {
  return {
    id,
    value: '',
    textContent: '',
    className: '',
    innerHTML: '',
    dataset: {},
    style: { setProperty() {} },
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; },
    },
    addEventListener() {},
    focus() {},
    blur() {},
    select() {},
    appendChild() {},
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { height: 52 }; },
    matches() { return false; },
  };
}

const elementMap = new Map();
const storage = new Map();
const session = new Map();
const documentStub = {
  body: makeElement('body'),
  documentElement: makeElement('html'),
  activeElement: null,
  getElementById(id) {
    if (!elementMap.has(id)) elementMap.set(id, makeElement(id));
    return elementMap.get(id);
  },
  querySelectorAll() { return []; },
  querySelector() { return null; },
  createElement(tag) { return makeElement(tag); },
  addEventListener() {},
};

documentStub.getElementById('orderDays').value = '3';

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval() {},
  Date,
  Math,
  Number,
  String,
  Array,
  Object,
  JSON,
  RegExp,
  Map,
  Set,
  URLSearchParams,
  TextEncoder,
  Uint8Array,
  location: { search: '', hostname: 'localhost' },
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
  },
  sessionStorage: {
    getItem(key) { return session.has(key) ? session.get(key) : null; },
    setItem(key, value) { session.set(key, String(value)); },
    removeItem(key) { session.delete(key); },
  },
  crypto: {
    randomUUID() { return 'test-device'; },
    subtle: { digest: async () => new Uint8Array(32).buffer },
  },
  navigator: {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    platform: 'Linux x86_64',
    language: 'ko-KR',
    maxTouchPoints: 0,
    geolocation: { getCurrentPosition() {} },
  },
  window: { addEventListener() {} },
  document: documentStub,
  fetch: async () => ({ ok: true, status: 200, json: async () => null, text: async () => '' }),
};

sandbox.window.document = documentStub;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.sessionStorage = sandbox.sessionStorage;
vm.createContext(sandbox);
vm.runInContext(`${scripts}
this.__OrderHelperApi = {
  MASTER,
  resolveOrderUnitContract,
  orderUnitResolutionText,
  recommendedOrderQty,
  outputOrderQty,
  displayOrderQty,
  currentCalcSnapshot,
  buildOrderSiteMatches,
  collectActualOrderCandidates,
  buildOrderAliasMatches,
  buildSfaAnalysisPayloadState,
  saveToFB,
  setEntriesForCheck(value) { entries = Array.isArray(value) ? value : []; touchCurrentStateRevision(); },
  setOverridesForCheck(value) { overrides = value && typeof value === 'object' ? value : {}; touchCurrentStateRevision(); },
  setDailySalesForCheck(value) { dailySales = Array.isArray(value) ? value : []; touchCurrentStateRevision(); },
  setBaseSalesForCheck(value) { baseSales = Number(value); touchCurrentStateRevision(); },
  setActualOrdersForCheck(value) { actualOrders = cleanActualOrders(value); touchCurrentStateRevision(); },
  setOrderDaysForCheck(value) { setOrderDaysValue(value); },
  setCompareDataForCheck(value) { setLastSfaCompareData(value || null); },
  setUsageHistoryForCheck(value) { usageHistory = value && typeof value === 'object' ? value : {}; touchUsageHistoryRevision(); },
  setSfaActualHistoryForCheck(value) { sfaActualHistory = value && typeof value === 'object' ? value : {}; touchSfaActualHistoryRevision(); },
  setAliasMappingsForCheck(value) { orderAliasMappings = sanitizeOrderAliasMappings(value); touchCurrentStateRevision(); },
  setUnitCorrectionsForCheck(value) { orderUnitCorrections = sanitizeOrderUnitCorrections(value); touchCurrentStateRevision(); },
};`, sandbox);

const api = sandbox.__OrderHelperApi;
;(async () => {
const sample = api.MASTER.find(item => item.unit) || api.MASTER[0];
const other = api.MASTER.find(item => item.name !== sample.name) || sample;

function cloneItem(unit) {
  return { ...sample, unit };
}

function makeCompareData(itemName, actualName = itemName, siteUnit = 'BOX', qty = 2, expectedNeed = 4, rowIndex = 1) {
  return {
    ok: true,
    savedAt: 1000,
    historySummary: { selectedDate: '20260712' },
    file: { name: 'fixture.xlsx' },
    items: [{ name: itemName, qty, unit: siteUnit, row_index: rowIndex }],
    comparison: {
      matched: [{
        row_index: rowIndex,
        sfa_name: actualName,
        sfa_qty: qty,
        sfa_unit: siteUnit,
        sfa_amount: 12000,
        expected_name: itemName,
        expected_stock_need: expectedNeed,
        score: 0.91,
      }],
      extra: [],
      missing: [],
    },
  };
}

function makeUsageHistory(stockNeed) {
  return {
    20260710: {
      savedAt: 1,
      dateKey: '20260710',
      entries: [{ name: sample.name, stock: stockNeed / 2 }],
      calc: { [sample.name]: { stockNeed, stock: stockNeed / 2 } },
    },
  };
}

function makeActualHistory(actualName) {
  return {
    20260710: {
      rows: [{
        expected_name: sample.name,
        sfa_name: actualName,
        sfa_qty: 5,
        sfa_unit: 'BOX',
        score: 0.97,
      }],
    },
  };
}

api.setEntriesForCheck([{ id: 'e1', name: sample.name, zone: '', stock: 1 }]);
api.setOverridesForCheck({});
api.setDailySalesForCheck([]);
api.setBaseSalesForCheck(280);
api.setOrderDaysForCheck(3);
api.setActualOrdersForCheck({});

const compareDataA = makeCompareData(sample.name, sample.name, 'BOX', 2, 4, 1);
const compareDataB = makeCompareData(other.name, other.name, 'BOX', 3, 6, 1);

api.setCompareDataForCheck(compareDataA);
api.setSfaActualHistoryForCheck(makeActualHistory(sample.name));
let actualCandidates1 = api.collectActualOrderCandidates(compareDataA);
assert(actualCandidates1.some(row => row.actualName === sample.name), 'actual candidate should include first comparison item');

api.setSfaActualHistoryForCheck(makeActualHistory(other.name));
let actualCandidates2 = api.collectActualOrderCandidates(compareDataA);
assert.notStrictEqual(actualCandidates1, actualCandidates2, 'same-length actual history change must invalidate candidate cache');
assert(actualCandidates2.some(row => row.actualName === other.name), 'actual candidate should update when history contents change');

const siteMatches = api.buildOrderSiteMatches(compareDataA);
assert.strictEqual(siteMatches.length, 1, 'duplicate menu/menu rows must collapse to one site match row');
assert.strictEqual(siteMatches[0].targetName, sample.name, 'new menu row should become immediately match eligible');

api.setCompareDataForCheck(compareDataB);
const aliasCompareData = {
  ok: true,
  savedAt: 2000,
  historySummary: { selectedDate: '20260710' },
  file: { name: 'fixture.xlsx' },
  items: [{ name: sample.name, qty: 2, unit: 'BOX', row_index: 1 }],
  comparison: { matched: [], extra: [], missing: [] },
};
api.setCompareDataForCheck(aliasCompareData);
api.setUsageHistoryForCheck(makeUsageHistory(10));
api.setSfaActualHistoryForCheck(makeActualHistory(sample.name));
let aliasRows1 = api.buildOrderAliasMatches(aliasCompareData);
const aliasRow1 = aliasRows1.find(row => row.aliasName === sample.name);
assert(aliasRow1, 'alias row should exist for the selected master item');
const aliasFactor1 = aliasRow1.conversionDefault?.factor ?? aliasRow1.conversionFactor ?? null;

api.setUsageHistoryForCheck(makeUsageHistory(15));
let aliasRows2 = api.buildOrderAliasMatches(aliasCompareData);
const aliasRow2 = aliasRows2.find(row => row.aliasName === sample.name);
assert.notStrictEqual(aliasRows1, aliasRows2, 'same-length usage-history change must invalidate alias cache');
assert.notStrictEqual(aliasFactor1, aliasRow2.conversionDefault?.factor ?? aliasRow2.conversionFactor ?? null, 'alias candidate must refresh when usage history contents change');

const entrySeed = api.MASTER.map((item, idx) => ({ id: `e${idx + 1}`, name: item.name, zone: '', stock: 0 }));
api.setEntriesForCheck(entrySeed);
api.setDailySalesForCheck([1, 1, 1]);
const calcFromEntriesA = api.currentCalcSnapshot(3);
const snapshotName = Object.keys(calcFromEntriesA)[0];
assert(snapshotName, 'current snapshot should contain at least one item');
const calcFromEntriesBSeed = entrySeed.map(entry => entry.name === snapshotName ? { ...entry, stock: 0.25 } : entry);
api.setEntriesForCheck(calcFromEntriesBSeed);
const calcFromEntriesB = api.currentCalcSnapshot(3);
const snapshotRowA = calcFromEntriesA[snapshotName];
const snapshotRowB = calcFromEntriesB[snapshotName];
assert(snapshotRowA && snapshotRowB, 'current snapshot row should exist across same-length entry replacement');
assert.notStrictEqual(snapshotRowA.stock, snapshotRowB.stock, 'same-length entry replacement must update the current snapshot');

api.setDailySalesForCheck([1, 100, 1]);
const calcFromSales = api.currentCalcSnapshot(3);
assert(calcFromSales[snapshotName], 'current snapshot row should exist across same-length dailySales replacement');
assert.notStrictEqual(snapshotRowB.stockNeed, calcFromSales[snapshotName].stockNeed, 'same-length dailySales replacement must update the current snapshot');

api.setOverridesForCheck({ [snapshotName]: { k: 1, l: 1 } });
const calcFromOverridesA = api.currentCalcSnapshot(3);
api.setOverridesForCheck({ [snapshotName]: { k: 2, l: 1 } });
const calcFromOverridesB = api.currentCalcSnapshot(3);
assert(calcFromOverridesA[snapshotName] && calcFromOverridesB[snapshotName], 'current snapshot row should exist across same-length override replacement');
assert.notStrictEqual(calcFromOverridesA[snapshotName].qty, calcFromOverridesB[snapshotName].qty, 'same-length override replacement must update the current snapshot');

api.setAliasMappingsForCheck({
  [sample.name]: {
    actualName: other.name,
    actualUnit: 'BOX',
    status: 'confirmed',
    conversionFactor: 2,
    conversionStatus: 'confirmed',
  },
});
const aliasRows3 = api.buildOrderAliasMatches(aliasCompareData);
const aliasRow3 = aliasRows3.find(row => row.aliasName === sample.name);
const aliasFactor3 = aliasRow3.savedConversionFactor ?? aliasRow3.effectiveConversionFactor ?? aliasRow3.conversionFactor ?? null;
api.setAliasMappingsForCheck({
  [sample.name]: {
    actualName: other.name,
    actualUnit: 'BOX',
    status: 'confirmed',
    conversionFactor: 3,
    conversionStatus: 'confirmed',
  },
});
const aliasRows4 = api.buildOrderAliasMatches(aliasCompareData);
const aliasRow4 = aliasRows4.find(row => row.aliasName === sample.name);
const aliasFactor4 = aliasRow4.savedConversionFactor ?? aliasRow4.effectiveConversionFactor ?? aliasRow4.conversionFactor ?? null;
assert.notStrictEqual(aliasRows3, aliasRows4, 'same-length alias mapping replacement must invalidate the alias match view');
assert.notStrictEqual(aliasFactor3, aliasFactor4, 'same-length alias mapping replacement must update the alias factor');

api.setAliasMappingsForCheck({});
api.setUnitCorrectionsForCheck({});
const noUnitItem = cloneItem('');
const sameUnitItem = cloneItem('BOX/BOX');
const packItem = cloneItem('BOX/EA');
const unresolved = api.resolveOrderUnitContract(noUnitItem);
assert.strictEqual(unresolved.resolved, false, 'missing units must remain unresolved');
assert.strictEqual(api.recommendedOrderQty(noUnitItem, 12), 0, 'missing units must suppress outgoing quantity');
assert(/단위/.test(api.orderUnitResolutionText(noUnitItem, unresolved)), 'missing units must explain the unresolved contract');

const sameContract = api.resolveOrderUnitContract(sameUnitItem);
assert.strictEqual(sameContract.resolved, true, 'equal nonempty units must resolve');
assert.strictEqual(sameContract.factor, 1, 'equal nonempty units must resolve to factor 1');
assert.strictEqual(api.recommendedOrderQty(sameUnitItem, 7.25), 7.3, 'factor 1 must preserve rounded fractional quantity');

api.setUnitCorrectionsForCheck({ [sample.name]: { factor: 2.5, orderMultiple: 0.5, minOrderQty: 1.5 } });
assert.strictEqual(api.recommendedOrderQty(packItem, 3.1), 1.5, 'manual factor must preserve fractional quantity with pack and minimum rounding');

api.setUnitCorrectionsForCheck({});
api.setAliasMappingsForCheck({
  [sample.name]: {
    actualName: other.name,
    actualUnit: 'BOX',
    status: 'confirmed',
    conversionFactor: 2,
    conversionStatus: 'confirmed',
  },
});
const staleItem = cloneItem('EA/EA2');
const staleContract = api.resolveOrderUnitContract(staleItem);
assert.strictEqual(staleContract.resolved, false, 'conflicting unit metadata must stay unresolved');
assert.strictEqual(staleContract.source, 'stale', 'conflicting unit metadata must be marked stale');

api.setActualOrdersForCheck({ [sample.name]: 0 });
assert.strictEqual(api.outputOrderQty(sameUnitItem, 3), 0, 'zero actual orders must be preserved');
assert.strictEqual(api.displayOrderQty(sameUnitItem, 3), '0', 'display output must preserve zero actual orders');
api.setActualOrdersForCheck({});

api.setAliasMappingsForCheck({});
api.setUsageHistoryForCheck(makeUsageHistory(10));
api.setSfaActualHistoryForCheck(makeActualHistory(sample.name));
api.setCompareDataForCheck(aliasCompareData);
api.setUnitCorrectionsForCheck({});
api.setAliasMappingsForCheck({});
api.setActualOrdersForCheck({});
const calcSnapshot = api.currentCalcSnapshot(3);
const expectedQty = api.outputOrderQty(sample, 3);
assert.strictEqual(calcSnapshot[sample.name].qty, expectedQty, 'current snapshot qty must equal the outgoing quantity');
assert.strictEqual(api.buildSfaAnalysisPayloadState(aliasCompareData).calc[sample.name].qty, expectedQty, 'saved no-publish payload must equal the outgoing quantity');

const captured = [];
const stubFetch = async (url, opts = {}) => {
  captured.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
  return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
};
sandbox.fetch = stubFetch;
sandbox.loadUsageHistory = async () => {};
sandbox.renderSaveState = () => {};
sandbox.pushSaveLog = () => {};
sandbox.toast = () => {};
sandbox.render = () => {};
sandbox.scheduleAutoSave = () => {};
documentStub.getElementById('orderDays').value = '3';

await api.saveToFB('test');
assert.strictEqual(captured.length, 2, 'saveToFB must issue current and history writes only');
captured.forEach(entry => {
  assert.strictEqual(entry.body.calc[sample.name].qty, expectedQty, 'save payload qty must match outgoing quantity');
});

api.setSfaActualHistoryForCheck(makeActualHistory(other.name));
assert.strictEqual(api.buildOrderSiteMatches(compareDataB).length, 1, 'new menu must not create duplicate match rows');
assert(api.collectActualOrderCandidates(compareDataB).some(row => row.actualName === other.name), 'new menu must be immediately eligible after same-length refresh');

console.log('OrderHelper runtime precision checks OK');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
