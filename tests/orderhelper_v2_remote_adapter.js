'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Sync = require('../sync/order-sync-v2.js');
const RemoteV2 = require('../v2/order-remote-v2.js');

function response(status, body, headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get(name) { return normalized[String(name).toLowerCase()] ?? null; } },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); }
  };
}

function capability(now, operations = ['read', 'write']) {
  return {
    decision: 'allow',
    capability: 'orderhelper_v2_canonical',
    node: Sync.CANONICAL_NODE,
    origin: 'https://poskds-4ba60-default-rtdb.asia-southeast1.firebasedatabase.app',
    operations,
    receiptId: 'capability-receipt-1',
    verifiedAt: now,
    expiresAt: now + 1000
  };
}

function makeAdapter(overrides = {}) {
  let now = overrides.nowValue ?? 1000;
  const calls = [];
  const fetchImpl = overrides.fetchImpl || (async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') return response(200, Sync.emptyDocument(), { etag: '"one"' });
    return response(200, JSON.parse(options.body), { etag: '"two"' });
  });
  const adapter = RemoteV2.createRemoteAdapter({
    baseUrl: 'https://poskds-4ba60-default-rtdb.asia-southeast1.firebasedatabase.app',
    fetchImpl,
    now: () => now,
    timeoutMs: overrides.timeoutMs ?? 100,
    verifyCapability: overrides.verifyCapability || (async () => capability(now))
  });
  return { adapter, calls, setNow(value) { now = value; } };
}

async function testUnauthorizedAndWrongPathFailBeforeFetch() {
  let calls = 0;
  const unauthorized = RemoteV2.createRemoteAdapter({
    baseUrl: 'https://poskds-4ba60-default-rtdb.asia-southeast1.firebasedatabase.app',
    fetchImpl: async () => { calls += 1; },
    verifyCapability: async () => ({ decision: 'deny' })
  });
  await assert.rejects(() => unauthorized.getCanonical(Sync.CANONICAL_NODE), RemoteV2.RemoteAuthorizationError);
  await assert.rejects(() => unauthorized.putCanonical(Sync.CANONICAL_NODE, Sync.emptyDocument(), '"etag"'), RemoteV2.RemoteAuthorizationError);
  assert.strictEqual(calls, 0);

  const wrongOriginReceipt = RemoteV2.createRemoteAdapter({
    baseUrl: RemoteV2.APPROVED_FIREBASE_ORIGIN,
    fetchImpl: async () => { calls += 1; },
    now: () => 1000,
    verifyCapability: async () => ({ ...capability(1000), origin: 'https://shadow.example.test' })
  });
  await assert.rejects(() => wrongOriginReceipt.getCanonical(Sync.CANONICAL_NODE), RemoteV2.RemoteAuthorizationError);
  assert.strictEqual(calls, 0, 'receipt origin mismatch must fail before fetch');

  const valid = makeAdapter();
  await assert.rejects(() => valid.adapter.getCanonical('/order/current'), RemoteV2.RemotePathError);
  await assert.rejects(() => valid.adapter.putCanonical(Sync.CANONICAL_NODE + '/child', Sync.emptyDocument(), '"etag"'), RemoteV2.RemotePathError);
  assert.strictEqual(valid.calls.length, 0);
}

async function testValidGetPutHeadersAndBody() {
  const remote = makeAdapter();
  const read = await remote.adapter.getCanonical(Sync.CANONICAL_NODE);
  assert.strictEqual(read.status, 200);
  assert.strictEqual(read.etag, '"one"');
  assert.strictEqual(read.body.schemaVersion, Sync.SCHEMA_VERSION);
  const getCall = remote.calls[0];
  assert.strictEqual(getCall.url, RemoteV2.APPROVED_FIREBASE_ORIGIN + Sync.CANONICAL_NODE + '.json');
  assert.strictEqual(getCall.options.method, 'GET');
  assert.strictEqual(getCall.options.cache, 'no-store');
  assert.strictEqual(getCall.options.headers['X-Firebase-ETag'], 'true');

  const document = Sync.writeFields(Sync.emptyDocument(), { actorId: 'phone.actor', epoch: 0, counter: 0 }, 'inventory', 'oil', { stock: 0 });
  const write = await remote.adapter.putCanonical(Sync.CANONICAL_NODE, document, read.etag);
  assert.strictEqual(write.status, 200);
  assert.strictEqual(write.etag, '"two"');
  const putCall = remote.calls[1];
  assert.strictEqual(putCall.options.method, 'PUT');
  assert.strictEqual(putCall.options.headers['if-match'], '"one"');
  assert.strictEqual(putCall.options.headers['Content-Type'], 'application/json');
  assert.deepStrictEqual(JSON.parse(putCall.options.body), document);
}

async function test412PassesThrough() {
  const remote = makeAdapter({ fetchImpl: async () => response(412, 'null', { etag: '"new"' }) });
  const result = await remote.adapter.putCanonical(Sync.CANONICAL_NODE, Sync.emptyDocument(), '"old"');
  assert.strictEqual(result.status, 412);
  assert.strictEqual(result.etag, '"new"');
}

async function testTimeoutAborts() {
  let observedSignal = null;
  const remote = makeAdapter({
    timeoutMs: 5,
    fetchImpl: async (url, options) => {
      observedSignal = options.signal;
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }
  });
  await assert.rejects(() => remote.adapter.getCanonical(Sync.CANONICAL_NODE), RemoteV2.RemoteTimeoutError);
  assert.strictEqual(observedSignal.aborted, true);
}

async function testMalformedAndOversizeResponsesFailClosed() {
  const malformed = makeAdapter({ fetchImpl: async () => response(200, '{bad json', { etag: '"one"' }) });
  await assert.rejects(() => malformed.adapter.getCanonical(Sync.CANONICAL_NODE), RemoteV2.RemoteResponseError);
  const oversizeText = JSON.stringify({ blob: 'x'.repeat(Sync.MAX_CANONICAL_BYTES + 1) });
  const oversize = makeAdapter({ fetchImpl: async () => response(200, oversizeText, { etag: '"one"' }) });
  await assert.rejects(() => oversize.adapter.getCanonical(Sync.CANONICAL_NODE), RemoteV2.RemoteResponseError);
  const localOversize = { ...Sync.emptyDocument(), padding: 'x'.repeat(Sync.MAX_CANONICAL_BYTES + 1) };
  await assert.rejects(() => oversize.adapter.putCanonical(Sync.CANONICAL_NODE, localOversize, '"one"'));
}

async function testCapabilityExpiresBetweenGetAndPut() {
  let issuedAt = 1000;
  const remote = makeAdapter({ verifyCapability: async ({ operation }) => capability(issuedAt, operation === 'read' ? ['read'] : ['write']) });
  await remote.adapter.getCanonical(Sync.CANONICAL_NODE);
  remote.setNow(3000);
  await assert.rejects(() => remote.adapter.putCanonical(Sync.CANONICAL_NODE, Sync.emptyDocument(), '"one"'), RemoteV2.RemoteAuthorizationError);
  assert.strictEqual(remote.calls.length, 1, 'expired write capability must fail before fetch');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(remote.adapter, 'setCapabilityVerifier'), false, 'verifier replacement bypass must not be public');
  assert.throws(() => { remote.adapter.setCapabilityVerifier = async () => capability(3000); }, TypeError, 'frozen adapter must reject a forged verifier setter');
}

async function testNoSecretLeakAndNoForbiddenRoutes() {
  const rawPin = '9182-secret-pin';
  const rawDeviceToken = 'device-token-secret';
  const seen = [];
  const adapter = RemoteV2.createRemoteAdapter({
    baseUrl: 'https://poskds-4ba60-default-rtdb.asia-southeast1.firebasedatabase.app',
    fetchImpl: async (url, options) => { seen.push({ url, options }); return response(200, Sync.emptyDocument(), { etag: '"one"' }); },
    now: () => 1000,
    verifyCapability: async () => ({ ...capability(1000), rawPin, rawDeviceToken })
  });
  await adapter.getCanonical(Sync.CANONICAL_NODE);
  assert.doesNotMatch(JSON.stringify(seen), new RegExp(rawPin + '|' + rawDeviceToken));
  const source = fs.readFileSync(path.join(__dirname, '..', 'v2', 'order-remote-v2.js'), 'utf8');
  assert.doesNotMatch(source, /\/current|\/history|sfaAnalysis|setInterval|setTimeout\([^,]+,\s*[0-9]{4,}/i);
}

async function testOnlyApprovedRootOriginIsAccepted() {
  const allowed = () => capability(1000);
  const fetchImpl = async () => response(200, Sync.emptyDocument(), { etag: '"one"' });
  const rejected = [
    'https://shadow.example.test',
    RemoteV2.APPROVED_FIREBASE_ORIGIN + '/nested',
    RemoteV2.APPROVED_FIREBASE_ORIGIN + '?auth=secret',
    RemoteV2.APPROVED_FIREBASE_ORIGIN + '#fragment',
    'https://user:secret@poskds-4ba60-default-rtdb.asia-southeast1.firebasedatabase.app'
  ];
  rejected.forEach(baseUrl => assert.throws(
    () => RemoteV2.createRemoteAdapter({ baseUrl, fetchImpl, verifyCapability: allowed, now: () => 1000 }),
    RemoteV2.RemotePathError
  ));
  assert.doesNotThrow(() => RemoteV2.createRemoteAdapter({
    baseUrl: RemoteV2.APPROVED_FIREBASE_ORIGIN,
    fetchImpl,
    verifyCapability: allowed,
    now: () => 1000
  }));
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

async function testVerifierTimeoutIsBoundedAndFlushGateReleases() {
  let mode = 'hang';
  let verifierSignal = null;
  const fetchCalls = [];
  const adapter = RemoteV2.createRemoteAdapter({
    baseUrl: RemoteV2.APPROVED_FIREBASE_ORIGIN,
    timeoutMs: 5,
    now: () => 1000,
    verifyCapability: async ({ signal }) => {
      verifierSignal = signal;
      if (mode === 'hang') return new Promise(() => {});
      return capability(1000);
    },
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });
      if (options.method === 'GET') return response(200, Sync.emptyDocument(), { etag: '"one"' });
      return response(200, JSON.parse(options.body), { etag: '"two"' });
    }
  });
  const storage = memoryStorage();
  const actor = { actorId: 'phone.actor', epoch: 0, counter: 0 };
  const document = Sync.writeFields(Sync.emptyDocument(), actor, 'inventory', 'oil', { stock: 1 });
  Sync.saveOutbox(storage, Sync.enqueueIntent(Sync.emptyOutbox(actor.actorId), Sync.makeIntent(actor, document, { intentId: 'timeout-intent' })));
  await assert.rejects(
    () => Sync.flushOutbox({ storage, actorId: actor.actorId, adapter }),
    RemoteV2.RemoteTimeoutError
  );
  assert.strictEqual(verifierSignal.aborted, true);
  assert.strictEqual(fetchCalls.length, 0);
  mode = 'allow';
  assert.strictEqual((await Sync.flushOutbox({ storage, actorId: actor.actorId, adapter })).status, 'canonical_committed', 'flush lock must release after verifier timeout');
}

async function testFullSyncFlushRetriesAdapter412ThenCommits() {
  const storage = memoryStorage();
  const actor = { actorId: 'phone.actor', epoch: 0, counter: 0 };
  const local = Sync.writeFields(Sync.emptyDocument(), actor, 'inventory', 'oil', { stock: 2 });
  Sync.saveOutbox(storage, Sync.enqueueIntent(Sync.emptyOutbox(actor.actorId), Sync.makeIntent(actor, local, { intentId: 'cas-integration' })));
  let step = 0;
  const fetchImpl = async (url, options) => {
    step += 1;
    if (step === 1) return response(200, Sync.emptyDocument(), { etag: '"one"' });
    if (step === 2) return response(412, null, { etag: '"two"' });
    if (step === 3) return response(200, Sync.emptyDocument(), { etag: '"two"' });
    if (step === 4) return response(200, JSON.parse(options.body), { etag: '"three"' });
    throw new Error('unexpected fetch');
  };
  const adapter = RemoteV2.createRemoteAdapter({
    baseUrl: RemoteV2.APPROVED_FIREBASE_ORIGIN,
    fetchImpl,
    now: () => 1000,
    verifyCapability: async () => capability(1000)
  });
  const result = await Sync.flushOutbox({ storage, actorId: actor.actorId, adapter, maxCasRetries: 2 });
  assert.strictEqual(result.status, 'canonical_committed');
  assert.strictEqual(result.receipt.attempts, 2);
  assert.strictEqual(step, 4);
}

async function main() {
  const tests = [
    testUnauthorizedAndWrongPathFailBeforeFetch,
    testValidGetPutHeadersAndBody,
    test412PassesThrough,
    testTimeoutAborts,
    testMalformedAndOversizeResponsesFailClosed,
    testCapabilityExpiresBetweenGetAndPut,
    testNoSecretLeakAndNoForbiddenRoutes,
    testOnlyApprovedRootOriginIsAccepted,
    testVerifierTimeoutIsBoundedAndFlushGateReleases,
    testFullSyncFlushRetriesAdapter412ThenCommits
  ];
  for (const test of tests) {
    await test();
    console.log('PASS ' + test.name);
  }
  console.log('PASS OrderHelper v2 remote adapter (' + tests.length + ' tests)');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
