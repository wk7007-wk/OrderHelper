const assert = require('assert');
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g)).map(match => match[1]).join('\n');

new Function(scripts);

assert.match(html, /const APP_VERSION = '\d{4}\.\d{4}';/);
assert.doesNotMatch(html, /scheduleSalesAutoSave/);
assert.match(html, /addEventListener\('blur', flushSalesAutoSave\)/);
assert.match(html, /id="baseSalesInput"/);
assert.match(html, /id="salesInputs"/);
assert.match(html, /CLI-OK-0826UX2/);
assert.match(html, /function screenOrderPackSize\(item\)/);
assert.match(html, /name:"스티커\(BBQ스티커T\)"[\s\S]*?buffer:0,daily:0/);
assert.match(html, /name:"포장팩커팅칼\(250EA\/봉\)"[\s\S]*?buffer:0,daily:0/);
assert.match(html, /"스티커T_컷팅칼\(떡볶이스티커\)": "스티커\(BBQ스티커T\)"/);
assert.match(html, /item\.name === '스티커\(BBQ스티커T\)' \? 1/);
assert.match(html, /item\.name === '포장팩커팅칼\(250EA\/봉\)' \? 0/);
assert.match(html, /function sfaDisplayNameForItem\(item, resolvedRow = null\)/);
assert.match(html, /gridSortMode === 'sfa'/);
assert.match(html, /ux2-work-mode/);
assert.match(html, /workLabels\.join\(' '\)\} 여유150/);
assert.match(html, /lbl\.textContent = wd/);
assert.match(html, /name === '통다리바베큐,자메이카'\) return 10/);
assert.match(html, /name === 'BBQ양념치킨소스'\) return 4/);
assert.match(html, /name === '올리브치킨용배터믹스-파우다'\) return 4/);
assert.match(html, /return fmt\(screenOrderQty\(item, days\), 0\)/);
assert.match(html, /data-field="stock"/);
assert.match(html, /mobile-row-toggle/);

console.log('orderhelper UX2 static checks: pass');
