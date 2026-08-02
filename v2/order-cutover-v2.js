(function attachOrderHelperCutoverV2(root, factory) {
  'use strict';
  const syncApi = root?.OrderHelperSyncV2
    || (typeof require === 'function' ? require('../sync/order-sync-v2.js') : null);
  const api = factory(syncApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrderHelperCutoverV2 = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCutoverApi(Sync) {
  'use strict';

  if (!Sync) throw new Error('OrderHelper v2 sync dependency is required');

  const CONTROL_NODE = '/order/desk_q7m9r3a8/syncV2/control';
  const READINESS_NODE = '/order/desk_q7m9r3a8/syncV2/readiness';
  const REQUIRED_ROLES = Object.freeze(['personal-phone', 'factory-pc']);
  const MAX_READY_AGE_MS = 15 * 60 * 1000;
  const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;
  const SAFE_HASH = /^[a-f0-9]{8,64}$/;
  const SAFE_DEVICE_HASH = /^[a-f0-9]{64}$/;

  function boundedText(value, max = 80) {
    return String(value || '').trim().slice(0, max);
  }

  function validRole(value) {
    const role = boundedText(value, 40);
    return REQUIRED_ROLES.includes(role) ? role : '';
  }

  function normalizeReadiness(source, now = Date.now()) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const role = validRole(source.role);
    const deviceHash = boundedText(source.deviceHash, 64).toLowerCase();
    const observedAt = Number(source.observedAt || 0);
    const sourceFingerprint = boundedText(source.sourceFingerprint, 64).toLowerCase();
    const appVersion = boundedText(source.appVersion, 40);
    if (!role || !SAFE_DEVICE_HASH.test(deviceHash) || !SAFE_HASH.test(sourceFingerprint)
        || !Number.isFinite(observedAt) || observedAt <= 0 || observedAt > now + 1000
        || now - observedAt > MAX_READY_AGE_MS || !appVersion
        || source.shadowReadPassed !== true || source.localDraftProtected !== true
        || source.externalOrderWriteCount !== 0) return null;
    return Object.freeze({
      schemaVersion: 1,
      role,
      deviceHash,
      observedAt,
      sourceFingerprint,
      appVersion,
      shadowReadPassed: true,
      localDraftProtected: true,
      externalOrderWriteCount: 0,
    });
  }

  function buildReadinessReceipt(input = {}, now = Date.now()) {
    const receipt = normalizeReadiness({ ...input, observedAt: Number(input.observedAt || now) }, now);
    if (!receipt) throw new TypeError('invalid OrderHelper v2 readiness evidence');
    return receipt;
  }

  function normalizeShadowControl(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source) || source.phase !== 'shadow') return null;
    const cutoverId = boundedText(source.cutoverId, 160);
    const expectedAppVersion = boundedText(source.expectedAppVersion, 40);
    const sourceFingerprint = boundedText(source.sourceFingerprint, 64).toLowerCase();
    return SAFE_ID.test(cutoverId) && expectedAppVersion && SAFE_HASH.test(sourceFingerprint)
      ? Object.freeze({ phase: 'shadow', cutoverId, expectedAppVersion, sourceFingerprint })
      : null;
  }

  function evaluateActivationCandidate(controlSource, readinessSource, now = Date.now()) {
    const control = normalizeShadowControl(controlSource);
    if (!control) return Object.freeze({ allowed: false, reason: 'shadow_control_invalid' });
    const receipts = readinessSource && typeof readinessSource === 'object' && !Array.isArray(readinessSource)
      ? readinessSource : {};
    const normalized = {};
    for (const role of REQUIRED_ROLES) {
      const receipt = normalizeReadiness(receipts[role], now);
      if (!receipt) return Object.freeze({ allowed: false, reason: `readiness_missing:${role}` });
      if (receipt.role !== role || receipt.appVersion !== control.expectedAppVersion
          || receipt.sourceFingerprint !== control.sourceFingerprint) {
        return Object.freeze({ allowed: false, reason: `readiness_mismatch:${role}` });
      }
      normalized[role] = receipt;
    }
    if (normalized['personal-phone'].deviceHash === normalized['factory-pc'].deviceHash) {
      return Object.freeze({ allowed: false, reason: 'distinct_physical_devices_required' });
    }
    return Object.freeze({
      allowed: true,
      cutoverId: control.cutoverId,
      expectedAppVersion: control.expectedAppVersion,
      sourceFingerprint: control.sourceFingerprint,
      roles: Object.freeze({ ...normalized }),
    });
  }

  function normalizeActiveControl(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source) || source.phase !== 'active') return null;
    const cutoverId = boundedText(source.cutoverId, 160);
    const canonicalFingerprint = boundedText(source.canonicalFingerprint, 64).toLowerCase();
    const sourceFingerprint = boundedText(source.sourceFingerprint, 64).toLowerCase();
    const activatedAt = Number(source.activatedAt || 0);
    const approvedBy = boundedText(source.approvedBy, 80);
    if (!SAFE_ID.test(cutoverId) || !SAFE_HASH.test(canonicalFingerprint)
        || !SAFE_HASH.test(sourceFingerprint) || !Number.isFinite(activatedAt)
        || activatedAt <= 0 || !approvedBy || source.canonicalNode !== Sync.CANONICAL_NODE
        || source.v1WriteMode !== 'projection_only') return null;
    return Object.freeze({
      phase: 'active', cutoverId, canonicalFingerprint, sourceFingerprint,
      activatedAt, approvedBy, canonicalNode: Sync.CANONICAL_NODE,
      v1WriteMode: 'projection_only'
    });
  }

  // The critical invariant: after activation, a malformed/unavailable control
  // never falls back to legacy writes. That would recreate split-brain state.
  function selectRuntimeRoute(controlSource) {
    if (controlSource?.phase === 'active') {
      const active = normalizeActiveControl(controlSource);
      return active
        ? Object.freeze({ mode: 'canonical_active', canonicalNode: Sync.CANONICAL_NODE, allowV1Writes: false, control: active })
        : Object.freeze({ mode: 'blocked_active_control_invalid', allowV1Writes: false });
    }
    if (controlSource?.phase === 'rollback') {
      return Object.freeze({ mode: 'rollback_v1_read_only', allowV1Writes: false });
    }
    if (controlSource?.phase === 'shadow') {
      return normalizeShadowControl(controlSource)
        ? Object.freeze({ mode: 'legacy_active_v2_shadow', allowV1Writes: true })
        : Object.freeze({ mode: 'blocked_shadow_control_invalid', allowV1Writes: false });
    }
    return Object.freeze({ mode: 'legacy_active_no_cutover', allowV1Writes: true });
  }

  return Object.freeze({
    CONTROL_NODE,
    READINESS_NODE,
    REQUIRED_ROLES,
    MAX_READY_AGE_MS,
    buildReadinessReceipt,
    normalizeReadiness,
    evaluateActivationCandidate,
    normalizeActiveControl,
    selectRuntimeRoute,
  });
}));
