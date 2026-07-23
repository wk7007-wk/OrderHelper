const assert = require('assert');
const { api, plain } = require('./orderhelper_static_checks.js');

const newerInventoryWithStaleSales = {
  savedAt: 300,
  stateRevision: 300,
  inventoryRevision: 300,
  salesRevision: 100,
  entries: [{ id: 'local-stock', name: api.MASTER[0].name, stock: 4 }],
  dailySales: [270, 270, 270, 270],
  baseSales: 270,
  salesWeights: [1, 1, 1, 1],
};
const olderInventoryWithNewerSales = {
  savedAt: 200,
  stateRevision: 200,
  inventoryRevision: 200,
  salesRevision: 200,
  entries: [{ id: 'remote-stock', name: api.MASTER[0].name, stock: 1 }],
  dailySales: [320, 330, 340, 350],
  baseSales: 280,
  salesWeights: [1.143, 1.179, 1.214, 1.25],
};

const inventoryWins = plain(api.mergeFirebasePayloadLedger(
  olderInventoryWithNewerSales,
  newerInventoryWithStaleSales
));
assert.strictEqual(inventoryWins.entries[0].id, 'local-stock', 'newer inventory state must still win the general merge');
assert.deepStrictEqual(inventoryWins.dailySales, [320, 330, 340, 350], 'newer sales revision must survive a later inventory save');
assert.strictEqual(inventoryWins.baseSales, 280, 'base expected sales must use the same field-level winner');
assert.strictEqual(inventoryWins.salesRevision, 200, 'merged payload must retain the winning sales revision');

const newerRemoteInventory = {
  ...newerInventoryWithStaleSales,
  savedAt: 500,
  stateRevision: 500,
  inventoryRevision: 500,
};
const newerLocalSales = {
  ...olderInventoryWithNewerSales,
  savedAt: 400,
  stateRevision: 400,
  salesRevision: 600,
  dailySales: [410, 420, 430, 440],
};
const salesWins = plain(api.mergeFirebasePayloadLedger(newerRemoteInventory, newerLocalSales));
assert.strictEqual(salesWins.entries[0].id, 'local-stock', 'newer remote inventory must remain authoritative');
assert.deepStrictEqual(salesWins.dailySales, [410, 420, 430, 440], 'newer local expected sales must merge independently');
assert.strictEqual(api.firebaseSalesPayloadIsNewer(newerRemoteInventory, newerLocalSales), false, 'field-level sales revision must outrank whole-state recency');

const legacyPayload = {
  savedAt: 900,
  stateRevision: 900,
  inventoryRevision: 900,
  dailySales: [999],
  baseSales: 999,
};
assert.strictEqual(
  api.firebaseSalesPayloadIsNewer(legacyPayload, newerLocalSales),
  false,
  'an old client without a sales revision must not overwrite revisioned expected sales'
);

console.log('OrderHelper expected-sales sync regression OK');
