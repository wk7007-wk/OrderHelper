const assert = require('assert');
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g))
  .map(match => match[1])
  .join('\n');

new Function(scripts);

function mustMatch(pattern, message) {
  assert(pattern.test(html), message);
}

mustMatch(/const APP_VERSION = '20260528-1';/, 'APP_VERSION must be bumped for enter fallback');
mustMatch(/function advanceStockInput\(currentId, source = 'manual'\)/, 'stock enter helper missing');
mustMatch(/function shouldFallbackAdvanceFromChange\(target\)/, 'change fallback guard missing');
mustMatch(/if \(active === target\) return true;/, 'mobile change while focused must advance');
mustMatch(/advanceStockInput\(e\.target\.dataset\.id, 'keydown'\)/, 'keydown Enter must use shared helper');
mustMatch(/advanceStockInput\(currentId, 'change'\)/, 'change fallback must use shared helper');

console.log('OrderHelper static checks OK');
