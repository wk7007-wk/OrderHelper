(function (root, factory) {
  const syncApi = root?.OrderHelperSyncV2 || (typeof require === 'function' ? require('../sync/order-sync-v2.js') : null);
  const api = factory(syncApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrderHelperRemoteV2 = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Sync) {
  'use strict';

  if (!Sync) throw new Error('OrderHelper v2 sync dependency is required');

  const DEFAULT_TIMEOUT_MS = 5000;
  const MAX_TIMEOUT_MS = 15000;
  const MAX_CAPABILITY_AGE_MS = 30000;
  const APPROVED_FIREBASE_ORIGIN = 'https://poskds-4ba60-default-rtdb.asia-southeast1.firebasedatabase.app';

  class RemotePathError extends Error {
    constructor(message) { super(message); this.name = 'RemotePathError'; }
  }
  class RemoteAuthorizationError extends Error {
    constructor(message) { super(message); this.name = 'RemoteAuthorizationError'; }
  }
  class RemoteTimeoutError extends Error {
    constructor(message) { super(message); this.name = 'RemoteTimeoutError'; }
  }
  class RemoteResponseError extends Error {
    constructor(message) { super(message); this.name = 'RemoteResponseError'; }
  }

  function byteSize(text) {
    return typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(text).length
      : unescape(encodeURIComponent(text)).length;
  }

  function exactNode(path) {
    if (path !== Sync.CANONICAL_NODE) throw new RemotePathError('only the v2 canonical node is allowed');
    return path;
  }

  function normalizeBaseUrl(value) {
    let parsed;
    try { parsed = new URL(String(value || '')); } catch (_) { throw new RemotePathError('a fixed HTTPS Firebase base URL is required'); }
    if (parsed.origin !== APPROVED_FIREBASE_ORIGIN || parsed.pathname !== '/' ||
        parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new RemotePathError('a fixed HTTPS Firebase base URL is required');
    }
    return APPROVED_FIREBASE_ORIGIN;
  }

  function validEtag(value, required = true) {
    if (value === null || value === undefined || value === '') {
      if (required) throw new RemoteResponseError('ETag is required');
      return null;
    }
    const etag = String(value);
    if (etag.length > 512 || /[\r\n]/.test(etag)) throw new RemoteResponseError('ETag is invalid');
    return etag;
  }

  function createRemoteAdapter(options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    if (typeof options.fetchImpl !== 'function') throw new TypeError('injected fetch implementation required');
    const fetchImpl = options.fetchImpl;
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const timeoutMs = Math.max(1, Math.min(MAX_TIMEOUT_MS, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)));
    const capabilityVerifier = options.verifyCapability;

    async function verifyCapabilityBounded(operation, node) {
      if (typeof capabilityVerifier !== 'function') throw new RemoteAuthorizationError('capability verifier unavailable');
      const controller = new AbortController();
      let timer;
      const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new RemoteTimeoutError('capability verification timed out'));
        }, timeoutMs);
      });
      try {
        return await Promise.race([
          Promise.resolve().then(() => capabilityVerifier({ operation, node, now: Number(now()), signal: controller.signal })),
          timeout
        ]);
      } catch (error) {
        if (error instanceof RemoteTimeoutError) throw error;
        throw new RemoteAuthorizationError('capability verification failed');
      } finally {
        clearTimeout(timer);
      }
    }

    async function authorize(operation, node) {
      const receipt = await verifyCapabilityBounded(operation, node);
      const current = Number(now());
      const verifiedAt = Number(receipt?.verifiedAt);
      const expiresAt = Number(receipt?.expiresAt);
      const allowed = receipt?.decision === 'allow' &&
        receipt?.capability === 'orderhelper_v2_canonical' &&
        receipt?.node === Sync.CANONICAL_NODE &&
        receipt?.origin === APPROVED_FIREBASE_ORIGIN &&
        Array.isArray(receipt?.operations) && receipt.operations.includes(operation) &&
        typeof receipt?.receiptId === 'string' && receipt.receiptId.length > 0 && receipt.receiptId.length <= 160 &&
        Number.isFinite(verifiedAt) && verifiedAt <= current && current - verifiedAt <= MAX_CAPABILITY_AGE_MS &&
        Number.isFinite(expiresAt) && expiresAt > current;
      if (!allowed) throw new RemoteAuthorizationError('fresh canonical capability denied');
    }

    async function fetchBounded(url, request) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        return await fetchImpl(url, { ...request, signal: controller.signal });
      } catch (error) {
        if (timedOut || error?.name === 'AbortError') throw new RemoteTimeoutError('canonical request timed out');
        throw new RemoteResponseError('canonical transport failed');
      } finally {
        clearTimeout(timer);
      }
    }

    function validateStatus(response, allowPrecondition = false) {
      const status = Number(response?.status);
      if (!Number.isInteger(status) || status < 100 || status > 599) throw new RemoteResponseError('invalid canonical response status');
      if (allowPrecondition && status === 412) return status;
      if (status < 200 || status >= 300) throw new RemoteResponseError('canonical request rejected with status ' + status);
      return status;
    }

    async function readCanonicalBody(response) {
      let raw;
      try { raw = await response.text(); } catch (_) { throw new RemoteResponseError('canonical response body unavailable'); }
      if (byteSize(raw) > Sync.MAX_CANONICAL_BYTES) throw new RemoteResponseError('canonical response exceeds size budget');
      let parsed;
      try { parsed = JSON.parse(raw); } catch (_) { throw new RemoteResponseError('canonical response JSON is malformed'); }
      try {
        const document = parsed === null ? Sync.emptyDocument() : Sync.normalizeDocument(parsed);
        Sync.assertCanonicalSizeBudget(document);
        return document;
      } catch (error) {
        if (error instanceof RemoteResponseError) throw error;
        throw new RemoteResponseError('canonical response schema is invalid');
      }
    }

    async function getCanonical(path) {
      const node = exactNode(path);
      await authorize('read', node);
      const response = await fetchBounded(baseUrl + node + '.json', {
        method: 'GET',
        cache: 'no-store',
        headers: { 'X-Firebase-ETag': 'true', Accept: 'application/json' }
      });
      const status = validateStatus(response);
      const etag = validEtag(response.headers?.get?.('etag'));
      const body = await readCanonicalBody(response);
      return { status, etag, body };
    }

    async function putCanonical(path, documentSource, suppliedEtag) {
      const node = exactNode(path);
      await authorize('write', node);
      const etag = validEtag(suppliedEtag);
      let document;
      let body;
      try {
        const rawBody = JSON.stringify(documentSource);
        if (byteSize(rawBody) > Sync.MAX_CANONICAL_BYTES) throw new Error('oversize');
        document = Sync.normalizeDocument(documentSource);
        Sync.assertCanonicalSizeBudget(document);
        body = JSON.stringify(document);
      } catch (_) {
        throw new RemoteResponseError('canonical request body is invalid or oversized');
      }
      const response = await fetchBounded(baseUrl + node + '.json', {
        method: 'PUT',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Firebase-ETag': 'true',
          'if-match': etag
        },
        body
      });
      const status = validateStatus(response, true);
      const responseEtag = validEtag(response.headers?.get?.('etag'), status !== 412);
      if (status === 412) return { status, etag: responseEtag };
      const responseBody = await readCanonicalBody(response);
      return { status, etag: responseEtag, body: responseBody };
    }

    return Object.freeze({ getCanonical, putCanonical, officialCanonicalAdapter: true });
  }

  return Object.freeze({
    DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    APPROVED_FIREBASE_ORIGIN,
    RemotePathError,
    RemoteAuthorizationError,
    RemoteTimeoutError,
    RemoteResponseError,
    createRemoteAdapter
  });
}));
