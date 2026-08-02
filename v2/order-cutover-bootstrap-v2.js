(function attachOrderHelperCutoverBootstrapV2(root, factory) {
  'use strict';
  const cutoverApi = root?.OrderHelperCutoverV2
    || (typeof require === 'function' ? require('./order-cutover-v2.js') : null);
  const remoteApi = root?.OrderHelperRemoteV2
    || (typeof require === 'function' ? require('./order-remote-v2.js') : null);
  const api = factory(cutoverApi, remoteApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrderHelperCutoverBootstrapV2 = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCutoverBootstrapApi(CutoverV2, RemoteV2) {
  'use strict';

  if (!CutoverV2 || !RemoteV2) throw new Error('OrderHelper v2 cutover and remote dependencies are required');

  const CONTROL_SCHEMA_VERSION = 1;
  const CONTROL_CAPABILITY = 'orderhelper_v2_cutover_control_read';
  const MAX_RECEIPT_AGE_MS = 30_000;
  const MAX_TIMEOUT_MS = 5_000;
  const SAFE_RECEIPT_ID = /^[A-Za-z0-9._:-]{1,160}$/;

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeReadReceipt(receipt, now) {
    if (!isRecord(receipt) || receipt.decision !== 'allow'
      || receipt.capability !== CONTROL_CAPABILITY
      || receipt.node !== CutoverV2.CONTROL_NODE
      || receipt.origin !== RemoteV2.APPROVED_FIREBASE_ORIGIN
      || !Array.isArray(receipt.operations) || receipt.operations.length !== 1 || receipt.operations[0] !== 'read'
      || typeof receipt.receiptId !== 'string' || !SAFE_RECEIPT_ID.test(receipt.receiptId)) return null;
    const verifiedAt = Number(receipt.verifiedAt);
    const expiresAt = Number(receipt.expiresAt);
    if (!Number.isFinite(verifiedAt) || verifiedAt > now || now - verifiedAt > MAX_RECEIPT_AGE_MS
      || !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt <= verifiedAt) return null;
    return Object.freeze({
      decision: 'allow', capability: CONTROL_CAPABILITY, node: CutoverV2.CONTROL_NODE,
      origin: RemoteV2.APPROVED_FIREBASE_ORIGIN, operations: Object.freeze(['read']),
      receiptId: receipt.receiptId, verifiedAt, expiresAt
    });
  }

  function normalizeBootstrapControl(source) {
    if (!isRecord(source) || Number(source.schemaVersion) !== CONTROL_SCHEMA_VERSION
      || source.owner !== 'v2' || source.writeFence !== 'v1_projection_only') return null;
    const route = CutoverV2.selectRuntimeRoute(source);
    if (route.mode !== 'canonical_active' && route.mode !== 'legacy_active_v2_shadow') return null;
    return Object.freeze({ ...source });
  }

  async function readWithTimeout(reader, now, timeoutMs) {
    if (!reader || typeof reader.readControl !== 'function' || typeof reader.writeControl === 'function') {
      return Object.freeze({ status: 'reader_unavailable' });
    }
    const boundedTimeout = Math.max(1, Math.min(MAX_TIMEOUT_MS, Number(timeoutMs || MAX_TIMEOUT_MS)));
    const controller = new AbortController();
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => reader.readControl(Object.freeze({
          node: CutoverV2.CONTROL_NODE,
          operation: 'read',
          signal: controller.signal,
          requestedAt: now,
        }))),
        new Promise(resolve => {
          timer = setTimeout(() => { controller.abort(); resolve(null); }, boundedTimeout);
        })
      ]);
      if (!isRecord(result)) return Object.freeze({ status: 'network_or_malformed' });
      return result;
    } catch (_) {
      return Object.freeze({ status: 'network_or_malformed' });
    } finally {
      clearTimeout(timer);
    }
  }

  async function bootstrap(options = {}) {
    const clock = typeof options.now === 'function' ? options.now : Date.now;
    const requestedAt = Number(clock());
    if (!Number.isFinite(requestedAt) || requestedAt <= 0) return Object.freeze({ status: 'clock_invalid' });
    const result = await readWithTimeout(options.reader, requestedAt, options.timeoutMs);
    if (result.status) return result;
    // Control reads are asynchronous.  Re-sample the clock before accepting
    // the capability receipt so it cannot authorize v2 after it has expired.
    const validatedAt = Number(clock());
    if (!Number.isFinite(validatedAt) || validatedAt <= 0) return Object.freeze({ status: 'clock_invalid' });
    const receipt = normalizeReadReceipt(result.receipt, validatedAt);
    if (!receipt) return Object.freeze({ status: 'unauthorized_or_stale' });
    const control = normalizeBootstrapControl(result.control);
    if (!control) return Object.freeze({ status: 'control_invalid' });
    const installed = CutoverV2.installRuntimeControl(control);
    if (!installed.installed) return Object.freeze({ status: 'owner_fence_requires_reload', route: installed.route });
    return Object.freeze({ status: 'installed_read_only', receipt, route: installed.route });
  }

  return Object.freeze({
    CONTROL_SCHEMA_VERSION,
    CONTROL_CAPABILITY,
    MAX_RECEIPT_AGE_MS,
    normalizeReadReceipt,
    normalizeBootstrapControl,
    bootstrap,
  });
}));
