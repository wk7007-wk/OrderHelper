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

mustMatch(/const APP_VERSION = '20260715-01';/, 'APP_VERSION must be bumped for Enter-confirmed autosave recovery');
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
mustMatch(/let sfaAnalysisHistory = \{ records: \[\] \};/, 'SFA analysis cumulative history state missing');
mustMatch(/const SFA_ANALYSIS_HISTORY_STORAGE_KEY = 'bbq_sfa_analysis_history';/, 'SFA analysis cumulative history localStorage key missing');
mustMatch(/function appendSfaAnalysisHistory\(data, source = 'excel'\)/, 'SFA analysis results must be append-or-merge persisted');
mustMatch(/function sfaLedgerEventId\(runId, item = \{\}, fallbackIndex = 0\)/, 'lossless order ledger needs stable per-row event ids');
mustMatch(/function mergeSfaAnalysisHistories\(\.\.\.sources\)/, 'same-run retries and remote ledgers need idempotent item-level merge');
mustMatch(/function sfaActualHistoryLedgerForPayload\(source = sfaActualHistory\)/, 'legacy SFA actual-history rows must also feed the lossless ledger');
mustMatch(/version: 2,[\s\S]*eventCount:/, 'order ledger payload must publish its lossless event contract version');
mustMatch(/actualOrderQty: Number\.isFinite\(actualOrderQty\) \? actualOrderQty : 0/, 'ledger must preserve actual order quantity including zero');
mustMatch(/rawIdentity,[\s\S]*eventId = sfaLedgerEventId/, 'ledger events must preserve raw identity and a stable event id');
mustMatch(/function buildAiUsageEvidence\(windowDays = AI_USAGE_EVIDENCE_MAX_DAYS, now = Date\.now\(\)\)/, 'AI usage evidence builder missing');
mustMatch(/neverOverwrite: \['overrides\/\*\/l', 'orderUnitCorrections', 'actualOrders'\]/, 'AI usage contract must protect every manual value');
mustMatch(/browserModelCall: false,[\s\S]*browserApiKey: false/, 'browser must not call a model or carry an API key');
mustMatch(/responseField: 'aiUsageAdvisory'/, 'server worker advisory response pointer missing');
mustMatch(/function renderAiUsageAdvisorySpan\(name\)/, 'AI suggested usage must render as an advisory chip');
mustMatch(/localStorage\.setItem\(SFA_ANALYSIS_HISTORY_STORAGE_KEY, JSON\.stringify\(sfaAnalysisHistoryForPayload\(\)\)\)/, 'SFA analysis cumulative history must persist locally');
mustMatch(/appendSfaAnalysisHistory\(data, reason === 'manualInput' \? 'manual' : 'excel'\);/, 'fresh SFA/manual analysis results must update cumulative history before rendering');
mustMatch(/function buildUsageAnalysis\(history, currentSnapshot\)/, 'usage analysis builder missing');
mustMatch(/USAGE_ANALYSIS_MAX_DAYS \* 86400000/, 'usage analysis must limit old history records');
mustMatch(/const usage = order\.source === 'actual'[\s\S]*prevStock \+ \(Number\(order\.actualQty \|\| 0\) \* Number\(order\.orderUnitToStockFactor \|\| 1\)\) - currStock[\s\S]*: prevStock \+ orderQty - currStock;/, 'usage analysis must convert actual SFA orders back into stock units before inferring usage');
mustMatch(/data-analysis-key="\$\{escapeHtml\(itemKeyForName\(name\)\)\}" data-analysis-name="\$\{escapeHtml\(name\)\}"/, 'daily analysis marker must use the stable item key');
mustMatch(/loadUsageHistory\(true\);/, 'usage history must load on page start');
mustMatch(/setInterval\(\(\) => loadUsageHistory\(true\), 300000\);/, 'usage history must refresh periodically');
mustMatch(/function handleOutputCellInput\(target\)/, 'output edit handler missing');
mustMatch(/function setOutputStockTotal\(name, value\)/, 'output stock total setter missing');
mustMatch(/function itemKeyForName\(name\)/, 'inventory rows need a stable item key shared by input and output');
mustMatch(/function sanitizeEntries\(source = entries\)/, 'inventory entries need stable unique entry keys');
mustMatch(/function inventoryByItemKeyForPayload\(\)/, 'current/history payload needs the same keyed inventory read model as output');
mustMatch(/let stateRevision = 0;/, 'local/current saves need a monotonic state revision');
mustMatch(/let inventoryRevision = 0;/, 'inventory saves need a monotonic inventory revision');
mustMatch(/function shouldApplyIncomingCurrent\(data\)/, 'remote current application needs a latest-revision gate');
mustMatch(/function applyPendingFBDataIfSafe\(\)/, 'focus-deferred remote current must be revalidated before application');
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
mustMatch(/function bindCellInputs\(\)/, 'single-grid cell event binding missing');
mustMatch(/<th>필요량<\/th>\s*<th>추천발주 · 분석 · 금액<\/th>/, 'single grid must show need and recommended output columns beside editable inputs');
assert.strictEqual((html.match(/<table\b/g) || []).length, 1, 'input and output must share exactly one table');
mustNotMatch(/id="modeBtn"|function toggleMode\(|let viewMode\s*=/, 'separate input/output view mode must be removed');
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
mustMatch(/if \(lastSfaCompareData && document\.querySelector\('\.inline-alias-correction'\)\) renderPreservingGridFocus\(\);/, 'SFA history refresh must preserve focused single-grid input');
mustMatch(/const appliedText = lastSfaResultAppliedAt \? ` · 적용 \$\{sfaCompareTime\(lastSfaResultAppliedAt\)\}` : '';/, 'SFA compare meta must track UI application time');
mustMatch(/완료 \$\{sfaCompareTime\(data\.savedAt\)\}` : ''\}\$\{appliedText\}/, 'SFA compare meta must separate Excel completion and UI application times');
mustMatch(/setInterval\(\(\) => loadSfaOrderStatus\(false\), 10000\);/, 'SFA status must refresh every 10 seconds');
mustMatch(/mode: 'scan_pc_downloads'/, 'SFA request must target the PC download folder flow');
mustMatch(/const currentSaved = await flushCurrentBeforeSfaAnalysisRequest\(\);[\s\S]*const sfaAnalysisState = buildSfaAnalysisPayloadState\(lastSfaCompareData\);/, 'SFA request must save current state before building effective alias payload');
mustMatch(/orderDays: sfaAnalysisState\.orderDays,[\s\S]*entries: sfaAnalysisState\.entries,[\s\S]*overrides: sfaAnalysisState\.overrides,[\s\S]*orderAliasMappings: sfaAnalysisState\.orderAliasMappings,[\s\S]*orderAliasMappingDrafts: sfaAnalysisState\.orderAliasMappingDrafts,[\s\S]*effectiveOrderAliasMappings: sfaAnalysisState\.effectiveOrderAliasMappings,[\s\S]*orderManualItems: sfaAnalysisState\.orderManualItems,[\s\S]*sfaAnalysisHistory: sfaAnalysisState\.sfaAnalysisHistory,[\s\S]*sfaOrderLedger: sfaAnalysisState\.sfaOrderLedger,[\s\S]*aiUsageAnalysis:/, 'SFA request payload must carry latest state, lossless ledger, and AI advisory evidence contract');
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
mustMatch(/let orderManualItems = \[\];/, 'manual order item state missing');
mustMatch(/const ORDER_SITE_MAPPING_STORAGE_KEY = 'bbq_order_site_mappings';/, 'order-site mapping local storage key missing');
mustMatch(/const ORDER_ALIAS_MAPPING_STORAGE_KEY = 'bbq_order_alias_mappings';/, 'order alias mapping local storage key missing');
mustMatch(/const ORDER_UNIT_CORRECTION_STORAGE_KEY = 'bbq_order_unit_corrections';/, 'order-unit correction local storage key missing');
mustMatch(/const ORDER_MANUAL_ITEMS_STORAGE_KEY = 'bbq_order_manual_items';/, 'manual item local storage key missing');
mustMatch(/function orderItemList\(\)/, 'dynamic order item list helper missing');
mustMatch(/function ensureManualOrderItem\(name, unit = '', source = 'user', sourceSiteName = ''\)/, 'manual order item creator missing');
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
mustMatch(/function setOrderSiteMapping\(siteKey, targetName, siteName = '', siteUnit = ''\)/, 'order-site mapping setter missing');
mustMatch(/function addOrderSiteManualItem\(siteKey, itemName, siteName = '', siteUnit = ''\)/, 'manual SFA item add handler missing');
mustMatch(/function applyExplicitSiteMapping\(siteKey, targetName, siteName = '', siteUnit = '', mode = 'confirmed'\)/, 'explicit site selection must update both site and alias state');
mustMatch(/function setManualOrderAlias\(aliasName, actualName, actualUnit = ''\)/, 'alias review must allow an explicit new actual-name alias');
mustMatch(/class="sfa-new-item-custom"/, 'manual SFA custom item add button missing');
mustMatch(/class="sfa-new-item-source"/, 'manual SFA source-name item add button missing');
mustMatch(/class="sfa-edit sfa-alias-new-input"/, 'alias review needs a new alias input');
mustMatch(/class="sfa-alias-new-button"/, 'alias review needs an explicit new alias action');
mustMatch(/localStorage\.setItem\(ORDER_MANUAL_ITEMS_STORAGE_KEY, JSON\.stringify\(orderManualItemsForPayload\(\)\)\)/, 'manual items must persist locally');
mustMatch(/manualItems: orderManualItemsForPayload\(\)/, 'analysis IO export must include manual items');
mustMatch(/analysisHistory: sfaAnalysisHistoryForPayload\(\)/, 'analysis IO export must include cumulative analysis history');
mustMatch(/sfaAnalysisHistoryRecords\(\)\.forEach\(record =>/, 'actual order candidates must read cumulative SFA analysis history');
mustMatch(/latestSfaAnalysisRecordsByDate\(\)\.forEach\(record =>/, 'usage calculations must read latest cumulative SFA analysis record per date');
mustMatch(/function setOrderAliasMapping\(aliasName, actualName\)/, 'order alias mapping setter missing');
mustMatch(/function setOrderAliasConversion\(aliasName, value, mode = 'candidate'\)/, 'order alias conversion setter missing');
mustMatch(/function inlineAliasCorrectionHtml\(row\)/, 'input row inline alias correction renderer missing');
mustMatch(/class="inline-alias-correction \$\{statusClass\}"/, 'input row alias correction must render a compact details block');
mustMatch(/class="sfa-select inline-alias-select"/, 'input row actual-name alias selector missing');
mustMatch(/class="sfa-select inline-alias-factor-select"/, 'input row conversion candidate selector missing');
mustMatch(/class="sfa-edit inline-alias-factor-input"/, 'input row manual conversion input missing');
mustMatch(/function bindInlineAliasControls\(\)/, 'input row inline alias binding missing');
mustMatch(/class="sfa-edit inline-alias-new-input"/, 'same row must allow a typed new actual-order alias');
mustMatch(/class="inline-alias-new-button"/, 'same row must save a typed new alias explicitly');
mustMatch(/function inlineSiteMatchesHtml\(itemName, rows\)/, 'same row must expose SFA site matching controls');
mustMatch(/function inlineUnmatchedSiteRowHtml\(row\)/, 'unmatched SFA rows must remain inside the single grid');
mustMatch(/function bindInlineSiteControls\(\)/, 'inline site/new-item controls must be bound without opening another tab');
mustMatch(/setOrderAliasMapping\(e\.target\.dataset\.aliasName, e\.target\.value\);/, 'inline alias selector must reuse confirmed alias mapping setter');
mustMatch(/setOrderAliasConversion\(e\.target\.dataset\.aliasName, e\.target\.value, 'candidate'\);/, 'inline conversion candidate selector must save through confirmed conversion setter');
mustMatch(/setOrderAliasConversion\(e\.target\.dataset\.aliasName, e\.target\.value, 'manual'\);/, 'inline manual conversion input must save through manual conversion setter');
mustMatch(/const inlineAliasRowsByName = new Map\(buildOrderAliasMatches\(lastSfaCompareData\)\.map\(row => \[row\.aliasName, row\]\)\);/, 'input view must share alias match rows with alias review state');
mustMatch(/data-item-name="\$\{escapeHtml\(item\.name\)\}"/, 'input row name cell must keep item identity while showing inline correction controls');
mustMatch(/bindInlineAliasControls\(\);\s*bindInlineSiteControls\(\);\s*updateStickyOffsets\(\);/, 'single grid must bind inline alias and site controls after rendering rows');
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
mustMatch(/class="output-order-value" data-output-key="\$\{escapeHtml\(itemKeyForName\(name\)\)\}" data-output-name="\$\{escapeHtml\(name\)\}" data-output-field="order"/, 'output order display marker missing');
mustNotMatch(/outputNumberInput\(item\.name, 'order'/, 'output order must not render as an editable input');
mustMatch(/const orderText = isNeed \? displayOrderQty\(item, days\) : '';/, 'single grid must show the recommended order-unit quantity');
mustMatch(/<span class="need-output-value">\$\{isNeed \? displayDecimal\(g\) : ''\}<\/span>/, 'same row must show the raw stock-unit need');
mustMatch(/\$\{outputOrderDisplay\(item\.name, orderText\)\}\$\{renderOrderAnalysisSpan\(item, g\)\}\$\{renderOrderAmountSpan\(item, g\)\}/, 'same row must show recommended order, analysis, and amount');
mustMatch(/document\.querySelectorAll\(`tr\[data-item-key="\$\{itemKey\}"\]`\)/, 'live calculation refresh must patch only rows with the same stable item key');
mustMatch(/function scheduleDeferredInputWork\(options = \{\}\)/, 'input edits must use deferred calculation scheduler');
mustMatch(/let deferredInputRevision = 0;/, 'deferred input work must track a latest revision token');
mustMatch(/localStorage\.setItem\('bbq_entries', JSON\.stringify\(entries\)\);[\s\S]*localStorage\.setItem\(PENDING_SYNC_REVISION_STORAGE_KEY, String\(stateRevision\)\);/, 'input events must persist a durable local draft before deferred work');
mustNotMatch(/markDeferredInputDirty\([\s\S]*?scheduleAutoSave\(reason\)/, 'draft input must not schedule a remote save');
mustMatch(/const work = deferredInputWork;\s*deferredInputWork = emptyDeferredInputWork\(\);\s*if \(revision !== deferredInputRevision\) return;/, 'deferred input work must not apply stale calculations over newer input');
mustMatch(/const SAVE_REQUEST_TIMEOUT_MS = 20000;/, 'Firebase autosave must have a bounded request timeout');
mustMatch(/const CONFIRMED_SAVE_QUEUE_STORAGE_KEY = 'bbq_confirmed_save_queue_v1';/, 'Enter-confirmed queue storage key missing');
mustMatch(/async function putConfirmedSaveTargets\(commit, timeoutMs = SAVE_REQUEST_TIMEOUT_MS\)/, 'current/history writes need a shared abortable timeout');
mustMatch(/body: commit\.body, signal: controller\.signal/, 'both confirmed targets must replay the immutable body');
mustMatch(/controller\.abort\(\);/, 'a failed save target must abort its sibling before releasing single-flight');
mustMatch(/function retryConfirmedRemotePending\(reason = 'recovery'\)/, 'durable confirmed save retry helper missing');
mustMatch(/window\.addEventListener\('online', \(\) => retryConfirmedRemotePending\('online'\)\);/, 'online recovery must retry only a confirmed save');
mustMatch(/setOutputStockTotalByItemKey\(itemKey, value\);\s*scheduleDeferredInputWork\(\{ names: \[name\], recomputeUsage: true \}\);/, 'output stock edits must use the same stable item key and defer usage/order refresh');
mustMatch(/setOverrideValue\(name, field, value\);\s*scheduleDeferredInputWork\(\{ names: \[name\] \}\);/, 'output buffer/daily edits must defer order refresh');
mustMatch(/ent\.stock = stock == null \|\| !Number\.isFinite\(stock\) \? null : stock;\s*markInventoryMutation\(\);\s*updateDerivedOrderForName\(ent\.name\);\s*scheduleDeferredInputWork\(\{ names: \[ent\.name\], recomputeUsage: true \}\);/, 'stock input must patch its output immediately before deferred heavy work');
mustMatch(/function flushAutoSave\(reason\) \{\s*flushDeferredInputWork\(\);\s*if \(!reason \|\| reason === 'auto'\) return false;\s*return saveToFB\(reason\);/, 'flushAutoSave must reject draft/auto calls and persist scheduled input before explicit commit');
mustMatch(/async function flushCurrentBeforeSfaAnalysisRequest\(\) \{\s*flushDeferredInputWork\(\);/, 'SFA request save gate must flush pending input work first');
mustMatch(/if \(!confirmCurrentSave\('sfaAnalysis'\)\) return false;\s*return waitForSaveIdle\(\);/, 'SFA request must wait for an Enter-equivalent confirmed save');
mustNotMatch(/handleOutputCellInput\(e\.target\);\s*flushAutoSave\('auto'\);/, 'output stock/k/l change must remain a local draft');
mustMatch(/actualOrders = cleanActualOrders\(\);/, 'actual orders must be sanitized before save');
mustMatch(/orderManualItems: orderManualItemsForPayload\(\), sfaAnalysisHistory: ledger, sfaOrderLedger: ledger, sfaActualHistory: \{ sourcePath: SFA_ACTUAL_HISTORY_PATH, ledger \}, aiUsageEvidence: buildAiUsageEvidence\(\), aiUsageAdvisory: sanitizeAiUsageAdvisory\(\), dailySales/, 'Firebase current/history payload must include the lossless ledger and advisory evidence');
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
mustNotMatch(/if \(e\.target\.dataset\.outputField\) \{[\s\S]{0,160}render\(\);/, 'cell change must not full-render the grid');
mustMatch(/let debugLogs = \[\];/, 'debug logs state missing');
mustMatch(/const DEBUG_LOG_STORAGE_KEY = 'bbq_debug_logs';/, 'debug logs local storage key missing');
mustMatch(/let outputOrder = \[\];/, 'output order state missing');
mustMatch(/const OUTPUT_ORDER_STORAGE_KEY = 'bbq_output_order';/, 'output order storage key missing');
mustMatch(/const ORDER_DAYS_RULE_VERSION = '20260607-thu-fri-4';/, 'order day recommendation rule version missing');
mustMatch(/function getOutputItems\(days\)/, 'output item sort helper missing');
mustMatch(/function moveOutputItem\(name, direction\)/, 'output move helper missing');
mustMatch(/return orderItemList\(\)\.filter\(item => calcG\(item, days\) > 0\)\.sort\(defaultOutputCompare\);/, 'output view must use default order plus user-created items');
mustMatch(/localStorage\.removeItem\(OUTPUT_ORDER_STORAGE_KEY\)/, 'stored custom output order must be cleared locally');
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
mustMatch(/if \(Object\.prototype\.hasOwnProperty\.call\(data, 'orderManualItems'\)\) orderManualItems = sanitizeOrderManualItems\(data\.orderManualItems\);/, 'Firebase sync must apply manual order items');
mustMatch(/if \(Object\.prototype\.hasOwnProperty\.call\(data, 'dailySales'\)\) dailySales = Array\.isArray\(data\.dailySales\) \? data\.dailySales : \[\];/, 'Firebase sync must apply cleared daily sales payloads');
mustMatch(/function handleOrderDaysChange\(\)/, 'orderDays change handler must save and sync');
mustMatch(/flushAutoSave\('orderDays'\)/, 'orderDays changes must be saved to Firebase immediately');
mustMatch(/function setGridSortMode\(mode\) \{[\s\S]*flushDeferredInputWork\(\);[\s\S]*gridSortMode = nextMode;[\s\S]*render\(\{ focusSnapshot \}\);/, 'sort context switch must flush deferred state and restore the keyed focus snapshot');
mustNotMatch(/flushAutoSave\('sortSwitch'\)/, 'sort-only UI changes must not confirm an unentered draft');
mustMatch(/const flowEpoch = stockFlowEpoch;[\s\S]*if \(flowEpoch !== stockFlowEpoch\) return;/, 'sort switch must fence a stale blur-driven stock advance');
mustMatch(/function compareGridRows\(left, right, mode = gridSortMode\)/, 'single grid needs explicit input-zone and SFA sort contexts');
mustMatch(/return mode === 'sfa' \? compareSfaRows\(left, right\) : compareInputRows\(left, right\);/, 'sort context must only change row order');
mustMatch(/localStorage\.setItem\('bbq_orderDays', orderDaysEl\.value\)/, 'saveLocal must persist orderDays locally');
mustMatch(/localStorage\.setItem\(ORDER_DAYS_RULE_STORAGE_KEY, ORDER_DAYS_RULE_VERSION\)/, 'orderDays local persistence must mark the current recommendation rule');
mustMatch(/fetch\(`\$\{FB_URL\}\$\{FB_PATH\}\/history\/\$\{commit\.dateKey\}\.json`/, 'daily history path must use the confirmed commit date');
mustNotMatch(/<th>순서<\/th>/, 'output order controls header must be removed');
mustNotMatch(/onclick="moveOutputItem/, 'output row must not include move buttons');
mustMatch(/data-field="k" value="\$\{displayDecimal\(getK\(item\)\)\}"/, 'k field must still render with one decimal');
mustMatch(/data-field="l" value="\$\{displayDecimal\(getL\(item\)\)\}"/, 'l field must still render with one decimal');
mustMatch(/function recommendedDays\(\) \{\s*const d = new Date\(\)\.getDay\(\);\s*if \(d === 4 \|\| d === 5\) return 4;\s*return 3;\s*\}/, 'recommended order days must be 4 only on Thu/Fri and 3 otherwise');
mustMatch(/setOrderDaysValue\(savedDaysRule === ORDER_DAYS_RULE_VERSION \? \(savedDays \|\| rec\) : rec\);/, 'old site-local recommendation values must be refreshed after rule changes');
mustMatch(/step="0\.1" tabindex="-1" data-id="\$\{ent\.id\}" data-entry-key="\$\{escapeHtml\(ent\.entryKey \|\| ent\.id\)\}" data-item-key="\$\{escapeHtml\(itemKeyForName\(item\.name\)\)\}" data-field="k"/, 'k field must keep stable row identity and be skipped by next navigation');
mustMatch(/step="0\.1" tabindex="-1" data-id="\$\{ent\.id\}" data-entry-key="\$\{escapeHtml\(ent\.entryKey \|\| ent\.id\)\}" data-item-key="\$\{escapeHtml\(itemKeyForName\(item\.name\)\)\}" data-field="l"/, 'l field must keep stable row identity and be skipped by next navigation');
mustMatch(/class="cell zone" type="text" tabindex="-1"/, 'zone field must be skipped by keyboard next navigation');
mustMatch(/<button class="add" tabindex="-1"/, 'row action buttons must be skipped by keyboard next navigation');
mustMatch(/return renderAndFocusStock\(nextId, source, currentId\);/, 'stock advance must move within the current DOM order');
mustNotMatch(/function renderAndFocusStock\([^)]*\) \{\s*render\(\);/, 'stock Enter must not full-render or resort the table');
mustMatch(/advanceStockInput\(e\.target\.dataset\.id, 'keydown'\)/, 'keydown Enter must use shared helper');
mustMatch(/advanceStockInput\(currentId, 'change'\)/, 'change fallback must use shared helper');
mustMatch(/sortStockRowsAndKeepFlow\(currentId, 'change'\)/, 'change with already-correct focus must preserve current DOM flow');
mustNotMatch(/flushAutoSave\('auto'\)/, 'input/change paths must never confirm an unentered draft');
mustMatch(/if \(e\.isComposing \|\| e\.keyCode === 229\) return;[\s\S]*if \(e\.key !== 'Enter'\) return;/, 'IME composition must not accidentally confirm a save');
mustMatch(/if \(!\['stock', 'zone', 'k', 'l'\]\.includes\(e\.target\.dataset\.field\)\) return;/, 'all editable inventory fields must support Enter confirmation');
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
  orderItemList,
  itemKeyForName,
  orderSiteItemKey,
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
  orderManualItemsForPayload,
  sfaAnalysisHistoryForPayload,
  sfaActualHistoryLedgerForPayload,
  sfaOrderLedgerForPayload,
  appendSfaAnalysisHistory,
  mergeSfaAnalysisHistories,
  buildAiUsageEvidence,
  sanitizeAiUsageAdvisory,
  compareGridRows,
  gridFocusSnapshot,
  restoreGridFocus,
  setEntriesForCheck(value) { entries = sanitizeEntries(value); },
  entriesForCheck() { return entries; },
  totalStockForCheck(name) { return totalStock(name); },
  displayStockTotalForCheck(name) { return displayStockTotal(name); },
  inventoryByItemKeyForPayload,
  setRevisionsForCheck(stateValue, inventoryValue) {
    stateRevision = Number(stateValue || 0);
    inventoryRevision = Number(inventoryValue || 0);
  },
  revisionsForCheck() { return { stateRevision, inventoryRevision }; },
  setLocalDirtyForCheck(value) { localDirty = Boolean(value); },
  saveLocalForCheck(reason = 'draft') { saveLocal(reason); },
  markInventoryMutationForCheck() { return markInventoryMutation(); },
  saveStatusForCheck() { return { localDirty, saveInFlight, pendingSave, stateRevision, inventoryRevision, confirmedSaveQueueBlocked }; },
  resetConfirmedSaveMachineForCheck() {
    if (saveRetryTimer) clearTimeout(saveRetryTimer);
    saveRetryTimer = null;
    saveInFlight = false;
    pendingSave = false;
    pendingSaveReason = 'enter';
    activeSaveCommitId = '';
    saveAttempt = 0;
    saveAttemptCommitId = '';
    confirmedSaveSequence = 0;
    confirmedSaveQueueBlocked = false;
    localDirty = false;
    stateRevision = 0;
    inventoryRevision = 0;
    localStorage.removeItem(CONFIRMED_SAVE_QUEUE_STORAGE_KEY);
    localStorage.removeItem(PENDING_SYNC_REVISION_STORAGE_KEY);
    localStorage.removeItem('bbq_savedAt');
    if (deferredInputWorkHandle) cancelFrameTask(deferredInputWorkHandle);
    deferredInputWorkHandle = null;
    deferredInputWork = emptyDeferredInputWork();
  },
  confirmCurrentSave,
  sendActiveConfirmedSave,
  retryConfirmedRemotePending,
  putConfirmedSaveTargets,
  readConfirmedSaveQueue,
  writeConfirmedSaveQueue,
  emptyConfirmedSaveQueue,
  buildConfirmedSaveCommit,
  confirmedQueueKeyForCheck: CONFIRMED_SAVE_QUEUE_STORAGE_KEY,
  hasPendingLocalSync,
  cancelAutosaveForCheck() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    if (deferredInputWorkHandle) cancelFrameTask(deferredInputWorkHandle);
    deferredInputWorkHandle = null;
  },
  shouldApplyIncomingCurrent,
  setUnitCorrectionsForCheck(value) { orderUnitCorrections = sanitizeOrderUnitCorrections(value); },
  setSiteMappingsForCheck(value) { orderSiteMappings = sanitizeOrderSiteMappings(value); },
  setAliasMappingsForCheck(value) { orderAliasMappings = sanitizeOrderAliasMappings(value); },
  setManualItemsForCheck(value) { orderManualItems = sanitizeOrderManualItems(value); },
  setSfaAnalysisHistoryForCheck(value) { sfaAnalysisHistory = sanitizeSfaAnalysisHistory(value); },
  mergeSfaAnalysisHistoryForCheck(value) { sfaAnalysisHistory = mergeSfaAnalysisHistories(sfaAnalysisHistory, value); },
  setOverridesForCheck(value) { overrides = value || {}; },
  getOverridesForCheck() { return overrides; },
  setAiUsageAdvisoryForCheck(value) { aiUsageAdvisory = sanitizeAiUsageAdvisory(value); },
  gridRowsForCheck(value, mode = 'input') {
    return (value || []).map(entry => ({ entry, item: orderItemByName(entry.name), hidden: false }))
      .filter(row => row.item)
      .sort((left, right) => compareGridRows(left, right, mode))
      .map(row => row.entry.entryKey || row.entry.id);
  },
  resetGridPerfForCheck() {
    gridPerf.fullRenders = 0;
    gridPerf.keyedRowPatches = 0;
    gridPerf.deferredRuns = 0;
    gridPerf.scheduledFrames = 0;
  },
  gridPerfForCheck() { return { ...gridPerf, deferredRevision: deferredInputRevision }; },
  scheduleGridInputForCheck(name) {
    updateDerivedOrderForName(name);
    scheduleDeferredInputWork({ names: [name] });
  },
  flushGridInputForCheck() {
    const previous = suppressAutoSave;
    suppressAutoSave = true;
    flushDeferredInputWork();
    suppressAutoSave = previous;
  },
  addManualSiteMappingForCheck(siteKey, itemName, siteName, siteUnit) {
    const nextName = ensureManualOrderItem(itemName, siteUnit, 'test', siteName);
    ensureEntryForOrderItem(nextName);
    applyExplicitSiteMapping(siteKey, nextName, siteName, siteUnit, 'manual');
  },
  applyExplicitSiteMappingForCheck(siteKey, targetName, siteName, siteUnit, mode = 'confirmed') {
    applyExplicitSiteMapping(siteKey, targetName, siteName, siteUnit, mode);
  },
  setManualOrderAliasForCheck(aliasName, actualName, actualUnit = '') {
    storeExplicitAliasMapping(aliasName, actualName, actualUnit, 'manual', 'test explicit alias');
  },
  getSiteMappingsForCheck() { return orderSiteMappings; },
  getAliasMappingsForCheck() { return orderAliasMappings; },
  setUsageHistoryForCheck(value) { usageHistory = value || {}; },
  setSfaActualHistoryForCheck(value) { sfaActualHistory = value || {}; },
};`, sandbox);

const api = sandbox.__OrderHelperApi;
const plain = value => JSON.parse(JSON.stringify(value));
const inventoryName = api.MASTER[0].name;
api.setEntriesForCheck([
  { id: 'dup-entry', name: inventoryName, zone: '주방', stock: 0 },
  { id: 'dup-entry', name: inventoryName, zone: '창고', stock: 2 },
]);
const inventoryEntries = plain(api.entriesForCheck());
assert.strictEqual(new Set(inventoryEntries.map(row => row.entryKey)).size, 2, 'duplicate zone rows must receive unique stable entry keys');
assert(inventoryEntries.every(row => row.itemKey === api.itemKeyForName(inventoryName)), 'input rows must share the exact stable item key used by output');
assert.strictEqual(api.totalStockForCheck(inventoryName), 2, 'duplicate zones including explicit zero must aggregate through the stable item key');
const keyedInventory = plain(api.inventoryByItemKeyForPayload());
assert.strictEqual(keyedInventory[api.itemKeyForName(inventoryName)].total, 2, 'current/history inventory read model must match output total');
assert(keyedInventory[api.itemKeyForName(inventoryName)].entries.some(row => row.stock === 0), 'keyed inventory payload must preserve explicit zero stock');
api.setRevisionsForCheck(200, 150);
storage.set('bbq_savedAt', '200');
assert.strictEqual(api.shouldApplyIncomingCurrent({ savedAt: 999, stateRevision: 199, inventoryRevision: 999 }), false, 'stale state revision must not overwrite newer local input');
assert.strictEqual(api.shouldApplyIncomingCurrent({ savedAt: 201, stateRevision: 201, inventoryRevision: 151 }), true, 'newer current revision should be accepted');
assert.strictEqual(api.shouldApplyIncomingCurrent({ savedAt: 200, stateRevision: 200, inventoryRevision: 150 }), false, 'same revision/savedAt must be deduplicated');
assert.strictEqual(api.normalizeSiteItemName('BBQ치즈볼(크림)'), 'BBQ치즈볼', 'site item normalizer should remove parenthesized spec');
assert(api.scoreSiteToMaster('BBQ치즈볼', '냉동-치즈볼-BBQ치즈볼(크림)') >= 0.84, 'site/master score should find obvious candidate');
const siteData = {
  ok: true,
  items: [{ name: 'BBQ치즈볼', qty: 2, unit: 'BOX', row_index: 1 }],
  comparison: { matched: [], missing: [], extra: [] },
};
let matches = api.buildOrderSiteMatches(siteData);
assert.strictEqual(matches[0].targetName, '냉동-치즈볼-BBQ치즈볼(크림)', 'matching builder should choose best local candidate');
assert.strictEqual(matches[0].status, 'candidate', 'high-confidence local analysis must remain a candidate until the user selects it');
api.setSiteMappingsForCheck({ [matches[0].siteKey]: { targetName: '냉동-치즈볼-BBQ황금알치즈볼', siteName: 'BBQ치즈볼', siteUnit: 'BOX' } });
matches = api.buildOrderSiteMatches(siteData);
assert.strictEqual(matches[0].targetName, '냉동-치즈볼-BBQ황금알치즈볼', 'user mapping should override local candidate');
assert.notStrictEqual(
  api.orderSiteItemKey({ name: '원재료 A(대)', unit: 'BOX' }),
  api.orderSiteItemKey({ name: '원재료A', unit: 'BOX' }),
  'same normalized names with different raw identities must not collapse to one persisted site key'
);
const sameNormalizedRows = api.buildOrderSiteMatches({
  ok: true,
  items: [
    { name: '원재료 A(대)', qty: 0, unit: 'BOX', row_index: 91 },
    { name: '원재료A', qty: 2, unit: 'BOX', row_index: 92 },
  ],
  comparison: { matched: [], missing: [], extra: [] },
});
assert.strictEqual(sameNormalizedRows.length, 2, 'same normalized names must remain independently selectable/creatable');
const zeroQtyMatches = api.buildOrderSiteMatches({
  ok: true,
  items: [{ name: '0수량 신규품목', qty: 0, unit: 'EA', row_index: 93 }],
  comparison: {
    matched: [{ row_index: 93, sfa_name: '0수량 신규품목', sfa_qty: 7, sfa_unit: 'EA', expected_name: '물티슈(500)', score: 0.9 }],
    missing: [],
    extra: [],
  },
});
assert.strictEqual(zeroQtyMatches[0].siteQty, 0, 'an explicit zero inventory/order-site quantity must not fall through to a comparison value');
api.setManualItemsForCheck([]);
api.setSiteMappingsForCheck({});
api.setAliasMappingsForCheck({});
const sourceManualKey = api.orderSiteItemKey({ name: '원재료A', unit: 'BOX' });
api.addManualSiteMappingForCheck(sourceManualKey, '원재료A', '원재료A', 'BOX');
let manualMatches = api.buildOrderSiteMatches({
  ok: true,
  items: [{ name: '원재료A', qty: 1, unit: 'BOX', row_index: 2 }],
  comparison: { matched: [], missing: [], extra: [] },
});
assert.strictEqual(manualMatches[0].targetName, '원재료A', 'source-name manual item should become reusable site mapping target');
assert(api.orderItemList().some(item => item.name === '원재료A'), 'source-name manual item should join selectable order items');
assert(api.orderManualItemsForPayload().some(row => row.name === '원재료A' && row.unit === 'BOX'), 'source-name manual item should persist in payload form');
assert.strictEqual(api.getAliasMappingsForCheck()['원재료A'].actualName, '원재료A', 'explicit new item creation must also create its user-confirmed site alias');
assert.strictEqual(api.getAliasMappingsForCheck()['원재료A'].status, 'manual', 'newly created aliases must be marked manual, never auto-confirmed');
const customManualKey = api.orderSiteItemKey({ name: '임의품목', unit: 'EA' });
api.addManualSiteMappingForCheck(customManualKey, '사용자 임의명', '임의품목', 'EA');
manualMatches = api.buildOrderSiteMatches({
  ok: true,
  items: [{ name: '임의품목', qty: 3, unit: 'EA', row_index: 3 }],
  comparison: { matched: [], missing: [], extra: [] },
});
assert.strictEqual(manualMatches[0].targetName, '사용자 임의명', 'custom manual item name should become reusable site mapping target');
assert.strictEqual(api.getSiteMappingsForCheck()[customManualKey].siteName, '임의품목', 'manual mapping must preserve the raw SFA site name');
api.setManualOrderAliasForCheck('사용자 임의명', '신규 실발주 별명', 'BOX');
assert.strictEqual(api.getAliasMappingsForCheck()['사용자 임의명'].actualName, '신규 실발주 별명', 'alias review must accept an explicitly typed new actual-order alias');
assert.strictEqual(api.effectiveOrderAliasMappingsForPayload()['사용자 임의명'].actualName, '신규 실발주 별명', 'new alias must immediately feed the effective current/history read model');
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
api.setSfaActualHistoryForCheck({});
api.setSfaAnalysisHistoryForCheck({ records: [] });
api.appendSfaAnalysisHistory({
  ok: true,
  savedAt: Date.UTC(2026, 6, 4),
  file: { name: '누적.xlsx' },
  historySummary: { selectedDate: '20260704' },
  items: [],
  comparison: {
    matched: [{ row_index: 10, sfa_name: 'BBQ치즈볼누적', sfa_qty: 4, sfa_unit: 'BOX', expected_name: '냉동-치즈볼-BBQ치즈볼(크림)', expected_stock_need: 8, score: 0.97 }],
    missing: [],
    extra: [{ row_index: 11, name: '0수량품목', qty: 0, unit: 'EA' }]
  }
}, 'excel');
const cumulativeHistory = api.sfaAnalysisHistoryForPayload();
assert.strictEqual(cumulativeHistory.records.length, 1, 'SFA analysis history should append analysis runs');
assert.strictEqual(cumulativeHistory.records[0].dateKey, '20260704', 'SFA analysis history should preserve the analysis date');
assert(cumulativeHistory.records[0].items.some(row => row.originalName === '0수량품목' && row.quantity === 0), 'SFA analysis history must preserve zero-quantity rows');
assert(storage.has('bbq_sfa_analysis_history'), 'SFA analysis history should be durable in localStorage');
const cumulativeCandidates = api.collectActualOrderCandidates(null);
assert(cumulativeCandidates.some(row => row.actualName === 'BBQ치즈볼누적' && row.sources.includes('분석누적')), 'actual order candidates should include cumulative local SFA analysis rows');
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
api.setSfaActualHistoryForCheck({});
api.setSfaAnalysisHistoryForCheck({
  records: [
    { id: 'local-20260701', dateKey: '20260701', source: 'excel', savedAt: Date.UTC(2026, 6, 1), items: [{ originalName: 'BBQ치즈볼', mappedName: '냉동-치즈볼-BBQ치즈볼(크림)', quantity: 5, unit: 'BOX', dateKey: '20260701' }] },
    { id: 'local-20260702', dateKey: '20260702', source: 'excel', savedAt: Date.UTC(2026, 6, 2), items: [{ originalName: 'BBQ치즈볼', mappedName: '냉동-치즈볼-BBQ치즈볼(크림)', quantity: 6, unit: 'BOX', dateKey: '20260702' }] },
    { id: 'local-20260703', dateKey: '20260703', source: 'excel', savedAt: Date.UTC(2026, 6, 3), items: [{ originalName: 'BBQ치즈볼', mappedName: '냉동-치즈볼-BBQ치즈볼(크림)', quantity: 4, unit: 'BOX', dateKey: '20260703' }] }
  ]
});
aliasRows = api.buildOrderAliasMatches({ comparison: { matched: [], missing: [], extra: [] } });
cheeseAlias = aliasRows.find(row => row.aliasName === '냉동-치즈볼-BBQ치즈볼(크림)');
const localUsageConversion = cheeseAlias.conversionCandidates.find(row => row.source === 'usage');
assert(localUsageConversion, 'usage-based conversion candidate should be generated from cumulative local SFA analysis history');
assert.strictEqual(localUsageConversion.factor, 2, 'local cumulative SFA analysis history should feed usageEstimate / actual SFA qty conversion');
api.setSfaAnalysisHistoryForCheck({ records: [] });
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

module.exports = { api, storage, plain, sandbox };
console.log('OrderHelper static checks OK');
