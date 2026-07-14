const assert = require('assert');
const { api, storage, sandbox } = require('./orderhelper_static_checks.js');

const item = api.MASTER[0];
api.setEntriesForCheck([{ id: 'autosave-row', entryKey: 'autosave-row', name: item.name, zone: 'VM', stock: 44 }]);
api.scheduleGridInputForCheck(item.name);
const localEntries = JSON.parse(storage.get('bbq_entries') || '[]');
assert.strictEqual(localEntries.find(row => row.id === 'autosave-row').stock, 44, 'input scheduling must synchronously persist the local draft');
assert(Number(storage.get('bbq_pending_sync_revision') || 0) > 0, 'input scheduling must persist a pending-sync marker');
api.cancelAutosaveForCheck();

async function verifyStalledFetchAbort() {
  let aborted = 0;
  sandbox.fetch = async (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      aborted += 1;
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  const started = Date.now();
  await assert.rejects(
    api.putSaveTargets({ fixture: true }, '20260714', 25),
    error => error?.name === 'AbortError',
    'stalled Firebase targets must reject through AbortController'
  );
  assert(Date.now() - started < 500, 'bounded save timeout must release the VM fixture promptly');
  assert.strictEqual(aborted, 2, 'shared save timeout must abort both current and history requests');
}

verifyStalledFetchAbort()
  .then(() => console.log('OrderHelper autosave VM regression OK'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
