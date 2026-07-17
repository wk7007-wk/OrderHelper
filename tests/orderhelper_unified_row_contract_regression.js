const assert = require('assert');
const fixture = require('./fixtures/orderhelper_unified_order_row_contract.json');
const { api, plain, sandbox } = require('./orderhelper_static_checks.js');

assert.strictEqual(fixture.version, 1, 'unified row fixture version must be explicit');
assert.strictEqual(new Set(fixture.statusEnum).size, fixture.statusEnum.length, 'status enum must be mutually exclusive');
fixture.equationCases.forEach(testCase => {
  const solved = plain(api.solveOrderLineEquation(testCase.inputs, {
    sourceRunId: `fixture-${testCase.id}`,
    asOf: Date.UTC(2026, 6, 14),
    provenance: 'FIXTURE'
  }));
  ['actualOrderQty', 'amount', 'actualUnitPrice'].forEach(field => {
    if (!Object.prototype.hasOwnProperty.call(testCase.expected, field)) return;
    assert.strictEqual(solved[field]?.value ?? null, testCase.expected[field], `${testCase.id}: ${field}`);
    if (testCase.expected.formula && solved[field]) {
      assert.strictEqual(solved[field].formula, testCase.expected.formula, `${testCase.id}: formula`);
      assert.strictEqual(solved[field].sourceRunId, `fixture-${testCase.id}`, `${testCase.id}: provenance run`);
      assert.strictEqual(solved[field].provenance, 'FIXTURE', `${testCase.id}: provenance source`);
      assert(solved[field].inputRefs.length === 2, `${testCase.id}: derived input refs`);
    }
  });
  const issueCodes = solved.issues.map(issue => issue.code);
  assert.deepStrictEqual(issueCodes, testCase.expected.issues || [], `${testCase.id}: issues`);
});

fixture.movementCases.forEach(testCase => {
  const samples = testCase.samples.map(sample => plain(api.movementFactorEvidence(sample.inputs, sample.context)));
  const summary = plain(api.summarizeMovementFactorEvidence(samples, Date.UTC(2026, 6, 14, 12)));
  assert.strictEqual(summary.factor, testCase.expected.factor, `${testCase.id}: factor`);
  assert.strictEqual(summary.samples, testCase.expected.samples, `${testCase.id}: accepted sample count`);
  assert.strictEqual(summary.conflict, testCase.expected.conflict, `${testCase.id}: conflict`);
  if (testCase.expected.confidenceLabel) assert.strictEqual(summary.confidenceLabel, testCase.expected.confidenceLabel, `${testCase.id}: confidence`);
  if (testCase.expected.commonPack) assert.strictEqual(summary.commonPack, testCase.expected.commonPack, `${testCase.id}: common pack`);
  if (testCase.expected.excluded) assert.deepStrictEqual(summary.excluded, testCase.expected.excluded, `${testCase.id}: exclusion reason`);
  if (testCase.expected.formula) {
    assert.strictEqual(samples[0].formula, testCase.expected.formula, `${testCase.id}: exact formula`);
    assert.strictEqual(samples[0].sourceRunId, testCase.samples[0].context.sourceRunId, `${testCase.id}: source run provenance`);
  }
  if (Object.prototype.hasOwnProperty.call(testCase.expected, 'preservedActualOrderQty')) {
    assert.strictEqual(samples[0].inputs.actualOrderQty, testCase.expected.preservedActualOrderQty, `${testCase.id}: explicit zero preserved`);
  }
});

const item = api.MASTER.find(row => row.name === '신선육(10호)-뼈한마리');
assert(item, 'factor-10 unified-row fixture item missing');
const legacyPackItem = api.MASTER.find(row => row.name === '두마리치킨,파더스');
assert(legacyPackItem, 'legacy pack migration fixture item missing');
api.setUnitCorrectionsForCheck({
  [legacyPackItem.name]: { factor: 1, orderMultiple: 10, updatedAt: 1 },
});
const migratedPackCorrection = plain(api.unitCorrectionForItem(legacyPackItem.name));
assert.strictEqual(migratedPackCorrection.factor, 10, 'legacy pack size must migrate to 1 order = 10 stock/chicken units');
assert.strictEqual(migratedPackCorrection.orderUnitToStockFactor, 10, 'migrated pack factor must use the explicit directional field');
assert.strictEqual(migratedPackCorrection.orderMultiple, undefined, 'legacy pack size must no longer multiply the number of order boxes');
assert.strictEqual(migratedPackCorrection.migratedFromOrderMultiple, true, 'legacy conversion must remain visible for audit');
const actualName = '실발주품목';
const now = Date.UTC(2026, 6, 14, 12);

function ledger(events) {
  return {
    version: 2,
    records: [{
      id: 'fixture-record',
      runId: 'fixture-record',
      dateKey: '20260714',
      savedAt: now,
      updatedAt: now,
      source: 'excel',
      fileName: '실발주.xlsx',
      items: events,
    }],
  };
}

function setBaseState() {
  sandbox.document.getElementById('orderDays').value = '2';
  api.setEntriesForCheck([{ id: 'unified-target', entryKey: 'unified-target', name: item.name, zone: '주방', stock: 0 }]);
  api.setOverridesForCheck({ [item.name]: { l: 25, k: 0 } });
  api.setSalesForCheck([], 280);
  api.setUnitCorrectionsForCheck({});
  api.setSfaPriceHistoryForCheck({ version: 1, canonicalSource: 'sfaAnalysisRuns', advisoryOnly: true, items: {} });
  api.setSiteMappingsForCheck({});
  api.setAliasMappingsForCheck({
    [item.name]: {
      aliasName: item.name,
      actualName,
      actualUnit: 'BOX',
      status: 'confirmed',
      source: 'user',
      conversionFactor: 10,
      conversionStatus: 'confirmed',
    },
  });
}

function targetRow() {
  const rows = plain(api.resolveUnifiedOrderRows(null, null, 2, now));
  const matches = rows.filter(row => row.itemKey === api.itemKeyForName(item.name));
  assert.strictEqual(matches.length, 1, 'one itemKey must resolve to exactly one row');
  return { row: matches[0], rows };
}

function rowFor(name) {
  const rows = plain(api.resolveUnifiedOrderRows(null, null, 2, now));
  const itemKey = api.itemKeyForName(name);
  const matches = rows.filter(row => row.itemKey === itemKey);
  assert.strictEqual(matches.length, 1, `${name}: resolver occurrence`);
  return matches[0];
}

setBaseState();
api.setSfaActualHistoryForCheck({});
api.setSfaAnalysisHistoryForCheck(ledger([{
  runId: 'run-new',
  dateKey: '20260714',
  eventAt: now,
  originalName: actualName,
  mappedName: item.name,
  aliasName: actualName,
  actualOrderQty: 5,
  quantity: 5,
  amount: '12,000',
  unit: 'BOX',
  rowIndex: 1,
  rawIdentity: 'matched-price-row',
}]));
let result = targetRow();
assert.strictEqual(result.row.matchStatus, 'MATCHED', 'confirmed alias and factor must resolve MATCHED');
assert.strictEqual(result.row.orderQty, 3, 'stock need 25 at factor 10 must resolve three order units');
assert.strictEqual(result.row.unitPrice, 2400, 'Excel amount 12,000 / order qty 5 must resolve unit price 2,400');
assert.strictEqual(result.row.perStockUnitPrice, 240, 'one stock unit must use order-unit price divided by factor 10');
assert.strictEqual(result.row.expectedAmount, 7200, 'recommended order 3 * unit price 2,400 must resolve 7,200');
assert.strictEqual(result.row.unitPriceEvidence.formula, 'amount / actualOrderQty', 'unit-price evidence must disclose the exact Excel equation');
assert.strictEqual(result.row.orderQtyEvidence.formula, 'ceilDiscrete(stockNeed / factor)', 'factor must be applied once in the stock-to-order equation');
assert.strictEqual(result.row.expectedAmountEvidence.formula, 'orderQty * actualUnitPrice', 'today amount must not multiply the factor a second time');
assert.strictEqual(result.row.expectedAmountEvidence.sourceRunId, 'run-new', 'today amount provenance must point at the actual-price source run');
assert.deepStrictEqual(result.row.issues, [], 'valid matched price row must have no issues');
assert.strictEqual(result.rows.filter(row => row.matchStatus === 'ITEM_UNMATCHED' && row.itemKey === result.row.itemKey).length, 0, 'matched item must never also appear unmatched');
assert.strictEqual(result.rows.reduce((sum, row) => sum + (Number.isFinite(row.expectedAmount) ? row.expectedAmount : 0), 0), 7200, 'today expected total must sum each resolver row once');

const wingPackItem = api.MASTER.find(row => row.name === '냉동-핫윙,비비윙스');
assert(wingPackItem, 'live factor-10 wing item missing');
const wingPackRow = {
  matchStatus: 'MATCHED',
  factor: 10,
  unitPrice: 123200,
  perStockUnitPrice: 12320,
  actualOrderQty: 1,
  chickenPriceSanity: 'not_applicable',
  issues: [],
  priceEvidence: {
    valid: true,
    basis: 'SFA_ORDER_UNIT_DIRECT_PRICE',
    provenance: 'SFA_PRICE_HISTORY',
    actualUnit: 'BOX',
    actualOrderQty: 1,
    amount: 123200,
    dateKey: '20260711',
    fileName: '3개월 발주.xlsx',
    runId: 'wing-pack-price-run',
    equation: { actualUnitPrice: { formula: 'source' } },
  },
};
const wingPackEstimate = plain(api.expectedOrderAmountForItem(wingPackItem, 13.8, wingPackRow));
assert.strictEqual(wingPackEstimate.recommended_order_qty, 2, '13.8 stock units at factor 10 must recommend two boxes');
assert.strictEqual(wingPackEstimate.order_unit_price, 123200, 'one-box price must stay explicit in the amount contract');
assert.strictEqual(wingPackEstimate.unit_price, 123200, 'legacy unit_price must remain the one-order-unit price');
assert.strictEqual(wingPackEstimate.stock_unit_price, 12320, 'employee stock-unit price must be one-box price divided by 10');
assert.strictEqual(wingPackEstimate.order_unit_to_stock_factor, 10, 'price meanings must carry the conversion factor');
assert.strictEqual(wingPackEstimate.expected_order_amount, 246400, 'two recommended boxes at 123,200 won must total 246,400 won');
const wingPackHtml = api.renderOrderAmountSpan(wingPackItem, 13.8, wingPackRow);
const wingPackVisible = wingPackHtml.replace(/<[^>]+>/g, '');
assert(wingPackVisible.includes('예상 246,400원'), 'live scenario must keep the correct expected spend');
assert(wingPackVisible.includes('개당 12,320원 · 1박스 123,200원 · 최근 3개월 발주 기준'), 'live scenario must separate each price from one-box price');
assert(wingPackHtml.includes('재고 개당 가격 12,320원'), 'detail title must identify the stock-unit price');
assert(wingPackHtml.includes('발주 1박스 가격 123,200원'), 'detail title must identify the one-box price');
assert(wingPackHtml.includes('환산 1박스 = 재고 10개'), 'detail title must disclose the price conversion direction');
assert(!wingPackHtml.includes('단가 123,200원'), 'one-box amount must never be mislabeled as an ambiguous unit price');

const tteokPackItem = api.MASTER.find(row => row.name === '냉동-떡볶이(16개)');
assert(tteokPackItem, '16-piece tteokbokki pack item missing');
api.setUnitCorrectionsForCheck({ [tteokPackItem.name]: { factor: 16, packUnit: '박스' } });
assert.strictEqual(api.recommendedOrderQty(tteokPackItem, 16), 1, 'one full 16-piece pack must recommend one box');
assert.strictEqual(api.recommendedOrderQty(tteokPackItem, 17), 2, 'one piece beyond a full pack must recommend two boxes');
const tteokPackRow = {
  matchStatus: 'CANDIDATE',
  factor: 16,
  unitPrice: 80000,
  perStockUnitPrice: 5000,
  actualOrderQty: 2,
  chickenPriceSanity: 'not_applicable',
  issues: [],
  priceEvidence: {
    valid: true,
    basis: 'SFA_ORDER_UNIT_AMOUNT_DIV_QTY',
    provenance: 'SFA_PRICE_HISTORY',
    actualUnit: 'BOX',
    actualOrderQty: 2,
    amount: 160000,
    dateKey: '20260717',
    fileName: '3개월 발주.xlsx',
    runId: 'tteok-pack-price-run',
    equation: { actualUnitPrice: { formula: 'amount / actualOrderQty' } },
  },
};
const tteokPackEstimate = plain(api.expectedOrderAmountForItem(tteokPackItem, 17, tteokPackRow));
assert.strictEqual(tteokPackEstimate.recommended_order_qty, 2, '17 checked pieces must resolve two ordered boxes');
assert.strictEqual(tteokPackEstimate.order_unit_price, 80000, 'Excel price must remain the one-box price');
assert.strictEqual(tteokPackEstimate.stock_unit_price, 5000, 'employee each-price must divide one-box price by 16');
assert.strictEqual(tteokPackEstimate.expected_order_amount, 160000, 'two boxes must cost two times the box price, without multiplying by 16 again');
const tteokPackHtml = api.renderOrderAmountSpan(tteokPackItem, 17, tteokPackRow);
const tteokPackVisible = tteokPackHtml.replace(/<[^>]+>/g, '');
assert(tteokPackVisible.includes('예상 160,000원'), 'employee card must show the two-box expected spend');
assert(tteokPackVisible.includes('개당 5,000원 · 1박스 80,000원 · 최근 3개월 발주 기준'), 'employee card must separate each price from the box price');
assert(tteokPackHtml.includes('환산 1박스 = 재고 16개'), 'detail title must say one box equals 16 checked pieces');
const noNeedPriceHtml = api.renderOrderAmountSpan(tteokPackItem, 0, tteokPackRow);
const noNeedPriceVisible = noNeedPriceHtml.replace(/<[^>]+>/g, '');
assert(noNeedPriceHtml.includes('order-amount price-only'), 'no-order rows must retain known price evidence in a compact card');
assert(noNeedPriceVisible.includes('개당 5,000원 · 1박스 80,000원'), 'no-order rows must show the same stock/order unit prices');
assert(noNeedPriceVisible.includes('최근 3개월 발주 기준'), 'no-order rows must retain a short price source');
assert(!noNeedPriceVisible.includes('예상 0원'), 'no-order price cards must not add a noisy zero-total label');
const noNeedMissingHtml = api.renderOrderAmountSpan(tteokPackItem, 0, {
  matchStatus: 'ITEM_UNMATCHED',
  factor: 16,
  unitPrice: null,
  priceEvidence: null,
  issues: [{ code: 'PRICE_SOURCE_MISSING', message: '가격 근거가 없습니다.' }],
});
assert(noNeedMissingHtml.includes('order-amount price-only missing') && noNeedMissingHtml.includes('단가 확인 필요'), 'a true no-order price gap must be explicit instead of an ambiguous unconfirmed badge');

const rectangularOne = '직사각용기1(190,감자)';
const rectangularTwo = '직사각용기2(230,치즈스틱)';
const legacyRectangularName = '직사각용기1(190,감자),2(230,치즈스틱)';
api.setEntriesForCheck([
  { id: 'rect-1', entryKey: 'rect-1', name: rectangularOne, zone: '창고', stock: 1 },
  { id: 'rect-2', entryKey: 'rect-2', name: rectangularTwo, zone: '창고', stock: 1 },
]);
api.setOverridesForCheck({});
api.setUnitCorrectionsForCheck({});
api.setAliasMappingsForCheck({});
api.setSfaPriceHistoryForCheck({ version: 1, canonicalSource: 'sfaAnalysisRuns', advisoryOnly: true, items: {} });
const rectangularRows = plain(api.resolveUnifiedOrderRows(null, ledger([
  { runId: 'rect-run', eventId: 'rect-run#1', eventAt: now, dateKey: '20260711', originalName: 'BBQ직사각용기1호', mappedName: legacyRectangularName, actualOrderQty: 1, quantity: 1, amount: 15620, unit: 'BOX' },
  { runId: 'rect-run', eventId: 'rect-run#2', eventAt: now, dateKey: '20260704', originalName: 'BBQ직사각용기2호', mappedName: legacyRectangularName, actualOrderQty: 1, quantity: 1, amount: 13420, unit: 'BOX' },
]), 2, now));
const rectangularOneRow = rectangularRows.find(row => row.internalName === rectangularOne);
const rectangularTwoRow = rectangularRows.find(row => row.internalName === rectangularTwo);
assert.strictEqual(rectangularOneRow.unitPrice, 15620, 'container 1 must use only the number-1 box price');
assert.strictEqual(rectangularTwoRow.unitPrice, 13420, 'container 2 must use only the number-2 box price');
assert.deepStrictEqual(rectangularOneRow.actualAliases, ['BBQ직사각용기1호'], 'container 1 must expose only its own fixed actual name');
assert.deepStrictEqual(rectangularTwoRow.actualAliases, ['BBQ직사각용기2호'], 'container 2 must expose only its own fixed actual name');

setBaseState();
api.setSfaAnalysisHistoryForCheck(ledger([{
  runId: 'run-explicit-zero-price', dateKey: '20260714', eventAt: now, originalName: actualName,
  mappedName: item.name, actualOrderQty: 5, quantity: 5, amount: 0, unit: 'BOX', rowIndex: 1, rawIdentity: 'zero-price-present',
}]));
result = targetRow();
assert.strictEqual(result.row.unitPrice, 0, 'an explicit zero amount with positive quantity must remain valid zero-price evidence');
assert.strictEqual(result.row.expectedAmount, 0, 'an explicit zero unit price must produce a present zero expected amount');
assert(!result.row.issues.some(issue => issue.code === 'PRICE_JOIN_BUG'), 'valid zero-price evidence must not be treated as a missing join');

const liveShapeName = '(컵소스)BBQ양념치킨소스(배달용)';
api.setEntriesForCheck([{ id: 'live-shape', entryKey: 'live-shape', name: liveShapeName, zone: '주방', stock: 0 }]);
api.setOverridesForCheck({ [liveShapeName]: { l: 1.5, k: 0 } });
api.setUnitCorrectionsForCheck({});
api.setSiteMappingsForCheck({});
api.setAliasMappingsForCheck({
  [liveShapeName]: { aliasName: liveShapeName, actualName: liveShapeName, actualUnit: '봉', status: 'confirmed', source: 'user' },
});
api.setSfaAnalysisHistoryForCheck(ledger([{
  runId: 'live-shape-run', dateKey: '20260714', eventAt: now, originalName: liveShapeName,
  mappedName: liveShapeName, actualOrderQty: 5, quantity: 5, amount: 12000, unit: '봉', rowIndex: 1, rawIdentity: 'live-shape-price',
}]));
const liveShapeRow = rowFor(liveShapeName);
assert.strictEqual(liveShapeRow.matchStatus, 'MATCHED', 'live parenthesized alias shape must resolve matched');
assert.strictEqual(liveShapeRow.unitPrice, 2400, 'live parenthesized alias must join its priced lossless row');
assert(!liveShapeRow.issues.some(issue => ['PRICE_JOIN_BUG', 'ITEM_UNMATCHED'].includes(issue.code)), 'fixed live shape must have zero legacy join issues');

setBaseState();
api.setSfaAnalysisHistoryForCheck(ledger([
  {
    runId: 'run-old', dateKey: '20260713', eventAt: now - 86400000, originalName: actualName,
    mappedName: item.name, actualOrderQty: 4, quantity: 4, amount: 8000, unit: 'BOX', rowIndex: 1, rawIdentity: 'old-valid-price',
  },
  {
    runId: 'run-new', dateKey: '20260714', eventAt: now, originalName: actualName,
    mappedName: item.name, actualOrderQty: 0, quantity: 0, amount: 0, unit: 'BOX', rowIndex: 2, rawIdentity: 'new-zero-price',
  },
]));
result = targetRow();
assert.strictEqual(result.row.priceEvidence.sourceRunId, 'run-old', 'zero-quantity newest row must fall back to latest older positive price evidence');
assert.strictEqual(result.row.priceEvidence.fallbackFromNewerZeroQty, true, 'older-price fallback must remain explicit evidence');
assert.strictEqual(result.row.unitPrice, 2000);
assert.strictEqual(result.row.expectedAmount, 6000);

setBaseState();
api.setSfaAnalysisHistoryForCheck({ records: [] });
result = targetRow();
assert.strictEqual(result.row.matchStatus, 'MATCHED', 'missing price must not erase an explicit alias match');
assert.strictEqual(result.row.unitPrice, null, 'missing price must stay null, never fabricated zero');
assert.strictEqual(result.row.expectedAmount, null, 'missing price must keep expected amount unresolved');
assert(result.row.issues.some(issue => issue.code === 'PRICE_JOIN_BUG' && issue.message.includes('엑셀 금액 행')), 'matched alias without price must raise Korean PRICE_JOIN_BUG');

setBaseState();
api.setAliasMappingsForCheck({});
api.setUnitCorrectionsForCheck({ [item.name]: { factor: 10 } });
api.setSfaAnalysisHistoryForCheck({ records: [] });
api.setSfaPriceHistoryForCheck({
  version: 1,
  canonicalSource: 'sfaAnalysisRuns',
  advisoryOnly: true,
  updatedAt: now,
  latestRunId: 'history-run-3month',
  latestRunPath: '/order/desk_q7m9r3a8/sfaAnalysisRuns/history-run-3month',
  items: {
    [item.name]: {
      mappedName: item.name,
      actualName: '3개월 원본 실발주명',
      actualUnit: 'BOX',
      actualOrderQty: 5,
      amount: 12000,
      unitPrice: 2400,
      dateKey: '20260710',
      score: 0.99,
      sourceRunId: 'history-run-3month',
      sourceRunIds: ['history-run-3month'],
      sourcePath: '/order/desk_q7m9r3a8/sfaAnalysisRuns/history-run-3month',
      sourceFile: '3개월재분석.xlsx',
      sourceSavedAt: now,
      priceEvidenceVersion: 1,
      orderUnitToStockFactorCandidate: 10,
      perStockUnitPrice: 240,
    },
  },
});
result = targetRow();
assert.strictEqual(result.row.matchStatus, 'CANDIDATE', 'price-history exact mappedName evidence must remain candidate-only without a saved alias');
assert.strictEqual(result.row.priceCandidateOnly, true, '3-month price history must never persist or pretend an alias');
assert.strictEqual(result.row.priceEvidence.provenance, 'SFA_PRICE_HISTORY');
assert.strictEqual(result.row.unitPrice, 2400, '3-month price history must restore the actual order-unit price');
assert.strictEqual(result.row.expectedAmount, 7200, 'restored price history must calculate today amount with the explicit factor exactly once');
assert.strictEqual(Object.keys(plain(api.getAliasMappingsForCheck())).length, 0, 'reading price history must not mutate user alias mappings');

api.setSfaPriceHistoryForCheck({
  version: 1,
  canonicalSource: 'sfaAnalysisRuns',
  advisoryOnly: true,
  updatedAt: now + 1,
  latestRunId: 'direct-price-run',
  latestRunPath: '/order/desk_q7m9r3a8/sfaAnalysisRuns/direct-price-run',
  items: {
    [item.name]: {
      mappedName: item.name,
      actualName: '엑셀 단가 표시 원명',
      actualUnit: 'BOX',
      actualOrderQty: 0,
      amount: 0,
      unitPrice: 9000,
      dateKey: '20260710',
      score: 0.99,
      sourceRunId: 'direct-price-run',
      sourceRunIds: ['direct-price-run'],
      sourcePath: '/order/desk_q7m9r3a8/sfaAnalysisRuns/direct-price-run',
      sourceFile: '단가포함.xlsx',
      sourceSavedAt: now + 1,
      priceEvidenceVersion: 2,
      priceBasis: 'direct_unit_price',
    },
  },
});
result = targetRow();
assert.strictEqual(result.row.unitPrice, 9000, 'a downloaded Excel direct unit price must work even when ordered quantity and line amount are zero');
assert.strictEqual(result.row.unitPriceEvidence.formula, 'source', 'direct Excel unit price must remain source evidence, not amount/quantity derivation');
assert.strictEqual(result.row.expectedAmount, 27000, 'direct unit price must calculate the current order amount without fabricating an historical quantity');
api.setSfaPriceHistoryForCheck({ version: 1, canonicalSource: 'sfaAnalysisRuns', advisoryOnly: true, items: {} });

api.setAliasMappingsForCheck({});
api.setSiteMappingsForCheck({});
const exactMappedCompare = {
  ok: true,
  runId: 'latest-exact-mapped-name',
  savedAt: now,
  items: [{
    row_index: 99,
    name: '관계없는 원문',
    qty: 1,
    amount: 100,
    unit: 'EA',
    mappedName: api.MASTER.find(row => row.name !== item.name).name,
  }],
  comparison: {
    matched: [{
      row_index: 7,
      sfa_name: '아직 저장하지 않은 실발주명',
      sfa_qty: 5,
      sfa_amount: 12000,
      sfa_unit: 'BOX',
      expected_name: item.name,
    }],
    missing: [],
    extra: [],
  },
};
const exactMappedRows = plain(api.resolveUnifiedOrderRows(exactMappedCompare, { version: 2, records: [] }, 2, now));
const exactMappedRow = exactMappedRows.find(row => row.itemKey === api.itemKeyForName(item.name));
assert.strictEqual(exactMappedRow.matchStatus, 'CANDIDATE', 'exact mappedName evidence without a saved alias must remain candidate-only');
assert.strictEqual(exactMappedRow.priceCandidateOnly, true, 'exact mappedName evidence must never pretend to be a stored alias');
assert.strictEqual(exactMappedRow.priceEvidence.provenance, 'EXACT_MAPPED_NAME_CURRENT_EXCEL');
assert.strictEqual(exactMappedRow.unitPrice, 2400, 'latest exact mappedName amount/qty must resolve a candidate unit price');
assert.strictEqual(Object.keys(plain(api.getAliasMappingsForCheck())).length, 0, 'candidate price evidence must not persist an alias');
const exactMappedHtml = api.renderOrderAmountSpan(item, exactMappedRow.stockNeed, exactMappedRow);
const exactMappedVisible = exactMappedHtml.replace(/<[^>]+>/g, '');
assert(exactMappedVisible.includes('예상 7,200원'), 'employee card must lead with the expected amount');
assert(exactMappedVisible.includes('박당 240원 · 1박스 2,400원 · 최신 엑셀 기준'), 'employee card must separate stock-unit price from one-box price');
assert(!/실발주|가격출처|미저장|금액÷수량/.test(exactMappedVisible), 'technical price provenance must stay out of visible card text');
assert(exactMappedHtml.includes('실발주 5BOX') && exactMappedHtml.includes('가격출처 최신 엑셀 정확매칭 후보(미저장)·금액÷수량'), 'full quantity and provenance must remain in the detail title');

const nullRawPriceEvidence = plain(api.priceEvidenceForActualAliases([], { version: 2, records: [] }, now, {
  ...exactMappedCompare,
  items: [{ row_index: 7, name: '아직 저장하지 않은 실발주명', qty: null, amount: ' ', unit: 'BOX', mappedName: item.name }],
}, item.name));
assert.strictEqual(nullRawPriceEvidence.unitPrice, 2400, 'null/blank raw fields must fall back to the priced comparison row while preserving explicit zero elsewhere');

const noIndexPriceEvidence = plain(api.priceEvidenceForActualAliases([], { version: 2, records: [] }, now, {
  ...exactMappedCompare,
  items: [{ name: 'row index 없는 실발주명', qty: null, amount: ' ', unit: 'BOX', mappedName: item.name }],
  comparison: {
    matched: [{ sfa_name: 'row index 없는 실발주명', sfa_qty: 5, sfa_amount: 12000, sfa_unit: 'BOX', expected_name: item.name }],
    missing: [],
    extra: [],
  },
}, item.name));
assert.strictEqual(noIndexPriceEvidence.unitPrice, 2400, 'row_index-free raw and comparison rows must join by exact site name+unit for price fallback');

const wrongIndexPriceEvidence = plain(api.priceEvidenceForActualAliases([], { version: 2, records: [] }, now, {
  ...exactMappedCompare,
  items: [{ row_index: 101, name: '같은 원명', qty: null, amount: ' ', unit: 'BOX', mappedName: item.name }],
  comparison: {
    matched: [{ row_index: 202, sfa_name: '같은 원명', sfa_qty: 5, sfa_amount: 12000, sfa_unit: 'BOX', expected_name: api.MASTER.find(row => row.name !== item.name).name }],
    missing: [],
    extra: [],
  },
}, item.name));
assert.strictEqual(wrongIndexPriceEvidence.unitPrice, null, 'different present row_index values must never site-key join another item price');

api.setAliasMappingsForCheck({
  [item.name]: {
    aliasName: item.name,
    actualName: '거부할 자동 후보',
    actualUnit: 'BOX',
    status: 'unlinked',
    source: 'user',
    conversionFactor: 10,
    conversionStatus: 'confirmed',
  },
});
const unlinkedRows = plain(api.resolveUnifiedOrderRows(exactMappedCompare, { version: 2, records: [] }, 2, now));
const unlinkedRow = unlinkedRows.find(row => row.itemKey === api.itemKeyForName(item.name));
assert.strictEqual(unlinkedRow.matchStatus, 'ITEM_UNLINKED', 'explicit unlink must win over exact mapped-name price evidence');
assert.strictEqual(unlinkedRow.actualName, '', 'unlinked row must not expose a rejected actual name');
assert.deepStrictEqual(unlinkedRow.actualAliases, [], 'unlinked row must have no effective aliases');
assert.strictEqual(unlinkedRow.priceEvidence, null, 'unlinked row must not use current Excel, history, or ledger prices');
assert.strictEqual(unlinkedRow.unitPrice, null, 'unlinked row must not resolve a unit price');
assert.strictEqual(unlinkedRow.expectedAmount, null, 'unlinked row must not calculate an expected amount');
assert.deepStrictEqual(unlinkedRow.issues, [], 'intentional unlink is a closed user choice, not an error');
assert.strictEqual(api.renderOrderAmountSpan(item, unlinkedRow.stockNeed, unlinkedRow), '<span class="order-amount empty"></span>', 'unlinked row must show no misleading amount card');
const unlinkedSummary = plain(api.summarizeUnifiedOrderAmounts([unlinkedRow]));
assert.deepStrictEqual(unlinkedSummary, { needCount: 0, validAmountCount: 0, total: 0, unresolvedPriceCount: 0, unresolvedAmountCount: 0 }, 'intentional unlink must not inflate top unresolved counts');

api.setAliasMappingsForCheck({
  [item.name]: {
    aliasName: item.name,
    actualName: '과거에 저장된 다른 실발주명',
    actualUnit: 'BOX',
    status: 'confirmed',
    source: 'user',
    conversionFactor: 10,
    conversionStatus: 'confirmed',
  },
});
const staleAliasRows = plain(api.resolveUnifiedOrderRows(exactMappedCompare, { version: 2, records: [] }, 2, now));
const staleAliasRow = staleAliasRows.find(row => row.itemKey === api.itemKeyForName(item.name));
assert.strictEqual(staleAliasRow.matchStatus, 'MATCHED', 'a saved alias remains explicit match state');
assert.strictEqual(staleAliasRow.priceEvidence.provenance, 'EXACT_MAPPED_NAME_CURRENT_EXCEL', 'current exact mappedName must recover price when the saved actual alias is stale');
assert.strictEqual(staleAliasRow.priceCandidateOnly, true, 'stale-alias recovery price remains non-stored candidate evidence');
assert.strictEqual(staleAliasRow.unitPrice, 2400, 'stale saved alias must not hide the exact current Excel price');
assert(!staleAliasRow.issues.some(issue => issue.code === 'PRICE_JOIN_BUG'), 'stale alias plus exact mappedName must not raise the legacy price join bug');
assert.strictEqual(plain(api.getAliasMappingsForCheck())[item.name].actualName, '과거에 저장된 다른 실발주명', 'price fallback must not rewrite the user-owned alias');

assert.strictEqual(api.formatWon(null), '', 'a missing price must never be formatted as zero won');
assert.strictEqual(api.formatWon(0), '0원', 'an explicit valid zero remains distinguishable from missing');
const amountSummary = plain(api.summarizeUnifiedOrderAmounts([
  { stockNeed: 2, unitPrice: 1000, expectedAmount: 2000 },
  { stockNeed: 1, unitPrice: null, expectedAmount: null },
  { stockNeed: 3, unitPrice: 500, expectedAmount: null },
  { stockNeed: 0, unitPrice: null, expectedAmount: null },
]));
assert.deepStrictEqual(amountSummary, {
  needCount: 3,
  validAmountCount: 1,
  total: 2000,
  unresolvedPriceCount: 1,
  unresolvedAmountCount: 1,
}, 'today summary must total valid amounts only and distinguish price versus unit gaps');

api.setAliasMappingsForCheck({});
api.setSiteMappingsForCheck({});
api.setSfaAnalysisHistoryForCheck({ records: [] });
result = targetRow();
assert.strictEqual(result.row.matchStatus, 'ITEM_UNMATCHED', 'no explicit alias or candidate must resolve one unmatched status');
assert(result.row.issues.some(issue => issue.code === 'ITEM_UNMATCHED'), 'true unmatched row must expose the exact reason code');

const secondConflictItem = api.MASTER.find(row => row.name !== item.name);
const sharedActualAlias = '두 품목에 중복된 실발주 별명';
api.setEntriesForCheck([
  { id: 'alias-conflict-a', entryKey: 'alias-conflict-a', name: item.name, zone: 'A', stock: 0 },
  { id: 'alias-conflict-b', entryKey: 'alias-conflict-b', name: secondConflictItem.name, zone: 'B', stock: 0 },
]);
api.setOverridesForCheck({
  [item.name]: { l: 5, k: 0 },
  [secondConflictItem.name]: { l: 5, k: 0 },
});
api.setUnitCorrectionsForCheck({});
api.setSiteMappingsForCheck({});
api.setAliasMappingsForCheck({
  [item.name]: { aliasName: item.name, actualName: sharedActualAlias, actualUnit: 'BOX', status: 'confirmed', conversionFactor: 1, conversionStatus: 'confirmed' },
  [secondConflictItem.name]: { aliasName: secondConflictItem.name, actualName: sharedActualAlias, actualUnit: 'BOX', status: 'confirmed', conversionFactor: 1, conversionStatus: 'confirmed' },
});
const aliasConflictData = {
  ok: true,
  runId: 'alias-conflict-price',
  savedAt: now,
  items: [{ row_index: 301, name: sharedActualAlias, qty: 5, amount: 12000, unit: 'BOX', mappedName: item.name }],
  comparison: { matched: [], missing: [], extra: [] },
};
const aliasConflictRows = plain(api.resolveUnifiedOrderRows(aliasConflictData, { version: 2, records: [] }, 2, now))
  .filter(row => [item.name, secondConflictItem.name].includes(row.internalName));
assert.strictEqual(aliasConflictRows.length, 2);
aliasConflictRows.forEach(row => {
  assert.strictEqual(row.matchStatus, 'ALIAS_CONFLICT');
  assert.strictEqual(row.unitPrice, 2400, 'conflict rows may retain visible price evidence');
  assert.strictEqual(row.expectedAmount, null, 'conflict rows must never calculate an amount');
  const conflictHtml = api.renderOrderAmountSpan(api.MASTER.find(candidate => candidate.name === row.internalName), row.stockNeed, row);
  const conflictVisible = conflictHtml.replace(/<[^>]+>/g, '');
  assert(conflictVisible.includes('예상금액 확인 필요') && conflictVisible.includes('발주명 중복 확인 필요'), 'conflict row must show a short actionable employee reason');
  assert(conflictHtml.includes('같은 실발주 별명이 여러 내부 품목에 중복 확정됐습니다.'), 'full alias-conflict reason must remain in the detail title');
});
const aliasConflictSummary = plain(api.summarizeUnifiedOrderAmounts(aliasConflictRows));
assert.strictEqual(aliasConflictSummary.validAmountCount, 0, 'duplicate alias price must contribute zero valid amount rows');
assert.strictEqual(aliasConflictSummary.total, 0, 'duplicate alias price must never be double-counted');

console.log('OrderHelper unified order row contract regression OK');
