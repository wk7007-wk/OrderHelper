#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_CONSTITUTION_SHA = '8cd45de2922894fe2be8b8e7424fe91cc490ec20d2ec9cea0a60164fcf21a575';
const receipt = JSON.parse(fs.readFileSync(path.join(ROOT, 'ORDERHELPER_CONSTITUTION_RECEIPT.json'), 'utf8'));
assert.strictEqual(receipt.constitution.sha256, EXPECTED_CONSTITUTION_SHA);
assert.strictEqual(
  crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, receipt.constitution.path))).digest('hex'),
  EXPECTED_CONSTITUTION_SHA
);

const Master = require(path.join(ROOT, 'v2', 'master-data.js'));
const V2 = require(path.join(ROOT, 'v2', 'orderhelper-v2.js'));

const model = V2.createModel({
  masterItems: Master.MASTER_ITEMS,
  now: new Date('2026-07-27T12:00:00+09:00'),
});
const canonical = model.getCanonicalRows();
const ordered = V2.sortRows(canonical, V2.VIEW_MODES.SFA, model.getState());

assert.deepStrictEqual(
  ordered.slice(0, 8).map(row => row.internalName),
  [
    '(신)올리브오일',
    '냉동-핫윙,비비윙스',
    '냉동-닭껍데기(국내산)',
    '두마리치킨,파더스',
    'BBQ충진식패티(100g)(마일드)',
    'BBQ페퍼로니씬피자',
    '냉동-크런치너겟,순살크래커',
    '냉동-바사칸윙',
  ],
  'first SFA sequence is exact sfaSeq, then canonical name'
);

const seq56 = ordered.filter(row => row.canonicalSeq === 56).map(row => row.internalName);
assert.deepStrictEqual(seq56, ['알루미늄캔(뚜껑포함)', '치킨간지']);

const beforeKeys = ordered.map(row => row.itemKey);
const noisy = canonical.map((row, index) => ({
  ...row,
  matchStatus: index % 2 ? 'ITEM_UNMATCHED' : 'MATCHED',
  recommendedOrderQty: index % 3 ? 0 : 99,
  hidden: index % 5 === 0,
  issues: index % 2 ? ['ITEM_UNMATCHED'] : [],
}));
assert.deepStrictEqual(
  V2.sortRows(noisy, V2.VIEW_MODES.SFA, model.getState()).map(row => row.itemKey),
  beforeKeys,
  'match/actionable/positive/zero/hidden flags may decorate but never reorder SFA rows'
);

const sameNameTie = [
  { canonicalSeq: 7, canonicalName: '동일', entryKey: 'entry-b', itemKey: 'b' },
  { canonicalSeq: 7, canonicalName: '동일', entryKey: 'entry-a', itemKey: 'a' },
];
assert.deepStrictEqual(
  V2.sortRows(sameNameTie, V2.VIEW_MODES.SFA, {}).map(row => row.entryKey),
  ['entry-a', 'entry-b'],
  'stable entryKey is the final tie breaker'
);

const latestSfa = [
  { row_index: 12, originalName: '원문 C', unit: '박스' },
  { row_index: 4, originalName: '원문 A', unit: '봉' },
  { row_index: 9, originalName: '매핑 원문', unit: '팩', mappedItemKey: beforeKeys[20] },
  { row_index: 4, originalName: '원문 B', unit: '봉' },
];
assert.deepStrictEqual(
  V2.sourceOnlyRows(latestSfa).map(row => [row.sourceRowIndex, row.originalName]),
  [[4, '원문 A'], [4, '원문 B'], [12, '원문 C']],
  'row_index orders only source-only unmapped rows with stable source identity tie-break'
);
assert.deepStrictEqual(
  V2.sortRows(canonical, V2.VIEW_MODES.SFA, { latestSfaRows: latestSfa }).map(row => row.itemKey),
  beforeKeys,
  'mapped latest row_index cannot rewrite canonical SFA master order'
);

const inputRows = [
  { itemKey: 'c', inputIndex: 2, stockTotal: null, entries: [{ zone: '냉동', stock: null, entryKey: 'c1' }] },
  { itemKey: 'a', inputIndex: 0, stockTotal: 1, entries: [{ zone: '주방', stock: 1, entryKey: 'a1' }] },
  { itemKey: 'b', inputIndex: 1, stockTotal: null, entries: [{ zone: '주방', stock: null, entryKey: 'b1' }] },
];
assert.deepStrictEqual(
  V2.sortRows(inputRows, V2.VIEW_MODES.INPUT, { zoneOrder: ['주방', '냉동'] }).map(row => row.itemKey),
  ['b', 'a', 'c'],
  'input view follows zone order and puts missing stock first inside a zone'
);

assert.strictEqual(V2.VIEW_MODES.SFA, 'sfa');
assert.strictEqual(Object.prototype.hasOwnProperty.call(V2.VIEW_MODES, 'SFA_WORK_PRIORITY'), false);

console.log('orderhelper_v2_sfa_order: PASS');
