'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'v2', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'v2', 'styles.css'), 'utf8');
const constitution = fs.readFileSync(path.join(root, 'ORDERHELPER_CONSTITUTION.md'));
const expectedDigest = '8cd45de2922894fe2be8b8e7424fe91cc490ec20d2ec9cea0a60164fcf21a575';

function has(pattern, message) {
  assert.match(html, pattern, message);
}

function testConstitutionMarker() {
  assert.strictEqual(crypto.createHash('sha256').update(constitution).digest('hex'), expectedDigest);
  has(new RegExp('<meta[^>]+name="orderhelper-constitution-sha256"[^>]+content="' + expectedDigest + '"'), 'shell must carry the active constitution receipt marker');
}

function testSafeAssetBoundary() {
  const scripts = Array.from(html.matchAll(/<script\s+([^>]*)><\/script>/g), match => match[1]);
  assert.deepStrictEqual(scripts.map(attributes => attributes.match(/src="([^"]+)"/)[1]), [
    '../sync/order-sync-v2.js',
    './order-remote-v2.js',
    './order-auth-v2.js',
    './order-cutover-v2.js',
    './order-storage-v2.js',
    './master-data.js',
    './orderhelper-v2.js',
    './order-sync-controller-v2.js'
  ]);
  scripts.forEach(attributes => assert.match(attributes, /\bdefer\b/));
  assert.doesNotMatch(html, /<script(?:\s[^>]*)?>\s*[^<\s]/i, 'inline business logic is forbidden');
  assert.doesNotMatch(html, /firebaseio|firebasedatabase|phoneWins|작업\s*필요\s*우선|양수\s*우선|0\s*우선/i);
  assert.doesNotMatch(html, /onclick\s*=|onchange\s*=|onsubmit\s*=/i);
}

function testOneGridLandmarks() {
  has(/<section[^>]+id="authGate"[^>]+data-auth-state="adapter-pending"/, 'auth gate placeholder missing');
  has(/<section[^>]+id="syncReceiptBar"[^>]+aria-label="동기화 상태와 저장 영수증"/, 'status/receipt bar missing');
  has(/<select[^>]+id="orderDays"/, 'order days control missing');
  has(/<fieldset[^>]+id="dailySalesControls"/, 'sales controls missing');
  has(/<button[^>]+id="inputOrderButton"[^>]*>입력순<\/button>/, 'input-order mode missing');
  has(/<button[^>]+id="sfaOrderButton"[^>]*>SFA 발주순<\/button>/, 'constitutional SFA-order mode missing');
  assert.strictEqual((html.match(/<table\b/g) || []).length, 1, 'input and output must share exactly one table');
  has(/<tbody[^>]+id="orderRowsMount"/, 'single row mount missing');
  has(/<aside[^>]+id="sfaEvidenceDrawer"/, 'SFA evidence/mapping drawer missing');
  has(/<output[^>]+id="totalExpectedAmount"/, 'total expected amount missing');
  has(/id="snoozeButton"[^>]+disabled/, 'snooze control must stay disabled before adapter integration');
}

function testUnsafeControlsRemainDisabled() {
  has(/<button[^>]+id="exportCsvButton"[^>]+disabled[^>]*>CSV 내보내기<\/button>/, 'export must be disabled until its adapter is integrated');
  has(/<button[^>]+id="requestSfaAnalysisButton"[^>]+disabled[^>]*>SFA 분석 요청<\/button>/, 'SFA request must be disabled until receipt and PC preflight adapters exist');
  has(/<button[^>]+id="closeEvidenceDrawer"[^>]+aria-label="SFA 상세 닫기"/, 'drawer close control needs an accessible label');
  has(/<caption>[^<]*재고 입력과 계산, SFA 근거/, 'one grid needs an accessible caption');
  ['orderDays', 'baseSales', 'salesDay1', 'salesDay2', 'salesDay3', 'salesDay4'].forEach(id => {
    assert.match(html, new RegExp('<label[^>]+for="' + id + '"'), id + ' needs an explicit label');
  });
}

function testResponsiveContract() {
  assert.match(css, /html,\s*body\s*\{[^}]*overflow-x:\s*clip/s);
  assert.match(css, /@media\s*\(max-width:\s*390px\)/);
  assert.match(css, /@media\s*\(min-width:\s*1100px\)/);
  assert.match(css, /tbody\s+tr\s*\{[^}]*overflow-anchor:\s*auto/s, 'row anchor must survive detail expansion');
  assert.match(css, /\.detail-drawer\s*\{[^}]*overflow-anchor:\s*none/s, 'drawer expansion must not steal the viewport anchor');
  assert.match(css, /table-layout:\s*fixed/);
}

testConstitutionMarker();
testSafeAssetBoundary();
testOneGridLandmarks();
testUnsafeControlsRemainDisabled();
testResponsiveContract();
console.log('PASS OrderHelper v2 static shell constitution and safety gates');
