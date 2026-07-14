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
    writes = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 390, "height": 844})

            def firebase_route(route, request):
                if request.method == "PUT":
                    body = request.post_data or ""
                    kind = "current" if "/current.json" in request.url else "history"
                    remote[kind] = json.loads(body)
                    writes.append({"kind": kind, "url": request.url, "body": body})
                    route.fulfill(status=200, content_type="application/json", body=body)
                elif "/current.json" in request.url:
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(remote["current"]))
                else:
                    route.fulfill(status=200, content_type="application/json", body="null")

            page.route("**/*firebasedatabase.app/**", firebase_route)
            page.goto(origin, wait_until="domcontentloaded")
            show_alias_review(page)
            page.wait_for_timeout(1200)
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
            assert fixture["buttonText"] == "별명 생성"

            page.evaluate(
                "document.querySelector('.sfa-alias-new-button').click()"
            )
            wait_for_writes(page, writes, 2)
            assert {row["kind"] for row in writes[:2]} == {"current", "history"}
            assert writes[0]["body"] == writes[1]["body"]
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
            enter_payload = json.loads(enter_pair[0]["body"])
            assert enter_payload["orderAliasMappings"][second]["actualName"] == "두번째 임의 별명 Enter"
            assert enter_payload["orderAliasMappings"][second]["status"] == "manual"

            browser.close()
    finally:
        server.shutdown()

    print("OrderHelper arbitrary alias save browser regression OK")


if __name__ == "__main__":
    main()
