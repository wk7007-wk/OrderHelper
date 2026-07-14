const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const indexPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const inferencePath =
  process.env.ORDERHELPER_INFERENCE_SCRIPT?.trim() ||
  path.join('/root', 'my-first-project', 'scripts', 'orderhelper_usage_inference.py');
assert(
  fs.existsSync(inferencePath),
  `missing inference script: ${inferencePath} (set ORDERHELPER_INFERENCE_SCRIPT)`
);
const inferencePy = fs.readFileSync(inferencePath, 'utf8');
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

function mustMatchPy(pattern, message) {
  assert(pattern.test(inferencePy), message);
}

mustMatch(/const APP_VERSION = '0715.0209';/, 'APP_VERSION must match the KST autosave hotfix build time');
mustMatch(/const SAVE_REQUEST_TIMEOUT_MS = 20000;/, 'Firebase autosave must have a bounded request timeout');
mustMatch(/async function putConfirmedSaveTargets\(commit, timeoutMs = SAVE_REQUEST_TIMEOUT_MS\)/, 'confirmed current/history writes need a shared abortable timeout');
mustMatch(/controller\.abort\(\);/, 'a failed save target must abort its sibling before releasing single-flight');
mustMatch(/const CONFIRMED_SAVE_QUEUE_STORAGE_KEY = 'bbq_confirmed_save_queue_v1';/, 'confirmed remote queue key missing');
mustMatch(/function retryConfirmedRemotePending\(reason = 'recovery'\)/, 'confirmed pending recovery helper missing');
mustMatch(/window\.addEventListener\('online', \(\) => retryConfirmedRemotePending\('online'\)\);/, 'online recovery must retry only confirmed pending state');
mustMatch(/return \{ v: 1, active: null, queued: null \};/, 'confirmed queue must have active and latest queued slots');
mustMatch(/body: JSON\.stringify\(payload\)/, 'Enter must capture an immutable serialized payload');
mustMatch(/if \(!nextQueue\.active && commit\.revision === localMutationRevision\) clearLocalDirtyRevision\(\);/, 'only the latest confirmed revision may clear local dirty state');
mustMatch(/const USAGE_ANALYSIS_MAX_DAYS = 90;/, 'usage analysis must use a bounded recent history window');
mustMatch(/const SFA_ORDER_REQUEST_PATH = '\/monitor\/main_pc\/sfa_order_request';/, 'SFA immediate analysis request path missing');
mustMatch(/const SFA_ORDER_STATUS_PATH = '\/monitor\/main_pc\/sfa_order';/, 'SFA status path missing');
mustMatch(/const SFA_COMPARE_PATH = `\$\{FB_PATH\}\/sfaCompare\/latest`;/, 'SFA latest comparison path missing');
mustMatch(/const SFA_ACTUAL_HISTORY_PATH = `\$\{FB_PATH\}\/sfaActualHistory`;/, 'SFA actual order history path missing');
mustMatch(/const DESKTOP_ACCESS_PATH = `\$\{FB_PATH\}\/desktopAccess`;/, 'desktop access Firebase path missing');
mustMatch(/const DESKTOP_GRACE_MS = 24 \* 60 \* 60 \* 1000;/, 'desktop grace window must be explicitly 24 hours');
mustMatch(/radiusM: 700/, 'GPS auth radius must be temporarily 700m');
mustMatch(/매장 GPS 700m/, 'auth UI must disclose the temporary 700m GPS radius');
mustMatchPy(/--validate-local-sfa-history/, 'local SFA history mapping validation flag missing');
mustMatchPy(/local_sfa_backfill_low_confidence_rows/, 'local SFA mapping validation must expose low-confidence row count');
mustMatch(/function advanceStockInput\(currentId, source = 'manual'\)/, 'stock enter helper missing');
mustMatch(/function renderAndFocusStock\(nextId, source, currentId\)/, 'stock sort render/focus helper missing');
mustMatch(/function sortStockRowsAndKeepFlow\(currentId, source = 'sort'\)/, 'already-focused stock sort helper missing');
mustMatch(/function stockEventLabel\(e, phase\)/, 'stock key event label missing');
mustMatch(/function logStockEvent\(e, phase\)/, 'stock key event logger missing');
mustMatch(/let usageHistory = \{\};/, 'usage history state missing');
mustMatch(/let usageAnalysis = \{\};/, 'usage analysis state missing');
mustMatch(/let sfaActualHistory = \{\};/, 'SFA actual history state missing');
mustMatch(/function buildUsageAnalysis\(history, currentSnapshot\)/, 'usage analysis builder missing');
mustMatch(/USAGE_ANALYSIS_MAX_DAYS \* 86400000/, 'usage analysis must limit old history records');
mustMatch(/const usage = order\.source === 'actual'[\s\S]*prevStock \+ \(Number\(order\.actualQty \|\| 0\) \* Number\(order\.orderUnitToStockFactor \|\| 1\)\) - currStock[\s\S]*: prevStock \+ orderQty - currStock;/, 'usage analysis must convert actual SFA orders back into stock units before inferring usage');
mustMatch(/data-analysis-name="\$\{escapeHtml\(name\)\}"/, 'daily analysis marker must be rendered next to daily usage');
mustMatch(/loadUsageHistory\(true\);/, 'usage history must load on page start');
mustMatch(/setInterval\(\(\) => loadUsageHistory\(true\), 300000\);/, 'usage history must refresh periodically');
mustMatch(/function handleOutputCellInput\(target\)/, 'output edit handler missing');
mustMatch(/function setOutputStockTotal\(name, value\)/, 'output stock total setter missing');
mustMatch(/let actualOrders = \{\};/, 'actual order state missing');
mustMatch(/let conversionAnalysis = \{\};/, 'conversion analysis state missing');
mustMatch(/function setActualOrderValue\(name, value\)/, 'actual order setter missing');
mustMatch(/function outputOrderQty\(item, days\)/, 'output order qty must prefer actual order');
mustMatch(/function displayOrderQty\(item, days\)/, 'input and output order display must share the same quantity formatter');
mustMatch(/function displayDecimal\(value\)/, 'decimal display helper missing');
mustMatch(/function parseMoney\(value\)/, 'money parser missing');
mustMatch(/function formatWon\(value\)/, 'won formatter missing');
mustMatch(/function sfaUnitPriceFromRow\(row\)/, 'SFA unit price resolver missing');
mustMatch(/function expectedOrderAmountForItem\(item, stockNeed\)/, 'expected order amount helper missing');
mustMatch(/const matched = lastSfaCompareData\?\.comparison\?\.matched \|\| \[\];/, 'amount estimate must read latest matched SFA comparison rows');
mustMatch(/const recommendedQty = recommendedOrderQty\(item, stockNeed\);/, 'amount estimate must use the same recommended order quantity conversion');
mustMatch(/expected_order_amount: recommendedQty \* price\.unitPrice/, 'amount estimate must multiply converted order qty by inferred unit price');
mustMatch(/return Math\.ceil\(\(n - 1e-9\) \* 10\) \/ 10;/, 'order quantity must round up to one decimal instead of whole units');
mustMatch(/return fmt\(outputOrderQty\(item, days\), 1\);/, 'order quantity display must preserve one decimal digit');
mustMatch(/function updateOutputOrderForName\(name\)/, 'output stock/k/l edits must immediately refresh the visible order quantity');
mustMatch(/function bindCellInputs\(\)/, 'cell event binding must be shared by input and output views');
mustMatch(/bindCellInputs\(\);\s*updateStickyOffsets\(\);\s*return;/, 'output view must bind stock/buffer/daily inputs before returning');
mustMatch(/function normalizeOrderUnit\(unit\)/, 'unit alias normalizer missing');
mustMatch(/\['box', '박스', '박'\]\.includes\(value\)/, 'box/박스/박 must be treated as the same order unit');
mustMatch(/checkUnitKey === orderUnitKey/, 'unit equality must compare normalized unit aliases');
mustMatch(/name:"신선육\(10호\)-뼈한마리",unit:"박\/박스"/, 'fresh meat 박/박스 regression item missing');
mustMatch(/function requestSfaOrderAnalysis\(\)/, 'SFA analysis request button handler missing');
mustMatch(/id="sfaAnalyzeBtn" type="button" onclick="requestSfaOrderAnalysis\(\)"/, 'SFA analysis request button missing');
mustMatch(/id="sfaCompareBtn" type="button" onclick="toggleSfaComparePanel\(\)">오차보기<\/button>/, 'SFA compare result button missing');
mustMatch(/id="desktopAccessBtn" type="button" onclick="toggleDesktopAccessPanel\(\)">접근관리<\/button>/, 'desktop access management button missing');
mustMatch(/id="desktopAccessPanel"/, 'desktop access panel missing');
mustMatch(/id="sfaComparePanel"/, 'SFA compare panel missing');
mustMatch(/data-tab="match" onclick="setSfaAnalysisTab\('match'\)">1:1 매칭<\/button>/, '1:1 matching tab missing');
mustMatch(/data-tab="alias" onclick="setSfaAnalysisTab\('alias'\)">별명 검수<\/button>/, 'alias review tab missing');
mustMatch(/data-tab="unit" onclick="setSfaAnalysisTab\('unit'\)">단위 보정<\/button>/, 'unit correction tab missing');
mustMatch(/data-tab="unmatched" onclick="setSfaAnalysisTab\('unmatched'\)">미매칭<\/button>/, 'unmatched tab missing');
mustMatch(/data-tab="io" onclick="setSfaAnalysisTab\('io'\)">입출력<\/button>/, 'analysis IO tab missing');
mustMatch(/id="sfaStatus">엑셀 대기<\/span>/, 'SFA status chip missing');
mustMatch(/function loadSfaOrderStatus\(silent = true\)/, 'SFA status polling handler missing');
mustMatch(/function renderSfaStatus\(data\)/, 'SFA status renderer missing');
mustMatch(/function renderSfaComparePanel\(data\)/, 'SFA comparison renderer missing');
mustMatch(/function loadSfaCompareLatest\(silent = true, forceShow = false\)/, 'SFA comparison loader missing');
mustMatch(/function toggleSfaComparePanel\(\)/, 'SFA comparison toggle missing');
mustMatch(/function sfaStatusToastText\(data\)/, 'SFA status change toast handler missing');
mustMatch(/let sfaLastRequestAt = 0;/, 'SFA status must track request time to ignore stale completion states');
mustMatch(/let lastSfaCompareStatusKey = '';/, 'SFA compare loader must dedupe completed status updates');
mustMatch(/let lastSfaResultAppliedAt = 0;/, 'SFA result application time must be tracked separately from Excel completion time');
mustMatch(/statusMs < sfaLastRequestAt/, 'SFA status must ignore stale states older than the latest request');
mustMatch(/loadSfaCompareLatest\(true, hadPendingRequest\)/, 'fresh SFA completion must load visible comparison results');
mustMatch(/function buildSfaAnalysisPayloadState\(data = lastSfaCompareData\)/, 'SFA payload state builder missing');
mustMatch(/function refreshSfaResultViewsWithCurrentState\(data = lastSfaCompareData, reason = 'sfaResult'\)/, 'SFA result refresh helper missing');
mustMatch(/lastSfaCompareData = data;\s*await autoLoadFromFB\(true\);\s*await loadUsageHistory\(true\);\s*refreshSfaResultViewsWithCurrentState\(data, 'latestCompare'\);/, 'fresh SFA comparison must load latest current/history before rebuilding alias and inline views');
mustMatch(/if \(lastSfaCompareData && \(viewMode === 'output' \|\| document\.querySelector\('\.inline-alias-correction'\)\)\) render\(\);/, 'SFA history load must force main rows and inline alias controls to refresh');
mustMatch(/const appliedText = lastSfaResultAppliedAt \? ` · 적용 \$\{sfaCompareTime\(lastSfaResultAppliedAt\)\}` : '';/, 'SFA compare meta must track UI application time');
mustMatch(/완료 \$\{sfaCompareTime\(data\.savedAt\)\}` : ''\}\$\{appliedText\}/, 'SFA compare meta must separate Excel completion and UI application times');
mustMatch(/setInterval\(\(\) => loadSfaOrderStatus\(false\), 10000\);/, 'SFA status must refresh every 10 seconds');
mustMatch(/mode: 'scan_pc_downloads'/, 'SFA request must target the PC download folder flow');
mustMatch(/const currentSaved = await flushCurrentBeforeSfaAnalysisRequest\(\);[\s\S]*const sfaAnalysisState = buildSfaAnalysisPayloadState\(lastSfaCompareData\);/, 'SFA request must save current state before building effective alias payload');
mustMatch(/orderDays: sfaAnalysisState\.orderDays,[\s\S]*entries: sfaAnalysisState\.entries,[\s\S]*overrides: sfaAnalysisState\.overrides,[\s\S]*orderAliasMappings: sfaAnalysisState\.orderAliasMappings,[\s\S]*orderAliasMappingDrafts: sfaAnalysisState\.orderAliasMappingDrafts,[\s\S]*effectiveOrderAliasMappings: sfaAnalysisState\.effectiveOrderAliasMappings,/, 'SFA request payload must carry latest current state and rebuilt alias read models');
mustMatch(/PC 다운로드 폴더 분석 요청함/, 'SFA request must give user feedback');
mustMatch(/renderSfaStatus\(\{ state: 'requested'/, 'SFA request must update visible status immediately');
mustMatch(/수동 일사용\/발주값 자동변경 없음/, 'SFA compare panel must disclose that analysis does not edit manual daily/order values');
mustMatch(/실사용 참고 즉시 반영/, 'SFA compare panel must disclose that actual order history refreshes reference badges');
mustMatch(/실발주 이력은 실사용 참고에만 반영/, 'SFA compare panel must disclose that actual order history is reference-only');
mustMatch(/sfaReviewRows\(comp\)/, 'SFA comparison must include matched differences and missing rows');
mustMatch(/function orderUnitParts\(item\)/, 'check/order unit parser missing');
mustMatch(/function buildConversionAnalysis\(history, currentSnapshot\)/, 'unit conversion analysis builder missing');
mustMatch(/function movementConversionFactorFromRecords\(prev, curr, item\)/, 'unit conversion must infer from stock movement versus actual SFA order quantity');
mustMatch(/const observedDelivery = currStock - prevStock \+ expectedUsage;/, 'stock movement inference must compare inventory change with expected usage');
mustMatch(/result\[item\.name\] = \{ \.\.\.movement, source: 'movement'/, 'movement-derived conversion must override manual unit labels when usable');
mustMatch(/function recommendedOrderQty\(item, stockNeed\)/, 'recommended order quantity converter missing');
mustMatch(/let orderSiteMappings = \{\};/, 'order-site mapping correction state missing');
mustMatch(/let orderAliasMappings = \{\};/, 'order alias mapping correction state missing');
mustMatch(/let orderUnitCorrections = \{\};/, 'order-unit correction state missing');
mustMatch(/const ORDER_SITE_MAPPING_STORAGE_KEY = 'bbq_order_site_mappings';/, 'order-site mapping local storage key missing');
mustMatch(/const ORDER_ALIAS_MAPPING_STORAGE_KEY = 'bbq_order_alias_mappings';/, 'order alias mapping local storage key missing');
mustMatch(/const ORDER_UNIT_CORRECTION_STORAGE_KEY = 'bbq_order_unit_corrections';/, 'order-unit correction local storage key missing');
mustMatch(/function normalizeSiteItemName\(text\)/, 'site item normalizer missing');
mustMatch(/function scoreSiteToMaster\(siteName, masterName\)/, 'site/master score helper missing');
mustMatch(/function buildOrderSiteMatches\(data = lastSfaCompareData\)/, 'order-site matching builder missing');
mustMatch(/function collectActualOrderCandidates\(data = lastSfaCompareData\)/, 'actual order candidate collector missing');
mustMatch(/function bestActualCandidatesForAlias\(aliasName, candidates = collectActualOrderCandidates\(\), limit = 5\)/, 'alias candidate scorer missing');
mustMatch(/function usageEstimateFromRecord\(record, name\)/, 'usage estimate resolver missing');
mustMatch(/function actualOrderQtyForUsageDate\(dateKey, item, actualNameKeys, data = lastSfaCompareData\)/, 'date-matched SFA actual order resolver missing');
mustMatch(/function usageBasedConversionCandidateForAlias\(item, data = lastSfaCompareData, records = null\)/, 'usage-based conversion candidate builder missing');
mustMatch(/function conversionCandidatesForAlias\(item, data = lastSfaCompareData, usageRecords = null\)/, 'alias conversion candidate builder missing');
mustMatch(/function orderAliasMappingDraftsForPayload\(data = lastSfaCompareData\)/, 'alias draft payload builder missing');
mustMatch(/function effectiveOrderAliasMappingsForPayload\(data = lastSfaCompareData\)/, 'effective alias mapping payload builder missing');
mustMatch(/function buildOrderAliasMatches\(data = lastSfaCompareData\)/, 'order alias matching builder missing');
mustMatch(/const usageRecords = historyRecordsWithCurrent\(usageHistory, currentAnalysisSnapshot\(\)\);/, 'alias matching should build usage conversion records once');
mustMatch(/function setOrderSiteMapping\(siteKey, targetName, siteName = '', siteUnit = '', persistence = 'sync'\)/, 'order-site mapping setter missing');
mustMatch(/function suggestedMasterCandidatesForNewSource\(row, limit = 5\)/, 'new raw source must expose fuzzy suggestions without auto-confirming them');
mustMatch(/isNewSource: !correction,/, 'order-present mapping-absent rows must be marked as new');
mustNotMatch(/else if \(candidates\[0\]\?\.score >= 0\.84\)/, 'local fuzzy candidate must not auto-confirm a new raw source');
mustMatch(/function confirmNewSourceAliasMapping\(siteKey, targetName, siteName = '', siteUnit = ''\)/, 'new raw source must support explicit canonical confirmation');
mustMatch(/setOrderSiteMapping\(siteKey, nextTarget, siteName, siteUnit, 'local'\)/, 'new alias confirmation must reuse the compatible raw mapping setter in local mode');
mustMatch(/localStorage\.setItem\(ORDER_SITE_MAPPING_STORAGE_KEY, JSON\.stringify\(orderSiteMappings\)\);/, 'local new alias confirmation must persist the complete existing mapping map');
mustMatch(/const LOCAL_NEW_SOURCE_ALIAS_STORAGE_KEY = 'bbq_local_new_source_aliases_v1';/, 'new raw aliases must have a local overlay that survives remote current refreshes');
mustMatch(/function mergeLocalNewSourceAliases\(source = orderSiteMappings\)/, 'local new raw aliases must merge over existing remote mappings without deletion');
mustMatch(/orderSiteMappings = mergeLocalNewSourceAliases\(orderSiteMappings\);/, 'remote and reload hydrate paths must reapply local new aliases');
mustMatch(/신규 발주 원문 · 사용자 확정 필요/, 'Alias UI must surface order-present mapping-absent raw rows');
mustMatch(/function orderCycleMissingWarning\(name\)[\s\S]*overrides\.l \/ MASTER\.daily[\s\S]*currentOrderDaysValue\(\)/, 'order-absent canonical rows may show only a read-only daily/orderDays diagnostic');
mustMatch(/function setOrderAliasMapping\(aliasName, actualName\)/, 'order alias mapping setter missing');
mustMatch(/function setOrderAliasConversion\(aliasName, value, mode = 'candidate'\)/, 'order alias conversion setter missing');
mustMatch(/function inlineAliasCorrectionHtml\(row\)/, 'input row inline alias correction renderer missing');
mustMatch(/class="inline-alias-correction \$\{statusClass\}"/, 'input row alias correction must render a compact details block');
mustMatch(/class="sfa-select inline-alias-select"/, 'input row actual-name alias selector missing');
mustMatch(/class="sfa-select inline-alias-factor-select"/, 'input row conversion candidate selector missing');
mustMatch(/class="sfa-edit inline-alias-factor-input"/, 'input row manual conversion input missing');
mustMatch(/function bindInlineAliasControls\(\)/, 'input row inline alias binding missing');
mustMatch(/setOrderAliasMapping\(e\.target\.dataset\.aliasName, e\.target\.value\);/, 'inline alias selector must reuse confirmed alias mapping setter');
mustMatch(/setOrderAliasConversion\(e\.target\.dataset\.aliasName, e\.target\.value, 'candidate'\);/, 'inline conversion candidate selector must save through confirmed conversion setter');
mustMatch(/setOrderAliasConversion\(e\.target\.dataset\.aliasName, e\.target\.value, 'manual'\);/, 'inline manual conversion input must save through manual conversion setter');
mustMatch(/const inlineAliasRowsByName = new Map\(buildOrderAliasMatches\(lastSfaCompareData\)\.map\(row => \[row\.aliasName, row\]\)\);/, 'input view must share alias match rows with alias review state');
mustMatch(/data-item-name="\$\{escapeHtml\(item\.name\)\}"/, 'input row name cell must keep item identity while showing inline correction controls');
mustMatch(/bindInlineAliasControls\(\);\s*updateStickyOffsets\(\);/, 'input view must bind inline alias controls after rendering rows');
mustMatch(/const allowedStatuses = new Set\(\['candidate', 'default', 'confirmed', 'manual'\]\);/, 'alias mapping sanitizer must preserve default status');
mustMatch(/if \(status === 'default'\) return '기본';/, 'alias default status must be visible in UI');
mustMatch(/function conversionStatusText\(status\)/, 'conversion status label helper missing');
mustMatch(/effectiveOrderAliasMappings,/, 'SFA request payload must include effective alias mappings');
mustMatch(/if \(source === 'usage'\) return '실사용량 비교';/, 'usage-based conversion source label missing');
mustMatch(/function conversionDirectionText\(factor, orderUnit = '발주단위', checkUnit = '체크\/재고'\)/, 'conversion direction helper missing');
mustMatch(/환산값=발주 1\$\{labelOrderUnit\}가 체크\/재고 \$\{fmt\(factor, 3\)\}\$\{labelCheckUnit\}에 해당/, 'conversion direction helper must define stock/check units per one order unit');
mustMatch(/실사용량 비교 \$\{summary\.samples\}건/, 'usage-based conversion reason must show sample count');
mustMatch(/예: 체크 10개=발주 1박스이면 10/, 'conversion UI/reason must include the user example');
mustMatch(/제외 \$\{summary\.skipped \|\| 0\}건/, 'usage-based conversion reason must show skipped/outlier count');
mustMatch(/function setOrderUnitCorrection\(name, field, value\)/, 'order-unit correction setter missing');
mustMatch(/class="sfa-select sfa-alias-factor-select"/, 'alias conversion candidate selector missing');
mustMatch(/class="sfa-edit sfa-alias-factor-input"/, 'alias conversion direct input missing');
mustMatch(/환산값: 발주1=체크\/재고/, 'alias conversion selector must state the factor direction');
mustMatch(/placeholder="예: 10"/, 'alias conversion direct input should show the 10-per-box example value');
mustMatch(/환산값 발주1=체크\/재고 \$\{fmt\(row\.conversionFactor, 3\)\}/, 'alias row must show fixed conversion direction');
mustMatch(/orderUnitToStockFactor: candidate\.factor/, 'conversion candidate payload must include orderUnitToStockFactor alias');
mustMatch(/conversionFactorMeaning: '발주 1단위가 체크\/재고 몇 단위인지'/, 'analysis payload must include conversion factor meaning');
mustMatch(/function parseManualSfaItemsText\(text\)/, 'manual analysis input parser missing');
mustMatch(/function fillSfaManualItemsSample\(\)/, 'manual analysis sample filler missing');
mustMatch(/function renderSfaAnalysisTab\(data = lastSfaCompareData\)/, 'analysis tab renderer missing');
mustMatch(/function loadDesktopAccessState\(silent = true\)/, 'desktop access state loader missing');
mustMatch(/function recordDesktopAuthCandidate\(device, hash, reason = 'gps_unavailable', state = desktopAccessState\)/, 'desktop auth candidate recorder missing');
mustMatch(/function desktopDeviceApproved\(hash, state = desktopAccessState\)/, 'approved desktop device fallback missing');
mustMatch(/row\.enabled !== false && row\.status === 'approved' && row\.isDesktop === true/, 'approved fallback must remain desktop-token scoped');
mustMatch(/function isDesktopGraceActive\(state = desktopAccessState, now = Date\.now\(\)\)/, 'desktop grace expiry check missing');
mustMatch(/function startDesktopGraceWindow\(\)/, 'desktop grace start action missing');
mustMatch(/function approveDesktopDevice\(hash\)/, 'desktop candidate approval action missing');
mustMatch(/status: 'approved'[\s\S]*approvedBy: 'orderhelper_ui'/, 'desktop approval must persist approved status and source');
mustMatch(/status = existing\.status === 'approved' \? 'approved' : \(isDesktopGraceActive\(state\) \? 'candidate' : 'pending'\)/, 'grace candidates must not become approved automatically');
mustMatch(/if \(desktopDeviceApproved\(hash, state\)\)[\s\S]*return 'desktop';/, 'approved desktop must pass GPS fallback');
mustMatch(/if \(isDesktopGraceActive\(state\)\) return 'desktop-grace';/, 'active grace window must allow temporary desktop fallback');
mustMatch(/function hasTrustedIpFactor\(\) \{[\s\S]*return false;\s*\}/, 'IP-only factor must not be trusted by the static client');
mustMatch(/Array\.isArray\(parsed\.mappings\)/, 'manual analysis input must accept exported mapping JSON');
mustMatch(/const manualFactor = manualUnitFactorForItem\(item\);\s*if \(manualFactor\) return manualFactor;/, 'manual unit factor must override inferred conversion');
mustMatch(/if \(multiple\) out = Math\.ceil\(\(out - 1e-9\) \/ multiple\) \* multiple;/, 'manual order multiple must round up order qty');
mustMatch(/if \(minOrderQty\) out = Math\.max\(out, minOrderQty\);/, 'manual min order qty must be applied');
mustMatch(/spread: max \/ Math\.max\(min, 1e-9\)/, 'unit conversion summaries must track consistency spread');
mustMatch(/analysis\?\.source === 'unit'[\s\S]*Number\(analysis\.samples \|\| 0\) >= 3[\s\S]*Number\(analysis\.spread \|\| 999\) <= 1\.25/, 'stable unit-pair patterns must be used for order quantity conversion');
mustMatch(/같은 단위 기록 \$\{analysis\.samples\}건 기준/, 'unit-pair conversion analysis must be visible to the user');
mustMatch(/단위환산 분석: orderUnitToStockFactor \$\{fmt\(analysis\.factor, 2\)\}\. \$\{conversionDirectionText\(analysis\.factor, parts\.orderUnit \|\| '발주단위', parts\.checkUnit \|\| '재고단위'\)\} \(재고 변동 \$\{analysis\.samples\}건\)\. 예: 체크 10개=발주 1박스이면 환산값 10\./, 'movement-derived unit conversion must disclose fixed factor direction');
mustMatch(/stockNeed: Math\.round\(g\s*\*\s*100\) \/ 100/, 'calc payload must preserve stock-unit need separately');
mustMatch(/renderOrderAnalysisSpan\(item, g\)/, 'output order cell must show conversion/missing warning');
mustMatch(/function renderOrderAmountSpan\(item, stockNeed\)/, 'output order amount renderer missing');
mustMatch(/<span class="order-amount" title="\$\{escapeHtml\(title\)\}">예상 \$\{escapeHtml\(formatWon\(estimate\.expected_order_amount\)\)\}<\/span>/, 'output order cell must show expected amount from SFA amount data');
mustMatch(/renderOrderAnalysisSpan\(item, g\)\}\$\{renderOrderAmountSpan\(item, g\)\}/, 'unit conversion analysis and amount estimate must render as separate chips');
mustMatch(/예상 발주금액 \$\{formatWon\(estimate\.expected_order_amount\)\}/, 'amount chip title must disclose expected order amount');
mustMatch(/단가 \$\{formatWon\(estimate\.unit_price\)\} \(\$\{estimate\.basis\}\)/, 'amount chip title must disclose unit price basis');
mustMatch(/function outputOrderDisplay\(name, value\)/, 'output order must be read-only display');
mustMatch(/class="output-order-value" data-output-name="\$\{escapeHtml\(name\)\}" data-output-field="order"/, 'output order display marker missing');
mustNotMatch(/outputNumberInput\(item\.name, 'order'/, 'output order must not render as an editable input');
mustMatch(/outputNumberInput\(item\.name, 'stock', displayDecimal\(E\)\)/, 'output stock must display one decimal place');
mustMatch(/outputNumberInput\(item\.name, 'k', displayDecimal\(getK\(item\)\)\)/, 'output buffer must display one decimal place');
mustMatch(/outputNumberInput\(item\.name, 'l', displayDecimal\(getL\(item\)\)\)/, 'output daily usage must display one decimal place');
mustMatch(/const orderText = isNeed \? displayOrderQty\(item, days\) : '';/, 'input order view must show the same order-unit quantity as output view');
mustMatch(/gCell\.textContent = isNeed \? displayOrderQty\(item, days\) : '';/, 'live input order refresh must use the same output quantity');
mustMatch(/const isDuplicateCell = gCell\.classList\.contains\('dup'\);/, 'duplicate input rows must keep the same order quantity while preserving duplicate styling');
mustMatch(/updateDailyAnalysisForName\(name\);\s*updateOutputOrderForName\(name\);/, 'output stock edits must refresh order quantity');
mustMatch(/setOverrideValue\(name, field, value\);\s*saveLocalDraft\(\);\s*updateOutputOrderForName\(name\);/, 'output buffer/daily edits must persist only a local draft while typing');
mustNotMatch(/handleOutputCellInput\(e\.target\);\s*flushAutoSave\('auto'\);/, 'output typing/change must not auto-commit remotely');
mustMatch(/actualOrders = cleanActualOrders\(\);/, 'actual orders must be sanitized before save');
mustMatch(/actualOrders, orderSiteMappings, orderAliasMappings, orderAliasMappingDrafts, effectiveOrderAliasMappings, orderUnitCorrections, dailySales/, 'Firebase payload must include actual orders and corrections');
mustMatch(/const actual = getActualOrder\(name, record\?\.actualOrders \|\| \{\}\);/, 'usage analysis must prefer actual order from history');
mustMatch(/const convertedActual = orderUnitToStockFactor \? actual \* orderUnitToStockFactor : actual;/, 'usage analysis must convert actual SFA order quantity back to stock-check units');
mustMatch(/orderUnitToStockFactor direction: one order unit contains this many stock\/check units\./, 'orderUnitToStockFactor direction comment missing');
mustMatch(/function actualOrderForInterval\(prev, curr, name\)/, 'usage analysis must join SFA actual orders by stock interval');
mustMatch(/function orderQtyForInterval\(prev, curr, name\)/, 'usage analysis must convert interval SFA orders to stock units');
mustMatch(/구간실발주 \$\{fmt\(last\.actualQty, 0\)\} \/ 환산값 발주1=체크\/재고 \$\{fmt\(last\.orderUnitToStockFactor \|\| 1, 2\)\} \/ 재고환산 \$\{fmt\(last\.orderQty, 2\)\}/, 'analysis title must disclose interval actual order and fixed stock conversion direction');
mustMatch(/실발주\+재고 실사용/, 'analysis title must identify actual usage basis');
mustMatch(/최근 기준매출환산/, 'analysis title must disclose the recent history context');
mustMatch(/function getL\(item\) \{\s*return baseDailyUsage\(item\);\s*\}/, 'manual daily usage must remain the calculation/display value');
mustNotMatch(/actualUsage\?\.source === 'actual'[\s\S]*return actualUsage\.avg;/, 'actual usage analysis must not override manual daily usage');
mustMatch(/function baseDailyUsage\(item\)/, 'base daily usage helper must exist for non-recursive analysis snapshots');
mustMatch(/calcG\(item, days, \{ baseDaily: true \}\)/, 'analysis snapshot must avoid feeding inferred usage back into itself');
mustMatch(/data-output-name="\$\{escapeHtml\(name\)\}" data-output-field="\$\{field\}"/, 'output edit inputs must use output-only dataset fields');
mustMatch(/if \(handleOutputCellInput\(e\.target\)\) return;/, 'output edit input must bypass row-id input handler');
mustMatch(/if \(e\.target\.dataset\.outputField\) \{\s*handleOutputCellInput\(e\.target\);\s*render\(\);\s*return;\s*\}/, 'output change must remain local-only and rerender');
mustMatch(/let debugLogs = \[\];/, 'debug logs state missing');
mustMatch(/const DEBUG_LOG_STORAGE_KEY = 'bbq_debug_logs';/, 'debug logs local storage key missing');
mustMatch(/let outputOrder = \[\];/, 'output order state missing');
mustMatch(/const OUTPUT_ORDER_STORAGE_KEY = 'bbq_output_order';/, 'output order storage key missing');
mustMatch(/const ORDER_DAYS_RULE_VERSION = '20260607-thu-fri-4';/, 'order day recommendation rule version missing');
mustMatch(/function getOutputItems\(days\)/, 'output item sort helper missing');
mustMatch(/function moveOutputItem\(name, direction\)/, 'output move helper missing');
mustMatch(/return MASTER\.filter\(item => calcG\(item, days\) > 0\)\.sort\(defaultOutputCompare\);/, 'output view must use the initial default order');
mustMatch(/localStorage\.removeItem\(OUTPUT_ORDER_STORAGE_KEY\)/, 'stored custom output order must be cleared locally');
mustMatch(/outputOrder, actualOrders, orderSiteMappings, orderAliasMappings, orderAliasMappingDrafts, effectiveOrderAliasMappings, orderUnitCorrections, dailySales/, 'Firebase payload must include output, actual order, and corrections');
mustMatch(/if \(Object\.prototype\.hasOwnProperty\.call\(data, 'outputOrder'\)\) outputOrder = \[\];/, 'Firebase sync must ignore saved custom output order');
mustNotMatch(/outputOrder = visibleNames\.concat\(remaining\);/, 'output move must not persist custom order');
mustNotMatch(/localStorage\.setItem\(OUTPUT_ORDER_STORAGE_KEY, JSON\.stringify\(outputOrder\)\)/, 'custom output order must not be stored locally');
mustMatch(/function pushDebugLog\(message, tone = 'debug', ts = Date\.now\(\)\)/, 'internal debug logger missing');
mustMatch(/debugLogs: debugLogs\.slice\(0, DEBUG_LOG_LIMIT\)/, 'debug logs must be included in Firebase payload');
mustMatch(/pushDebugLog\('키 ' \+ msg, 'warn'\)/, 'stock key logs must be analysis-only');
mustMatch(/name:"배달소스-\(신\)비비소스",unit:"봉\/봉",policy:"여유",buffer:1,daily:0/, 'BB sauce baseline missing');
mustMatch(/name:"레몬보이",unit:"봉\/봉",policy:"여유",buffer:1,daily:0/, 'Lemonboy must match BB sauce baseline');
mustMatch(/name:"고추,가위,소금,종이호일,레몬보이,검정봉투"/, 'existing combined Lemonboy misc item must remain');
mustMatch(/name:"BBQ양념치킨소스",unit:"팩\/팩",policy:"여유",buffer:1\.5,daily:2/, 'kitchen sauce name must match current SFA order name');
mustMatch(/name:"\(컵소스\)BBQ양념치킨소스\(배달용\)",unit:"봉\/봉",policy:"여유",buffer:0\.3,daily:0\.3/, 'delivery sauce name must match current SFA order name');
mustMatch(/const ITEM_NAME_ALIASES = \{[\s\S]*"BBQ시크릿양념소스\(주방용\)": "BBQ양념치킨소스"[\s\S]*"BBQ시크릿양념소스\(배달용\)": "\(컵소스\)BBQ양념치킨소스\(배달용\)"/, 'old BBQ secret sauce names must migrate to current SFA names');
mustMatch(/function migrateRuntimeItemNames\(\)/, 'runtime item name migration helper missing');
mustMatch(/entries = migrateEntriesByName\(entries\);/, 'entries must migrate old item names');
mustMatch(/overrides = migrateNamedObject\(overrides\);/, 'overrides must migrate old item names');
mustMatch(/actualOrders = migrateNamedObject\(actualOrders\);/, 'actual orders must migrate old item names');
mustMatch(/function calcRowFromRecord\(record, name\)/, 'history calc lookup must support old item names');
mustMatch(/const name = canonicalItemName\(entry\.name\);/, 'history stock map must support old item names');
mustNotMatch(/name:"BBQ시크릿양념소스/, 'old BBQ secret sauce names must not remain in MASTER');
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
mustMatch(/function setOrderDaysValue\(value\)/, 'orderDays setter must exist for cross-device sync');
mustMatch(/if \(Object\.prototype\.hasOwnProperty\.call\(data, 'orderDays'\)\) setOrderDaysValue\(data\.orderDays\);/, 'Firebase sync must apply orderDays to the selector');
mustMatch(/if \(Object\.prototype\.hasOwnProperty\.call\(data, 'entries'\)\) entries = migrateEntriesByName\(data\.entries\);/, 'Firebase sync must apply empty entries payloads by ownership check');
mustMatch(/if \(Object\.prototype\.hasOwnProperty\.call\(data, 'overrides'\)\) overrides = migrateNamedObject\(data\.overrides\);/, 'Firebase sync must apply cleared overrides payloads');
mustMatch(/if \(Object\.prototype\.hasOwnProperty\.call\(data, 'orderSiteMappings'\)\) orderSiteMappings = sanitizeOrderSiteMappings\(data\.orderSiteMappings\);/, 'Firebase sync must apply order-site mapping corrections');
mustMatch(/if \(Object\.prototype\.hasOwnProperty\.call\(data, 'orderAliasMappings'\)\) orderAliasMappings = sanitizeOrderAliasMappings\(data\.orderAliasMappings\);/, 'Firebase sync must apply order alias mapping corrections');
mustMatch(/if \(Object\.prototype\.hasOwnProperty\.call\(data, 'orderUnitCorrections'\)\) orderUnitCorrections = sanitizeOrderUnitCorrections\(data\.orderUnitCorrections\);/, 'Firebase sync must apply order-unit corrections');
mustMatch(/if \(Object\.prototype\.hasOwnProperty\.call\(data, 'dailySales'\)\) dailySales = Array\.isArray\(data\.dailySales\) \? data\.dailySales : \[\];/, 'Firebase sync must apply cleared daily sales payloads');
mustMatch(/function handleOrderDaysChange\(\)/, 'orderDays change handler must save and sync');
mustMatch(/flushAutoSave\('orderDays'\)/, 'orderDays changes must be saved to Firebase immediately');
mustMatch(/localStorage\.setItem\('bbq_orderDays', orderDaysEl\.value\)/, 'saveLocal must persist orderDays locally');
mustMatch(/localStorage\.setItem\(ORDER_DAYS_RULE_STORAGE_KEY, ORDER_DAYS_RULE_VERSION\)/, 'orderDays local persistence must mark the current recommendation rule');
mustMatch(/fetch\(`\$\{FB_URL\}\$\{FB_PATH\}\/history\/\$\{commit\.dateKey\}\.json`/, 'confirmed snapshot date must select the immutable history path');
mustNotMatch(/<th>순서<\/th>/, 'output order controls header must be removed');
mustNotMatch(/onclick="moveOutputItem/, 'output row must not include move buttons');
mustMatch(/data-field="k" value="\$\{displayDecimal\(getK\(item\)\)\}"/, 'k field must still render with one decimal');
mustMatch(/data-field="l" value="\$\{displayDecimal\(getL\(item\)\)\}"/, 'l field must still render with one decimal');
mustMatch(/function recommendedDays\(\) \{\s*const d = new Date\(\)\.getDay\(\);\s*if \(d === 4 \|\| d === 5\) return 4;\s*return 3;\s*\}/, 'recommended order days must be 4 only on Thu/Fri and 3 otherwise');
mustMatch(/setOrderDaysValue\(savedDaysRule === ORDER_DAYS_RULE_VERSION \? \(savedDays \|\| rec\) : rec\);/, 'old site-local recommendation values must be refreshed after rule changes');
mustMatch(/step="0\.1" tabindex="-1" data-id="\$\{ent\.id\}" data-field="k"/, 'k field must be skipped by keyboard next navigation');
mustMatch(/step="0\.1" tabindex="-1" data-id="\$\{ent\.id\}" data-field="l"/, 'l field must be skipped by keyboard next navigation');
mustMatch(/class="cell zone" type="text" tabindex="-1"/, 'zone field must be skipped by keyboard next navigation');
mustMatch(/<button class="add" tabindex="-1"/, 'row action buttons must be skipped by keyboard next navigation');
mustMatch(/return renderAndFocusStock\(nextId, source, currentId\);/, 'stock advance must render sorted rows and restore focus');
mustMatch(/advanceStockInput\(e\.target\.dataset\.id, 'keydown'\)/, 'keydown Enter must use shared helper');
mustMatch(/advanceStockInput\(currentId, 'change'\)/, 'change fallback must use shared helper');
mustMatch(/sortStockRowsAndKeepFlow\(currentId, 'change'\)/, 'change with already-correct focus must still sort rows');
mustMatch(/flushAutoSave\('enter'\)/, 'Enter must explicitly confirm the current local draft');
mustNotMatch(/flushAutoSave\('auto'\)/, 'input/change handlers must not auto-commit remotely');
mustMatch(/if \(e\.isComposing \|\| e\.keyCode === 229\) return;/, 'IME composing Enter must not confirm a remote save');
mustNotMatch(/pushSaveLog\('키 /, 'stock key logs must not be visible user logs');
mustNotMatch(/pushSaveLog\(`보정 /, 'focus correction logs must not be visible user logs');
mustNotMatch(/pushSaveLog\('정렬이동 /, 'sort/focus logs must not be visible user logs');

function makeElement(id) {
  return {
    id,
    value: '',
    textContent: '',
    className: '',
    innerHTML: '',
    dataset: {},
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    focus() {},
    select() {},
    appendChild() {},
    getBoundingClientRect() { return { height: 52 }; },
    matches() { return false; },
  };
}

const elementMap = new Map();
const storage = new Map();
const session = new Map();
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval() {},
  Date,
  Math,
  Number,
  String,
  Array,
  Object,
  JSON,
  RegExp,
  Map,
  Set,
  URLSearchParams,
  TextEncoder,
  Uint8Array,
  AbortController,
  location: { search: '', hostname: 'localhost' },
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
  },
  sessionStorage: {
    getItem(key) { return session.has(key) ? session.get(key) : null; },
    setItem(key, value) { session.set(key, String(value)); },
    removeItem(key) { session.delete(key); },
  },
  crypto: {
    randomUUID() { return 'test-device'; },
    subtle: { digest: async () => new Uint8Array(32).buffer },
  },
  navigator: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64', language: 'ko-KR', maxTouchPoints: 0, geolocation: { getCurrentPosition() {} } },
  window: { addEventListener() {} },
  document: {
    body: makeElement('body'),
    documentElement: makeElement('html'),
    activeElement: null,
    getElementById(id) {
      if (!elementMap.has(id)) elementMap.set(id, makeElement(id));
      return elementMap.get(id);
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement(tag) { return makeElement(tag); },
    addEventListener() {},
  },
  fetch: async () => ({ ok: true, json: async () => null }),
};
sandbox.window.document = sandbox.document;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.sessionStorage = sandbox.sessionStorage;
vm.createContext(sandbox);
vm.runInContext(`${scripts}
this.__OrderHelperApi = {
  MASTER,
  normalizeSiteItemName,
  scoreSiteToMaster,
  buildOrderSiteMatches,
  collectActualOrderCandidates,
  buildOrderAliasMatches,
  orderAliasMappingDraftsForPayload,
  effectiveOrderAliasMappingsForPayload,
  buildSfaAnalysisPayloadState,
  parseManualSfaItemsText,
  siteItemAmount,
  recommendedOrderQty,
  conversionFactorForItem,
  setUnitCorrectionsForCheck(value) { orderUnitCorrections = sanitizeOrderUnitCorrections(value); },
  setSiteMappingsForCheck(value) { orderSiteMappings = sanitizeOrderSiteMappings(value); },
  getSiteMappingsForCheck() { return orderSiteMappings; },
  setLocalNewSourceAliasesForCheck(value) { localNewSourceAliasMappings = sanitizeOrderSiteMappings(value); },
  mergeLocalNewSourceAliases,
  confirmNewSourceAliasMapping,
  orderSiteItemKey,
  setAliasMappingsForCheck(value) { orderAliasMappings = sanitizeOrderAliasMappings(value); },
  setUsageHistoryForCheck(value) { usageHistory = value || {}; },
  setSfaActualHistoryForCheck(value) { sfaActualHistory = value || {}; },
  setEntriesForCheck(value) { entries = value; },
  getEntriesForCheck() { return entries; },
  totalStock,
  displayDecimal,
  markLocalDirtyRevision,
  clearLocalDirtyRevision,
  storedLocalDirtyRevision,
  shouldApplyFBData,
  isPendingFBDataCurrent,
  getLocalMutationRevisionForCheck() { return localMutationRevision; },
  applyFBData,
  saveLocalDraft,
  flushAutoSave,
  buildConfirmedSaveCommit,
  confirmCurrentSave,
  sendActiveConfirmedSave,
  putConfirmedSaveTargets,
  readConfirmedSaveQueue,
  writeConfirmedSaveQueue,
  emptyConfirmedSaveQueue,
  retryConfirmedRemotePending,
  saveMachineForCheck() {
    return { saveInFlight, pendingSave, activeSaveCommitId, confirmedSaveQueueBlocked, localDirty, localMutationRevision };
  },
  resetConfirmedSaveMachineForCheck() {
    if (saveRetryTimer) clearTimeout(saveRetryTimer);
    saveRetryTimer = null;
    saveAttempt = 0;
    saveAttemptCommitId = '';
    saveInFlight = false;
    pendingSave = false;
    pendingSaveReason = 'enter';
    activeSaveCommitId = '';
    confirmedSaveQueueBlocked = false;
    localStorage.removeItem(CONFIRMED_SAVE_QUEUE_STORAGE_KEY);
  },
};`, sandbox);

const api = sandbox.__OrderHelperApi;
const plain = value => JSON.parse(JSON.stringify(value));
assert.strictEqual(api.normalizeSiteItemName('BBQ치즈볼(크림)'), 'BBQ치즈볼', 'site item normalizer should remove parenthesized spec');
assert(api.scoreSiteToMaster('BBQ치즈볼', '냉동-치즈볼-BBQ치즈볼(크림)') >= 0.84, 'site/master score should find obvious candidate');
const siteData = {
  ok: true,
  items: [{ name: 'BBQ치즈볼', qty: 2, unit: 'BOX', row_index: 1 }],
  comparison: { matched: [], missing: [], extra: [] },
};
let matches = api.buildOrderSiteMatches(siteData);
assert.strictEqual(matches[0].targetName, '', 'mapping-absent raw source must not auto-confirm even an exact local candidate');
assert.strictEqual(matches[0].isNewSource, true, 'order-present mapping-absent raw source must be marked new');
assert(matches[0].newSourceCandidates.some(candidate => candidate.name === '냉동-치즈볼-BBQ치즈볼(크림)'), 'exact/normalized canonical suggestion must remain visible for user confirmation');
api.setSiteMappingsForCheck({ [matches[0].siteKey]: { targetName: '냉동-치즈볼-BBQ황금알치즈볼', siteName: 'BBQ치즈볼', siteUnit: 'BOX' } });
matches = api.buildOrderSiteMatches(siteData);
assert.strictEqual(matches[0].targetName, '냉동-치즈볼-BBQ황금알치즈볼', 'user mapping should override local candidate');
const existingMappingSnapshot = plain(api.getSiteMappingsForCheck());
const newRawData = {
  ok: true,
  items: [{ name: '필크런치소스', qty: 0, unit: 'BOX', row_index: 22 }],
  comparison: { matched: [], missing: [], extra: [] },
};
let newRawRow = api.buildOrderSiteMatches(newRawData)[0];
assert.strictEqual(newRawRow.siteName, '필크런치소스', 'order source raw name must be preserved exactly');
assert.strictEqual(newRawRow.siteQty, 0, 'zero order quantity must be preserved for a new raw source');
assert.strictEqual(newRawRow.isNewSource, true, 'order-present alias-absent raw source must appear as new');
assert.strictEqual(newRawRow.targetName, '', 'fuzzy suggestions must never auto-confirm the new raw source');
assert.strictEqual(api.confirmNewSourceAliasMapping(newRawRow.siteKey, '', newRawRow.siteName, newRawRow.siteUnit), false, 'empty canonical target must be rejected');
assert.strictEqual(api.confirmNewSourceAliasMapping(newRawRow.siteKey, '없는품목', newRawRow.siteName, newRawRow.siteUnit), false, 'unknown canonical target must be rejected');
assert.deepStrictEqual(plain(api.getSiteMappingsForCheck()), existingMappingSnapshot, 'invalid new alias attempts must leave every existing mapping unchanged');
const crunchCanonical = '배달소스-순살크래커소스';
assert.strictEqual(api.confirmNewSourceAliasMapping(newRawRow.siteKey, crunchCanonical, newRawRow.siteName, newRawRow.siteUnit), true, 'manual canonical selection must save the new raw alias');
const storedSiteMappings = JSON.parse(storage.get('bbq_order_site_mappings'));
const storedLocalNewAliases = JSON.parse(storage.get('bbq_local_new_source_aliases_v1'));
assert.strictEqual(storedSiteMappings[newRawRow.siteKey].targetName, crunchCanonical, 'manual new alias must persist locally');
assert.strictEqual(storedSiteMappings[matches[0].siteKey].targetName, existingMappingSnapshot[matches[0].siteKey].targetName, 'saving a new alias must preserve existing mappings');
api.setSiteMappingsForCheck(existingMappingSnapshot);
api.setLocalNewSourceAliasesForCheck(storedLocalNewAliases);
api.setSiteMappingsForCheck(api.mergeLocalNewSourceAliases(api.getSiteMappingsForCheck()));
newRawRow = api.buildOrderSiteMatches(newRawData)[0];
assert.strictEqual(newRawRow.targetName, crunchCanonical, 'same raw name/unit must auto-match the user-confirmed canonical item after reload');
assert.strictEqual(newRawRow.source, 'user', 'reloaded raw alias must remain explicitly user-confirmed');
assert.strictEqual(newRawRow.isNewSource, false, 'saved raw alias must no longer appear as new');
const freshMeat = api.MASTER.find(item => item.name === '신선육(10호)-뼈한마리');
api.setUnitCorrectionsForCheck({ [freshMeat.name]: { factor: 10, orderMultiple: 2, minOrderQty: 2 } });
assert.strictEqual(api.conversionFactorForItem(freshMeat), 10, 'manual factor should override inferred conversion');
assert.strictEqual(api.recommendedOrderQty(freshMeat, 11), 2, 'manual multiple/minimum should adjust converted order qty');
assert.deepStrictEqual(plain(api.parseManualSfaItemsText('A,2,BOX\\nB\\t3\\tEA').map(row => [row.name, row.qty, row.unit])), [['A', 2, 'BOX'], ['B', 3, 'EA']], 'manual analysis input parser should support comma and tab rows');
assert.deepStrictEqual(plain(api.parseManualSfaItemsText(JSON.stringify({ mappings: [{ siteName: 'C', siteQty: 4, siteUnit: 'BOX' }] })).map(row => [row.name, row.qty, row.unit])), [['C', 4, 'BOX']], 'manual analysis input parser should accept exported mapping JSON');
const compareOnlyData = {
  ok: true,
  items: [{ name: 'BBQ치즈볼', unit: 'BOX', row_index: 9 }],
  comparison: { matched: [{ row_index: 9, sfa_name: 'BBQ치즈볼', sfa_qty: 5, sfa_unit: 'BOX', sfa_amount: '12,000', expected_name: '냉동-치즈볼-BBQ치즈볼(크림)', expected_stock_need: 10, score: 0.96 }], missing: [], extra: [] },
};
matches = api.buildOrderSiteMatches(compareOnlyData);
assert.strictEqual(matches[0].siteQty, 5, 'matching builder should preserve comparison quantity when source row lacks it');
assert.strictEqual(matches[0].amount, 12000, 'matching builder should preserve comparison amount when source row lacks it');
let aliasRows = api.buildOrderAliasMatches(compareOnlyData);
let cheeseAlias = aliasRows.find(row => row.aliasName === '냉동-치즈볼-BBQ치즈볼(크림)');
assert(cheeseAlias, 'alias matching builder should include MASTER aliases');
assert.strictEqual(cheeseAlias.status, 'default', 'high-confidence alias suggestion must become the default selection until user saves it');
assert.strictEqual(cheeseAlias.actualName, 'BBQ치즈볼', 'alias matching builder should preselect the default actual SFA item name');
assert.strictEqual(cheeseAlias.defaultActualName, 'BBQ치즈볼', 'alias matching builder should expose the default actual SFA item name');
assert.strictEqual(cheeseAlias.effectiveActualName, 'BBQ치즈볼', 'alias matching builder should use the default actual name as effective value');
assert.strictEqual(cheeseAlias.suggested.actualName, 'BBQ치즈볼', 'alias matching builder should keep the highest SFA item as suggested/default candidate');
assert.strictEqual(cheeseAlias.conversionFactor, 2, 'alias matching builder should prefill conversion default from expected stock need / SFA qty');
assert.strictEqual(cheeseAlias.conversionStatus, 'default', 'conversion default must stay default until user confirms or edits it');
assert.strictEqual(cheeseAlias.effectiveConversionFactor, 2, 'alias matching builder should use the default conversion as effective value');
assert(cheeseAlias.conversionCandidates.some(row => row.factor === 2 && row.source === 'compare'), 'conversion candidates should include compare-derived factor');
let aliasDraft = api.orderAliasMappingDraftsForPayload(compareOnlyData).find(row => row.aliasName === '냉동-치즈볼-BBQ치즈볼(크림)');
assert.strictEqual(aliasDraft.status, 'default', 'alias draft should preserve default status');
assert.strictEqual(aliasDraft.defaultActualName, 'BBQ치즈볼', 'alias draft should include default actual name');
assert.strictEqual(aliasDraft.effectiveActualName, 'BBQ치즈볼', 'alias draft should include effective actual name');
assert.strictEqual(aliasDraft.defaultConversionFactor, 2, 'alias draft should include default conversion factor');
assert.strictEqual(aliasDraft.effectiveConversionFactor, 2, 'alias draft should include effective conversion factor');
let effectiveAliases = api.effectiveOrderAliasMappingsForPayload(compareOnlyData);
assert.strictEqual(effectiveAliases[cheeseAlias.aliasName].actualName, 'BBQ치즈볼', 'effective alias payload should use default actual name when no confirmed mapping exists');
assert.strictEqual(effectiveAliases[cheeseAlias.aliasName].conversionFactor, 2, 'effective alias payload should use default conversion when no manual conversion exists');
api.setAliasMappingsForCheck({ [cheeseAlias.aliasName]: { actualName: 'BBQ치즈볼', actualUnit: 'BOX' } });
aliasRows = api.buildOrderAliasMatches(compareOnlyData);
cheeseAlias = aliasRows.find(row => row.aliasName === '냉동-치즈볼-BBQ치즈볼(크림)');
assert.strictEqual(cheeseAlias.status, 'confirmed', 'saved alias mapping should mark the alias as confirmed');
assert.strictEqual(cheeseAlias.actualName, 'BBQ치즈볼', 'saved alias mapping should preserve the selected actual order item');
api.setAliasMappingsForCheck({ [cheeseAlias.aliasName]: { actualName: 'BBQ치즈볼', actualUnit: 'BOX', status: 'confirmed', conversionFactor: 2.5, conversionStatus: 'manual', conversionReason: '직접 입력' } });
aliasRows = api.buildOrderAliasMatches(compareOnlyData);
cheeseAlias = aliasRows.find(row => row.aliasName === '냉동-치즈볼-BBQ치즈볼(크림)');
assert.strictEqual(cheeseAlias.conversionFactor, 2.5, 'saved alias mapping should preserve manual conversion factor');
assert.strictEqual(cheeseAlias.conversionStatus, 'manual', 'saved alias mapping should preserve manual conversion status');
aliasDraft = api.orderAliasMappingDraftsForPayload(compareOnlyData).find(row => row.aliasName === '냉동-치즈볼-BBQ치즈볼(크림)');
assert.strictEqual(aliasDraft.conversionFactor, 2.5, 'alias draft payload should include conversion factor');
api.setAliasMappingsForCheck({});
api.setSfaActualHistoryForCheck({
  '20260701': {
    rows: [{ expected_name: '냉동-치즈볼-BBQ황금알치즈볼', sfa_name: 'BBQ황금알치즈볼', sfa_qty: 1, sfa_unit: 'BOX', score: 0.97 }]
  }
});
const historyCandidates = api.collectActualOrderCandidates(null);
assert(historyCandidates.some(row => row.actualName === 'BBQ황금알치즈볼'), 'actual order candidates should include SFA actual history rows');
api.setUsageHistoryForCheck({
  '20260701': {
    savedAt: Date.UTC(2026, 6, 1),
    dateKey: '20260701',
    entries: [{ name: '냉동-치즈볼-BBQ치즈볼(크림)', stock: 4 }],
    calc: { '냉동-치즈볼-BBQ치즈볼(크림)': { stockNeed: 10, stock: 4 } }
  },
  '20260702': {
    savedAt: Date.UTC(2026, 6, 2),
    dateKey: '20260702',
    entries: [{ name: '냉동-치즈볼-BBQ치즈볼(크림)', stock: 5 }],
    calc: { '냉동-치즈볼-BBQ치즈볼(크림)': { stockNeed: 12, stock: 5 } }
  },
  '20260703': {
    savedAt: Date.UTC(2026, 6, 3),
    dateKey: '20260703',
    entries: [{ name: '냉동-치즈볼-BBQ치즈볼(크림)', stock: 6 }],
    calc: { '냉동-치즈볼-BBQ치즈볼(크림)': { stockNeed: 8, stock: 6 } }
  }
});
api.setSfaActualHistoryForCheck({
  '20260701': {
    rows: [{ expected_name: '냉동-치즈볼-BBQ치즈볼(크림)', sfa_name: 'BBQ치즈볼', sfa_qty: 5, sfa_unit: 'BOX', score: 0.97 }]
  },
  '20260702': {
    rows: [{ expected_name: '냉동-치즈볼-BBQ치즈볼(크림)', sfa_name: 'BBQ치즈볼', sfa_qty: 6, sfa_unit: 'BOX', score: 0.97 }]
  },
  '20260703': {
    rows: [{ expected_name: '냉동-치즈볼-BBQ치즈볼(크림)', sfa_name: 'BBQ치즈볼', sfa_qty: 4, sfa_unit: 'BOX', score: 0.97 }]
  }
});
aliasRows = api.buildOrderAliasMatches({ comparison: { matched: [], missing: [], extra: [] } });
cheeseAlias = aliasRows.find(row => row.aliasName === '냉동-치즈볼-BBQ치즈볼(크림)');
const usageConversion = cheeseAlias.conversionCandidates.find(row => row.source === 'usage');
assert(usageConversion, 'usage-based conversion candidate should be generated from dated stock and actual order history');
assert.strictEqual(usageConversion.factor, 2, 'usage-based conversion should use usageEstimate / actual SFA qty as stock-per-order factor');
assert(usageConversion.reason.includes('실사용량 비교 3건'), 'usage-based conversion reason should show sample count');
assert(usageConversion.reason.includes('환산값=발주 1') && usageConversion.reason.includes('체크/재고') && usageConversion.reason.includes('2'), 'usage-based conversion reason should disclose stock/check units per one order unit');
assert(usageConversion.reason.includes('예: 체크 10개=발주 1박스이면 10'), 'usage-based conversion reason should include the user example');
assert.strictEqual(cheeseAlias.conversionDefault.source, 'usage', 'stable usage-based conversion should become the default conversion candidate');
aliasDraft = api.orderAliasMappingDraftsForPayload({ comparison: { matched: [], missing: [], extra: [] } }).find(row => row.aliasName === '냉동-치즈볼-BBQ치즈볼(크림)');
assert.strictEqual(aliasDraft.defaultConversionCandidate.source, 'usage', 'alias draft payload should preserve usage conversion evidence source');
assert.strictEqual(aliasDraft.effectiveConversionFactor, 2, 'alias draft payload should use usage conversion as effective default');
assert.strictEqual(aliasDraft.effectiveOrderUnitToStockFactor, 2, 'alias draft payload should expose effective orderUnitToStockFactor');
assert.strictEqual(aliasDraft.conversionFactorMeaning, '발주 1단위가 체크/재고 몇 단위인지', 'alias draft payload should explain conversion factor direction');
api.setAliasMappingsForCheck({ [cheeseAlias.aliasName]: { actualName: 'BBQ치즈볼', actualUnit: 'BOX', status: 'confirmed', conversionFactor: 3, conversionStatus: 'manual', conversionReason: '수동 확정' } });
const sfaPayloadState = api.buildSfaAnalysisPayloadState(compareOnlyData);
const confirmedAlias = sfaPayloadState.effectiveOrderAliasMappings[cheeseAlias.aliasName];
assert.strictEqual(confirmedAlias.actualName, 'BBQ치즈볼', 'SFA payload state should preserve confirmed alias actual name during refresh');
assert.strictEqual(confirmedAlias.conversionFactor, 3, 'SFA payload state should not overwrite manual conversion with a rebuilt default');
assert.strictEqual(confirmedAlias.conversionStatus, 'manual', 'SFA payload state should preserve manual conversion status');

const goldenCheeseBall = '냉동-치즈볼-BBQ황금알치즈볼';
const localStockFixture = [{ id: 'e-stock-race', name: goldenCheeseBall, zone: '', stock: 7.5 }];
api.setEntriesForCheck(localStockFixture);
storage.set('bbq_entries', JSON.stringify(localStockFixture));
storage.set('bbq_savedAt', '900');
const pendingRevisionBeforeLocalSave = api.getLocalMutationRevisionForCheck();
api.markLocalDirtyRevision(1000);
assert.strictEqual(api.storedLocalDirtyRevision(), 1000, 'local stock save must persist a durable dirty revision');
assert.strictEqual(api.totalStock(goldenCheeseBall), 7.5, 'input/canonical stock must preserve the exact decimal value');
assert.strictEqual(String(api.getEntriesForCheck()[0].stock), '7.5', 'input stock DOM source value must remain exactly 7.5');
assert.strictEqual(String(api.displayDecimal(api.totalStock(goldenCheeseBall))), '7.5', 'output stock display must render the same exact 7.5 value');
assert.strictEqual(api.applyFBData({ savedAt: 950, entries: [{ id: 'remote-old', name: goldenCheeseBall, zone: '', stock: 2 }] }), false, 'stale pending remote data must be rejected while local stock is dirty');
assert.strictEqual(api.totalStock(goldenCheeseBall), 7.5, 'stale pending apply must not change output stock semantics');
api.setEntriesForCheck(JSON.parse(storage.get('bbq_entries')));
assert.strictEqual(api.storedLocalDirtyRevision(), 1000, 'reload must retain the durable dirty marker');
assert.strictEqual(api.totalStock(goldenCheeseBall), 7.5, 'reload must restore the exact local decimal stock while dirty');
assert.strictEqual(api.applyFBData({ savedAt: 999, entries: [{ id: 'remote-reload-old', name: goldenCheeseBall, zone: '', stock: 3 }] }), false, 'reload must continue rejecting stale remote stock until sync succeeds');
assert.strictEqual(api.totalStock(goldenCheeseBall), 7.5, 'output stock must remain exactly equal to the locally stored input after reload');
assert.strictEqual(api.isPendingFBDataCurrent(pendingRevisionBeforeLocalSave), false, 'a remote snapshot observed before the local stock save must remain stale even after focusout delay');
storage.set('bbq_savedAt', '1100');
api.clearLocalDirtyRevision();
assert.strictEqual(api.storedLocalDirtyRevision(), 0, 'confirmed save may clear the durable dirty marker');
assert.strictEqual(api.isPendingFBDataCurrent(pendingRevisionBeforeLocalSave), false, 'clearing dirty after sync must not make an older pending snapshot current again');
assert.strictEqual(api.applyFBData({ savedAt: 950, entries: [{ id: 'remote-after-sync-old', name: goldenCheeseBall, zone: '', stock: 4 }] }), false, 'a pending snapshot older than the confirmed local save must still be rejected after dirty clears');
assert.strictEqual(api.totalStock(goldenCheeseBall), 7.5, 'confirmed sync must retain exact input/output stock equality');

module.exports = { api, storage, sandbox, plain };
console.log('OrderHelper static checks OK');
