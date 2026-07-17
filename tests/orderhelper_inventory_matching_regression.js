const assert = require('assert');
const { api, storage, plain, sandbox } = require('./orderhelper_static_checks.js');

const canonicalName = 'BBQ양념치킨소스';
api.setEntriesForCheck([
  { id: 'zone-shared', name: 'BBQ시크릿양념소스(주방용)', zone: '주방', stock: 0 },
  { id: 'zone-shared', name: canonicalName, zone: '창고', stock: 3.5 },
  { id: 'zone-empty', name: canonicalName, zone: '보조', stock: '' },
]);

const entries = plain(api.entriesForCheck());
assert.strictEqual(entries.length, 3, 'canonical-name migration must keep every duplicate-zone inventory row');
assert.strictEqual(new Set(entries.map(row => row.entryKey)).size, 3, 'duplicate/missing row identities must be repaired without dropping rows');
assert(entries.every(row => row.itemKey === api.itemKeyForName(canonicalName)), 'legacy and canonical names must resolve to one stable item key');
assert.strictEqual(api.totalStockForCheck(canonicalName), 3.5, 'input stock must equal the output aggregate for the same item key');

const keyed = plain(api.inventoryByItemKeyForPayload())[api.itemKeyForName(canonicalName)];
assert.strictEqual(keyed.total, 3.5, 'local/current keyed inventory total must match the output calculation');
assert(keyed.entries.some(row => row.stock === 0), 'explicit zero stock must survive local/current serialization');
assert(keyed.entries.some(row => row.stock === null), 'blank stock must remain blank instead of becoming zero');
api.setEntriesForCheck([{ id: 'blank-only', name: canonicalName, zone: '주방', stock: '' }]);
assert.strictEqual(api.totalStockForCheck(canonicalName), 0, 'blank stock must remain zero only for calculation compatibility');
assert.strictEqual(api.displayStockTotalForCheck(canonicalName), null, 'output inventory cell must stay blank when every input zone is blank');
assert.strictEqual(plain(api.inventoryByItemKeyForPayload())[api.itemKeyForName(canonicalName)].total, null, 'current/history keyed read model must preserve an all-blank inventory total');
api.setEntriesForCheck(entries);

const legacyRectangularName = '직사각용기1(190,감자),2(230,치즈스틱)';
const rectangularOne = '직사각용기1(190,감자)';
const rectangularTwo = '직사각용기2(230,치즈스틱)';
api.setEntriesForCheck([{ id: 'legacy-rect', name: legacyRectangularName, zone: '창고', stock: 1 }]);
const migratedRectangularEntries = plain(api.entriesForCheck());
assert.deepStrictEqual(
  migratedRectangularEntries.map(row => [row.name, row.zone, row.stock]),
  [[rectangularOne, '창고', 1]],
  'legacy combined container stock must migrate once to item 1 without duplicating it into item 2'
);
assert(api.MASTER.some(item => item.name === rectangularOne), 'rectangular container 1 must remain an independent master item');
assert(api.MASTER.some(item => item.name === rectangularTwo), 'rectangular container 2 must be added as an independent master item');
api.setEntriesForCheck(entries);

api.setAliasMappingsForCheck({});
const rectangularAliasRows = api.buildOrderAliasMatches({
  items: [
    { name: 'BBQ직사각용기1호', qty: 1, unit: 'BOX', amount: 15620, row_index: 401 },
    { name: 'BBQ직사각용기2호', qty: 1, unit: 'BOX', amount: 13420, row_index: 402 },
  ],
  comparison: {
    matched: [
      { row_index: 401, sfa_name: 'BBQ직사각용기1호', sfa_qty: 1, sfa_unit: 'BOX', sfa_amount: 15620, expected_name: legacyRectangularName, score: 0.99 },
      { row_index: 402, sfa_name: 'BBQ직사각용기2호', sfa_qty: 1, sfa_unit: 'BOX', sfa_amount: 13420, expected_name: legacyRectangularName, score: 0.99 },
    ],
    missing: [],
    extra: [],
  },
});
assert.strictEqual(rectangularAliasRows.find(row => row.aliasName === rectangularOne).actualName, 'BBQ직사각용기1호', 'container 1 must select only the number-1 actual order name');
assert.strictEqual(rectangularAliasRows.find(row => row.aliasName === rectangularTwo).actualName, 'BBQ직사각용기2호', 'container 2 must select only the number-2 actual order name');

const rawA = { name: '같은 이름(대)', unit: 'BOX', qty: 0, row_index: 201 };
const rawB = { name: '같은이름', unit: 'BOX', qty: 1, row_index: 202 };
assert.strictEqual(api.normalizeSiteItemName(rawA.name), api.normalizeSiteItemName(rawB.name), 'fixture must reproduce a normalized-name collision');
assert.notStrictEqual(api.orderSiteItemKey(rawA), api.orderSiteItemKey(rawB), 'raw identities must still receive distinct persisted keys');

api.setManualItemsForCheck([]);
api.setSiteMappingsForCheck({});
api.setAliasMappingsForCheck({});
const sameNameTarget = '물티슈(500)';
api.applyExplicitSiteMappingForCheck(api.orderSiteItemKey(rawA), sameNameTarget, sameNameTarget, 'BOX', 'confirmed');
const mappings = plain(api.getSiteMappingsForCheck());
const aliases = plain(api.getAliasMappingsForCheck());
assert.strictEqual(mappings[api.orderSiteItemKey(rawA)].targetName, sameNameTarget, 'explicit same-name selection must persist to orderSiteMappings');
assert.strictEqual(aliases[sameNameTarget].actualName, sameNameTarget, 'explicit same-name selection must create the alias record too');
assert.strictEqual(aliases[sameNameTarget].status, 'confirmed', 'only the explicit user selection may mark the same-name alias confirmed');

api.setLocalNewSourceAliasesForCheck({});
const newRawSource = { name: 'BBQ치즈볼', unit: 'BOX', qty: 0, row_index: 301 };
const newRawData = { items: [newRawSource], comparison: { matched: [], missing: [], extra: [] } };
let newRawMatch = api.buildOrderSiteMatches(newRawData)[0];
assert.strictEqual(newRawMatch.targetName, '', 'new raw source must not auto-confirm a fuzzy/exact local candidate');
assert.strictEqual(newRawMatch.isNewSource, true, 'mapping-absent order source must be surfaced as new');
assert.strictEqual(newRawMatch.siteQty, 0, 'new-source review must preserve explicit zero quantity');
assert(newRawMatch.newSourceCandidates.some(row => row.name === '냉동-치즈볼-BBQ치즈볼(크림)'), 'new source must still expose canonical suggestions');
const existingMappingSnapshot = plain(api.getSiteMappingsForCheck());
assert.strictEqual(api.confirmNewSourceAliasMapping(newRawMatch.siteKey, '', newRawMatch.siteName, newRawMatch.siteUnit), false, 'empty new-source target must fail closed');
assert.strictEqual(api.confirmNewSourceAliasMapping(newRawMatch.siteKey, '없는 품목', newRawMatch.siteName, newRawMatch.siteUnit), false, 'unknown new-source target must fail closed');
assert.deepStrictEqual(plain(api.getSiteMappingsForCheck()), existingMappingSnapshot, 'invalid new-source confirmation must preserve existing mappings');
const confirmedNewTarget = '냉동-치즈볼-BBQ치즈볼(크림)';
assert.strictEqual(api.confirmNewSourceAliasMapping(newRawMatch.siteKey, confirmedNewTarget, newRawMatch.siteName, newRawMatch.siteUnit), true, 'explicit canonical selection must save the new raw alias');
const storedNewSourceAliases = JSON.parse(storage.get('bbq_local_new_source_aliases_v1'));
assert.strictEqual(storedNewSourceAliases[newRawMatch.siteKey].targetName, confirmedNewTarget, 'new raw alias must persist in the local overlay');
assert.strictEqual(api.getSiteMappingsForCheck()[api.orderSiteItemKey(rawA)].targetName, sameNameTarget, 'saving a new raw alias must preserve existing mappings');
api.setSiteMappingsForCheck(existingMappingSnapshot);
api.setLocalNewSourceAliasesForCheck(storedNewSourceAliases);
api.setSiteMappingsForCheck(api.mergeLocalNewSourceAliases(api.getSiteMappingsForCheck()));
newRawMatch = api.buildOrderSiteMatches(newRawData)[0];
assert.strictEqual(newRawMatch.targetName, confirmedNewTarget, 'local new-source overlay must survive a remote mapping refresh');
assert.strictEqual(newRawMatch.source, 'user', 'reloaded new-source alias must remain user-confirmed');
assert.strictEqual(newRawMatch.isNewSource, false, 'confirmed raw source must leave the new-source queue');

api.setManualOrderAliasForCheck(sameNameTarget, '사용자 신규 실발주명', 'EA');
const effective = plain(api.effectiveOrderAliasMappingsForPayload());
assert.strictEqual(effective[sameNameTarget].actualName, '사용자 신규 실발주명', 'typed alias creation must immediately update the effective read model');
assert.strictEqual(effective[sameNameTarget].status, 'manual', 'typed alias creation must remain marked manual');

api.setManualItemsForCheck([]);
api.setSiteMappingsForCheck({});
api.setAliasMappingsForCheck({});
const emptyState = plain(api.buildSfaAnalysisPayloadState({ comparison: { matched: [], missing: [], extra: [] } }));
assert.deepStrictEqual(emptyState.orderManualItems, [], 'empty manual item arrays must be preserved in current/history payloads');
assert.deepStrictEqual(emptyState.orderSiteMappings, {}, 'cleared site mappings must be preserved in current/history payloads');
assert.deepStrictEqual(emptyState.orderAliasMappings, {}, 'cleared alias mappings must be preserved in current/history payloads');

api.setRevisionsForCheck(500, 450);
storage.set('bbq_savedAt', '500');
assert.strictEqual(api.shouldApplyIncomingCurrent({ savedAt: 900, stateRevision: 499, inventoryRevision: 900 }), false, 'a newer timestamp cannot bypass a stale state revision');
assert.strictEqual(api.shouldApplyIncomingCurrent({ savedAt: 501, stateRevision: 501, inventoryRevision: 451 }), true, 'the newest revision must be eligible for current-state adoption');

async function verifyConfirmedSaveRevisionFence() {
  const putBodies = [];
  const firstPutResolvers = [];
  sandbox.document.getElementById('orderDays').value = '3';
  sandbox.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') {
      putBodies.push({ url: String(url), body: JSON.parse(options.body) });
      if (putBodies.length <= 2) {
        return new Promise(resolve => firstPutResolvers.push(() => resolve({ ok: true, status: 200, text: async () => '' })));
      }
      return { ok: true, status: 200, text: async () => '' };
    }
    return {
      ok: true,
      status: 200,
      headers: { get(name) { return String(name).toLowerCase() === 'etag' ? '"fixture"' : null; } },
      json: async () => null,
      text: async () => '',
    };
  };

  api.resetConfirmedSaveMachineForCheck();
  api.setEntriesForCheck(entries);
  api.setRevisionsForCheck(1000, 900);
  api.setLocalDirtyForCheck(true);
  assert.strictEqual(api.confirmCurrentSave('enter'), true, 'first Enter must start one immutable current/history pair');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.strictEqual(putBodies.length, 2, 'the first current/history pair must be in flight before the simulated new input');

  api.setRevisionsForCheck(1001, 901);
  api.setLocalDirtyForCheck(true);
  assert.strictEqual(api.confirmCurrentSave('enter'), true, 'a second Enter during flight must queue the latest confirmed revision');
  firstPutResolvers.splice(0).forEach(resolve => resolve());

  for (let i = 0; i < 30 && putBodies.length < 4; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const currentWrites = putBodies.filter(row => row.url.includes('/current.json'));
  assert.strictEqual(currentWrites.length, 2, 'a newer revision confirmed with Enter during save must force one follow-up current write');
  assert.strictEqual(currentWrites[0].body.stateRevision, 1000, 'first request must retain its captured revision');
  assert.strictEqual(currentWrites[1].body.stateRevision, 1001, 'follow-up request must carry the latest revision');
  const latestInventory = currentWrites[1].body.inventoryByItemKey[api.itemKeyForName(canonicalName)];
  assert.strictEqual(latestInventory.total, 3.5, 'latest current write must carry the same stock total rendered in output mode');
  assert(latestInventory.entries.some(row => row.stock === 0), 'latest current write must keep explicit zero-zone stock');
  assert.strictEqual(api.saveStatusForCheck().localDirty, false, 'only the latest revision response may clear localDirty');
}

verifyConfirmedSaveRevisionFence()
  .then(() => console.log('OrderHelper inventory/matching regression OK'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
