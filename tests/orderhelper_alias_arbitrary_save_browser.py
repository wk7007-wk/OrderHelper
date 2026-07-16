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


def wait_for_writes(page, writes, count):
    for _ in range(240):
        if len(writes) >= count:
            return
        page.wait_for_timeout(25)
    state = page.evaluate(
        """() => ({
            saveState: document.getElementById('saveState')?.textContent,
            queue: localStorage.getItem('bbq_confirmed_save_queue_v1'),
            mappings: orderAliasMappings,
        })"""
    )
    raise AssertionError(f"timed out waiting for PUT #{count}: writes={writes}, state={state}")


def show_alias_review(page):
    page.evaluate(
        """() => {
            startOrderHelperApp();
            document.body.classList.remove('auth-locked');
            document.getElementById('pinOverlay').classList.add('authed');
            document.getElementById('sfaComparePanel').classList.remove('hidden');
            sfaCompareVisible = true;
            setSfaAnalysisTab('alias');
        }"""
    )


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
            page = browser.new_page(viewport={"width": 390, "height": 844})

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
                    writes.append({"kind": kind, "url": request.url, "body": body, "if_match": request.headers.get("if-match")})
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
            show_alias_review(page)
            page.wait_for_timeout(1200)
            show_alias_review(page)

            resolver_probe = page.evaluate(
                """async () => {
                    const target = MASTER.find(item => item.name === '물티슈(500)') || MASTER[0];
                    const originalResolver = resolveUnifiedOrderRows;
                    let resolverCalls = 0;
                    resolveUnifiedOrderRows = (...args) => {
                        resolverCalls += 1;
                        return originalResolver(...args);
                    };
                    orderAliasMappings = {};
                    orderSiteMappings = {};
                    const unrelated = MASTER.find(item => item.name !== target.name) || target;
                    lastSfaCompareData = {
                        ok: true,
                        runId: 'browser-exact-mapped-name',
                        savedAt: Date.now(),
                        items: [{ row_index: 99, name: '브라우저 관계없는 원명', qty: 1, amount: 100, unit: 'EA', mappedName: unrelated.name }],
                        comparison: { matched: [{ row_index: 71, sfa_name: '브라우저 실발주 원명', sfa_qty: 5, sfa_amount: 12000, sfa_unit: 'BOX', expected_name: target.name }], missing: [], extra: [] },
                    };
                    render();
                    const firstRenderCalls = resolverCalls;
                    const candidateRow = Array.from(document.querySelectorAll('tr[data-item-key]')).find(tr => tr.dataset.itemKey === itemKeyForName(target.name));
                    const candidateAmount = candidateRow?.querySelector('.order-amount');
                    const candidateAmountText = candidateAmount?.textContent || '';
                    const candidateAmountTitle = candidateAmount?.title || '';
                    const afterCandidateAliasCount = Object.keys(orderAliasMappings).length;
                    orderAliasMappings = {
                        [target.name]: {
                            aliasName: target.name,
                            actualName: '브라우저 과거 저장 별명',
                            actualUnit: 'BOX',
                            status: 'confirmed',
                            source: 'user',
                        },
                    };
                    render();
                    const secondRenderCalls = resolverCalls - firstRenderCalls;
                    const staleRow = Array.from(document.querySelectorAll('tr[data-item-key]')).find(tr => tr.dataset.itemKey === itemKeyForName(target.name));
                    const staleAmount = staleRow?.querySelector('.order-amount');
                    const staleAmountText = staleAmount?.textContent || '';
                    const staleAmountTitle = staleAmount?.title || '';
                    const beforeNoIndexRender = resolverCalls;
                    lastSfaCompareData = {
                        ok: true,
                        runId: 'browser-no-row-index',
                        savedAt: Date.now(),
                        items: [{ name: '브라우저 row index 없는 원명', qty: null, amount: ' ', unit: 'BOX', mappedName: target.name }],
                        comparison: { matched: [{ sfa_name: '브라우저 row index 없는 원명', sfa_qty: 5, sfa_amount: 12000, sfa_unit: 'BOX', expected_name: target.name }], missing: [], extra: [] },
                    };
                    render();
                    const noIndexRenderCalls = resolverCalls - beforeNoIndexRender;
                    const noIndexRow = Array.from(document.querySelectorAll('tr[data-item-key]')).find(tr => tr.dataset.itemKey === itemKeyForName(target.name));
                    const noIndexAmount = noIndexRow?.querySelector('.order-amount');
                    const noIndexAmountText = noIndexAmount?.textContent || '';
                    const noIndexAmountTitle = noIndexAmount?.title || '';
                    const staleAliasPreserved = orderAliasMappings[target.name]?.actualName || '';
                    resolverCalls = 0;
                    const stockInput = noIndexRow?.querySelector('input.cell[data-field="stock"]');
                    for (let index = 0; index < 150; index += 1) {
                        stockInput.value = index === 149 ? '0' : String(index % 2);
                        stockInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    const days = parseInt(document.getElementById('orderDays').value);
                    const expectedNeed = calcG(target, days);
                    const expectedOrder = expectedNeed > 0 ? displayOrderQty(target, days) : '';
                    const burstRow = Array.from(document.querySelectorAll('tr[data-item-key]')).find(tr => tr.dataset.itemKey === itemKeyForName(target.name));
                    const immediateNeed = burstRow?.querySelector('.need-output-value')?.textContent || '';
                    const immediateOrder = burstRow?.querySelector('.output-order-value')?.textContent || '';
                    const burstResolverCallsBeforeFrame = resolverCalls;
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    const burstResolverCallsAfterFrame = resolverCalls;
                    orderAliasMappings = {};
                    resolveUnifiedOrderRows = originalResolver;
                    return {
                        firstRenderCalls,
                        secondRenderCalls,
                        candidateAmountText,
                        candidateAmountTitle,
                        staleAmountText,
                        staleAmountTitle,
                        noIndexRenderCalls,
                        noIndexAmountText,
                        noIndexAmountTitle,
                        staleAliasPreserved,
                        afterCandidateAliasCount,
                        burstResolverCallsBeforeFrame,
                        burstResolverCallsAfterFrame,
                        immediateNeed,
                        immediateOrder,
                        expectedNeedText: expectedNeed > 0 ? displayDecimal(expectedNeed) : '',
                        expectedOrder,
                    };
                }"""
            )
            assert resolver_probe["firstRenderCalls"] == 1 and resolver_probe["secondRenderCalls"] == 1, f"each render must call the full resolver once: {resolver_probe}"
            assert resolver_probe["noIndexRenderCalls"] == 1, f"row-index-free browser render must still resolve once: {resolver_probe}"
            for field in ("candidateAmountText", "staleAmountText", "noIndexAmountText"):
                assert "1발주 2,400원" in resolver_probe[field] and "최신 엑셀 기준" in resolver_probe[field], resolver_probe
                assert all(term not in resolver_probe[field] for term in ("실발주", "가격출처", "미저장", "금액÷수량", "가격 미해결")), resolver_probe
            for field in ("candidateAmountTitle", "staleAmountTitle", "noIndexAmountTitle"):
                assert "실발주 5BOX" in resolver_probe[field], resolver_probe
                assert "가격출처 최신 엑셀 정확매칭 후보(미저장)·금액÷수량" in resolver_probe[field], resolver_probe
            assert resolver_probe["afterCandidateAliasCount"] == 0, "exact mappedName price evidence must not save an alias"
            assert resolver_probe["staleAliasPreserved"] == "브라우저 과거 저장 별명", "stale saved alias must remain user-owned while mappedName recovers price"
            assert resolver_probe["burstResolverCallsBeforeFrame"] == 0, f"150 stock inputs must not run price resolver synchronously: {resolver_probe}"
            assert resolver_probe["burstResolverCallsAfterFrame"] == 0, f"draft stock typing must not run the full price resolver before completion: {resolver_probe}"
            assert resolver_probe["immediateNeed"] == resolver_probe["expectedNeedText"], f"need must patch immediately: {resolver_probe}"
            assert resolver_probe["immediateOrder"] == resolver_probe["expectedOrder"], f"order quantity must patch immediately: {resolver_probe}"
            show_alias_review(page)

            fixture = page.evaluate(
                """() => {
                    const input = document.querySelector('.sfa-alias-new-input');
                    const wrap = input.closest('.sfa-alias-new-fields');
                    const unit = wrap.querySelector('.sfa-alias-new-unit');
                    input.value = '임의 별명 브라우저 테스트';
                    unit.value = 'BOX임의';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    input.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Enter', keyCode: 229, isComposing: true, bubbles: true
                    }));
                    return {
                        aliasName: input.dataset.aliasName,
                        fieldWidth: Math.round(input.getBoundingClientRect().width),
                        buttonText: wrap.querySelector('.sfa-alias-new-button').textContent.trim()
                    };
                }"""
            )
            page.wait_for_timeout(250)
            assert writes == [], "typing, blur/change, and IME Enter must produce PUT 0"
            assert fixture["fieldWidth"] > 100, f"390px mobile alias input must remain usable: {fixture}"
            assert fixture["buttonText"] == "이 이름으로 확정"

            page.evaluate(
                "document.querySelector('.sfa-alias-new-button').click()"
            )
            wait_for_writes(page, writes, 2)
            assert {row["kind"] for row in writes[:2]} == {"current", "history"}
            assert writes[0]["body"] == writes[1]["body"]
            assert {row["if_match"] for row in writes[:2]} == {'"v0"'}, "alias pair must use the ETag returned by each target read"
            payload = json.loads(writes[0]["body"])
            saved = payload["orderAliasMappings"][fixture["aliasName"]]
            assert saved["actualName"] == "임의 별명 브라우저 테스트"
            assert saved["actualUnit"] == "BOX임의"
            assert saved["status"] == "manual"

            # Reload must hydrate the same arbitrary alias from local/confirmed current state.
            page.reload(wait_until="domcontentloaded")
            show_alias_review(page)
            reloaded = page.evaluate(
                "aliasName => ({ state: orderAliasMappings[aliasName], selected: document.querySelector(`[data-alias-name=\"${CSS.escape(aliasName)}\"].sfa-alias-select`)?.value })",
                fixture["aliasName"],
            )
            assert reloaded["state"]["actualName"] == "임의 별명 브라우저 테스트"
            assert reloaded["state"]["status"] == "manual"
            assert reloaded["selected"] == "임의 별명 브라우저 테스트"

            # A real Enter on another row is also an explicit confirmed action.
            before_enter = len(writes)
            second = page.evaluate(
                """() => {
                    const inputs = Array.from(document.querySelectorAll('.sfa-alias-new-input'));
                    const input = inputs.find(row => row.dataset.aliasName !== Object.keys(orderAliasMappings)[0]);
                    input.value = '두번째 임의 별명 Enter';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                    return input.dataset.aliasName;
                }"""
            )
            wait_for_writes(page, writes, before_enter + 2)
            enter_pair = writes[before_enter : before_enter + 2]
            assert enter_pair[0]["body"] == enter_pair[1]["body"]
            assert {row["if_match"] for row in enter_pair} == {'"v1"'}, "second alias pair must advance the target ETags"
            enter_payload = json.loads(enter_pair[0]["body"])
            assert enter_payload["orderAliasMappings"][second]["actualName"] == "두번째 임의 별명 Enter"
            assert enter_payload["orderAliasMappings"][second]["status"] == "manual"

            # An explicit "연결 안 함" is a durable user choice, not a blank/reset.
            before_unlink = len(writes)
            unlink_state = page.evaluate(
                """aliasName => {
                    const select = document.querySelector(`[data-alias-name="${CSS.escape(aliasName)}"].sfa-alias-select`);
                    select.value = ORDER_ALIAS_UNLINKED_VALUE;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    const draft = orderAliasMappingDraftsForPayload(lastSfaCompareData)
                        .find(row => row.aliasName === aliasName);
                    return {
                        raw: orderAliasMappings[aliasName],
                        selected: document.querySelector(`[data-alias-name="${CSS.escape(aliasName)}"].sfa-alias-select`)?.value,
                        statusText: document.querySelector(`[data-alias-name="${CSS.escape(aliasName)}"].sfa-alias-select`)
                            ?.closest('.sfa-match-row')?.querySelector('.sfa-match-status')?.textContent.trim(),
                        effective: effectiveOrderAliasMappingsForPayload(lastSfaCompareData)[aliasName] || null,
                        draft,
                    };
                }""",
                fixture["aliasName"],
            )
            wait_for_writes(page, writes, before_unlink + 2)
            unlink_pair = writes[before_unlink : before_unlink + 2]
            assert unlink_pair[0]["body"] == unlink_pair[1]["body"]
            assert {row["if_match"] for row in unlink_pair} == {'"v2"'}, "unlink pair must advance both target ETags"
            unlink_payload = json.loads(unlink_pair[0]["body"])
            unlinked = unlink_payload["orderAliasMappings"][fixture["aliasName"]]
            assert unlinked["status"] == "unlinked"
            assert unlinked["actualName"] == ""
            assert fixture["aliasName"] not in unlink_payload["effectiveOrderAliasMappings"]
            unlink_draft = next(row for row in unlink_payload["orderAliasMappingDrafts"] if row["aliasName"] == fixture["aliasName"])
            assert unlink_draft["status"] == "unlinked"
            assert unlink_draft["actualCandidates"] == []
            assert unlink_state["raw"]["status"] == "unlinked"
            assert unlink_state["selected"] == "__ORDERHELPER_UNLINKED__"
            assert unlink_state["statusText"] == "연결 안 함"
            assert unlink_state["effective"] is None

            page.reload(wait_until="domcontentloaded")
            show_alias_review(page)
            reloaded_unlink = page.evaluate(
                """aliasName => ({
                    raw: orderAliasMappings[aliasName],
                    selected: document.querySelector(`[data-alias-name="${CSS.escape(aliasName)}"].sfa-alias-select`)?.value,
                    statusText: document.querySelector(`[data-alias-name="${CSS.escape(aliasName)}"].sfa-alias-select`)
                        ?.closest('.sfa-match-row')?.querySelector('.sfa-match-status')?.textContent.trim(),
                    effective: effectiveOrderAliasMappingsForPayload(lastSfaCompareData)[aliasName] || null,
                })""",
                fixture["aliasName"],
            )
            assert reloaded_unlink["raw"]["status"] == "unlinked"
            assert reloaded_unlink["selected"] == "__ORDERHELPER_UNLINKED__"
            assert reloaded_unlink["statusText"] == "연결 안 함"
            assert reloaded_unlink["effective"] is None

            browser.close()
    finally:
        server.shutdown()

    print("OrderHelper arbitrary alias save browser regression OK")


if __name__ == "__main__":
    main()
