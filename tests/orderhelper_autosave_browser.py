#!/usr/bin/env python3
import http.server
import json
import socketserver
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_bytes()


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(HTML)))
        self.end_headers()
        self.wfile.write(HTML)

    def log_message(self, *_args):
        pass


def wait_for_count(page, rows, key, minimum):
    for _ in range(200):
        if sum(1 for row_key, _payload in rows if row_key == key) >= minimum:
            return
        page.wait_for_timeout(25)
    raise AssertionError(f"timed out waiting for {key} write #{minimum}")


def main():
    server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_address[1]}"
    remote = {"current": None, "history": None}
    writes = []

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context()
            page = context.new_page()

            def firebase_route(route, request):
                url = request.url
                if request.method == "PUT":
                    payload = json.loads(request.post_data or "null")
                    key = "current" if "/current.json" in url else "history"
                    remote[key] = payload
                    writes.append((key, payload))
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))
                    return
                if "/current.json" in url:
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(remote["current"]))
                    return
                route.fulfill(status=200, content_type="application/json", body="null")

            page.route("**/*firebasedatabase.app/**", firebase_route)
            page.goto(origin, wait_until="domcontentloaded")
            page.evaluate("startOrderHelperApp()")

            first = page.evaluate(
                """() => {
                    const input = document.querySelector('input.cell[data-field="stock"]');
                    input.value = '23.5';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    return { id: input.dataset.id, entryKey: input.dataset.entryKey };
                }"""
            )
            wait_for_count(page, writes, "current", 1)
            wait_for_count(page, writes, "history", 1)
            current_payload = [payload for key, payload in writes if key == "current"][-1]
            saved_entry = next(row for row in current_payload["entries"] if row["id"] == first["id"])
            assert saved_entry["stock"] == 23.5, "debounced PUT did not carry the typed stock"

            before_flush = sum(1 for key, _payload in writes if key == "current")
            page.evaluate(
                """() => {
                    const input = document.querySelector('input.cell[data-field="zone"]');
                    input.value = '긴급저장구역';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }"""
            )
            wait_for_count(page, writes, "current", before_flush + 1)
            current_payload = [payload for key, payload in writes if key == "current"][-1]
            saved_entry = next(row for row in current_payload["entries"] if row["id"] == first["id"])
            assert saved_entry["zone"] == "긴급저장구역", "change/flush PUT did not carry the typed zone"

            page.evaluate("localStorage.clear()")
            page.reload(wait_until="domcontentloaded")
            page.evaluate("startOrderHelperApp()")
            page.evaluate("document.activeElement?.blur()")
            page.wait_for_timeout(350)
            page.evaluate("autoLoadFromFB(false)")
            for _ in range(200):
                ready = page.evaluate(
                    """id => {
                        const row = entries.find(item => item.id === id);
                        return row?.stock === 23.5 && row?.zone === '긴급저장구역';
                    }""",
                    first["id"],
                )
                if ready:
                    break
                page.wait_for_timeout(25)
            restored = page.evaluate(
                """id => {
                    const row = entries.find(item => item.id === id);
                    return { stock: row.stock, zone: row.zone };
                }""",
                first["id"],
            )
            assert restored == {"stock": 23.5, "zone": "긴급저장구역"}, (
                f"GET reload did not restore the saved input: restored={restored}, "
                f"remote={next(row for row in remote['current']['entries'] if row['id'] == first['id'])}"
            )

            immediate_draft = page.evaluate(
                """() => {
                    window.requestAnimationFrame = () => 777;
                    window.cancelAnimationFrame = () => {};
                    const input = document.querySelector('input.cell[data-field="stock"]');
                    input.value = '31';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    const local = JSON.parse(localStorage.getItem('bbq_entries') || '[]');
                    return {
                        stock: local.find(row => row.id === input.dataset.id)?.stock,
                        pending: Number(localStorage.getItem('bbq_pending_sync_revision') || 0)
                    };
                }"""
            )
            assert immediate_draft["stock"] == 31, "input event must persist before deferred frame work"
            assert immediate_draft["pending"] > 0, "input event must leave a durable pending-sync marker"

            timeout_result = page.evaluate(
                """async () => {
                    const originalFetch = window.fetch;
                    window.fetch = (_url, options = {}) => new Promise((_resolve, reject) => {
                        options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
                    });
                    const started = performance.now();
                    let errorName = '';
                    try {
                        await putSaveTargets({ test: true }, '20260714', 50);
                    } catch (error) {
                        errorName = error.name;
                    } finally {
                        window.fetch = originalFetch;
                    }
                    return { elapsed: performance.now() - started, errorName };
                }"""
            )
            assert timeout_result["errorName"] == "AbortError", "stalled target must be aborted"
            assert timeout_result["elapsed"] < 500, "stalled target timeout must release promptly in the fixture"

            browser.close()
    finally:
        server.shutdown()

    print(
        "OrderHelper autosave browser regression OK "
        "(input -> debounce PUT, change flush PUT, reload GET restore, durable draft, stalled fetch abort)"
    )


if __name__ == "__main__":
    main()
