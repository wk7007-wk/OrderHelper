'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Cutover = require('../v2/order-cutover-v2.js');
const Sync = require('../sync/order-sync-v2.js');
const ControllerV2 = require('../v2/order-sync-controller-v2.js');

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

function memoryStorage() {
  const values = new Map();
  return { getItem(key) { return values.get(key) || null; }, setItem(key, value) { values.set(key, String(value)); } };
}

const officialAdapter = Object.freeze({
  officialCanonicalAdapter: true,
  async getCanonical() { throw new Error('must remain inert without a confirmed outbox'); },
  async putCanonical() { throw new Error('must remain inert without a confirmed outbox'); },
});

Cutover.resetRuntimeForTest();
assert.throws(
  () => ControllerV2.createController({ storage: memoryStorage(), remoteAdapter: officialAdapter, actorId: 'phone.bootstrap' }),
  /cutover route is installed/,
  'official v2 remote bootstrap must fail closed with no route/control/capability'
);
assert.strictEqual(Cutover.claimWriteOwner('v1'), true, 'default route preserves the current v1 write owner');
assert.strictEqual(Cutover.installRuntimeControl(active).installed, false, 'v1 owner prevents an in-place active takeover');

Cutover.resetRuntimeForTest();
assert.strictEqual(Cutover.installRuntimeControl(active).installed, true);
assert.strictEqual(Cutover.claimWriteOwner('v2'), true, 'active control grants only the v2 canonical write owner');
assert.strictEqual(Cutover.claimWriteOwner('v1'), false, 'active v2 cannot coexist with a v1 write owner');
assert.strictEqual(Cutover.releaseWriteOwner('v2'), true);
assert.strictEqual(Cutover.installRuntimeControl({ phase: 'rollback' }).installed, true);
assert.strictEqual(Cutover.claimWriteOwner('v2'), false, 'rollback cannot leave v2 writes enabled');
assert.strictEqual(Cutover.claimWriteOwner('v1'), false, 'rollback keeps legacy writes read-only instead of silently falling back');
Cutover.resetRuntimeForTest();

const legacySource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.match(legacySource, /src="\.\/sync\/order-sync-v2\.js"/, 'v1 must load the shared cutover dependency before its write code');
assert.match(legacySource, /function claimLegacyOrderWriteOwner\(/, 'v1 must have an explicit write-owner fence');
['putPhoneWinsTargets', 'putFirebasePayloadWithLedgerCas', 'putConfirmedSaveTargets'].forEach(name => {
  const start = legacySource.indexOf('async function ' + name);
  assert(start >= 0 && legacySource.slice(start, start + 260).includes('claimLegacyOrderWriteOwner()'), name + ' must be fenced before network work');
});

console.log('PASS OrderHelper v2 two-device cutover and no-silent-fallback gate');
