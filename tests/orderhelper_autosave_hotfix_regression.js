const assert = require('assert');
const { api, storage, sandbox } = require('./orderhelper_static_checks.js');

const item = api.MASTER[0];
sandbox.document.getElementById('orderDays').value = '3';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate, label) {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return;
    await tick();
  }
  throw new Error(`timeout: ${label}`);
}

function response(ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => null, text: async () => '' };
}

function reset(stock = 10) {
  api.resetConfirmedSaveMachineForCheck();
  api.clearLocalDirtyRevision();
  api.setEntriesForCheck([{ id: 'enter-row', name: item.name, zone: '', stock }]);
  api.saveLocalDraft();
}

function stockFromBody(body) {
  return JSON.parse(body).entries.find(row => row.id === 'enter-row').stock;
}

function installFakeTimers() {
  const originalSetTimeout = sandbox.setTimeout;
  const originalClearTimeout = sandbox.clearTimeout;
  let sequence = 0;
  const timers = new Map();
  sandbox.setTimeout = (callback, delay) => {
    const id = ++sequence;
    timers.set(id, { callback, delay });
    return id;
  };
  sandbox.clearTimeout = id => timers.delete(id);
  return {
    timers,
    runTimerByDelay(delay) {
      const row = Array.from(timers.entries()).find(([, timer]) => timer.delay === delay);
      assert(row, `missing timer with delay ${delay}`);
      timers.delete(row[0]);
      row[1].callback();
    },
    runOnlyTimer() {
      assert.strictEqual(timers.size, 1, 'fixture expected exactly one guarded retry timer');
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
    },
    restore() {
      sandbox.setTimeout = originalSetTimeout;
      sandbox.clearTimeout = originalClearTimeout;
    },
  };
}

async function verifyEnterPairAndExactBody() {
  reset(10);
  const calls = [];
  sandbox.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') calls.push({ url: String(url), body: options.body });
    return response(true);
  };
  assert.strictEqual(api.confirmCurrentSave('enter'), true, 'Enter must capture a confirmed commit');
  await waitFor(() => calls.length === 2 && !api.saveMachineForCheck().saveInFlight, 'Enter pair');
  assert.strictEqual(calls[0].body, calls[1].body, 'current/history must receive the exact same immutable JSON body');
  assert.strictEqual(stockFromBody(calls[0].body), 10, 'Enter body must contain the value at Enter time');
  assert.strictEqual(api.readConfirmedSaveQueue().active, null, 'both 200 responses must clear the matching active commit');
  assert.strictEqual(api.saveMachineForCheck().localDirty, false, 'matching successful revision may clear dirty state');
}

async function verifyRetryDoesNotCaptureLaterDraft() {
  reset(10);
  const fakeTimers = installFakeTimers();
  const calls = [];
  sandbox.fetch = (url, options = {}) => {
    if (options.method !== 'PUT') return Promise.resolve(response(true));
    calls.push({ url: String(url), body: options.body });
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };
  const activeCommit = api.buildConfirmedSaveCommit('enter');
  api.writeConfirmedSaveQueue({ v: 1, active: activeCommit, queued: null });
  api.sendActiveConfirmedSave('fixture', 25);
  await waitFor(() => calls.length === 2, 'stalled active requests');
  api.setEntriesForCheck([{ id: 'enter-row', name: item.name, zone: '', stock: 20 }]);
  api.saveLocalDraft();
  fakeTimers.runTimerByDelay(25);
  await waitFor(() => !api.saveMachineForCheck().saveInFlight && fakeTimers.timers.size === 1, 'retry timer');
  assert(calls.every(call => stockFromBody(call.body) === 10), 'failed active requests must retain Enter value 10');

  sandbox.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') calls.push({ url: String(url), body: options.body });
    return response(true);
  };
  fakeTimers.runOnlyTimer();
  await waitFor(() => calls.length === 4 && !api.saveMachineForCheck().saveInFlight, 'exact retry');
  assert(calls.slice(2).every(call => stockFromBody(call.body) === 10), 'retry must replay the old immutable Enter body, not unentered 20');
  assert.strictEqual(api.getEntriesForCheck()[0].stock, 20, 'new unentered local draft must remain 20');
  assert.strictEqual(api.saveMachineForCheck().localDirty, true, 'success of older revision must not clear the newer draft');
  fakeTimers.restore();
}

async function verifySecondEnterQueuesLatest() {
  reset(10);
  const calls = [];
  const firstPending = [];
  sandbox.fetch = (url, options = {}) => {
    if (options.method !== 'PUT') return Promise.resolve(response(true));
    calls.push({ url: String(url), body: options.body });
    if (calls.length <= 2) return new Promise(resolve => firstPending.push(resolve));
    return Promise.resolve(response(true));
  };
  api.confirmCurrentSave('enter');
  await waitFor(() => firstPending.length === 2, 'first Enter active');
  api.setEntriesForCheck([{ id: 'enter-row', name: item.name, zone: '', stock: 20 }]);
  api.saveLocalDraft();
  api.confirmCurrentSave('enter');
  let queue = api.readConfirmedSaveQueue();
  assert.strictEqual(stockFromBody(queue.active.body), 10, 'active commit must remain first Enter value');
  assert.strictEqual(stockFromBody(queue.queued.body), 20, 'second Enter must replace queued with latest confirmed value');
  firstPending.splice(0).forEach(resolve => resolve(response(true)));
  await waitFor(() => calls.length === 4 && !api.readConfirmedSaveQueue().active && !api.saveMachineForCheck().saveInFlight, 'queued Enter');
  assert(calls.slice(0, 2).every(call => stockFromBody(call.body) === 10), 'active pair must stay 10');
  assert(calls.slice(2).every(call => stockFromBody(call.body) === 20), 'queued pair must send 20 after active success');
  assert.strictEqual(api.saveMachineForCheck().localDirty, false, 'latest queued success may clear its matching dirty revision');
}

async function verifyPartialFailureRetriesBothExactTargets() {
  reset(30);
  const fakeTimers = installFakeTimers();
  const calls = [];
  let failHistory = true;
  sandbox.fetch = async (url, options = {}) => {
    if (options.method !== 'PUT') return response(true);
    calls.push({ url: String(url), body: options.body });
    if (failHistory && String(url).includes('/history/')) return response(false, 500);
    return response(true);
  };
  api.confirmCurrentSave('enter');
  await waitFor(() => !api.saveMachineForCheck().saveInFlight && fakeTimers.timers.size === 1, 'partial failure');
  assert(api.readConfirmedSaveQueue().active, 'one failed target must retain confirmed pending');
  const firstBody = calls[0].body;
  const historyUrl = calls.find(call => call.url.includes('/history/')).url;
  failHistory = false;
  fakeTimers.runOnlyTimer();
  await waitFor(() => calls.length === 4 && !api.saveMachineForCheck().saveInFlight, 'partial retry');
  assert(calls.every(call => call.body === firstBody), 'partial failure retry must replay one exact body to both targets');
  assert(calls.filter(call => call.url.includes('/history/')).every(call => call.url === historyUrl), 'retry after date change must retain captured history date path');
  fakeTimers.restore();
}

async function verifyRecoveryAndFailClosedStorage() {
  reset(40);
  const calls = [];
  sandbox.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') calls.push({ url: String(url), body: options.body });
    return response(true);
  };
  assert.strictEqual(api.retryConfirmedRemotePending('startup'), false, 'draft-only reload must not send remotely');
  assert.strictEqual(calls.length, 0, 'draft-only startup/online/visibility recovery must produce PUT 0');

  const commit = api.buildConfirmedSaveCommit('enter');
  api.writeConfirmedSaveQueue({ v: 1, active: commit, queued: null });
  assert.strictEqual(api.retryConfirmedRemotePending('startup'), true, 'confirmed pending reload must resume');
  await waitFor(() => calls.length === 2 && !api.saveMachineForCheck().saveInFlight, 'pending reload');
  assert(calls.every(call => call.body === commit.body), 'reload must replay the exact persisted confirmed body');

  api.resetConfirmedSaveMachineForCheck();
  api.markLocalDirtyRevision(Date.now() + 1000);
  calls.length = 0;
  const originalSetItem = sandbox.localStorage.setItem;
  sandbox.localStorage.setItem = (key, value) => {
    if (key === 'bbq_confirmed_save_queue_v1') throw new Error('quota');
    return originalSetItem.call(sandbox.localStorage, key, value);
  };
  assert.strictEqual(api.confirmCurrentSave('enter'), false, 'queue quota failure must reject confirmation');
  assert.strictEqual(calls.length, 0, 'queue quota failure must fail closed with PUT 0');
  sandbox.localStorage.setItem = originalSetItem;

  api.resetConfirmedSaveMachineForCheck();
  storage.set('bbq_confirmed_save_queue_v1', '{broken');
  assert.strictEqual(api.retryConfirmedRemotePending('startup'), false, 'corrupt queue must fail closed');
  assert.strictEqual(calls.length, 0, 'corrupt queue must never transmit');
}

async function verifyBoundedAbort() {
  reset(50);
  const commit = api.buildConfirmedSaveCommit('enter');
  let aborted = 0;
  sandbox.fetch = async (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      aborted += 1;
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  await assert.rejects(api.putConfirmedSaveTargets(commit, 25), error => error?.name === 'AbortError');
  assert.strictEqual(aborted, 2, 'timeout must abort both stalled targets and release their shared lock boundary');
}

(async () => {
  await verifyEnterPairAndExactBody();
  await verifyRetryDoesNotCaptureLaterDraft();
  await verifySecondEnterQueuesLatest();
  await verifyPartialFailureRetriesBothExactTargets();
  await verifyRecoveryAndFailClosedStorage();
  await verifyBoundedAbort();
  console.log('OrderHelper live Enter-confirmed autosave VM regression OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
