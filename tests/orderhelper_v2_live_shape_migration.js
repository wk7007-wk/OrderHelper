'use strict';

const assert = require('assert');
const Sync = require('../sync/order-sync-v2.js');

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

function valueAt(document, collection, key, field) {
  return document.collections[collection][key][field].value;
}

const itemCount = 91;
const entries = [];
const inventoryByItemKey = {};
const overrides = {};
for (let index = 0; index < itemCount; index += 1) {
  const name = `품목-${index}`;
  const itemKey = `item_${encodeURIComponent(name)}`;
  const entryKey = `e${index + 1}`;
  entries.push({ id: entryKey, entryKey, itemKey, name, zone: `구역-${index % 8}`, stock: index % 5 === 0 ? 0 : null });
  inventoryByItemKey[itemKey] = { itemKey, name, entries: [{ entryKey, zone: `구역-${index % 8}` }] };
  overrides[name] = { k: index / 10, l: index / 20 };
}
for (let index = 0; index < 19; index += 1) {
  const name = `품목-${index}`;
  entries.push({ id: `extra-${index}`, entryKey: `extra-${index}`, itemKey: `item_${encodeURIComponent(name)}`, name, zone: '추가구역', stock: index });
}

const bulkyCandidate = '후보근거'.repeat(300);
const aliasDrafts = Array.from({ length: itemCount }, (_, index) => ({
  aliasName: `별명-${index}`,
  actualName: `실발주-${index}`,
  status: index === 0 ? 'confirmed' : index === 1 ? 'manual' : index === 2 ? 'unlinked' : 'default',
  orderUnitToStockFactor: 1,
  conversionCandidates: [{ reason: bulkyCandidate }],
  reason: bulkyCandidate,
}));

const legacy = {
  dateKey: '20260803',
  orderDays: 3,
  zoneOrder: ['주방', '창고'],
  entries,
  inventoryByItemKey,
  overrides,
  orderSiteMappings: { site: { targetName: '품목-0' } },
  orderAliasMappings: { '품목-0': { actualName: '실발주-0', status: 'confirmed' } },
  orderAliasMappingDrafts: aliasDrafts,
  orderUnitCorrections: { '품목-0': { orderUnitToStockFactor: 10 } },
  orderManualItems: [{ itemKey: 'manual-one', name: '수동품목' }],
  dailySales: [0, 270, null],
  baseSales: 0,
  effectiveOrderAliasMappings: { derived: bulkyCandidate },
  calc: { derived: bulkyCandidate },
  debugLogs: [bulkyCandidate],
  aiUsageEvidence: { derived: bulkyCandidate },
  sfaAnalysisReadModel: { derived: bulkyCandidate },
  sfaOrderLedger: { version: 2, records: [{ sourceTable: 'x'.repeat(2 * 1024 * 1024) }] },
};

const actor = Sync.createActor(memoryStorage(), { actorId: 'migration.audit' });
const result = Sync.migrateLegacyPayload(legacy, actor);
const document = result.document;
assert.strictEqual(result.status, 'migrated');
assert.strictEqual(Object.keys(document.collections.entries).length, 110, 'all stable multi-zone entries must survive migration');
assert.strictEqual(Object.keys(document.collections.inventory).length, 0, 'derived keyed inventory must not duplicate explicit entries');
assert.strictEqual(valueAt(document, 'entries', 'extra-0', 'itemKey'), 'item_%ED%92%88%EB%AA%A9-0');
assert.strictEqual(valueAt(document, 'entries', 'e1', 'stock'), 0, 'explicit zero stock must survive');
assert.strictEqual(valueAt(document, 'usage', 'item_%ED%92%88%EB%AA%A9-0', 'buffer'), 0);
assert.strictEqual(valueAt(document, 'settings', 'order', 'days'), 3);
assert.deepStrictEqual(valueAt(document, 'zones', 'order', 'value'), ['주방', '창고']);
assert.strictEqual(valueAt(document, 'sales', 'base', 'amount'), 0);
assert.strictEqual(valueAt(document, 'sales', 'day-1', 'amount'), 0);
const mappingRows = Object.entries(document.collections.mappings);
assert.strictEqual(mappingRows.length, 6, 'each user mapping must have its own merge row');
const aliasDraftRows = mappingRows.filter(([key]) => Sync.mappingIdentityFromRowKey(key).namespace === 'aliasDrafts');
assert.strictEqual(aliasDraftRows.length, 3, 'only user decisions belong in canonical alias drafts');
const siteRow = mappingRows.find(([key]) => {
  const identity = Sync.mappingIdentityFromRowKey(key);
  return identity.namespace === 'site' && identity.sourceKey === 'site';
});
const aliasRow = mappingRows.find(([key]) => {
  const identity = Sync.mappingIdentityFromRowKey(key);
  return identity.namespace === 'alias' && identity.sourceKey === '품목-0';
});
assert(siteRow && aliasRow, 'site and alias mappings must retain their source identities');
assert.strictEqual(siteRow[1].targetName.value, '품목-0');
assert.strictEqual(aliasRow[1].actualName.value, '실발주-0');
assert.strictEqual(Object.keys(document.collections.manualItems).length, 1);
const canonicalText = JSON.stringify(document);
['sfaOrderLedger', 'effectiveOrderAliasMappings', 'debugLogs', bulkyCandidate].forEach(forbidden => {
  assert.strictEqual(canonicalText.includes(forbidden), false, `derived evidence must stay outside canonical: ${forbidden.slice(0, 24)}`);
});
assert(Sync.canonicalByteSize(document) < Sync.MAX_CANONICAL_BYTES, 'realistic live shape must fit the bounded canonical path');
assert(Sync.canonicalByteSize(document) < 256 * 1024, 'canonical must remain materially smaller than the legacy current payload');

const phoneActor = Sync.createActor(memoryStorage(), { actorId: 'phone.mapping' });
const pcActor = Sync.createActor(memoryStorage(), { actorId: 'pc.mapping' });
const phoneEdit = Sync.writeFields(document, phoneActor, 'mappings', siteRow[0], { targetName: '폰-수정' });
const pcEdit = Sync.writeFields(document, pcActor, 'mappings', siteRow[0], { siteUnit: 'PC-수정' });
const merged = Sync.mergeDocuments(phoneEdit, pcEdit).document;
assert.strictEqual(valueAt(merged, 'mappings', siteRow[0], 'targetName'), '폰-수정');
assert.strictEqual(valueAt(merged, 'mappings', siteRow[0], 'siteUnit'), 'PC-수정');
assert.strictEqual(valueAt(merged, 'mappings', aliasRow[0], 'actualName'), '실발주-0', 'unrelated mapping rows must survive');
assert.throws(
  () => Sync.writeFields(document, phoneActor, 'entries', 'unsafe/key', { stock: 1 }),
  /invalid Firebase row key/,
  'invalid RTDB keys must fail locally instead of breaking a remote flush'
);
assert.throws(
  () => Sync.writeFields(document, phoneActor, 'settings', 'safe', { value: { 'unsafe/key': true } }),
  /invalid Firebase nested field key/,
  'invalid nested RTDB keys must also fail before a remote flush'
);

console.log(`PASS OrderHelper v2 live-shape migration: entries=110 bytes=${Sync.canonicalByteSize(document)}`);
