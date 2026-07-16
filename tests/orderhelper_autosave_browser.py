#!/usr/bin/env python3
import http.server
import json
import socketserver
import threading
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
            assert "1발주=10개" in factor_direction["chip"] and "1발주 = 재고/사용량 10개" in factor_direction["title"], "visible factor label must state 1 order equals 10 stock units"
            assert factor_direction["correction"]["orderUnitToStockFactor"] == 10
            assert factor_direction["correction"]["factorMeaning"] == "1발주 단위 = 재고/사용량 N개"

            fixture = page.evaluate(
                """() => {
                    const input = document.querySelector('input.cell[data-field="stock"]');
                    for (let value = 1; value <= 10; value += 1) {
                        input.value = String(value);
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    window.dispatchEvent(new Event('online'));
                    document.dispatchEvent(new Event('visibilitychange'));
                    const local = JSON.parse(localStorage.getItem('bbq_entries') || '[]');
                    return {
                        id: input.dataset.id,
                        itemKey: input.dataset.itemKey,
                        localStock: local.find(row => row.id === input.dataset.id)?.stock,
                        pending: Number(localStorage.getItem('bbq_pending_sync_revision') || 0),
                        status: document.getElementById('saveState').textContent
                    };
                }"""
            )
            page.wait_for_timeout(1600)
            assert writes == [], "ten draft stock inputs plus online/visibility must produce PUT 0"
            assert fixture["localStock"] == 10 and fixture["pending"] > 0
            assert fixture["status"] == "로컬 입력됨 · Enter 저장"

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

            browser.close()
    finally:
        server.shutdown()

    print("OrderHelper integrated Enter-confirmed browser regression OK")


if __name__ == "__main__":
    main()
