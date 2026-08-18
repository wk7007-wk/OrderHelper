#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const Sync = require(path.join(ROOT, 'sync', 'order-sync-v2.js'));
const RemoteV2 = require(path.join(ROOT, 'v2', 'order-remote-v2.js'));
const Auth = require(path.join(ROOT, 'v2', 'order-auth-v2.js'));

const TRUSTED_TOKENS = new Map([
  ['personal-token', '20d3878e2c09054563c1008f264a1e04fffe6aa844de86304233f08b04764491'],
  ['factory-token', 'b102528da17d98d3c8879417170b85552ddbb4059bf2c4f0684801db3e0c4eb6'],
  ['factory-codex-token', '3478b8091ca76988cdc84079f963c4c224b1d440d2748439bf9ca0a61952c6d3'],
]);

const POLICY = Object.freeze({
  capability: 'orderhelper_v2_canonical',
  node: Sync.CANONICAL_NODE,
  origin: RemoteV2.APPROVED_FIREBASE_ORIGIN,
  operations: ['read', 'write'],
  readwrite: 'readwrite',
});

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

const cryptoAdapter = {
  async sha256(value) {
    return TRUSTED_TOKENS.get(String(value)) || sha256(value);
  },
};

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  const writes = [];
  return {
    writes,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(String(key), String(value)); writes.push({ key: String(key), value: String(value) }); },
    removeItem(key) { values.delete(String(key)); },
  };
}

function deviceRaw(token, extras = {}) {
  return JSON.stringify({ token, createdAt: 1, ...extras });
}

function validReceipt(now, overrides = {}) {
  return {
    decision: 'allow',
    receiptId: 'cap-receipt-1',
    ...POLICY,
    operations: ['read'],
    verifiedAt: now,
    expiresAt: now + 30_000,
    ...overrides,
  };
}

function issuerOptions(storage, clock, overrides = {}) {
  return {
    storage,
    cryptoAdapter,
    deviceTokenGenerator: () => 'generated-device-token',
    now: () => clock.value,
    pinHash: sha256('2468'),
    capabilityPolicy: POLICY,
    sessionTtlMs: 60_000,
    factorTimeoutMs: 20,
    registrationTimeoutMs: 20,
    ...overrides,
  };
}

async function testExactTrustedAutoAndFreshIdentity() {
  const clock = { value: 10_000 };
  const storage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: deviceRaw('personal-token', { label: 'irrelevant' }) });
  let remoteCalls = 0;
  const issuer = Auth.createAuthIssuer(issuerOptions(storage, clock, {
    capabilityPolicy: undefined,
    remoteAdapter: {
      async verifyCapability() { remoteCalls += 1; return validReceipt(clock.value); },
    },
  }));
  const result = await issuer.authenticate();
  assert.deepStrictEqual(result, { allowed: true, method: 'exact_trusted_device', expiresAt: 70_000 });
  assert.strictEqual((await issuer.verifyCapability({ operation: 'read', node: POLICY.node })).decision, 'allow');
  assert.strictEqual(remoteCalls, 1);
  storage.setItem(Auth.AUTH_DEVICE_KEY, deviceRaw('changed-token'));
  assert.deepStrictEqual(
    await issuer.verifyCapability({ operation: 'read', node: POLICY.node }),
    { allowed: false, reason: 'identity_changed' }
  );
  assert.strictEqual(remoteCalls, 1, 'fresh identity denial must happen before remote capability verification');
}

async function testAllThreeExactHashesAndWrongToken() {
  for (const [token, hash] of TRUSTED_TOKENS) {
    assert(Auth.TRUSTED_DEVICE_HASHES.includes(hash));
    const storage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: deviceRaw(token) });
    const result = await Auth.createAuthIssuer(issuerOptions(storage, { value: 20_000 })).authenticate();
    assert.strictEqual(result.method, 'exact_trusted_device');
  }
  const wrong = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: deviceRaw('personal-token-wrong') });
  assert.deepStrictEqual(
    await Auth.createAuthIssuer(issuerOptions(wrong, { value: 20_000 })).authenticate(),
    { allowed: false, reason: 'additional_auth_required' }
  );
}

async function testCapabilityPolicyCannotBeOverridden() {
  const storage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: deviceRaw('personal-token') });
  assert.throws(() => Auth.createAuthIssuer(issuerOptions(storage, { value: 25_000 }, {
    capabilityPolicy: { ...POLICY, origin: 'https://policy-override.example.test' },
  })), TypeError);
}

async function testLegacyReadOnlyImport() {
  const clock = { value: 30_000 };
  const legacyRaw = deviceRaw('factory-token', { name: '공장 PC' });
  const storage = memoryStorage({ [Auth.LEGACY_AUTH_DEVICE_KEY]: legacyRaw });
  const result = await Auth.createAuthIssuer(issuerOptions(storage, clock)).authenticate();
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(storage.getItem(Auth.LEGACY_AUTH_DEVICE_KEY), legacyRaw, 'legacy bytes are read-only');
  assert.strictEqual(JSON.parse(storage.getItem(Auth.AUTH_DEVICE_KEY)).token, 'factory-token');
  assert.strictEqual(storage.writes.length, 1, 'legacy import copies once into the v2 namespace');
}

async function testEmptyStorageGeneratesDurableDeviceAndRegistrationWorks() {
  const clock = { value: 35_000 };
  const storage = memoryStorage();
  let generated = 0;
  let reads = 0;
  const issuer = Auth.createAuthIssuer(issuerOptions(storage, clock, {
    deviceTokenGenerator() { generated += 1; return 'crypto-generated-token-1'; },
    registrationAdapter: {
      async readWindow() {
        reads += 1;
        return registrationWindow(clock, { networkReceiptId: `empty-read-${reads}` });
      },
      async writeCandidate() {
        return { ok: true, recordedAt: clock.value, receiptId: 'empty-candidate-write' };
      },
    },
  }));
  assert.deepStrictEqual(await issuer.authenticate(), { allowed: false, reason: 'additional_auth_required' });
  assert.strictEqual(generated, 1);
  assert.deepStrictEqual(JSON.parse(storage.getItem(Auth.AUTH_DEVICE_KEY)), {
    schemaVersion: 1,
    token: 'crypto-generated-token-1',
    createdAt: clock.value,
  });
  assert.deepStrictEqual(
    await issuer.authenticateRegistration(),
    { allowed: true, method: 'registration_window_temporary', expiresAt: 65_000 }
  );
  assert.strictEqual(generated, 1, 'durably stored generated identity must be reused');
}

async function testNonStringTokensPreserveRawAndDeny() {
  const malformedTokens = [{ nested: true }, 1234, ['array-token']];
  for (const [index, token] of malformedTokens.entries()) {
    const currentRaw = JSON.stringify({ token, createdAt: 1 });
    const currentStorage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: currentRaw });
    assert.deepStrictEqual(
      await Auth.createAuthIssuer(issuerOptions(currentStorage, { value: 36_000 })).authenticate(),
      { allowed: false, reason: 'auth_storage_corrupt' }
    );
    assert.strictEqual(currentStorage.getItem(Auth.AUTH_DEVICE_KEY), currentRaw);
    assert.strictEqual(currentStorage.writes.length, 0);

    const legacyRaw = JSON.stringify({ token, createdAt: 1 });
    const legacyStorage = memoryStorage({ [Auth.LEGACY_AUTH_DEVICE_KEY]: legacyRaw });
    assert.deepStrictEqual(
      await Auth.createAuthIssuer(issuerOptions(legacyStorage, { value: 36_000 + index })).authenticate(),
      { allowed: false, reason: 'auth_storage_corrupt' }
    );
    assert.strictEqual(legacyStorage.getItem(Auth.LEGACY_AUTH_DEVICE_KEY), legacyRaw);
    assert.strictEqual(legacyStorage.getItem(Auth.AUTH_DEVICE_KEY), null);
    assert.strictEqual(legacyStorage.writes.length, 0);
  }
}

async function testLabelsAndCandidateRowsNeverTrust() {
  const clock = { value: 40_000 };
  let registrationReads = 0;
  const storage = memoryStorage({
    [Auth.AUTH_DEVICE_KEY]: deviceRaw('unknown-token', { name: 'personal-phone', label: 'factory-pc' }),
  });
  const issuer = Auth.createAuthIssuer(issuerOptions(storage, clock, {
    registrationAdapter: {
      async readWindow() { registrationReads += 1; return { candidates: { approved: true } }; },
    },
  }));
  assert.deepStrictEqual(await issuer.authenticate(), { allowed: false, reason: 'additional_auth_required' });
  assert.strictEqual(registrationReads, 0, 'candidate/name/label paths are not consulted for passwordless auth');
}

async function testPinRequiresExplicitFactorAndTimeoutFailsClosed() {
  const clock = { value: 50_000 };
  const storage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: deviceRaw('unknown-token') });
  const pinOnly = Auth.createAuthIssuer(issuerOptions(storage, clock));
  assert.deepStrictEqual(await pinOnly.authenticate({ pin: '2468' }), { allowed: false, reason: 'second_factor_required' });

  let factorPayload = null;
  const withFactor = Auth.createAuthIssuer(issuerOptions(storage, clock, {
    factorAdapter: {
      async verify(payload) { factorPayload = payload; return { allowed: true, factor: 'explicit_approval' }; },
    },
  }));
  assert.deepStrictEqual(
    await withFactor.authenticate({ pin: '2468' }),
    { allowed: true, method: 'pin_plus_factor', expiresAt: 110_000 }
  );
  assert.strictEqual(JSON.stringify(factorPayload).includes('2468'), false);
  assert.strictEqual(JSON.stringify(factorPayload).includes('unknown-token'), false);

  const wrongPin = Auth.createAuthIssuer(issuerOptions(storage, clock, {
    factorAdapter: { async verify() { throw new Error('must not run'); } },
  }));
  assert.deepStrictEqual(await wrongPin.authenticate({ pin: '0000' }), { allowed: false, reason: 'pin_invalid' });

  const hanging = Auth.createAuthIssuer(issuerOptions(storage, clock, {
    factorTimeoutMs: 5,
    factorAdapter: { verify() { return new Promise(() => {}); } },
  }));
  assert.deepStrictEqual(await hanging.authenticate({ pin: '2468' }), { allowed: false, reason: 'factor_timeout' });
}

async function testPinMustBePrimitiveExactFourDigits() {
  const storage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: deviceRaw('unknown-token') });
  let factorCalls = 0;
  const issuer = Auth.createAuthIssuer(issuerOptions(storage, { value: 55_000 }, {
    factorAdapter: {
      async verify() { factorCalls += 1; return { allowed: true }; },
    },
  }));
  for (const pin of [2468, { toString: () => '2468' }, ['2468'], '246', '24680', '24a8']) {
    assert.deepStrictEqual(await issuer.authenticate({ pin }), { allowed: false, reason: 'pin_invalid' });
  }
  assert.strictEqual(factorCalls, 0, 'invalid PIN shape must be denied before second factor');
}

function registrationWindow(clock, overrides = {}) {
  return {
    enabled: true,
    autoApprove: false,
    windowId: 'window_safe_1',
    startsAt: clock.value - 1_000,
    expiresAt: clock.value + 30_000,
    fetchedAt: clock.value,
    networkReceiptId: 'window-read-1',
    ...overrides,
  };
}

async function testFreshRegistrationSuccessAndNoSecretLeak() {
  const clock = { value: 60_000 };
  const storage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: deviceRaw('registration-secret-token') });
  const writes = [];
  let reads = 0;
  const adapter = {
    async readWindow() { reads += 1; return registrationWindow(clock, { networkReceiptId: `window-read-${reads}` }); },
    async writeCandidate(payload) {
      writes.push(payload);
      return { ok: true, recordedAt: clock.value, receiptId: 'candidate-write-1' };
    },
  };
  const issuer = Auth.createAuthIssuer(issuerOptions(storage, clock, { registrationAdapter: adapter }));
  assert.deepStrictEqual(
    await issuer.authenticateRegistration(),
    { allowed: true, method: 'registration_window_temporary', expiresAt: 90_000 }
  );
  assert.strictEqual(reads, 2, 'registration window must be read fresh before and after candidate write');
  assert.strictEqual(writes.length, 1);
  const serialized = JSON.stringify(writes[0]);
  assert.strictEqual(serialized.includes('registration-secret-token'), false);
  assert.strictEqual(serialized.includes('2468'), false);
  assert.strictEqual(writes[0].candidateOnly, true);
  assert.strictEqual(Object.hasOwn(writes[0], 'trusted'), false);
}

async function registrationDenied(firstWindow, secondWindow, writeResult = { ok: true, recordedAt: 70_000, receiptId: 'candidate-ok' }) {
  const clock = { value: 70_000 };
  const storage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: deviceRaw('registration-denied-token') });
  let reads = 0;
  const issuer = Auth.createAuthIssuer(issuerOptions(storage, clock, {
    registrationAdapter: {
      async readWindow() { reads += 1; return reads === 1 ? firstWindow(clock) : secondWindow(clock); },
      async writeCandidate() { return writeResult; },
    },
  }));
  return issuer.authenticateRegistration();
}

async function testRegistrationChangedExpiredAutoApproveAndWriteFail() {
  assert.deepStrictEqual(
    await registrationDenied(
      clock => registrationWindow(clock),
      clock => registrationWindow(clock, { windowId: 'window_changed' })
    ),
    { allowed: false, reason: 'registration_window_changed' }
  );
  assert.deepStrictEqual(
    await registrationDenied(
      clock => registrationWindow(clock, { expiresAt: clock.value }),
      clock => registrationWindow(clock)
    ),
    { allowed: false, reason: 'registration_window_invalid' }
  );
  assert.deepStrictEqual(
    await registrationDenied(
      clock => registrationWindow(clock, { autoApprove: true }),
      clock => registrationWindow(clock, { autoApprove: true })
    ),
    { allowed: false, reason: 'registration_window_invalid' }
  );
  assert.deepStrictEqual(
    await registrationDenied(
      clock => registrationWindow(clock),
      clock => registrationWindow(clock),
      { ok: false }
    ),
    { allowed: false, reason: 'candidate_write_failed' }
  );
  assert.deepStrictEqual(
    await registrationDenied(
      clock => registrationWindow(clock, { fetchedAt: clock.value }),
      clock => registrationWindow(clock, {
        fetchedAt: clock.value - 1,
        networkReceiptId: 'window-read-new-but-older',
      })
    ),
    { allowed: false, reason: 'registration_window_not_fresh' }
  );
}

async function testRegistrationSecondFetchMustFollowWriteCompletion() {
  const clock = { value: 75_000 };
  const storage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: deviceRaw('registration-clock-token') });
  let reads = 0;
  const issuer = Auth.createAuthIssuer(issuerOptions(storage, clock, {
    registrationAdapter: {
      async readWindow() {
        reads += 1;
        return registrationWindow(clock, {
          startsAt: 74_000,
          expiresAt: 105_000,
          fetchedAt: reads === 1 ? 75_000 : 75_005,
          networkReceiptId: `clock-read-${reads}`,
        });
      },
      async writeCandidate() {
        clock.value = 75_010;
        return { ok: true, recordedAt: 75_000, receiptId: 'clock-write-1' };
      },
    },
  }));
  assert.deepStrictEqual(
    await issuer.authenticateRegistration(),
    { allowed: false, reason: 'registration_window_not_fresh' }
  );
}

async function testCapabilityReceiptAndSessionExpiry() {
  const clock = { value: 80_000 };
  const storage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: deviceRaw('factory-codex-token') });
  let receipt = validReceipt(clock.value);
  const issuer = Auth.createAuthIssuer(issuerOptions(storage, clock, {
    sessionTtlMs: 100,
    remoteAdapter: { async verifyCapability() { return receipt; } },
  }));
  await issuer.authenticate();
  const request = { operation: 'read', node: POLICY.node };
  const allowed = await issuer.verifyCapability(request);
  assert.strictEqual(allowed.decision, 'allow');
  assert.strictEqual(Object.hasOwn(allowed, 'receipt'), false, 'receipt must be flat for the remote adapter');
  assert.deepStrictEqual(Auth.DEFAULT_CAPABILITY_POLICY, POLICY);
  receipt = validReceipt(clock.value, { operations: ['read'] });
  assert.strictEqual((await issuer.verifyCapability(request)).decision, 'allow', 'requested operation subset is valid');
  receipt = validReceipt(clock.value, { decision: 'deny' });
  assert.deepStrictEqual(await issuer.verifyCapability(request), { allowed: false, reason: 'capability_receipt_invalid' });
  receipt = validReceipt(clock.value, { receiptId: 'x'.repeat(161) });
  assert.deepStrictEqual(await issuer.verifyCapability(request), { allowed: false, reason: 'capability_receipt_invalid' });
  receipt = validReceipt(clock.value - 60_000);
  assert.deepStrictEqual(await issuer.verifyCapability(request), { allowed: false, reason: 'capability_receipt_stale' });
  clock.value = 80_101;
  assert.deepStrictEqual(await issuer.verifyCapability(request), { allowed: false, reason: 'session_expired' });
}

async function testCapabilityIsSingleOperationAndRejectsFutureReceipt() {
  const clock = { value: 85_000 };
  const storage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: deviceRaw('factory-token') });
  let providerRequest = null;
  let providerReceipt = validReceipt(clock.value, { operations: ['read'] });
  const issuer = Auth.createAuthIssuer(issuerOptions(storage, clock, {
    remoteAdapter: {
      async verifyCapability(request) {
        providerRequest = request;
        return providerReceipt;
      },
    },
  }));
  await issuer.authenticate();
  const read = await issuer.verifyCapability({ operation: 'read', node: POLICY.node });
  assert.deepStrictEqual(providerRequest.operations, ['read']);
  assert.deepStrictEqual(read.operations, ['read']);

  providerReceipt = validReceipt(clock.value, { operations: ['read', 'write'] });
  assert.deepStrictEqual(
    await issuer.verifyCapability({ operation: 'read', node: POLICY.node }),
    { allowed: false, reason: 'capability_receipt_invalid' }
  );

  for (const futureBy of [1, 500]) {
    providerReceipt = validReceipt(clock.value, {
      operations: ['read'],
      verifiedAt: clock.value + futureBy,
      expiresAt: clock.value + 30_000,
    });
    assert.deepStrictEqual(
      await issuer.verifyCapability({ operation: 'read', node: POLICY.node }),
      { allowed: false, reason: 'capability_receipt_stale' }
    );
    let fetchCalls = 0;
    const direct = RemoteV2.createRemoteAdapter({
      baseUrl: RemoteV2.APPROVED_FIREBASE_ORIGIN,
      now: () => clock.value,
      verifyCapability: async () => ({ ...providerReceipt }),
      fetchImpl: async () => { fetchCalls += 1; return response(200, Sync.emptyDocument(), { etag: '"future"' }); },
    });
    await assert.rejects(() => direct.getCanonical(Sync.CANONICAL_NODE), RemoteV2.RemoteAuthorizationError);
    assert.strictEqual(fetchCalls, 0);
  }
}

async function testMalformedStoragePreservedAndDenied() {
  const raw = '{malformed-auth';
  const storage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: raw, [Auth.LEGACY_AUTH_DEVICE_KEY]: deviceRaw('personal-token') });
  const issuer = Auth.createAuthIssuer(issuerOptions(storage, { value: 90_000 }));
  assert.deepStrictEqual(await issuer.authenticate(), { allowed: false, reason: 'auth_storage_corrupt' });
  assert.strictEqual(storage.getItem(Auth.AUTH_DEVICE_KEY), raw);
  assert.strictEqual(storage.writes.length, 0, 'corrupt v2 auth storage blocks legacy fallback and remains byte-exact');

  const legacyRaw = '{malformed-legacy-auth';
  const legacyStorage = memoryStorage({ [Auth.LEGACY_AUTH_DEVICE_KEY]: legacyRaw });
  const legacyIssuer = Auth.createAuthIssuer(issuerOptions(legacyStorage, { value: 90_000 }));
  assert.deepStrictEqual(await legacyIssuer.authenticate(), { allowed: false, reason: 'auth_storage_corrupt' });
  assert.strictEqual(legacyStorage.getItem(Auth.LEGACY_AUTH_DEVICE_KEY), legacyRaw);
  assert.strictEqual(legacyStorage.getItem(Auth.AUTH_DEVICE_KEY), null);
  assert.strictEqual(legacyStorage.writes.length, 0);
}

function response(status, body, headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    headers: { get(name) { return normalized[String(name).toLowerCase()] ?? null; } },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
  };
}

async function testFlatIssuerReceiptDrivesRemoteGetAndPut() {
  const clock = { value: 95_000 };
  const storage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: deviceRaw('personal-token') });
  const providerCalls = [];
  const issuer = Auth.createAuthIssuer(issuerOptions(storage, clock, {
    remoteAdapter: {
      async verifyCapability(request) {
        providerCalls.push(request);
        return validReceipt(clock.value, { operations: [request.operation] });
      },
    },
  }));
  assert.strictEqual((await issuer.authenticate()).allowed, true);
  const fetchCalls = [];
  const remote = RemoteV2.createRemoteAdapter({
    baseUrl: RemoteV2.APPROVED_FIREBASE_ORIGIN,
    now: () => clock.value,
    verifyCapability: issuer.verifyCapability,
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });
      if (options.method === 'GET') return response(200, Sync.emptyDocument(), { etag: '"auth-get"' });
      return response(200, JSON.parse(options.body), { etag: '"auth-put"' });
    },
  });
  const read = await remote.getCanonical(Sync.CANONICAL_NODE);
  const write = await remote.putCanonical(Sync.CANONICAL_NODE, read.body, read.etag);
  assert.strictEqual(read.status, 200);
  assert.strictEqual(write.status, 200);
  assert.deepStrictEqual(providerCalls.map(call => call.operation), ['read', 'write']);
  assert.deepStrictEqual(fetchCalls.map(call => call.options.method), ['GET', 'PUT']);
  assert(providerCalls.every(call => call.signal instanceof AbortSignal));
}

async function testCapturedVerifierCannotReuseReadReceiptForWrite() {
  const clock = { value: 96_000 };
  const storage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: deviceRaw('personal-token') });
  const readReceipt = validReceipt(clock.value, { operations: ['read'] });
  const issuer = Auth.createAuthIssuer(issuerOptions(storage, clock, {
    remoteAdapter: { async verifyCapability() { return readReceipt; } },
  }));
  await issuer.authenticate();
  let fetchCalls = 0;
  const capturedVerifier = issuer.verifyCapability;
  const remote = RemoteV2.createRemoteAdapter({
    baseUrl: RemoteV2.APPROVED_FIREBASE_ORIGIN,
    now: () => clock.value,
    verifyCapability: capturedVerifier,
    fetchImpl: async () => {
      fetchCalls += 1;
      return response(200, Sync.emptyDocument(), { etag: '"unexpected"' });
    },
  });
  await assert.rejects(
    () => remote.putCanonical(Sync.CANONICAL_NODE, Sync.emptyDocument(), '"etag"'),
    RemoteV2.RemoteAuthorizationError
  );
  assert.strictEqual(fetchCalls, 0, 'a captured read receipt must never authorize a write fetch');
}

function cooperativeDelayed(signal, onSideEffect, result, delay = 20) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onSideEffect();
      resolve(result);
    }, delay);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
}

async function testAllAdapterTimeoutsAbortBeforeCooperativeSideEffects() {
  const waitPastSideEffect = () => new Promise(resolve => setTimeout(resolve, 30));

  {
    const storage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: deviceRaw('unknown-token') });
    let signal = null;
    let sideEffects = 0;
    const issuer = Auth.createAuthIssuer(issuerOptions(storage, { value: 100_000 }, {
      factorTimeoutMs: 5,
      factorAdapter: {
        verify(request) {
          signal = request.signal;
          return cooperativeDelayed(signal, () => { sideEffects += 1; }, { allowed: true });
        },
      },
    }));
    assert.deepStrictEqual(await issuer.authenticate({ pin: '2468' }), { allowed: false, reason: 'factor_timeout' });
    await waitPastSideEffect();
    assert.strictEqual(signal.aborted, true);
    assert.strictEqual(sideEffects, 0);
  }

  {
    const storage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: deviceRaw('registration-read-token') });
    let signal = null;
    let sideEffects = 0;
    const issuer = Auth.createAuthIssuer(issuerOptions(storage, { value: 101_000 }, {
      registrationTimeoutMs: 5,
      registrationAdapter: {
        readWindow(request) {
          signal = request.signal;
          return cooperativeDelayed(signal, () => { sideEffects += 1; }, {});
        },
        async writeCandidate() { throw new Error('must not run'); },
      },
    }));
    assert.deepStrictEqual(await issuer.authenticateRegistration(), { allowed: false, reason: 'registration_timeout' });
    await waitPastSideEffect();
    assert.strictEqual(signal.aborted, true);
    assert.strictEqual(sideEffects, 0);
  }

  {
    const clock = { value: 102_000 };
    const storage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: deviceRaw('registration-write-token') });
    let signal = null;
    let sideEffects = 0;
    const issuer = Auth.createAuthIssuer(issuerOptions(storage, clock, {
      registrationTimeoutMs: 5,
      registrationAdapter: {
        async readWindow() { return registrationWindow(clock, { networkReceiptId: 'write-timeout-read' }); },
        writeCandidate(payload, control) {
          signal = control.signal;
          return cooperativeDelayed(signal, () => { sideEffects += 1; }, {
            ok: true,
            recordedAt: clock.value,
            receiptId: 'too-late',
          });
        },
      },
    }));
    assert.deepStrictEqual(await issuer.authenticateRegistration(), { allowed: false, reason: 'registration_timeout' });
    await waitPastSideEffect();
    assert.strictEqual(signal.aborted, true);
    assert.strictEqual(sideEffects, 0);
  }

  {
    const clock = { value: 103_000 };
    const storage = memoryStorage({ [Auth.AUTH_DEVICE_KEY]: deviceRaw('factory-token') });
    let signal = null;
    let sideEffects = 0;
    const issuer = Auth.createAuthIssuer(issuerOptions(storage, clock, {
      capabilityTimeoutMs: 5,
      remoteAdapter: {
        verifyCapability(request) {
          signal = request.signal;
          return cooperativeDelayed(signal, () => { sideEffects += 1; }, validReceipt(clock.value));
        },
      },
    }));
    await issuer.authenticate();
    assert.deepStrictEqual(
      await issuer.verifyCapability({ operation: 'read', node: POLICY.node }),
      { allowed: false, reason: 'capability_timeout' }
    );
    await waitPastSideEffect();
    assert.strictEqual(signal.aborted, true);
    assert.strictEqual(sideEffects, 0);
  }
}

async function testBrowserSourceHasNoBuiltInNetwork() {
  const source = fs.readFileSync(path.join(ROOT, 'v2', 'order-auth-v2.js'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest/i);
  assert.doesNotMatch(source, /Math\.random|Date\.now\(\).*token|new Date\(\).*token/i);
  assert.match(source, /randomUUID|getRandomValues/);
}

async function main() {
  const tests = [
    testExactTrustedAutoAndFreshIdentity,
    testAllThreeExactHashesAndWrongToken,
    testCapabilityPolicyCannotBeOverridden,
    testLegacyReadOnlyImport,
    testEmptyStorageGeneratesDurableDeviceAndRegistrationWorks,
    testNonStringTokensPreserveRawAndDeny,
    testLabelsAndCandidateRowsNeverTrust,
    testPinRequiresExplicitFactorAndTimeoutFailsClosed,
    testPinMustBePrimitiveExactFourDigits,
    testFreshRegistrationSuccessAndNoSecretLeak,
    testRegistrationChangedExpiredAutoApproveAndWriteFail,
    testRegistrationSecondFetchMustFollowWriteCompletion,
    testCapabilityReceiptAndSessionExpiry,
    testCapabilityIsSingleOperationAndRejectsFutureReceipt,
    testMalformedStoragePreservedAndDenied,
    testFlatIssuerReceiptDrivesRemoteGetAndPut,
    testCapturedVerifierCannotReuseReadReceiptForWrite,
    testAllAdapterTimeoutsAbortBeforeCooperativeSideEffects,
    testBrowserSourceHasNoBuiltInNetwork,
  ];
  for (const test of tests) {
    await test();
    console.log(`PASS ${test.name}`);
  }
  console.log(`PASS OrderHelper v2 auth capability issuer (${tests.length} tests)`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
