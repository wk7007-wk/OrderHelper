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
    writes = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()

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
            page.evaluate("startOrderHelperApp()")

            # A: repeated typing, slow pause, blur/change, online/visibility remain local-only.
            fixture = page.evaluate(
                """() => {
                    const input = document.querySelector('input.cell[data-field="stock"]');
                    for (let value = 1; value <= 10; value += 1) {
                        input.value = String(value);
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    window.dispatchEvent(new Event('online'));
                    document.dispatchEvent(new Event('visibilitychange'));
                    const local = JSON.parse(localStorage.getItem('bbq_entries') || '[]');
                    return {
                        id: input.dataset.id,
                        localStock: local.find(row => row.id === input.dataset.id)?.stock,
                        dirty: Number(localStorage.getItem('bbq_local_dirty_revision_v1') || 0),
                        status: document.getElementById('saveState').textContent
                    };
                }"""
            )
            page.wait_for_timeout(1600)
            assert writes == [], "ten stock inputs plus blur/online/visibility must produce PUT 0"
            assert fixture["localStock"] == 10 and fixture["dirty"] > 0
            assert fixture["status"] == "로컬 입력됨 · Enter 저장"

            # Draft-only reload must restore local 10 and still produce no remote write.
            page.reload(wait_until="domcontentloaded")
            page.evaluate("startOrderHelperApp(); document.activeElement?.blur()")
            page.wait_for_timeout(1200)
            draft_reload = page.evaluate("id => entries.find(row => row.id === id)?.stock", fixture["id"])
            assert draft_reload == 10, "draft-only reload must keep the latest local value"
            assert writes == [], "draft-only reload must produce PUT 0"

            # IME composing Enter and blur-only remain local-only.
            page.evaluate(
                """id => {
                    const input = Array.from(document.querySelectorAll('input.cell[data-field="stock"]')).find(row => row.dataset.id === id);
                    input.value = '11';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }""",
                fixture["id"],
            )
            page.wait_for_timeout(1100)
            assert writes == [], "IME Enter and blur-only must produce PUT 0"

            # B: Enter captures one immutable body and change after Enter does not duplicate it.
            page.evaluate(
                """id => {
                    const input = Array.from(document.querySelectorAll('input.cell[data-field="stock"]')).find(row => row.dataset.id === id);
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }""",
                fixture["id"],
            )
            wait_for_puts(page, writes, 2)
            page.wait_for_timeout(250)
            assert len(writes) == 2, "Enter followed by change must not duplicate PUTs"
            assert {row["kind"] for row in writes} == {"current", "history"}
            assert writes[0]["body"] == writes[1]["body"]
            entered_payload = json.loads(writes[0]["body"])
            assert next(row for row in entered_payload["entries"] if row["id"] == fixture["id"])["stock"] == 11

            # Zone and base-sales Enter also confirm; their blur/change alone remains local-only.
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

            # Explicit row action remains a confirmed action without waiting for debounce.
            before_action = len(writes)
            page.evaluate("id => addRow(id)", fixture["id"])
            wait_for_puts(page, writes, before_action + 2)

            # G: persisted confirmed pending resumes exact body on reload.
            page.evaluate(
                """id => {
                    const input = Array.from(document.querySelectorAll('input.cell[data-field="stock"]')).find(row => row.dataset.id === id);
                    input.value = '44';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    const commit = buildConfirmedSaveCommit('enter');
                    if (!writeConfirmedSaveQueue({ v: 1, active: commit, queued: null })) throw new Error('queue fixture write failed');
                    window.__pendingBody = commit.body;
                }""",
                fixture["id"],
            )
            pending_body = page.evaluate("window.__pendingBody")
            before_reload_pending = len(writes)
            page.reload(wait_until="domcontentloaded")
            page.evaluate("startOrderHelperApp(); document.activeElement?.blur()")
            wait_for_puts(page, writes, before_reload_pending + 2)
            resumed = writes[before_reload_pending:before_reload_pending + 2]
            assert resumed[0]["body"] == pending_body and resumed[1]["body"] == pending_body

            browser.close()
    finally:
        server.shutdown()

    print("OrderHelper live Enter-confirmed browser regression OK")


if __name__ == "__main__":
    main()
