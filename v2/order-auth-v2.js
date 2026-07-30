(function attachOrderHelperAuthV2(root, factory) {
  'use strict';

  const syncApi = root?.OrderHelperSyncV2
    || (typeof require === 'function' ? require('../sync/order-sync-v2.js') : null);
  const remoteApi = root?.OrderHelperRemoteV2
    || (typeof require === 'function' ? require('./order-remote-v2.js') : null);
  const api = factory(root, syncApi, remoteApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrderHelperAuthV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAuthApi(root, Sync, RemoteV2) {
  'use strict';

  if (!Sync || !RemoteV2) throw new Error('OrderHelper v2 sync and remote dependencies are required');

  const LEGACY_AUTH_DEVICE_KEY = 'bbq_desk_auth_device_v1';
  const AUTH_DEVICE_KEY = 'orderhelper_v2_auth_device_v1';
  const DEFAULT_PIN_HASH = '38083c7ee9121e17401883566a148aa5c2e2d55dc53bc4a94a026517dbff3c6b';
  const TRUSTED_DEVICE_HASHES = Object.freeze([
    '20d3878e2c09054563c1008f264a1e04fffe6aa844de86304233f08b04764491',
    'b102528da17d98d3c8879417170b85552ddbb4059bf2c4f0684801db3e0c4eb6',
    '3478b8091ca76988cdc84079f963c4c224b1d440d2748439bf9ca0a61952c6d3',
  ]);
  const TRUSTED_DEVICE_HASH_SET = new Set(TRUSTED_DEVICE_HASHES);
  const MAX_SESSION_MS = 60 * 60 * 1000;
  const MAX_REGISTRATION_WINDOW_MS = 60 * 60 * 1000;
  const DEFAULT_SESSION_MS = 15 * 60 * 1000;
  const DEFAULT_TIMEOUT_MS = 5_000;
  const DEFAULT_RECEIPT_FRESH_MS = 30_000;
  const DEFAULT_CAPABILITY_RECEIPT_MS = 5 * 60 * 1000;
  const SAFE_RECEIPT_ID = /^[A-Za-z0-9._:-]{1,160}$/;
  const SAFE_WINDOW_ID = /^[A-Za-z0-9_-]{1,80}$/;
  const SHA256_HEX = /^[a-f0-9]{64}$/;
  const DEFAULT_CAPABILITY_POLICY = Object.freeze({
    capability: 'orderhelper_v2_canonical',
    node: Sync.CANONICAL_NODE,
    origin: RemoteV2.APPROVED_FIREBASE_ORIGIN,
    operations: Object.freeze(['read', 'write']),
    readwrite: 'readwrite',
  });

  class AuthStorageError extends Error {
    constructor(message) { super(message); this.name = 'AuthStorageError'; }
  }

  class AuthFlowError extends Error {
    constructor(reason) { super(reason); this.name = 'AuthFlowError'; this.reason = reason; }
  }

  function denied(reason) {
    return Object.freeze({ allowed: false, reason });
  }

  function defaultStorage() {
    try { return root && root.localStorage ? root.localStorage : null; } catch (_) { return null; }
  }

  function defaultCryptoAdapter() {
    const subtle = root?.crypto?.subtle;
    const Encoder = root?.TextEncoder;
    if (!subtle || !Encoder) return null;
    return {
      async sha256(value) {
        const bytes = await subtle.digest('SHA-256', new Encoder().encode(String(value)));
        return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
      },
    };
  }

  function defaultDeviceTokenGenerator() {
    const crypto = root?.crypto;
    if (typeof crypto?.randomUUID === 'function') {
      return () => `ohv2_${crypto.randomUUID()}`;
    }
    if (typeof crypto?.getRandomValues === 'function') {
      return () => {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        return `ohv2_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
      };
    }
    return null;
  }

  function defaultTimerAdapter() {
    if (!root?.setTimeout || !root?.clearTimeout) return null;
    return {
      setTimeout: root.setTimeout.bind(root),
      clearTimeout: root.clearTimeout.bind(root),
    };
  }

  function requireStorage(storage) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new TypeError('localStorage-compatible auth storage is required');
    }
  }

  function parseDeviceRaw(raw) {
    let source;
    try { source = JSON.parse(raw); } catch (_) { throw new AuthStorageError('auth device JSON is malformed'); }
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new AuthStorageError('auth device record is invalid');
    if (typeof source.token !== 'string' || !source.token || source.token.length > 512) {
      throw new AuthStorageError('auth device token is invalid');
    }
    const token = source.token;
    const createdAt = Number(source.createdAt || 0);
    return {
      schemaVersion: 1,
      token,
      createdAt: Number.isFinite(createdAt) && createdAt >= 0 ? createdAt : 0,
    };
  }

  async function loadOrCreateDevice(storage, tokenGenerator, now) {
    requireStorage(storage);
    const currentRaw = storage.getItem(AUTH_DEVICE_KEY);
    if (currentRaw !== null) return parseDeviceRaw(currentRaw);
    const legacyRaw = storage.getItem(LEGACY_AUTH_DEVICE_KEY);
    let device;
    if (legacyRaw !== null) {
      device = parseDeviceRaw(legacyRaw);
    } else {
      if (typeof tokenGenerator !== 'function') throw new AuthFlowError('identity_generator_unavailable');
      const generated = await tokenGenerator();
      if (typeof generated !== 'string' || !generated || generated.length > 512) {
        throw new AuthFlowError('identity_generation_failed');
      }
      const createdAt = Number(now());
      if (!Number.isFinite(createdAt) || createdAt < 0) throw new AuthFlowError('identity_generation_failed');
      device = { schemaVersion: 1, token: generated, createdAt };
    }
    const serialized = JSON.stringify(device);
    storage.setItem(AUTH_DEVICE_KEY, serialized);
    const verifiedRaw = storage.getItem(AUTH_DEVICE_KEY);
    if (verifiedRaw !== serialized) throw new AuthStorageError('v2 auth device durable write verification failed');
    const verified = parseDeviceRaw(verifiedRaw);
    if (!constantTimeTextEqual(verified.token, device.token)) {
      throw new AuthStorageError('v2 auth device durable write verification failed');
    }
    return verified;
  }

  function normalizeHash(value) {
    const hash = String(value || '').toLowerCase();
    if (!SHA256_HEX.test(hash)) throw new AuthFlowError('crypto_invalid');
    return hash;
  }

  function constantTimeTextEqual(left, right) {
    const a = String(left || '');
    const b = String(right || '');
    let difference = a.length ^ b.length;
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
    }
    return difference === 0;
  }

  function boundedDuration(value, fallback, maximum = MAX_SESSION_MS) {
    const duration = Number(value ?? fallback);
    if (!Number.isFinite(duration) || duration <= 0) return fallback;
    return Math.min(maximum, Math.trunc(duration));
  }

  function clonePolicy(policy) {
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new TypeError('capability policy is required');
    const operations = Array.isArray(policy.operations) && policy.operations.every(item => typeof item === 'string')
      ? [...policy.operations]
      : null;
    const normalized = {
      capability: typeof policy.capability === 'string' ? policy.capability : '',
      node: typeof policy.node === 'string' ? policy.node : '',
      origin: typeof policy.origin === 'string' ? policy.origin : '',
      operations,
      readwrite: typeof policy.readwrite === 'string' ? policy.readwrite : '',
    };
    if (!normalized.capability || !normalized.node || !normalized.origin || !operations?.length || !normalized.readwrite) {
      throw new TypeError('capability policy is incomplete');
    }
    return Object.freeze({ ...normalized, operations: Object.freeze(operations) });
  }

  function assertExactCapabilityPolicy(policy) {
    if (policy.capability !== DEFAULT_CAPABILITY_POLICY.capability
      || policy.node !== DEFAULT_CAPABILITY_POLICY.node
      || policy.origin !== DEFAULT_CAPABILITY_POLICY.origin
      || policy.readwrite !== DEFAULT_CAPABILITY_POLICY.readwrite
      || policy.operations.length !== DEFAULT_CAPABILITY_POLICY.operations.length
      || !policy.operations.every((operation, index) => operation === DEFAULT_CAPABILITY_POLICY.operations[index])) {
      throw new TypeError('capability policy must match the fixed OrderHelper v2 remote contract');
    }
  }

  function timestamp(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
  }

  function normalizeRegistrationWindow(source, now, freshMs) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new AuthFlowError('registration_window_invalid');
    const startsAt = timestamp(source.startsAt);
    const expiresAt = timestamp(source.expiresAt);
    const fetchedAt = timestamp(source.fetchedAt);
    const windowId = String(source.windowId || '');
    if (
      source.enabled !== true
      || source.autoApprove !== false
      || !SAFE_WINDOW_ID.test(windowId)
      || !Number.isFinite(startsAt)
      || !Number.isFinite(expiresAt)
      || startsAt > now
      || now >= expiresAt
      || expiresAt <= startsAt
      || expiresAt - startsAt > MAX_REGISTRATION_WINDOW_MS
      || !Number.isFinite(fetchedAt)
      || fetchedAt > now + 1_000
      || now - fetchedAt > freshMs
      || !SAFE_RECEIPT_ID.test(String(source.networkReceiptId || ''))
    ) throw new AuthFlowError('registration_window_invalid');
    return {
      enabled: true,
      autoApprove: false,
      windowId,
      startsAt,
      expiresAt,
      fetchedAt,
      networkReceiptId: String(source.networkReceiptId),
    };
  }

  function sameRegistrationWindow(left, right) {
    return left.windowId === right.windowId
      && left.startsAt === right.startsAt
      && left.expiresAt === right.expiresAt
      && right.enabled === true
      && right.autoApprove === false;
  }

  function createAuthIssuer(options = {}) {
    const storage = options.storage || defaultStorage();
    const cryptoAdapter = options.cryptoAdapter || defaultCryptoAdapter();
    const deviceTokenGenerator = options.deviceTokenGenerator || defaultDeviceTokenGenerator();
    const timerAdapter = options.timerAdapter || defaultTimerAdapter();
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const factorAdapter = options.factorAdapter || null;
    const registrationAdapter = options.registrationAdapter || null;
    const remoteAdapter = options.remoteAdapter || null;
    const pinHash = normalizeHash(options.pinHash || DEFAULT_PIN_HASH);
    if (options.capabilityPolicy !== undefined) {
      assertExactCapabilityPolicy(clonePolicy(options.capabilityPolicy));
    }
    const policy = DEFAULT_CAPABILITY_POLICY;
    const sessionTtlMs = boundedDuration(options.sessionTtlMs, DEFAULT_SESSION_MS);
    const factorTimeoutMs = boundedDuration(options.factorTimeoutMs, DEFAULT_TIMEOUT_MS, 60_000);
    const registrationTimeoutMs = boundedDuration(options.registrationTimeoutMs, DEFAULT_TIMEOUT_MS, 60_000);
    const capabilityTimeoutMs = boundedDuration(options.capabilityTimeoutMs, DEFAULT_TIMEOUT_MS, 60_000);
    const receiptFreshMs = boundedDuration(options.receiptFreshMs, DEFAULT_RECEIPT_FRESH_MS, 5 * 60 * 1000);
    const capabilityReceiptMaxMs = boundedDuration(options.capabilityReceiptMaxMs, DEFAULT_CAPABILITY_RECEIPT_MS, MAX_SESSION_MS);
    let session = null;

    if (!storage || !cryptoAdapter || typeof cryptoAdapter.sha256 !== 'function') {
      throw new TypeError('auth storage and SHA-256 adapter are required');
    }

    function withTimeout(work, milliseconds, timeoutReason, externalSignal = null) {
      if (!timerAdapter || typeof timerAdapter.setTimeout !== 'function' || typeof timerAdapter.clearTimeout !== 'function') {
        return Promise.reject(new AuthFlowError(timeoutReason));
      }
      const AbortControllerType = root?.AbortController;
      if (typeof AbortControllerType !== 'function') return Promise.reject(new AuthFlowError(timeoutReason));
      return new Promise((resolve, reject) => {
        let settled = false;
        const controller = new AbortControllerType();
        let externalAbort = null;
        const finish = (handler, value) => {
          if (settled) return;
          settled = true;
          timerAdapter.clearTimeout(timer);
          if (externalSignal && externalAbort) externalSignal.removeEventListener?.('abort', externalAbort);
          handler(value);
        };
        const timer = timerAdapter.setTimeout(() => {
          controller.abort();
          finish(reject, new AuthFlowError(timeoutReason));
        }, milliseconds);
        if (externalSignal) {
          externalAbort = () => {
            controller.abort();
            finish(reject, new AuthFlowError(timeoutReason));
          };
          if (externalSignal.aborted) return externalAbort();
          externalSignal.addEventListener?.('abort', externalAbort, { once: true });
        }
        // Cancellation is cooperative: adapters must honor this signal before side effects.
        Promise.resolve().then(() => work(controller.signal)).then(
          value => finish(resolve, value),
          error => finish(reject, error)
        );
      });
    }

    async function freshIdentity() {
      const device = await loadOrCreateDevice(storage, deviceTokenGenerator, now);
      const deviceHash = normalizeHash(await cryptoAdapter.sha256(device.token));
      return { deviceHash };
    }

    function establishSession(identity, method, expiresAt) {
      session = Object.freeze({
        deviceHash: identity.deviceHash,
        method,
        expiresAt,
      });
      return Object.freeze({ allowed: true, method, expiresAt });
    }

    async function authenticate(request = {}) {
      session = null;
      let identity;
      try {
        identity = await freshIdentity();
      } catch (error) {
        session = null;
        return denied(error instanceof AuthStorageError ? 'auth_storage_corrupt' : 'identity_unavailable');
      }
      const current = Number(now());
      if (TRUSTED_DEVICE_HASH_SET.has(identity.deviceHash)) {
        return establishSession(identity, 'exact_trusted_device', current + sessionTtlMs);
      }
      if (!Object.prototype.hasOwnProperty.call(request, 'pin')) return denied('additional_auth_required');
      if (typeof request.pin !== 'string' || !/^\d{4}$/.test(request.pin)) return denied('pin_invalid');
      let submittedPinHash;
      try { submittedPinHash = normalizeHash(await cryptoAdapter.sha256(request.pin)); }
      catch (_) { return denied('pin_invalid'); }
      if (!constantTimeTextEqual(submittedPinHash, pinHash)) return denied('pin_invalid');
      if (!factorAdapter || typeof factorAdapter.verify !== 'function') return denied('second_factor_required');
      try {
        const factorResult = await withTimeout(
          signal => factorAdapter.verify(Object.freeze({
            deviceHash: identity.deviceHash,
            purpose: 'orderhelper_v2_auth',
            signal,
          })),
          factorTimeoutMs,
          'factor_timeout',
          request.signal
        );
        if (!factorResult || factorResult.allowed !== true) return denied('second_factor_denied');
      } catch (error) {
        return denied(error instanceof AuthFlowError ? error.reason : 'factor_failed');
      }
      return establishSession(identity, 'pin_plus_factor', Number(now()) + sessionTtlMs);
    }

    async function authenticateRegistration(request = {}) {
      session = null;
      let identity;
      try { identity = await freshIdentity(); }
      catch (error) { return denied(error instanceof AuthStorageError ? 'auth_storage_corrupt' : 'identity_unavailable'); }
      if (!registrationAdapter
        || typeof registrationAdapter.readWindow !== 'function'
        || typeof registrationAdapter.writeCandidate !== 'function') return denied('registration_unavailable');
      try {
        const firstNow = Number(now());
        const first = normalizeRegistrationWindow(
          await withTimeout(
            signal => registrationAdapter.readWindow(Object.freeze({ signal })),
            registrationTimeoutMs,
            'registration_timeout',
            request.signal
          ),
          firstNow,
          receiptFreshMs
        );
        const candidatePayload = Object.freeze({
          candidateOnly: true,
          deviceHash: identity.deviceHash,
          windowId: first.windowId,
          observedAt: firstNow,
        });
        const writeStartedAt = Number(now());
        const writeReceipt = await withTimeout(
          signal => registrationAdapter.writeCandidate(candidatePayload, Object.freeze({ signal })),
          registrationTimeoutMs,
          'registration_timeout',
          request.signal
        );
        const writeNow = Number(now());
        if (!writeReceipt || writeReceipt.ok !== true) return denied('candidate_write_failed');
        const candidateRecordedAt = timestamp(writeReceipt.recordedAt);
        if (!SAFE_RECEIPT_ID.test(String(writeReceipt.receiptId || ''))
          || !Number.isFinite(candidateRecordedAt)
          || candidateRecordedAt < writeStartedAt
          || candidateRecordedAt > writeNow + 1_000
          || writeNow - candidateRecordedAt > receiptFreshMs
          || writeNow >= first.expiresAt) return denied('candidate_write_failed');
        const secondNow = Number(now());
        const second = normalizeRegistrationWindow(
          await withTimeout(
            signal => registrationAdapter.readWindow(Object.freeze({ signal })),
            registrationTimeoutMs,
            'registration_timeout',
            request.signal
          ),
          secondNow,
          receiptFreshMs
        );
        if (!sameRegistrationWindow(first, second)) return denied('registration_window_changed');
        if (first.networkReceiptId === second.networkReceiptId) return denied('registration_window_not_fresh');
        if (second.fetchedAt < first.fetchedAt
          || second.fetchedAt < writeStartedAt
          || second.fetchedAt < writeNow
          || second.fetchedAt < candidateRecordedAt) return denied('registration_window_not_fresh');
        if (Number(now()) >= second.expiresAt) return denied('registration_window_invalid');
        return establishSession(identity, 'registration_window_temporary', second.expiresAt);
      } catch (error) {
        return denied(error instanceof AuthFlowError ? error.reason : 'registration_failed');
      }
    }

    async function validateSessionIdentity() {
      if (!session) return denied('session_required');
      if (Number(now()) >= session.expiresAt) {
        session = null;
        return denied('session_expired');
      }
      let identity;
      try { identity = await freshIdentity(); }
      catch (error) {
        session = null;
        return denied(error instanceof AuthStorageError ? 'auth_storage_corrupt' : 'identity_unavailable');
      }
      if (!constantTimeTextEqual(identity.deviceHash, session.deviceHash)) {
        session = null;
        return denied('identity_changed');
      }
      if (session.method === 'exact_trusted_device' && !TRUSTED_DEVICE_HASH_SET.has(identity.deviceHash)) {
        session = null;
        return denied('identity_changed');
      }
      return { allowed: true };
    }

    function validateCapabilityReceipt(receipt, current, operation) {
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
        || typeof receipt.receiptId !== 'string'
        || !SAFE_RECEIPT_ID.test(receipt.receiptId)
        || receipt.decision !== 'allow'
        || receipt.capability !== policy.capability
        || receipt.node !== policy.node
        || receipt.origin !== policy.origin
        || !Array.isArray(receipt.operations)
        || receipt.operations.length !== 1
        || receipt.operations[0] !== operation
        || receipt.readwrite !== policy.readwrite
        || typeof receipt.verifiedAt !== 'number'
        || typeof receipt.expiresAt !== 'number') return denied('capability_receipt_invalid');
      const verifiedAt = receipt.verifiedAt;
      const expiresAt = receipt.expiresAt;
      if (!Number.isFinite(verifiedAt) || verifiedAt > current || current - verifiedAt > receiptFreshMs) {
        return denied('capability_receipt_stale');
      }
      if (!Number.isFinite(expiresAt) || expiresAt <= current || expiresAt <= verifiedAt || expiresAt - verifiedAt > capabilityReceiptMaxMs) {
        return denied('capability_receipt_invalid');
      }
      return Object.freeze({
        decision: 'allow',
        receiptId: receipt.receiptId,
        capability: policy.capability,
        node: policy.node,
        origin: policy.origin,
        operations: Object.freeze([operation]),
        readwrite: policy.readwrite,
        verifiedAt,
        expiresAt,
      });
    }

    async function verifyCapability(request = {}) {
      const sessionState = await validateSessionIdentity();
      if (!sessionState.allowed) return sessionState;
      const operation = typeof request.operation === 'string' ? request.operation : '';
      const node = typeof request.node === 'string' ? request.node : '';
      if (!policy.operations.includes(operation) || node !== policy.node) return denied('capability_request_invalid');
      if (!remoteAdapter || typeof remoteAdapter.verifyCapability !== 'function') return denied('capability_adapter_unavailable');
      try {
        const receipt = await withTimeout(
          signal => remoteAdapter.verifyCapability(Object.freeze({
            ...policy,
            operations: Object.freeze([operation]),
            operation,
            node,
            requestedAt: Number(now()),
            signal,
          })),
          capabilityTimeoutMs,
          'capability_timeout',
          request.signal
        );
        return validateCapabilityReceipt(receipt, Number(now()), operation);
      } catch (error) {
        return denied(error instanceof AuthFlowError ? error.reason : 'capability_verification_failed');
      }
    }

    function clearSession() {
      session = null;
    }

    return Object.freeze({ authenticate, authenticateRegistration, verifyCapability, clearSession });
  }

  return Object.freeze({
    LEGACY_AUTH_DEVICE_KEY,
    AUTH_DEVICE_KEY,
    DEFAULT_PIN_HASH,
    TRUSTED_DEVICE_HASHES,
    DEFAULT_CAPABILITY_POLICY,
    AuthStorageError,
    AuthFlowError,
    createAuthIssuer,
  });
});
