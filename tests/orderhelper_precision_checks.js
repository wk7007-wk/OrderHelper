const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function expect(pattern, message) {
  assert(pattern.test(html), message);
}

expect(/const APP_VERSION = '20260712-1';/, 'release version must be bumped');
expect(/function resolveOrderUnitContract\(item\)/, 'unit-contract resolver missing');
expect(/if \(!contract\.factor\) return 0;/, 'unsafe mixed-unit fallback must be blocked');
expect(/return resolveOrderUnitContract\(item\)\.factor \|\| null;/, 'conversion factor must come from the explicit unit contract');
expect(/qty: outputOrderQty\(item, days\), stockNeed: Math\.round\(g \* 100\) \/ 100, unit: item\.unit, stock: totalStock\(item\.name\)/, 'current analysis snapshot must use outgoing/display quantity');
expect(/qty: outputOrderQty\(item, days\),\s*stockNeed: Math\.round\(g \* 100\) \/ 100,\s*unit: item\.unit,\s*stock: totalStock\(item\.name\)/, 'current calc snapshot must use outgoing/display quantity');
expect(/qty: outputOrderQty\(item, days\), stockNeed: Math\.round\(g\*100\)\/100, unit: item\.unit, stock: totalStock\(item\.name\)/, 'saved calc payload must use outgoing/display quantity');
expect(/const seen = new Map\(\);[\s\S]*existing\.sfa_qty = existing\.qty[\s\S]*existing\._rowCount \+= 1/, 'duplicate SFA rows must merge into a single candidate row');
expect(/const compareRow = \(Array\.isArray\(row\._rowIndexes\) \? row\._rowIndexes : \[row\.row_index\]\)/, 'merged site rows must still resolve comparison rows');
expect(/function actualCandidateCacheKey\(data = lastSfaCompareData\)/, 'actual-candidate cache key missing');
expect(/if \(cachedActualCandidateKey === cacheKey\) return cachedActualCandidates;/, 'actual-candidate cache missing');
expect(/function aliasMatchCacheKey\(data = lastSfaCompareData\)/, 'alias-match cache key missing');
expect(/if \(cachedAliasMatchKey === cacheKey\) return cachedAliasMatches;/, 'alias-match cache missing');

console.log('OrderHelper precision checks OK');
