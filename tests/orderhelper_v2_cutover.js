'use strict';

const assert = require('assert');
const Cutover = require('../v2/order-cutover-v2.js');
const Sync = require('../sync/order-sync-v2.js');

const now = 10_000_000;
const sourceFingerprint = 'a1b2c3d4';
const appVersion = '0803.sync-shadow.1';
const shadow = { phase: 'shadow', cutoverId: 'cutover-1', expectedAppVersion: appVersion, sourceFingerprint };
function ready(role, deviceHash, at = now) {
  return Cutover.buildReadinessReceipt({
    role,
    deviceHash,
    observedAt: at,
    sourceFingerprint,
    appVersion,
    shadowReadPassed: true,
    localDraftProtected: true,
    externalOrderWriteCount: 0,
  }, now);
}

const phone = ready('personal-phone', '1'.repeat(64));
const pc = ready('factory-pc', '2'.repeat(64));
assert.strictEqual(Cutover.evaluateActivationCandidate(shadow, { 'personal-phone': phone }, now).allowed, false);
assert.strictEqual(Cutover.evaluateActivationCandidate(shadow, { 'personal-phone': phone, 'factory-pc': pc }, now).allowed, true);
assert.match(Cutover.evaluateActivationCandidate(shadow, {
  'personal-phone': phone,
  'factory-pc': { ...pc, observedAt: now - Cutover.MAX_READY_AGE_MS - 1 },
}, now).reason, /factory-pc/);
assert.strictEqual(Cutover.evaluateActivationCandidate(shadow, {
  'personal-phone': phone,
  'factory-pc': { ...pc, deviceHash: phone.deviceHash },
}, now).reason, 'distinct_physical_devices_required');

assert.deepStrictEqual(Cutover.selectRuntimeRoute(null), { mode: 'legacy_active_no_cutover', allowV1Writes: true });
assert.deepStrictEqual(Cutover.selectRuntimeRoute(shadow), { mode: 'legacy_active_v2_shadow', allowV1Writes: true });
assert.strictEqual(Cutover.selectRuntimeRoute({ phase: 'active' }).allowV1Writes, false, 'invalid active control must fail closed');
assert.strictEqual(Cutover.selectRuntimeRoute({ phase: 'rollback' }).mode, 'rollback_v1_read_only');
const active = {
  phase: 'active',
  cutoverId: 'cutover-1',
  canonicalFingerprint: 'deadbeef',
  sourceFingerprint,
  canonicalNode: Sync.CANONICAL_NODE,
  activatedAt: now,
  approvedBy: 'physical-gate',
  v1WriteMode: 'projection_only',
};
assert.strictEqual(Cutover.selectRuntimeRoute(active).mode, 'canonical_active');
assert.strictEqual(Cutover.selectRuntimeRoute(active).allowV1Writes, false);

console.log('PASS OrderHelper v2 two-device cutover and no-silent-fallback gate');
