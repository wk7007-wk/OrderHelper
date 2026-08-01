#!/usr/bin/env python3
"""Fast, no-write mobile regression for the OrderHelper auth labels."""

import http.server
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


def main():
    server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    firebase_requests = []
    page_errors = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.on("pageerror", lambda error: page_errors.append(str(error)))

            def abort_firebase(route, request):
                firebase_requests.append({"method": request.method, "url": request.url})
                route.abort()

            page.route("**/*firebasedatabase.app/**", abort_firebase)
            page.goto(f"http://127.0.0.1:{server.server_address[1]}", wait_until="domcontentloaded")
            page.wait_for_timeout(150)
            auth = page.evaluate(
                """() => {
                    const inspect = (id, value) => {
                        const input = document.getElementById(id);
                        const label = document.querySelector(`label[for="${id}"]`);
                        input.value = value;
                        const rect = label?.getBoundingClientRect();
                        return {
                            value: input.value,
                            labelText: label?.textContent.trim(),
                            accessibleName: Array.from(input.labels || []).map(item => item.textContent.trim()).join(' '),
                            visible: !!rect && rect.width > 0 && rect.height > 0,
                            insideViewport: !!rect && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
                        };
                    };
                    return {
                        pin: inspect('pinInput', '1234'),
                        device: inspect('deviceNameInput', 'factory-pc'),
                        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
                        verticalOverflow: document.documentElement.scrollHeight > innerHeight,
                    };
                }"""
            )
            assert auth == {
                "pin": {"value": "1234", "labelText": "PIN 번호", "accessibleName": "PIN 번호", "visible": True, "insideViewport": True},
                "device": {"value": "factory-pc", "labelText": "단말 이름", "accessibleName": "단말 이름", "visible": True, "insideViewport": True},
                "horizontalOverflow": False,
                "verticalOverflow": False,
            }, auth
            page.locator("#pinInput").fill("")
            page.locator("#pinOverlay button").click()
            page.wait_for_function("document.getElementById('pinError').textContent.includes('비밀번호 틀림')")
            feedback = page.locator("#pinError").evaluate(
                """element => ({
                    role: element.getAttribute('role'),
                    live: element.getAttribute('aria-live'),
                    text: element.textContent,
                })"""
            )
            assert feedback == {"role": "status", "live": "polite", "text": "비밀번호 틀림 (1/5)"}, feedback
            firebase_write_count = sum(row["method"] not in {"GET", "OPTIONS"} for row in firebase_requests)
            assert firebase_write_count == 0, firebase_requests
            assert not page_errors, page_errors
            browser.close()
    finally:
        server.shutdown()

    print("OrderHelper no-write 390x844 auth-label browser regression OK")


if __name__ == "__main__":
    main()
