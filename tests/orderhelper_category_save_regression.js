const assert = require('assert');
const { api, sandbox } = require('./orderhelper_static_checks.js');

const item = api.MASTER[0];

function response(ok = true, status = ok ? 200 : 500, body = null, etag = '"fixture"') {
  return {
    ok,
    status,
    headers: { get(name) { return String(name).toLowerCase() === 'etag' ? etag : null; } },
    json: async () => body,
    text: async () => '',
  };
}

function setupZoneCommit(zone = '새구역') {
  api.resetConfirmedSaveMachineForCheck();
  api.setEntriesForCheck([{ id: 'zone-row', entryKey: 'zone-row', itemKey: api.itemKeyForName(item.name), name: item.name, zone, stock: 3 }]);
  api.setRevisionsForCheck(200, 200);
  assert.strictEqual(api.rememberEntryZonePatchForCheck('zone-row'), true, 'fixture must record the user zone patch');
  const commit = api.buildConfirmedSaveCommit('manual');
  assert.strictEqual(commit.entryZonePatches.length, 1, 'confirmed save commit must carry only the local zone patch metadata');
  return commit;
}

async function verifyRemoteNewerZonePatchMerge() {
  const commit = setupZoneCommit('최신구역');
  const remoteRevision = 9999999999999;
  const remote = {
    savedAt: remoteRevision,
    stateRevision: remoteRevision,
    inventoryRevision: remoteRevision,
    remoteOnly: 'preserve-me',
    entries: [{ id: 'zone-row', entryKey: 'zone-row', itemKey: api.itemKeyForName(item.name), name: item.name, zone: '원격구역', stock: 99 }],
    sfaOrderLedger: { version: 2, eventCount: 0, records: [] },
  };
  const writes = [];
  sandbox.fetch = async (_url, options = {}) => {
    if (!options.method) return response(true, 200, remote, '"remote-v1"');
    writes.push(JSON.parse(options.body));
    return response(true, 200, null);
  };
  const result = await api.putConfirmedSaveTargets(commit, 1000, 4);
  assert.strictEqual(result.conflict, undefined, 'remote-newer category conflict must not fail before a merge attempt');
  assert.strictEqual(result.entryZonePatchMerged, true, 'result must record that the user zone patch was merged');
  assert.strictEqual(result.attempts, 1, 'remote-newer merge should write immediately when ETags are still fresh');
  assert.strictEqual(writes.length, 2, 'current/history pair must both be written after the merge');
  assert.strictEqual(writes[0].remoteOnly, 'preserve-me', 'unknown remote fields must be retained');
  assert.strictEqual(writes[0].entries.find(row => row.entryKey === 'zone-row').zone, '최신구역', 'only the user-confirmed zone must replace the remote zone');
  assert.strictEqual(writes[0].entries.find(row => row.entryKey === 'zone-row').stock, 99, 'remote stock must not be blindly overwritten by the local snapshot');
  assert.strictEqual(
    writes[0].inventoryByItemKey[api.itemKeyForName(item.name)].entries.find(row => row.entryKey === 'zone-row').zone,
    '최신구역',
    'inventory read model must be regenerated from the merged zone entries'
  );
  assert(writes[0].stateRevision > remoteRevision, 'merged body must advance the shared revision beyond the remote conflict');
}

async function verifyPairCasOneRetryWithFreshRemoteMerge() {
  const commit = setupZoneCommit('재시도구역');
  const remoteRevision = 9999999999999;
  let getCount = 0;
  let putCount = 0;
  const writes = [];
  sandbox.fetch = async (_url, options = {}) => {
    if (!options.method) {
      getCount += 1;
      const version = getCount <= 2 ? 'v1' : 'v2';
      return response(true, 200, {
        savedAt: remoteRevision + getCount,
        stateRevision: remoteRevision + getCount,
        inventoryRevision: remoteRevision + getCount,
        remoteMarker: version,
        entries: [{ id: 'zone-row', entryKey: 'zone-row', itemKey: api.itemKeyForName(item.name), name: item.name, zone: `원격-${version}`, stock: 7 }],
      }, `"${version}"`);
    }
    putCount += 1;
    writes.push(JSON.parse(options.body));
    if (putCount <= 2) return response(false, 412, null);
    return response(true, 200, null);
  };
  const result = await api.putConfirmedSaveTargets(commit, 1000, 4);
  assert.strictEqual(result.entryZonePatchMerged, true, 'retry must re-merge the user zone patch with the fresh remote body');
  assert.strictEqual(result.attempts, 2, 'entry-zone conflict handling is bounded to one CAS retry');
  assert.strictEqual(putCount, 4, 'one failed pair and one retry pair should be attempted');
  assert.strictEqual(writes[2].remoteMarker, 'v2', 'retry body must be based on the freshly fetched remote payload');
  assert.strictEqual(writes[2].entries.find(row => row.entryKey === 'zone-row').zone, '재시도구역');
}

async function verifyRepeatedPairCasConflictPreservesQueue() {
  const commit = setupZoneCommit('보존구역');
  const remoteRevision = 200;
  let putCount = 0;
  sandbox.fetch = async (_url, options = {}) => {
    if (!options.method) {
      return response(true, 200, {
        savedAt: remoteRevision,
        stateRevision: remoteRevision,
        inventoryRevision: remoteRevision,
        entries: [{ id: 'zone-row', entryKey: 'zone-row', itemKey: api.itemKeyForName(item.name), name: item.name, zone: '원격구역', stock: 1 }],
      }, '"always-conflict"');
    }
    putCount += 1;
    return response(false, 412, null);
  };
  const result = await api.putConfirmedSaveTargets(commit, 1000, 4);
  assert.strictEqual(result.conflict, true, 'repeated 412 must stop as an explicit conflict');
  assert.strictEqual(result.conflictReason, 'entry_zone_patch_cas_conflict', 'same-revision pair-CAS conflicts still need an explicit preserved-local-patch status');
  assert.strictEqual(result.localPatchPreserved, true, 'local patch must be reported as preserved for user recovery');
  assert.strictEqual(result.attempts, 2, 'repeated conflict must not spin beyond one retry');
  assert.strictEqual(putCount, 4, 'bounded retry means two current/history write pairs at most');
}

(async () => {
  await verifyRemoteNewerZonePatchMerge();
  await verifyPairCasOneRetryWithFreshRemoteMerge();
  await verifyRepeatedPairCasConflictPreservesQueue();
  console.log('PASS orderhelper category save regression');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
