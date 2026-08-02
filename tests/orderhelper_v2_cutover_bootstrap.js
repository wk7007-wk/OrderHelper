'use strict';

const assert = require('assert');
const Cutover = require('../v2/order-cutover-v2.js');
const Bootstrap = require('../v2/order-cutover-bootstrap-v2.js');
const Remote = require('../v2/order-remote-v2.js');
const Sync = require('../sync/order-sync-v2.js');

const now = 20_000_000;
const active = {
  schemaVersion: 1,
  phase: 'active',
  owner: 'v2',
  writeFence: 'v1_projection_only',
  cutoverId: 'bootstrap-1',
  canonicalFingerprint: 'deadbeef',
  sourceFingerprint: 'a1b2c3d4',
  canonicalNode: Sync.CANONICAL_NODE,
  activatedAt: now,
  approvedBy: 'physical-gate',
  v1WriteMode: 'projection_only',
};

function receipt(overrides = {}) {
  return {
    decision: 'allow', capability: Bootstrap.CONTROL_CAPABILITY, node: Cutover.CONTROL_NODE,
    origin: Remote.APPROVED_FIREBASE_ORIGIN, operations: ['read'], receiptId: 'control-read-1',
    verifiedAt: now, expiresAt: now + 1000, ...overrides
  };
}

async function run() {
  Cutover.resetRuntimeForTest();
  let calls = 0;
  const reader = { async readControl(request) {
    calls += 1;
    assert.strictEqual(request.node, Cutover.CONTROL_NODE);
    assert.strictEqual(request.operation, 'read');
    return { control: active, receipt: receipt() };
  } };
  const installed = await Bootstrap.bootstrap({ reader, now: () => now });
  assert.strictEqual(installed.status, 'installed_read_only');
  assert.strictEqual(installed.route.mode, 'canonical_active');
  assert.strictEqual(calls, 1);
  assert.strictEqual(Cutover.claimWriteOwner('v2'), true, 'only a verified active control can enable v2 ownership');
  Cutover.resetRuntimeForTest();

  const failureCases = [
    [{ control: active, receipt: receipt({ decision: 'deny' }) }, 'unauthorized_or_stale'],
    [{ control: { ...active, schemaVersion: 2 }, receipt: receipt() }, 'control_invalid'],
    [{ control: { ...active, owner: 'v1' }, receipt: receipt() }, 'control_invalid'],
    [{ control: { ...active, writeFence: 'none' }, receipt: receipt() }, 'control_invalid'],
    [{ control: { ...active, canonicalNode: '/wrong' }, receipt: receipt() }, 'control_invalid'],
  ];
  for (const [payload, expected] of failureCases) {
    Cutover.resetRuntimeForTest();
    const result = await Bootstrap.bootstrap({ reader: { async readControl() { return payload; } }, now: () => now });
    assert.strictEqual(result.status, expected);
    assert.strictEqual(Cutover.runtimeRoute().mode, 'legacy_active_no_cutover');
    assert.strictEqual(Cutover.claimWriteOwner('v2'), false, 'invalid bootstrap never enables v2 writes');
    Cutover.resetRuntimeForTest();
  }

  const unavailable = await Bootstrap.bootstrap({ reader: null, now: () => now });
  assert.strictEqual(unavailable.status, 'reader_unavailable');
  const network = await Bootstrap.bootstrap({ reader: { async readControl() { throw new Error('offline'); } }, now: () => now });
  assert.strictEqual(network.status, 'network_or_malformed');
  const writableReader = await Bootstrap.bootstrap({ reader: { async readControl() { return {}; }, async writeControl() {} }, now: () => now });
  assert.strictEqual(writableReader.status, 'reader_unavailable', 'bootstrap accepts a read-only source only');

  // A receipt that expires while the control read is in flight must not enable
  // canonical ownership.  Validating only against request start would create
  // a short post-expiry write window.
  let delayedClock = now;
  Cutover.resetRuntimeForTest();
  const expiredDuringRead = await Bootstrap.bootstrap({
    reader: { async readControl() {
      delayedClock = now + 1001;
      return { control: active, receipt: receipt() };
    } },
    now: () => delayedClock,
  });
  assert.strictEqual(expiredDuringRead.status, 'unauthorized_or_stale');
  assert.strictEqual(Cutover.claimWriteOwner('v2'), false, 'an expired-in-flight receipt never enables v2 writes');

  Cutover.resetRuntimeForTest();
  assert.strictEqual(Cutover.claimWriteOwner('v1'), true, 'bootstrap failures leave the existing v1 owner unchanged');
  console.log('PASS OrderHelper v2 authenticated read-only cutover bootstrap');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
