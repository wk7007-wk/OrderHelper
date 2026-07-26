const assert = require('assert');
const { api, plain } = require('./orderhelper_static_checks.js');

const item = api.MASTER[0];
const currentRemote = {
  savedAt: 9000,
  stateRevision: 9000,
  inventoryRevision: 9000,
  salesRevision: 12000,
  entries: [{ id: 'pc-row', name: item.name, zone: 'PC', stock: 99 }],
  zoneOrder: ['PC'],
  overrides: { [item.name]: { k: 99, l: 99 } },
  orderManualItems: [{ name: 'PC only' }],
  dailySales: [999],
  baseSales: 999,
  sfaOrderLedger: { version: 2, eventCount: 0, records: [] },
};
const historyRemote = {
  ...currentRemote,
  savedAt: 10000,
  stateRevision: 10000,
  inventoryRevision: 10000,
};
const phoneLocal = {
  savedAt: 100,
  stateRevision: 100,
  inventoryRevision: 100,
  salesRevision: 100,
  dateKey: '20260727',
  entries: [{ id: 'phone-row', name: item.name, zone: '폰', stock: 0 }],
  zoneOrder: [],
  overrides: {},
  orderSiteMappings: {},
  orderAliasMappings: {},
  orderUnitCorrections: {},
  orderManualItems: [],
  dailySales: [0, 270, null],
  baseSales: 0,
  sfaOrderLedger: { version: 2, eventCount: 0, records: [] },
};

const merged = plain(api.buildPhoneWinsPayload(currentRemote, historyRemote, phoneLocal, 11000, 'phone-resolution-test'));
assert.strictEqual(merged.entries[0].id, 'phone-row', 'phone inventory must replace newer PC inventory after explicit recovery');
assert.strictEqual(merged.entries[0].stock, 0, 'explicit zero stock must survive phone-wins recovery');
assert.deepStrictEqual(merged.zoneOrder, [], 'an intentional empty phone array must not fall back to PC data');
assert.deepStrictEqual(merged.overrides, {}, 'an intentional empty phone object must not fall back to PC overrides');
assert.deepStrictEqual(merged.orderManualItems, [], 'removed phone manual items must stay removed');
assert.deepStrictEqual(merged.dailySales, [0, 270, null], 'phone expected-sales values, including zero and null, must win');
assert.strictEqual(merged.baseSales, 0, 'an explicit zero base sales value must survive');
assert(merged.stateRevision > historyRemote.stateRevision, 'state revision must advance beyond both remote copies');
assert(merged.salesRevision > currentRemote.salesRevision, 'sales revision must advance beyond a newer remote field revision');
assert.strictEqual(merged.syncResolution.id, 'phone-resolution-test');
assert.strictEqual(merged.syncResolution.mode, 'phone_overwrite_pc');
assert.strictEqual(merged.syncResolution.source, 'explicit_user_phone');

console.log('OrderHelper phone-wins sync regression OK');
