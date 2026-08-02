'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const receipt = JSON.parse(fs.readFileSync(path.join(ROOT, 'ORDERHELPER_CONSTITUTION_RECEIPT.json'), 'utf8'));
const evidencePath = path.join(ROOT, receipt.promptEvidence.path);
const evidence = fs.readFileSync(evidencePath, 'utf8');
const digest = crypto.createHash('sha256').update(fs.readFileSync(evidencePath)).digest('hex');

assert.strictEqual(receipt.promptEvidence.sourceRange, '2026-05-05..2026-08-02');
assert.strictEqual(receipt.promptEvidence.sha256, digest);
assert.match(evidence, /PC와 모바일의 동기화 충돌/);
assert.match(evidence, /새 경로/);
assert.match(evidence, /새로고침해도 작성 중인 값은 로컬에 그대로 보존/);
assert.match(evidence, /exact dirty-path local draft reload/);
assert.match(evidence, /019fc3f6-fe9c-7f71-9876-57107d3e302f/);

console.log('PASS OrderHelper v2 prompt evidence through 2026-08-02 corrections');
