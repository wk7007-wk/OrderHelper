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


def main():
    server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_address[1]}"
    external_writes = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 390, "height": 844})

            def firebase_route(route, request):
                cors = {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, PUT, PATCH, POST, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, If-Match, X-Firebase-ETag",
                    "Access-Control-Expose-Headers": "ETag",
                }
                if request.method not in {"GET", "OPTIONS"}:
                    external_writes.append({"method": request.method, "url": request.url})
                if request.method == "OPTIONS":
                    route.fulfill(status=204, headers=cors, body="")
                else:
                    route.fulfill(status=200, content_type="application/json", headers={**cors, "ETag": '"v0"'}, body="null")

            page.route("**/*firebasedatabase.app/**", firebase_route)
            page.goto(origin, wait_until="domcontentloaded")
            page.evaluate("startOrderHelperApp(); unlockOrderHelper(); document.activeElement?.blur()")

            result = page.evaluate(
                """async () => {
                    const waitFrames = (count = 4) => new Promise(resolve => {
                      const step = () => count-- <= 0 ? resolve() : requestAnimationFrame(step);
                      requestAnimationFrame(step);
                    });
                    const placeToggleNearBottom = toggle => {
                      const rect = toggle.getBoundingClientRect();
                      window.scrollBy(0, rect.bottom - (window.innerHeight - 12));
                    };
                    const metrics = (row, toggle) => {
                      const rowRect = row.getBoundingClientRect();
                      const toggleRect = toggle.getBoundingClientRect();
                      const header = document.querySelector('thead')?.getBoundingClientRect();
                      const headerVisible = header && header.bottom > 0 && header.top <= 1;
                      const safeTop = headerVisible ? Math.ceil(header.bottom + 4) : 4;
                      const safeBottom = window.innerHeight - 4;
                      const wrap = document.querySelector('.table-wrap');
                      return {
                        rowTop: rowRect.top,
                        rowBottom: rowRect.bottom,
                        rowHeight: rowRect.height,
                        toggleTop: toggleRect.top,
                        toggleBottom: toggleRect.bottom,
                        toggleHeight: toggleRect.height,
                        safeTop,
                        safeBottom,
                        usableHeight: safeBottom - safeTop,
                        toggleVisible: toggleRect.bottom > safeTop && toggleRect.top < safeBottom,
                        rowIntersects: rowRect.bottom > safeTop && rowRect.top < safeBottom,
                        scrollX: window.scrollX,
                        documentScrollLeft: document.documentElement.scrollLeft,
                        bodyScrollLeft: document.body.scrollLeft,
                        wrapOverflow: wrap.scrollWidth - wrap.clientWidth,
                      };
                    };
                    const exercise = async (row, makeTall) => {
                      const toggle = row.querySelector('[data-grid-action="mobile-toggle"]');
                      if (makeTall) {
                        const detail = document.createElement('div');
                        detail.className = 'inline-site-match';
                        detail.innerHTML = '<div style="height:1000px" aria-hidden="true"></div>';
                        row.querySelector('[data-column="name"]').appendChild(detail);
                      }
                      placeToggleNearBottom(toggle);
                      await waitFrames(1);
                      const before = metrics(row, toggle);
                      toggle.click();
                      await waitFrames();
                      const expanded = metrics(row, toggle);
                      toggle.click();
                      await waitFrames();
                      const collapsed = metrics(row, toggle);
                      return { before, expanded, collapsed };
                    };

                    const rows = Array.from(document.querySelectorAll('#tbody tr[data-entry-key]'));
                    const small = await exercise(rows[Math.min(5, rows.length - 1)], false);
                    const tall = await exercise(rows[Math.min(9, rows.length - 1)], true);
                    return { small, tall };
                }"""
            )

            for scenario_name in ("small", "tall"):
                scenario = result[scenario_name]
                before = scenario["before"]
                expanded = scenario["expanded"]
                collapsed = scenario["collapsed"]
                assert before["toggleVisible"], (scenario_name, scenario)
                assert expanded["toggleVisible"] and expanded["rowIntersects"], (scenario_name, scenario)
                assert expanded["scrollX"] == 0 and expanded["documentScrollLeft"] == 0 and expanded["bodyScrollLeft"] == 0, (scenario_name, scenario)
                assert expanded["wrapOverflow"] <= 1, (scenario_name, scenario)
                assert abs(expanded["toggleTop"] - before["toggleTop"]) <= before["safeBottom"] - before["safeTop"] + 1, (scenario_name, scenario)
                assert collapsed["toggleVisible"] and collapsed["rowIntersects"], (scenario_name, scenario)
                assert abs(collapsed["toggleTop"] - expanded["toggleTop"]) <= 2, (scenario_name, scenario)

            small = result["small"]["expanded"]
            assert small["rowHeight"] <= small["usableHeight"], result["small"]
            assert small["rowTop"] >= small["safeTop"] - 1 and small["rowBottom"] <= small["safeBottom"] + 1, result["small"]

            tall = result["tall"]["expanded"]
            assert tall["rowHeight"] > tall["usableHeight"], result["tall"]
            assert abs(tall["rowTop"] - tall["safeTop"]) <= 2, result["tall"]
            assert external_writes == [], external_writes
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
