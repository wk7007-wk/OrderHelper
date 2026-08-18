#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_CONSTITUTION_SHA = '8cd45de2922894fe2be8b8e7424fe91cc490ec20d2ec9cea0a60164fcf21a575';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verifyConstitutionBaseline() {
  const receipt = JSON.parse(fs.readFileSync(path.join(ROOT, 'ORDERHELPER_CONSTITUTION_RECEIPT.json'), 'utf8'));
  assert.strictEqual(receipt.constitution.sha256, EXPECTED_CONSTITUTION_SHA);
  assert.strictEqual(sha256(path.join(ROOT, receipt.constitution.path)), EXPECTED_CONSTITUTION_SHA);
  assert.strictEqual(sha256(path.join(ROOT, receipt.promptEvidence.path)), receipt.promptEvidence.sha256);
  assert.strictEqual(receipt.repositoryBaseline, 'b032da2aede30fb3954c66fc68bb8aecb76798b7');
}

verifyConstitutionBaseline();

const Master = require(path.join(ROOT, 'v2', 'master-data.js'));
const V2 = require(path.join(ROOT, 'v2', 'orderhelper-v2.js'));

assert.strictEqual(Master.MASTER_ITEMS.length, 88, 'MASTER static facts must remain complete');
assert.strictEqual(new Set(Master.MASTER_ITEMS.map(item => item.itemKey)).size, 88, 'itemKey must be unique');

assert.strictEqual(V2.recommendedOrderDays(4), 4);
assert.strictEqual(V2.recommendedOrderDays(5), 4);
for (const day of [0, 1, 2, 3, 6]) assert.strictEqual(V2.recommendedOrderDays(day), 3);

assert.strictEqual(V2.parseDraftNumber(''), null);
assert.strictEqual(V2.parseDraftNumber(null), null);
assert.strictEqual(V2.parseDraftNumber('0'), 0);
assert.strictEqual(V2.parseDraftNumber('0.25'), 0.25);

assert.deepStrictEqual(
  V2.salesWeights({ dailySales: ['', 0, 560], orderDays: 3, baseSales: 280 }),
  [1, 0, 2],
  'blank sales is weight 1 while explicit zero is weight 0'
);

const belowFirstDay = V2.calculateOrder({
  stockTotal: 1,
  buffer: 0.5,
  dailyUsage: 2,
  orderDays: 3,
  dailySales: ['', '', ''],
  baseSales: 280,
  orderUnitToStockFactor: 1,
  sameUnit: true,
  hidden: false,
});
assert.strictEqual(belowFirstDay.stockNeed, 4.5, 'E<M keeps Excel SUM-M+K meaning');
assert.strictEqual(belowFirstDay.recommendedOrderQty, 4.5);

const afterFirstDay = V2.calculateOrder({
  stockTotal: 3,
  buffer: 0.5,
  dailyUsage: 2,
  orderDays: 3,
  dailySales: ['', '', ''],
  baseSales: 280,
  orderUnitToStockFactor: 1,
  sameUnit: true,
  hidden: false,
});
assert.strictEqual(afterFirstDay.stockNeed, 3.5, 'E>=M keeps Excel SUM-E+K meaning');

const missingStock = V2.calculateOrder({
  stockTotal: null,
  buffer: 1,
  dailyUsage: 2,
  orderDays: 3,
  dailySales: [],
  orderUnitToStockFactor: 1,
  sameUnit: true,
});
assert.strictEqual(missingStock.stockNeed, null, 'missing stock must not be coerced to zero');
assert.strictEqual(missingStock.recommendedOrderQty, null);

const explicitZeroStock = V2.calculateOrder({
  stockTotal: 0,
  buffer: 1,
  dailyUsage: 2,
  orderDays: 3,
  dailySales: [],
  orderUnitToStockFactor: 1,
  sameUnit: true,
});
assert.strictEqual(explicitZeroStock.stockNeed, 5, 'explicit stock zero remains calculable evidence');

const weighted = V2.calculateOrder({
  stockTotal: 2,
  buffer: 0,
  dailyUsage: 2,
  orderDays: 3,
  dailySales: ['', 0, 280],
  baseSales: 280,
  orderUnitToStockFactor: 1,
  sameUnit: true,
});
assert.strictEqual(weighted.stockNeed, 2);

assert.strictEqual(V2.roundUpTenth(2.01), 2.1);
assert.strictEqual(V2.orderQtyForStockNeed(25, 10, false), 3, 'factor direction is stock need divided by factor');
assert.strictEqual(V2.stockQtyForOrderQty(2, 10), 20, 'two order units at factor ten means twenty stock units');

const hidden = V2.calculateOrder({
  stockTotal: 0,
  buffer: 10,
  dailyUsage: 10,
  orderDays: 4,
  orderUnitToStockFactor: 1,
  sameUnit: true,
  hidden: true,
});
assert.strictEqual(hidden.stockNeed, 0);
assert.strictEqual(hidden.recommendedOrderQty, 0);

const convertedWithoutFactor = V2.calculateOrder({
  stockTotal: 0,
  buffer: 1,
  dailyUsage: 1,
  orderDays: 3,
  orderUnitToStockFactor: null,
  sameUnit: false,
});
assert.strictEqual(convertedWithoutFactor.recommendedOrderQty, null);
assert(convertedWithoutFactor.issues.includes('UNIT_UNCONFIRMED'));

const fixtureMaster = Master.MASTER_ITEMS.slice(0, 2);
const model = V2.createModel({ masterItems: fixtureMaster, now: new Date('2026-07-27T12:00:00+09:00') });
const beforeRows = model.getCanonicalRows();
const beforeMetrics = model.getMetrics();
const targetEntryKey = beforeRows[0].entries[0].entryKey;
const untouchedRow = beforeRows[1];
const changed = model.updateEntryField(targetEntryKey, 'stock', '0');
const afterRows = model.getCanonicalRows();
const afterMetrics = model.getMetrics();
assert.strictEqual(changed.stockTotal, 0);
assert.notStrictEqual(afterRows[0], beforeRows[0], 'changed row is resolved again');
assert.strictEqual(afterRows[1], untouchedRow, 'unrelated row object is preserved');
assert.strictEqual(afterMetrics.fullResolveCount, beforeMetrics.fullResolveCount, 'input does not resolve full table');
assert.strictEqual(afterMetrics.rowResolveCount, beforeMetrics.rowResolveCount + 1, 'input resolves exactly one row');

model.addEntry(fixtureMaster[0].itemKey, { entryKey: 'extra-zone-entry', zone: '창고', stock: '0.25' });
const multiZone = model.getRow(fixtureMaster[0].itemKey);
assert.strictEqual(multiZone.stockTotal, 0.25, 'multi-zone stock aggregates explicit zero and decimal values');

const salesModel = V2.createModel({ masterItems: fixtureMaster, now: new Date('2026-07-27T12:00:00+09:00') });
const salesEntryKey = salesModel.getCanonicalRows()[0].entries[0].entryKey;
salesModel.updateEntryField(salesEntryKey, 'stock', '1');
assert.strictEqual(salesModel.getRow(fixtureMaster[0].itemKey).stockNeed, 4.2);
salesModel.setDailySales(0, '560');
assert.strictEqual(salesModel.getRow(fixtureMaster[0].itemKey).stockNeed, 4.7, 'day-1 560 updates the resolver immediately');
salesModel.setDailySales(0, '0');
assert.strictEqual(salesModel.getRow(fixtureMaster[0].itemKey).stockNeed, 3.7, 'explicit sales zero differs from blank');
salesModel.setDailySales(0, '');
assert.strictEqual(salesModel.getState().dailySales[0], null, 'blank daily sales remains null');
salesModel.setBaseSales('560');
salesModel.setDailySales(0, '560');
assert.strictEqual(salesModel.getRow(fixtureMaster[0].itemKey).stockNeed, 4.2, 'base sales updates the same resolver');

const firstItemKey = fixtureMaster[0].itemKey;
const defaultEntryKey = `entry_${firstItemKey}_0`;
const stamp = { epoch: 0, counter: 10, actorId: 'test.actor' };
const canonicalFixture = {
  collections: {
    entries: {
      [defaultEntryKey]: {
        itemKey: { value: firstItemKey, tombstone: false, stamp },
        zone: { value: '주방', tombstone: false, stamp },
        stock: { value: 1, tombstone: false, stamp },
      },
      'extra-zone-reload': {
        itemKey: { value: firstItemKey, tombstone: false, stamp },
        zone: { value: '창고', tombstone: false, stamp },
        stock: { value: 0.25, tombstone: false, stamp },
      },
    },
    usage: {},
    sales: {
      base: { amount: { value: 280, tombstone: false, stamp } },
      'day-1': { amount: { value: 0, tombstone: false, stamp } },
    },
    settings: {
      order: { days: { value: 3, tombstone: false, stamp } },
      [`item:${firstItemKey}`]: { hiddenUntil: { value: Date.now() + 60_000, tombstone: false, stamp } },
    },
  },
};
const hydratedModel = V2.createModel({ masterItems: fixtureMaster });
hydratedModel.hydrateCanonicalDocument(canonicalFixture);
const hydratedRow = hydratedModel.getRow(firstItemKey);
assert.strictEqual(hydratedRow.entries.length, 2, 'canonical hydrate upserts every zone entry');
assert.strictEqual(hydratedRow.stockTotal, 1.25, 'canonical hydrate preserves aggregate stock');
assert.strictEqual(hydratedRow.hidden, true);
assert.strictEqual(hydratedRow.stockNeed, 0);
assert.strictEqual(hydratedModel.getState().dailySales[0], 0, 'hydrate preserves explicit sales zero');

const tombstoneFixture = JSON.parse(JSON.stringify(canonicalFixture));
tombstoneFixture.collections.entries[defaultEntryKey].stock = { tombstone: true, stamp };
tombstoneFixture.collections.entries['extra-zone-reload'].itemKey = { tombstone: true, stamp };
tombstoneFixture.collections.settings[`item:${firstItemKey}`].hiddenUntil = { tombstone: true, stamp };
const tombstoneModel = V2.createModel({ masterItems: fixtureMaster });
tombstoneModel.hydrateCanonicalDocument(tombstoneFixture);
const tombstoneRow = tombstoneModel.getRow(firstItemKey);
assert.strictEqual(tombstoneRow.entries.length, 1, 'default entry remains structural while a tombstoned extra entry is removed');
assert.strictEqual(tombstoneRow.stockTotal, null, 'default stock tombstone restores missing stock rather than zero');
assert.strictEqual(tombstoneRow.hiddenUntil, null, 'hidden tombstone is distinct from explicit false');

const batchModel = V2.createModel({ masterItems: fixtureMaster, now: new Date('2026-07-27T12:00:00+09:00') });
const batchBefore = batchModel.getMetrics();
batchModel.updateSalesInputs({ baseSales: '560', dailySales: { 0: '560', 1: '0', 2: '', 3: '280' } });
const batchAfter = batchModel.getMetrics();
assert.strictEqual(
  batchAfter.fullResolveCount,
  batchBefore.fullResolveCount + 1,
  'one coalesced sales patch resolves the table exactly once'
);
assert.deepStrictEqual(batchModel.getState().dailySales.slice(0, 4), [560, 0, null, 280]);

let fakeNow = 1_000;
const expiryModel = V2.createModel({ masterItems: fixtureMaster, now: () => fakeNow });
expiryModel.setOrderDays(3);
const expiryItemKey = fixtureMaster[0].itemKey;
const expiryEntryKey = expiryModel.getRow(expiryItemKey).entries[0].entryKey;
expiryModel.updateEntryField(expiryEntryKey, 'stock', 0);
expiryModel.setHidden(expiryItemKey, 2_000);
assert.strictEqual(expiryModel.getRow(expiryItemKey).hidden, true);
assert.strictEqual(expiryModel.getRow(expiryItemKey).stockNeed, 0);
fakeNow = 2_001;
const expiredRows = expiryModel.refreshExpiredHidden();
assert.deepStrictEqual(expiredRows.map(row => row.itemKey), [expiryItemKey]);
assert.strictEqual(expiryModel.getRow(expiryItemKey).hidden, false, 'advancing injected clock expires hidden state without reload');
assert.strictEqual(expiryModel.getRow(expiryItemKey).stockNeed, 4.7);

const v2Index = fs.readFileSync(path.join(ROOT, 'v2', 'index.html'), 'utf8');
assert(!/firebase|fetch\s*\(|XMLHttpRequest|WebSocket/i.test(v2Index), 'foundation index must have no network/Firebase path');
assert(!/\son(?:click|input|change|keydown|keyup|submit)\s*=/i.test(v2Index), 'foundation uses delegated listeners, not inline handlers');

console.log('orderhelper_v2_calculation: PASS');
