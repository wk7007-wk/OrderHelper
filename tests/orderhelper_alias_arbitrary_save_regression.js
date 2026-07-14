const assert = require('assert');
const { api, storage, sandbox, plain } = require('./orderhelper_static_checks.js');

const tick = () => new Promise(resolve => setImmediate(resolve));

async function waitFor(predicate, label) {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return;
    await tick();
  }
  throw new Error(`timeout: ${label}`);
}

(async () => {
  api.resetConfirmedSaveMachineForCheck();
  api.clearLocalDirtyRevision();
  api.setAliasMappingsForCheck({});

  const calls = [];
  sandbox.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') calls.push({ url: String(url), body: options.body });
    return { ok: true, status: 200, json: async () => null, text: async () => '' };
  };

  const aliasName = '냉동-치즈볼-BBQ치즈볼(크림)';
  const arbitraryActualName = '사용자 임의 신규 별명 20260715';
  assert.strictEqual(
    api.setManualOrderAlias(aliasName, arbitraryActualName, '임의단위'),
    true,
    'an arbitrary non-candidate alias must save through the explicit action'
  );
  await waitFor(() => calls.length === 2 && !api.saveMachineForCheck().saveInFlight, 'manual alias current/history pair');

  const mapping = plain(api.getAliasMappingsForCheck()[aliasName]);
  assert.strictEqual(mapping.actualName, arbitraryActualName, 'manual alias text must be preserved exactly');
  assert.strictEqual(mapping.actualUnit, '임의단위', 'manual alias unit must be preserved exactly');
  assert.strictEqual(mapping.status, 'manual', 'arbitrary alias must remain an explicit manual correction');
  assert.strictEqual(mapping.source, 'user', 'arbitrary alias must remain user-owned');

  assert.strictEqual(calls[0].body, calls[1].body, 'manual alias action must confirm one identical current/history body');
  const payload = JSON.parse(calls[0].body);
  assert.strictEqual(payload.orderAliasMappings[aliasName].actualName, arbitraryActualName, 'confirmed payload must contain the new alias');
  assert.strictEqual(payload.orderAliasMappings[aliasName].status, 'manual', 'confirmed payload must retain manual status');

  const stored = JSON.parse(storage.get('bbq_order_alias_mappings'));
  assert.strictEqual(stored[aliasName].actualName, arbitraryActualName, 'local reload source must contain the arbitrary alias');
  api.setAliasMappingsForCheck(stored);
  const reloaded = api.buildOrderAliasMatches({ comparison: { matched: [], missing: [], extra: [] } })
    .find(row => row.aliasName === aliasName);
  assert.strictEqual(reloaded.actualName, arbitraryActualName, 'rebuilt alias rows must re-display the arbitrary alias');
  assert.strictEqual(reloaded.status, 'manual', 'rebuilt alias rows must retain manual status');

  console.log('OrderHelper arbitrary alias save VM regression OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
