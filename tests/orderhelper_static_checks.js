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

function mustNotMatch(pattern, message) {
  assert(!pattern.test(html), message);
}

mustMatch(/const APP_VERSION = '20260601-2';/, 'APP_VERSION must be bumped for output editing');
mustMatch(/function advanceStockInput\(currentId, source = 'manual'\)/, 'stock enter helper missing');
mustMatch(/function renderAndFocusStock\(nextId, source, currentId\)/, 'stock sort render/focus helper missing');
mustMatch(/function sortStockRowsAndKeepFlow\(currentId, source = 'sort'\)/, 'already-focused stock sort helper missing');
mustMatch(/function stockEventLabel\(e, phase\)/, 'stock key event label missing');
mustMatch(/function logStockEvent\(e, phase\)/, 'stock key event logger missing');
mustMatch(/let usageHistory = \{\};/, 'usage history state missing');
mustMatch(/let usageAnalysis = \{\};/, 'usage analysis state missing');
mustMatch(/function buildUsageAnalysis\(history, currentSnapshot\)/, 'usage analysis builder missing');
mustMatch(/const usage = prevStock \+ orderQty - currStock;/, 'usage analysis must infer from previous stock plus order minus next stock');
mustMatch(/data-analysis-name="\$\{escapeHtml\(name\)\}"/, 'daily analysis marker must be rendered next to daily usage');
mustMatch(/loadUsageHistory\(true\);/, 'usage history must load on page start');
mustMatch(/setInterval\(\(\) => loadUsageHistory\(true\), 300000\);/, 'usage history must refresh periodically');
mustMatch(/function handleOutputCellInput\(target\)/, 'output edit handler missing');
mustMatch(/function setOutputStockTotal\(name, value\)/, 'output stock total setter missing');
mustMatch(/data-output-name="\$\{escapeHtml\(name\)\}" data-output-field="\$\{field\}"/, 'output edit inputs must use output-only dataset fields');
mustMatch(/if \(handleOutputCellInput\(e\.target\)\) return;/, 'output edit input must bypass row-id input handler');
mustMatch(/if \(e\.target\.dataset\.outputField\) \{\s*flushAutoSave\('auto'\);\s*render\(\);\s*return;\s*\}/, 'output edit change must save and rerender');
mustMatch(/let debugLogs = \[\];/, 'debug logs state missing');
mustMatch(/const DEBUG_LOG_STORAGE_KEY = 'bbq_debug_logs';/, 'debug logs local storage key missing');
mustMatch(/let outputOrder = \[\];/, 'output order state missing');
mustMatch(/const OUTPUT_ORDER_STORAGE_KEY = 'bbq_output_order';/, 'output order storage key missing');
mustMatch(/function getOutputItems\(days\)/, 'output item sort helper missing');
mustMatch(/function moveOutputItem\(name, direction\)/, 'output move helper missing');
mustMatch(/outputOrder = visibleNames\.concat\(remaining\);/, 'output move must persist visible order');
mustMatch(/outputOrder = cleanOutputOrder\(\);/, 'output order must be cleaned before saving');
mustMatch(/outputOrder, dailySales/, 'Firebase payload must include output order');
mustMatch(/if \(data\.outputOrder\) outputOrder = cleanOutputOrder\(data\.outputOrder\);/, 'Firebase sync must restore output order');
mustMatch(/localStorage\.setItem\(OUTPUT_ORDER_STORAGE_KEY, JSON\.stringify\(outputOrder\)\)/, 'output order must be stored locally');
mustMatch(/function pushDebugLog\(message, tone = 'debug', ts = Date\.now\(\)\)/, 'internal debug logger missing');
mustMatch(/debugLogs: debugLogs\.slice\(0, DEBUG_LOG_LIMIT\)/, 'debug logs must be included in Firebase payload');
mustMatch(/pushDebugLog\('키 ' \+ msg, 'warn'\)/, 'stock key logs must be analysis-only');
mustMatch(/name:"배달소스-\(신\)비비소스",unit:"봉\/봉",policy:"여유",buffer:1,daily:0/, 'BB sauce baseline missing');
mustMatch(/name:"레몬보이",unit:"봉\/봉",policy:"여유",buffer:1,daily:0/, 'Lemonboy must match BB sauce baseline');
mustMatch(/name:"고추,가위,소금,종이호일,레몬보이,검정봉투"/, 'existing combined Lemonboy misc item must remain');
mustMatch(/const DEFAULT_SNOOZE_DAYS = 5;/, 'snooze default days must be 5');
mustMatch(/const MAX_SNOOZE_DAYS = 365;/, 'snooze max guard missing');
mustMatch(/id="snoozeDaysInput" type="text" inputmode="numeric" pattern="\[0-9\]\*" maxlength="3" autocomplete="off" value="5" oninput="sanitizeSnoozeDaysInput\(this\)"/, 'snooze dialog must use digits-only input with default value');
mustMatch(/function sanitizeSnoozeDaysInput\(input\)/, 'snooze digit sanitizer missing');
mustMatch(/replace\(\/\\D\/g, ''\)\.slice\(0, 3\)/, 'snooze input must strip non-digits while typing');
mustMatch(/parseInt\(String\(value \|\| ''\)\.replace\(\/\\D\/g, ''\), 10\)/, 'snooze parser must ignore non-digits');
mustMatch(/function openSnoozeDialog\(name\)/, 'snooze dialog opener missing');
mustMatch(/function confirmSnooze\(event\)/, 'snooze dialog submit handler missing');
mustMatch(/function applySnoozeItem\(name, days\)/, 'snooze apply helper missing');
mustMatch(/function snoozeItem\(name\) \{\s*openSnoozeDialog\(name\);\s*\}/, 'snooze button must open numeric dialog');
mustNotMatch(/prompt\(/, 'snooze must not use browser prompt');
mustMatch(/function shouldFallbackAdvanceFromChange\(target, currentId\)/, 'change fallback guard missing');
mustMatch(/if \(active === target\) return true;/, 'mobile change while focused must advance');
mustMatch(/activeField === 'stock' && activeId === nextStockId/, 'already-correct next stock focus must not be overridden');
mustMatch(/change correction current=\$\{currentId\}/, 'wrong active focus must be logged');
mustMatch(/dateKey, orderDays: days/, 'daily history payload must include KST date key');
mustMatch(/fetch\(`\$\{FB_URL\}\$\{FB_PATH\}\/history\/\$\{dateKey\}\.json`/, 'daily history path must be saved');
mustMatch(/<th>순서<\/th>/, 'output view must show order controls header');
mustMatch(/onclick="moveOutputItem\('\$\{safeName\}', -1\)"/, 'output row must include move-up button');
mustMatch(/onclick="moveOutputItem\('\$\{safeName\}', 1\)"/, 'output row must include move-down button');
mustMatch(/data-field="k" value="\$\{fmt\(getK\(item\),2\)\}"/, 'k field must still render');
mustMatch(/data-field="l" value="\$\{fmt\(getL\(item\),2\)\}"/, 'l field must still render');
mustMatch(/step="0\.1" tabindex="-1" data-id="\$\{ent\.id\}" data-field="k"/, 'k field must be skipped by keyboard next navigation');
mustMatch(/step="0\.1" tabindex="-1" data-id="\$\{ent\.id\}" data-field="l"/, 'l field must be skipped by keyboard next navigation');
mustMatch(/class="cell zone" type="text" tabindex="-1"/, 'zone field must be skipped by keyboard next navigation');
mustMatch(/<button class="add" tabindex="-1"/, 'row action buttons must be skipped by keyboard next navigation');
mustMatch(/return renderAndFocusStock\(nextId, source, currentId\);/, 'stock advance must render sorted rows and restore focus');
mustMatch(/advanceStockInput\(e\.target\.dataset\.id, 'keydown'\)/, 'keydown Enter must use shared helper');
mustMatch(/advanceStockInput\(currentId, 'change'\)/, 'change fallback must use shared helper');
mustMatch(/sortStockRowsAndKeepFlow\(currentId, 'change'\)/, 'change with already-correct focus must still sort rows');
mustMatch(/flushAutoSave\('auto'\)/, 'stock logs and sorted state must be saved immediately');
mustNotMatch(/pushSaveLog\('키 /, 'stock key logs must not be visible user logs');
mustNotMatch(/pushSaveLog\(`보정 /, 'focus correction logs must not be visible user logs');
mustNotMatch(/pushSaveLog\('정렬이동 /, 'sort/focus logs must not be visible user logs');

console.log('OrderHelper static checks OK');
