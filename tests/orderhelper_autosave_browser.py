#!/usr/bin/env python3
import http.server
import json
import socketserver
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


HTML = (Path(__file__).resolve().parents[1] / "index.html").read_bytes()


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(HTML)))
        self.end_headers()
        self.wfile.write(HTML)

    def log_message(self, *_args):
        pass


def wait_for_puts(page, writes, count):
    for _ in range(240):
        if len(writes) >= count:
            return
        page.wait_for_timeout(25)
    raise AssertionError(f"timed out waiting for PUT #{count}")


def main():
    server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_address[1]}"
    remote = {"current": None, "history": None}
    versions = {"current": 0, "history": 0}
    writes = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()

            def firebase_route(route, request):
                cors_headers = {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, If-Match, X-Firebase-ETag",
                    "Access-Control-Expose-Headers": "ETag",
                }
                kind = "current" if "/current.json" in request.url else ("history" if "/history/" in request.url else "other")
                if request.method == "OPTIONS":
                    route.fulfill(status=204, headers=cors_headers, body="")
                elif request.method == "GET" and "/sfaAnalysisRuns/browser-source/sourceTable.json" in request.url:
                    route.fulfill(
                        status=200,
                        content_type="application/json",
                        headers=cors_headers,
                        body=json.dumps({
                            "sheet": "주문현황",
                            "headerRowIndex": 0,
                            "rowCount": 2,
                            "columnCount": 3,
                            "rows": [["상품명", "단가", "메모"], ["치킨,간지", "9000", "=수식"]],
                        }),
                    )
                elif request.method == "PUT":
                    body = request.post_data or ""
                    if kind == "other":
                        route.fulfill(status=400, content_type="application/json", headers=cors_headers, body='{"error":"unexpected PUT"}')
                        return
                    expected_etag = f'"v{versions[kind]}"'
                    if request.headers.get("if-match") != expected_etag:
                        route.fulfill(status=412, content_type="application/json", headers=cors_headers, body='{"error":"etag mismatch"}')
                        return
                    remote[kind] = json.loads(body)
                    versions[kind] += 1
                    writes.append({"kind": kind, "url": request.url, "body": body})
                    route.fulfill(status=200, content_type="application/json", headers=cors_headers, body=body)
                elif kind in {"current", "history"}:
                    route.fulfill(
                        status=200,
                        content_type="application/json",
                        headers={**cors_headers, "ETag": f'"v{versions[kind]}"'},
                        body=json.dumps(remote[kind]),
                    )
                else:
                    route.fulfill(status=200, content_type="application/json", headers=cors_headers, body="null")

            page.route("**/*firebasedatabase.app/**", firebase_route)
            page.goto(origin, wait_until="domcontentloaded")
            page.evaluate("startOrderHelperApp()")

            compact_save_ui = page.evaluate(
                """() => {
                    for (let i = 0; i < 30; i += 1) pushSaveLog(`회귀 로그 ${i}`);
                    const saveState = document.getElementById('saveState');
                    return {
                        storedCount: JSON.parse(localStorage.getItem(SAVE_LOG_STORAGE_KEY) || '[]').length,
                        saveLogExists: Boolean(document.getElementById('saveLog')),
                        saveLogWrapExists: Boolean(document.querySelector('.save-log-wrap')),
                        toolsText: document.getElementById('inputTools').innerText.trim(),
                        saveStateText: saveState.textContent,
                        saveStateDisplay: getComputedStyle(saveState).display,
                    };
                }"""
            )
            assert compact_save_ui == {
                "storedCount": 8,
                "saveLogExists": False,
                "saveLogWrapExists": False,
                "toolsText": "재고 리셋",
                "saveStateText": "동기화됨",
                "saveStateDisplay": "flex",
            }, compact_save_ui

            mapping_copy = page.evaluate(
                """() => {
                    const base = {
                        aliasName: '테스트 내부명',
                        status: 'default',
                        actualName: 'BBQ양념먹태매운맛',
                        actualUnit: 'BON',
                        effectiveActualName: 'BBQ양념먹태매운맛',
                        defaultActualName: 'BBQ양념먹태매운맛',
                        savedActualName: '',
                        candidates: [{ actualName: 'BBQ양념먹태매운맛', actualUnit: 'BON', score: 0.98 }],
                        conversionFactor: 1,
                        effectiveConversionFactor: 1,
                        defaultConversionFactor: 1,
                        savedConversionFactor: null,
                        conversionStatus: 'default',
                        effectiveConversionStatus: 'default',
                        conversionCandidates: [{ factor: 1, source: 'same', score: 1 }],
                        reason: '기술 상세 근거',
                        conversionReason: '최근비교 100%',
                    };
                    const host = document.createElement('div');
                    host.style.width = '172px';
                    document.body.appendChild(host);
                    const summaryText = row => {
                        host.innerHTML = inlineAliasCorrectionHtml(row);
                        const details = host.querySelector('details');
                        details.open = true;
                        const body = host.querySelector('.inline-alias-body');
                        return {
                            text: host.querySelector('summary').innerText,
                            aria: host.querySelector('summary').getAttribute('aria-label'),
                            bodyText: body.innerText,
                            newFieldCount: host.querySelectorAll('.inline-alias-new-fields').length,
                            buttonText: host.querySelector('.inline-alias-new-button').textContent.trim(),
                            nameSelectValue: host.querySelector('.inline-alias-select').value,
                            factorSelectValue: host.querySelector('.inline-alias-factor-select').value,
                            fullNameWhiteSpace: getComputedStyle(host.querySelector('.inline-alias-summary-text')).whiteSpace,
                            bodyFits: body.scrollWidth <= body.clientWidth,
                        };
                    };
                    const defaultSummary = summaryText(base);
                    const mixedSummary = summaryText({
                        ...base,
                        status: 'confirmed',
                        actualName: 'BBQ양념먹태매운맛',
                        savedActualName: 'BBQ양념먹태매운맛',
                    });
                    host.remove();
                    return {
                        defaultSummary,
                        mixedSummary,
                        siteConfirmed: siteMatchSummaryText([{ status: 'confirmed' }]),
                        siteCandidate: siteMatchSummaryText([{ status: 'default' }]),
                        siteConflict: siteMatchSummaryText([{ status: 'conflict' }]),
                    };
                }"""
            )
            assert "발주명·단위" in mapping_copy["defaultSummary"]["text"], mapping_copy
            assert "자동 연결·확인 필요" in mapping_copy["defaultSummary"]["text"], mapping_copy
            assert "BBQ양념먹태매운맛" in mapping_copy["defaultSummary"]["text"], mapping_copy
            assert "발주 1개당 재고 1개 · 자동 계산·확인 필요" in mapping_copy["defaultSummary"]["text"], mapping_copy
            assert mapping_copy["defaultSummary"]["newFieldCount"] == 1, mapping_copy
            assert mapping_copy["defaultSummary"]["buttonText"] == "이 이름으로 확정", mapping_copy
            assert mapping_copy["defaultSummary"]["nameSelectValue"] == "", "automatic name must require an explicit selection"
            assert mapping_copy["defaultSummary"]["factorSelectValue"] == "", "automatic conversion must require an explicit selection"
            assert mapping_copy["defaultSummary"]["fullNameWhiteSpace"] == "normal", mapping_copy
            assert mapping_copy["defaultSummary"]["bodyFits"] is True, mapping_copy
            assert "발주 사이트에서 사용할 이름" in mapping_copy["defaultSummary"]["bodyText"], mapping_copy
            assert "자동으로 찾은 이름" in mapping_copy["defaultSummary"]["bodyText"], mapping_copy
            assert "자동으로 계산한 수량" in mapping_copy["defaultSummary"]["bodyText"], mapping_copy
            assert all(term not in mapping_copy["defaultSummary"]["bodyText"] for term in ("별명", "최근비교", "100%", "1발주=")), mapping_copy
            assert "선택 완료" in mapping_copy["mixedSummary"]["text"], mapping_copy
            assert "자동 계산·확인 필요" in mapping_copy["mixedSummary"]["text"], "name confirmation must not hide an unconfirmed conversion"
            assert mapping_copy["mixedSummary"]["nameSelectValue"] == "BBQ양념먹태매운맛", mapping_copy
            assert mapping_copy["mixedSummary"]["factorSelectValue"] == "", mapping_copy
            assert mapping_copy["siteConfirmed"] == "발주 사이트 품목 1건 · 연결 완료", mapping_copy
            assert mapping_copy["siteCandidate"] == "발주 사이트 품목 1건 · 자동 연결·확인 필요", mapping_copy
            assert mapping_copy["siteConflict"] == "발주 사이트 품목 1건 · 중복·확인 필요", mapping_copy

            page.evaluate(
                """() => {
                    lastSfaCompareData = {
                        runPath: `${FB_PATH}/sfaAnalysisRuns/browser-source`,
                        file: { name: '단가포함.xlsx' },
                    };
                }"""
            )
            with page.expect_download() as source_download_info:
                assert page.evaluate("downloadLatestSfaSourceCsv()") is True
            source_download = source_download_info.value
            assert source_download.suggested_filename == "단가포함_원문.csv"
            source_csv = Path(source_download.path()).read_text(encoding="utf-8-sig")
            assert source_csv == '"상품명","단가","메모"\n"치킨,간지","9000","\'=수식"'
            page.evaluate("lastSfaCompareData = null")

            factor_direction = page.evaluate(
                """() => {
                    const factorItem = MASTER.find(item => item.name === '신선육(10호)-뼈한마리');
                    const sameUnitItem = MASTER.find(item => item.name === '물티슈(500)');
                    const previousCorrections = orderUnitCorrections;
                    orderUnitCorrections = sanitizeOrderUnitCorrections({ [factorItem.name]: { factor: 10 } });
                    const result = {
                        orderFor25: recommendedOrderQty(factorItem, 25),
                        orderFor20: recommendedOrderQty(factorItem, 20),
                        stockFor2: stockUnitsForOrderQty(2, 10),
                        chip: orderAnalysisText(factorItem, 25),
                        title: orderAnalysisTitle(factorItem, 25),
                        correction: unitCorrectionForItem(factorItem.name),
                    };
                    orderUnitCorrections = {};
                    result.sameUnitDecimal = recommendedOrderQty(sameUnitItem, 2.21);
                    orderUnitCorrections = previousCorrections;
                    return result;
                }"""
            )
            assert factor_direction["orderFor25"] == 3, "factor 10 must convert 25 stock units to 3 whole order units"
            assert factor_direction["orderFor20"] == 2, "factor 10 must convert 20 stock units to 2 order units"
            assert factor_direction["stockFor2"] == 20, "2 order units at factor 10 must restore 20 stock/usage units"
            assert factor_direction["sameUnitDecimal"] == 2.3, "same-unit factor-1 path must preserve 0.1 precision"
            assert "발주 1개 → 재고 10개" in factor_direction["chip"] and "1발주 = 재고/사용량 10개" in factor_direction["title"], "visible factor label must explain the stock-unit direction"
            assert factor_direction["correction"]["orderUnitToStockFactor"] == 10
            assert factor_direction["correction"]["factorMeaning"] == "1발주 단위 = 재고/사용량 N개"

            fixture = page.evaluate(
                """() => {
                    const input = document.querySelector('input.cell[data-field="stock"]');
                    window.__draftRecomputeCount = 0;
                    window.__draftOriginalRecompute = recomputeUsageAnalysis;
                    window.__draftDebugBefore = debugLogs.length;
                    window.__draftResolverBefore = gridPerf.resolverRuns;
                    recomputeUsageAnalysis = (...args) => {
                        window.__draftRecomputeCount += 1;
                        return window.__draftOriginalRecompute(...args);
                    };
                    const started = performance.now();
                    for (let value = 1; value <= 10; value += 1) {
                        input.value = String(value);
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    const inputDurationMs = performance.now() - started;
                    window.dispatchEvent(new Event('online'));
                    document.dispatchEvent(new Event('visibilitychange'));
                    const local = JSON.parse(localStorage.getItem('bbq_entries') || '[]');
                    return {
                        id: input.dataset.id,
                        itemKey: input.dataset.itemKey,
                        localStock: local.find(row => row.id === input.dataset.id)?.stock,
                        pending: Number(localStorage.getItem('bbq_pending_sync_revision') || 0),
                        status: document.getElementById('saveState').textContent,
                        inputDurationMs
                    };
                }"""
            )
            page.wait_for_timeout(1600)
            draft_perf = page.evaluate(
                """() => {
                    const result = {
                        recomputeCount: window.__draftRecomputeCount,
                        debugDelta: debugLogs.length - window.__draftDebugBefore,
                        resolverDelta: gridPerf.resolverRuns - window.__draftResolverBefore,
                    };
                    recomputeUsageAnalysis = window.__draftOriginalRecompute;
                    return result;
                }"""
            )
            assert writes == [], "ten draft stock inputs plus online/visibility must produce PUT 0"
            assert fixture["localStock"] == 10 and fixture["pending"] > 0
            assert fixture["status"] == "로컬 입력됨 · Enter 저장"
            assert fixture["inputDurationMs"] < 100, fixture
            assert draft_perf == {"recomputeCount": 0, "debugDelta": 0, "resolverDelta": 0}, draft_perf

            page.reload(wait_until="domcontentloaded")
            page.evaluate("startOrderHelperApp(); document.activeElement?.blur()")
            page.wait_for_timeout(1200)
            draft_reload = page.evaluate("id => entries.find(row => row.id === id)?.stock", fixture["id"])
            assert draft_reload == 10, "draft-only reload must keep the latest local value"
            assert writes == [], "draft-only reload must produce PUT 0"

            page.evaluate(
                """id => {
                    const input = Array.from(document.querySelectorAll('input.cell[data-field="stock"]')).find(row => row.dataset.id === id);
                    input.value = '11';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true }));
                }""",
                fixture["id"],
            )
            page.wait_for_timeout(1100)
            assert writes == [], "IME composition keydown without completion/change must produce PUT 0"

            page.evaluate(
                """id => {
                    const input = Array.from(document.querySelectorAll('input.cell[data-field="stock"]')).find(row => row.dataset.id === id);
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }""",
                fixture["id"],
            )
            wait_for_puts(page, writes, 2)
            page.wait_for_timeout(250)
            assert len(writes) == 2, "mobile Next/change completion must create one current/history pair"
            change_payload = json.loads(writes[0]["body"])
            change_row = next(row for row in change_payload["entries"] if row["id"] == fixture["id"])
            assert change_row["stock"] == 11

            page.evaluate(
                """id => {
                    const input = Array.from(document.querySelectorAll('input.cell[data-field="stock"]')).find(row => row.dataset.id === id);
                    input.value = '12';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }""",
                fixture["id"],
            )
            wait_for_puts(page, writes, 4)
            page.wait_for_timeout(250)
            assert len(writes) == 4, "Enter followed by change must add only one current/history pair"
            entered_writes = writes[2:4]
            assert {row["kind"] for row in entered_writes} == {"current", "history"}
            assert entered_writes[0]["body"] == entered_writes[1]["body"]
            entered_payload = json.loads(entered_writes[0]["body"])
            entered_row = next(row for row in entered_payload["entries"] if row["id"] == fixture["id"])
            assert entered_row["stock"] == 12
            keyed = entered_payload["inventoryByItemKey"][fixture["itemKey"]]
            assert keyed["total"] == 12, "saved keyed inventory must match the entered stock/output read model"

            before_zone = len(writes)
            page.evaluate(
                """id => {
                    const input = Array.from(document.querySelectorAll('input.cell[data-field="zone"]')).find(row => row.dataset.id === id);
                    input.value = 'Enter구역';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }""",
                fixture["id"],
            )
            page.wait_for_timeout(1100)
            assert len(writes) == before_zone, "zone blur must produce PUT 0"
            page.evaluate(
                """id => {
                    const input = Array.from(document.querySelectorAll('input.cell[data-field="zone"]')).find(row => row.dataset.id === id);
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                }""",
                fixture["id"],
            )
            wait_for_puts(page, writes, before_zone + 2)

            before_base = len(writes)
            page.evaluate(
                """() => {
                    const input = document.getElementById('baseSalesInput');
                    input.value = '305';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }"""
            )
            page.wait_for_timeout(1100)
            assert len(writes) == before_base, "base-sales blur must produce PUT 0"
            page.evaluate(
                "document.getElementById('baseSalesInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))"
            )
            wait_for_puts(page, writes, before_base + 2)

            before_kitchen = len(writes)
            kitchen_page = browser.new_page()
            kitchen_page.route("**/*firebasedatabase.app/**", firebase_route)
            kitchen_page.goto(origin, wait_until="domcontentloaded")
            kitchen_page.evaluate("startOrderHelperApp()")
            kitchen_page.evaluate(
                """() => {
                    entries = MASTER.slice(0, 21).map((item, index) => ({
                        id: `kitchen-frozen-${index}`,
                        entryKey: `kitchen-frozen-${index}`,
                        itemKey: itemKeyForName(item.name),
                        name: item.name,
                        zone: '주방냉동',
                        stock: null,
                    }));
                    gridSortMode = 'sfa';
                    render();
                }"""
            )
            for index in range(21):
                kitchen_page.evaluate(
                    """index => {
                        const input = Array.from(document.querySelectorAll('input.cell[data-field="stock"]'))
                            .find(row => row.dataset.id === `kitchen-frozen-${index}`);
                        if (!input) throw new Error(`missing kitchen-frozen-${index}`);
                        input.value = String(index + 1);
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }""",
                    index,
                )
                kitchen_page.wait_for_timeout(10)
            kitchen_page.wait_for_function(
                "!saveInFlight && !pendingSave && !readConfirmedSaveQueue().active && !readConfirmedSaveQueue().queued"
            )
            page.wait_for_timeout(150)
            assert len(writes) >= before_kitchen + 2, "21 kitchen-frozen change completions must reach Firebase"
            kitchen_rows = {
                row["id"]: row for row in (remote["current"] or {}).get("entries", [])
                if row.get("zone") == "주방냉동"
            }
            assert len(kitchen_rows) == 21, "all 21 kitchen-frozen rows must survive the coalesced confirmed-save queue"
            assert [kitchen_rows[f"kitchen-frozen-{index}"]["stock"] for index in range(21)] == list(range(1, 22))
            assert remote["history"] == remote["current"], "kitchen-frozen current/history snapshots must remain identical"
            kitchen_page.close()

            before_action = len(writes)
            page.evaluate("id => addRow(id)", fixture["id"])
            wait_for_puts(page, writes, before_action + 2)

            before_xss_action = len(writes)
            xss_fixture = page.evaluate(
                """() => {
                    window.__storedXss = 0;
                    const maliciousId = 'row" onfocus="window.__storedXss=1';
                    const maliciousZone = '\"><img src=x onerror="window.__storedXss=1">';
                    const name = MASTER[0].name;
                    entries = [{
                        id: maliciousId,
                        entryKey: maliciousId,
                        itemKey: itemKeyForName(name),
                        name,
                        zone: maliciousZone,
                        stock: 1,
                    }];
                    render();
                    render();
                    const addButton = document.querySelector('button[data-grid-action="add"]');
                    const zoneInput = document.querySelector('input.cell[data-field="zone"]');
                    const before = entries.length;
                    addButton.click();
                    return {
                        maliciousId,
                        maliciousZone,
                        datasetId: addButton.dataset.entryId,
                        zoneValue: zoneInput.value,
                        imageCount: document.querySelectorAll('#tbody img').length,
                        xss: window.__storedXss,
                        before,
                        after: entries.length,
                    };
                }"""
            )
            assert xss_fixture["datasetId"] == xss_fixture["maliciousId"], "escaped row id must round-trip through dataset"
            assert xss_fixture["zoneValue"] == xss_fixture["maliciousZone"], "escaped zone text must round-trip as an input value"
            assert xss_fixture["imageCount"] == 0 and xss_fixture["xss"] == 0, "stored row data must remain inert HTML"
            assert xss_fixture["after"] == xss_fixture["before"] + 1, "double render must bind one delegated row-action listener"
            wait_for_puts(page, writes, before_xss_action + 2)
            page.wait_for_timeout(150)
            assert len(writes) == before_xss_action + 2, "one delegated add click must produce one confirmed current/history pair"

            page.evaluate(
                """() => {
                    const input = document.querySelector('input.cell[data-field="stock"]');
                    input.value = '44';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    const commit = buildConfirmedSaveCommit('enter');
                    if (!writeConfirmedSaveQueue({ v: 1, active: commit, queued: null })) throw new Error('queue fixture write failed');
                    window.__pendingBody = commit.body;
                }"""
            )
            pending_body = page.evaluate("window.__pendingBody")
            before_reload_pending = len(writes)
            page.reload(wait_until="domcontentloaded")
            page.evaluate("startOrderHelperApp(); document.activeElement?.blur()")
            wait_for_puts(page, writes, before_reload_pending + 2)
            resumed = writes[before_reload_pending : before_reload_pending + 2]
            assert resumed[0]["body"] == pending_body and resumed[1]["body"] == pending_body

            sort_page = browser.new_page()
            sort_page.route("**/*firebasedatabase.app/**", firebase_route)
            sort_page.goto(origin, wait_until="domcontentloaded")
            sort_page.evaluate("startOrderHelperApp()")
            sort_page.wait_for_function("document.activeElement?.id === 'pinInput'")
            sort_page.evaluate("unlockOrderHelper(); document.activeElement?.blur()")
            input_sort = sort_page.evaluate(
                """() => {
                    const items = MASTER.slice().sort(defaultOutputCompare).slice(0, 3);
                    entries = items.map((item, index) => ({
                        id: `sort-${index}`,
                        entryKey: `sort-${index}`,
                        itemKey: itemKeyForName(item.name),
                        name: item.name,
                        zone: '가',
                        stock: index === 2 ? 5 : null,
                    }));
                    gridSortMode = 'input';
                    render();
                    const input = document.querySelector('input.cell[data-field="stock"][data-id="sort-0"]');
                    input.focus();
                    input.value = '1';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                    return new Promise(resolve => setTimeout(() => resolve({
                        ids: Array.from(document.querySelectorAll('#tbody tr[data-entry-key]')).map(row => row.dataset.entryKey),
                        activeId: document.activeElement?.dataset?.id || '',
                    }), 0));
                }"""
            )
            assert input_sort["ids"] == ["sort-1", "sort-0", "sort-2"], "input mode Enter must move the completed row below unchecked rows"
            assert input_sort["activeId"] == "sort-1", f"input mode Enter must keep focus on the next unchecked stock row: {input_sort}"

            sfa_sort = sort_page.evaluate(
                """() => {
                    entries.forEach(row => { row.stock = null; });
                    gridSortMode = 'sfa';
                    render();
                    const before = Array.from(document.querySelectorAll('#tbody tr[data-entry-key]')).map(row => row.dataset.entryKey);
                    const first = document.querySelector('input.cell[data-field="stock"]');
                    const next = Array.from(document.querySelectorAll('input.cell[data-field="stock"]'))[1];
                    first.focus();
                    first.value = '1';
                    first.dispatchEvent(new Event('input', { bubbles: true }));
                    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                    return {
                        before,
                        after: Array.from(document.querySelectorAll('#tbody tr[data-entry-key]')).map(row => row.dataset.entryKey),
                        activeId: document.activeElement?.dataset?.id || '',
                        expectedNextId: next?.dataset?.id || '',
                    };
                }"""
            )
            assert sfa_sort["after"] == sfa_sort["before"], "SFA mode Enter must keep the fixed SFA row order"
            assert sfa_sort["activeId"] == sfa_sort["expectedNextId"], "SFA mode Enter must focus the next row without resorting"
            sort_page.close()

            mobile_page = browser.new_page(viewport={"width": 390, "height": 844})
            mobile_page.route("**/*firebasedatabase.app/**", firebase_route)
            mobile_page.goto(origin, wait_until="domcontentloaded")
            mobile_page.evaluate("startOrderHelperApp(); unlockOrderHelper(); document.activeElement?.blur()")
            mobile_header = mobile_page.evaluate(
                """() => {
                    const wrap = document.querySelector('.table-wrap').getBoundingClientRect();
                    const headerCells = Array.from(document.querySelectorAll('#thead th'));
                    const row = document.querySelector('#tbody tr[data-entry-key]:first-of-type');
                    const rowCells = Array.from(row.querySelectorAll(':scope > td'));
                    const headers = headerCells.slice(0, 5).map(cell => {
                        const rect = cell.getBoundingClientRect();
                        return { x: rect.x, right: rect.right, top: rect.top };
                    });
                    const cells = rowCells.slice(0, 5).map(cell => {
                        const rect = cell.getBoundingClientRect();
                        return { x: rect.x, right: rect.right };
                    });
                    const needCell = row.querySelector('td.need-qty');
                    const orderCell = row.querySelector('td.order-qty');
                    const orderContent = orderCell.querySelector('.order-cell');
                    const stockCell = row.querySelector('td[data-column="stock"]');
                    const orderRect = orderCell.getBoundingClientRect();
                    const orderContentRect = orderContent.getBoundingClientRect();
                    const stockRect = stockCell.getBoundingClientRect();
                    const expectedKeys = ['zone', 'name', 'need', 'order', 'stock', 'k', 'l', 'unit', 'actions'];
                    return {
                        wrapTop: wrap.top,
                        headers,
                        cells,
                        headerKeys: headerCells.map(cell => cell.dataset.column),
                        headerTexts: headerCells.map(cell => cell.textContent.trim()),
                        cellKeys: rowCells.map(cell => cell.dataset.column),
                        needTextAlign: getComputedStyle(needCell).textAlign,
                        needVerticalAlign: getComputedStyle(needCell).verticalAlign,
                        orderTextAlign: getComputedStyle(orderCell).textAlign,
                        orderVerticalAlign: getComputedStyle(orderCell).verticalAlign,
                        orderDisplay: getComputedStyle(orderContent).display,
                        orderJustify: getComputedStyle(orderContent).justifyContent,
                        regularRowsAligned: Array.from(document.querySelectorAll('#tbody tr[data-entry-key]')).every(candidate =>
                            Array.from(candidate.querySelectorAll(':scope > td')).map(cell => cell.dataset.column).join(',') === expectedKeys.join(',')
                        ),
                        orderContained: orderContentRect.left >= orderRect.left - 1 && orderContentRect.right <= orderRect.right + 1,
                        orderBeforeStock: orderRect.right <= stockRect.left + 1,
                    };
                }"""
            )
            assert mobile_header["headerKeys"] == ["zone", "name", "need", "order", "stock", "k", "l", "unit", "actions"], mobile_header
            assert mobile_header["headerTexts"] == ["구역", "품목명", "필요량", "추천발주 · 분석 · 금액", "재고", "여유", "일사용", "단위", ""], mobile_header
            assert mobile_header["cellKeys"] == ["zone", "name", "need", "order", "stock", "k", "l", "unit", "actions"], mobile_header
            assert abs(mobile_header["headers"][0]["top"] - mobile_header["wrapTop"]) <= 1, mobile_header
            for header, cell in zip(mobile_header["headers"], mobile_header["cells"]):
                assert abs(header["x"] - cell["x"]) < 1 and abs(header["right"] - cell["right"]) < 1, mobile_header
            assert mobile_header["needTextAlign"] == "center" and mobile_header["needVerticalAlign"] == "middle", mobile_header
            assert mobile_header["orderTextAlign"] == "left" and mobile_header["orderVerticalAlign"] == "middle", mobile_header
            assert mobile_header["orderDisplay"] == "flex" and mobile_header["orderJustify"] == "flex-start", mobile_header
            assert mobile_header["regularRowsAligned"] is True, mobile_header
            assert mobile_header["orderContained"] is True and mobile_header["orderBeforeStock"] is True, mobile_header

            focus_race = mobile_page.evaluate(
                """async () => {
                    const first = MASTER.find(item => item.name !== '신선육(10호)-뼈한마리');
                    const second = MASTER.find(item => item.name !== first.name && item.name !== '신선육(10호)-뼈한마리');
                    const fresh = MASTER.find(item => item.name === '신선육(10호)-뼈한마리');
                    entries = [
                        { id: 'typing-row', entryKey: 'typing-row', itemKey: itemKeyForName(first.name), name: first.name, zone: '가', stock: null },
                        { id: 'pending-row', entryKey: 'pending-row', itemKey: itemKeyForName(second.name), name: second.name, zone: '가', stock: null },
                        { id: 'fresh-row', entryKey: 'fresh-row', itemKey: itemKeyForName(fresh.name), name: fresh.name, zone: '가', stock: 5 },
                    ];
                    gridSortMode = 'input';
                    render();
                    const input = document.querySelector('input.cell[data-field="stock"][data-id="typing-row"]');
                    const beforeRenderCount = gridPerf.fullRenders;
                    input.focus();
                    input.value = '1';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    refreshSfaResultViewsWithCurrentState({
                        ok: true, runId: 'focus-race', savedAt: Date.now(), items: [],
                        comparison: { matched: [], missing: [], extra: [] },
                    }, 'latestCompare');
                    const whileEditing = {
                        order: Array.from(document.querySelectorAll('#tbody tr[data-entry-key]')).map(row => row.dataset.entryKey),
                        activeId: document.activeElement?.dataset?.id || '',
                        sameNode: document.activeElement === input,
                        fullRenders: gridPerf.fullRenders - beforeRenderCount,
                        pendingRender: pendingGridRender,
                    };
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                    await new Promise(resolve => setTimeout(resolve, 0));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    await new Promise(resolve => setTimeout(resolve, 20));
                    const afterEnter = {
                        order: Array.from(document.querySelectorAll('#tbody tr[data-entry-key]')).map(row => row.dataset.entryKey),
                        activeId: document.activeElement?.dataset?.id || '',
                        typingNodePreserved: document.querySelector('input.cell[data-field="stock"][data-id="typing-row"]') === input,
                        fullRenders: gridPerf.fullRenders - beforeRenderCount,
                    };

                    const duplicateItem = first;
                    entries = [
                        { id: 'dup-checked', entryKey: 'dup-checked', itemKey: itemKeyForName(duplicateItem.name), name: duplicateItem.name, zone: '가', stock: 1 },
                        { id: 'dup-edit', entryKey: 'dup-edit', itemKey: itemKeyForName(duplicateItem.name), name: duplicateItem.name, zone: '나', stock: null },
                    ];
                    pendingGridRender = false;
                    render({ allowDuringGridEdit: true });
                    const duplicateInput = document.querySelector('input.cell[data-field="stock"][data-id="dup-edit"]');
                    duplicateInput.focus();
                    duplicateInput.value = '2';
                    duplicateInput.dispatchEvent(new Event('input', { bubbles: true }));
                    duplicateInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                    await new Promise(resolve => setTimeout(resolve, 0));
                    const duplicate = {
                        order: Array.from(document.querySelectorAll('#tbody tr[data-entry-key]')).map(row => row.dataset.entryKey),
                        nodePreserved: document.querySelector('input.cell[data-field="stock"][data-id="dup-edit"]') === duplicateInput,
                        uniqueNodes: new Set(Array.from(document.querySelectorAll('input.cell[data-field="stock"]'))).size,
                    };
                    return { whileEditing, afterEnter, duplicate };
                }"""
            )
            assert focus_race["whileEditing"] == {
                "order": ["typing-row", "pending-row", "fresh-row"],
                "activeId": "typing-row",
                "sameNode": True,
                "fullRenders": 0,
                "pendingRender": True,
            }, focus_race
            assert focus_race["afterEnter"]["order"] == ["pending-row", "typing-row", "fresh-row"], focus_race
            assert focus_race["afterEnter"]["activeId"] == "pending-row", focus_race
            assert focus_race["afterEnter"]["typingNodePreserved"] is True, focus_race
            assert focus_race["afterEnter"]["fullRenders"] == 0, focus_race
            assert focus_race["duplicate"]["nodePreserved"] is True, focus_race
            assert focus_race["duplicate"]["uniqueNodes"] == 2, focus_race
            mobile_page.close()

            auth_page = browser.new_page(viewport={"width": 390, "height": 844})
            auth_page.route("**/*firebasedatabase.app/**", lambda route: route.abort())
            auth_page.goto(origin, wait_until="domcontentloaded")
            auth_page.wait_for_timeout(50)
            trusted_auth = auth_page.evaluate(
                """async factoryHash => {
                    const hashes = Array.from(PASSWORDLESS_TRUSTED_DEVICE_HASHES);
                    localStorage.setItem(AUTH_GEO.deviceKey, JSON.stringify({ token: 'trusted-fixture', name: 'factory-pc' }));
                    hashPin = async () => factoryHash;
                    window.__gpsCalls = 0;
                    getPosition = () => { window.__gpsCalls += 1; return Promise.reject(new Error('offline GPS')); };
                    document.body.classList.add('auth-locked');
                    document.getElementById('pinOverlay').classList.remove('authed');
                    const restored = await restoreAuthIfPossible();
                    await toggleDesktopAccessPanel();
                    const accessButton = document.getElementById('desktopAccessBtn');
                    const accessPanel = document.getElementById('desktopAccessPanel');
                    return {
                        restored,
                        locked: document.body.classList.contains('auth-locked'),
                        pinValue: document.getElementById('pinInput').value,
                        gpsCalls: window.__gpsCalls,
                        hashes,
                        exactPredicates: hashes.map(isPasswordlessTrustedDeviceHash),
                        accessButtonHidden: accessButton.hidden,
                        accessPanelHidden: accessPanel.hidden,
                        accessPanelClassHidden: accessPanel.classList.contains('hidden'),
                        accessBodyText: document.getElementById('desktopAccessBody').textContent,
                        registrationStatusDisplay: getComputedStyle(document.getElementById('registrationAccessStatus')).display,
                    };
                }""",
                "b102528da17d98d3c8879417170b85552ddbb4059bf2c4f0684801db3e0c4eb6",
            )
            assert trusted_auth["restored"] is True and trusted_auth["locked"] is False, trusted_auth
            assert trusted_auth["pinValue"] == "" and trusted_auth["gpsCalls"] == 0, trusted_auth
            assert trusted_auth["accessButtonHidden"] is True, trusted_auth
            assert trusted_auth["accessPanelHidden"] is True and trusted_auth["accessPanelClassHidden"] is True, trusted_auth
            assert trusted_auth["accessBodyText"] == "", trusted_auth
            assert trusted_auth["registrationStatusDisplay"] == "none", trusted_auth
            assert trusted_auth["hashes"] == [
                "20d3878e2c09054563c1008f264a1e04fffe6aa844de86304233f08b04764491",
                "b102528da17d98d3c8879417170b85552ddbb4059bf2c4f0684801db3e0c4eb6",
                "3478b8091ca76988cdc84079f963c4c224b1d440d2748439bf9ca0a61952c6d3",
            ] and all(trusted_auth["exactPredicates"]), trusted_auth

            unknown_auth = auth_page.evaluate(
                """async () => {
                    localStorage.setItem(AUTH_GEO.deviceKey, JSON.stringify({ token: 'unknown-fixture', name: 'factory-pc' }));
                    hashPin = async () => 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
                    window.__gpsCalls = 0;
                    document.body.classList.add('auth-locked');
                    document.getElementById('pinOverlay').classList.remove('authed');
                    const restored = await restoreAuthIfPossible();
                    return {
                        restored,
                        locked: document.body.classList.contains('auth-locked'),
                        activeId: document.activeElement?.id || '',
                        gpsCalls: window.__gpsCalls,
                        message: document.getElementById('pinError').textContent,
                    };
                }"""
            )
            assert unknown_auth["restored"] is False and unknown_auth["locked"] is True, unknown_auth
            assert unknown_auth["activeId"] == "pinInput" and unknown_auth["gpsCalls"] == 0, unknown_auth
            assert unknown_auth["message"] == "등록되지 않은 단말입니다. PIN을 입력하거나 관리자에게 등록을 요청해 주세요.", unknown_auth
            assert "GPS" not in unknown_auth["message"] and "단말ID" not in unknown_auth["message"], unknown_auth
            friendly_pin_failure = auth_page.evaluate(
                """async () => {
                    hashPin = async () => PIN_HASH;
                    verifyAuthFactor = async () => { throw new Error('DESKTOP_REGISTRATION_REQUIRED'); };
                    document.getElementById('pinInput').value = '0000';
                    await checkPin();
                    return document.getElementById('pinError').textContent;
                }"""
            )
            assert friendly_pin_failure == "이 단말은 아직 등록되지 않았습니다. 관리자에게 등록을 요청해 주세요.", friendly_pin_failure
            assert "GPS" not in friendly_pin_failure and "3478" not in friendly_pin_failure, friendly_pin_failure
            auth_page.close()

            registration_state = {"mode": "disabled", "window_gets": 0, "patches": [], "window_start": 0, "window_end": 0}

            def registration_route(route, request):
                now = int(time.time() * 1000)
                if "/registrationWindow.json" in request.url:
                    registration_state["window_gets"] += 1
                    mode = registration_state["mode"]
                    if mode == "network_fail":
                        route.abort()
                        return
                    active = {
                        "enabled": True,
                        "windowId": "window-active",
                        "startsAt": registration_state["window_start"] or now - 60_000,
                        "expiresAt": registration_state["window_end"] or now + 3_000_000,
                        "autoApprove": False,
                    }
                    if mode == "active":
                        body = active
                    elif mode == "disable_after_first" and registration_state["window_gets"] == 1:
                        body = active
                    elif mode == "expired":
                        body = {**active, "startsAt": now - 3_700_000, "expiresAt": now - 100_000}
                    else:
                        body = {**active, "enabled": False}
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
                    return
                if "/registrationCandidates/" in request.url:
                    if request.method == "GET":
                        route.fulfill(status=200, content_type="application/json", body="null")
                    elif request.method == "PATCH":
                        registration_state["patches"].append({"url": request.url, "body": json.loads(request.post_data or "{}")})
                        route.fulfill(status=200, content_type="application/json", body=request.post_data or "{}")
                    else:
                        route.fulfill(status=405, body="")
                    return
                route.fulfill(status=200, content_type="application/json", body="null")

            registration_page = browser.new_page(viewport={"width": 390, "height": 844})
            registration_page.route("**/*firebasedatabase.app/**", registration_route)
            registration_page.route(
                "https://api.ipify.org/**",
                lambda route: route.fulfill(status=200, content_type="application/json", body='{"ip":"203.0.113.9"}'),
            )
            registration_page.goto(origin, wait_until="domcontentloaded")
            registration_page.wait_for_timeout(50)

            def run_unknown_registration(mode, token, hash_value):
                registration_state["mode"] = mode
                registration_state["window_gets"] = 0
                now = int(time.time() * 1000)
                registration_state["window_start"] = now - 60_000
                registration_state["window_end"] = now + 3_000_000
                return registration_page.evaluate(
                    """async ({ token, hashValue }) => {
                        localStorage.setItem(AUTH_GEO.deviceKey, JSON.stringify({ token, name: 'factory-pc' }));
                        document.getElementById('deviceNameInput').value = 'factory-pc';
                        hashPin = async () => hashValue;
                        document.body.classList.add('auth-locked');
                        document.getElementById('pinOverlay').classList.remove('authed');
                        document.getElementById('registrationAccessStatus').hidden = true;
                        const restored = await restoreAuthIfPossible();
                        const status = document.getElementById('registrationAccessStatus');
                        return {
                            restored,
                            locked: document.body.classList.contains('auth-locked'),
                            statusHidden: status.hidden,
                            statusText: status.textContent,
                            statusTitle: status.title,
                            statusDisplay: getComputedStyle(status).display,
                        };
                    }""",
                    {"token": token, "hashValue": hash_value},
                )

            active_hash = "a" * 64
            before_patches = len(registration_state["patches"])
            active_registration = run_unknown_registration("active", "raw-token-must-not-leak", active_hash)
            assert active_registration == {
                "restored": True,
                "locked": False,
                "statusHidden": False,
                "statusText": "임시 접속",
                "statusTitle": "관리자가 허용한 임시 접속입니다.",
                "statusDisplay": "flex",
            }, active_registration
            assert len(registration_state["patches"]) == before_patches + 1, registration_state
            active_patch = registration_state["patches"][-1]
            assert f"/registrationCandidates/window-active/{active_hash}.json" in active_patch["url"], active_patch
            assert "raw-token-must-not-leak" not in json.dumps(active_patch["body"]), active_patch
            assert "token" not in active_patch["body"], active_patch
            assert active_patch["body"]["deviceHash"] == active_hash
            assert active_patch["body"]["deviceName"] == "factory-pc"
            assert active_patch["body"]["deviceNameTrust"] == "display_only"
            assert active_patch["body"]["autoApproved"] is False
            assert active_patch["body"]["publicIp"] == "203.0.113.9"
            assert active_patch["body"]["appVersion"] == "0717.0553"

            for mode, hash_char in (("expired", "b"), ("disabled", "c"), ("network_fail", "d"), ("disable_after_first", "e")):
                before_patches = len(registration_state["patches"])
                result = run_unknown_registration(mode, f"unknown-{mode}", hash_char * 64)
                assert result["restored"] is False and result["locked"] is True, (mode, result)
                assert result["statusHidden"] is True and result["statusDisplay"] == "none", (mode, result)
                assert len(registration_state["patches"]) == before_patches, (mode, registration_state)
            registration_page.close()

            browser.close()
    finally:
        server.shutdown()

    print("OrderHelper integrated Enter-confirmed browser regression OK")


if __name__ == "__main__":
    main()
