#!/usr/bin/env python3
"""No-write browser contrast gate for OrderHelper's locked-screen action."""

import http.server
import socketserver
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright


HTML = (Path(__file__).resolve().parents[1] / "index.html").read_bytes()
VIEWPORTS = ({"width": 390, "height": 844}, {"width": 1280, "height": 900})


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(HTML)))
        self.end_headers()
        self.wfile.write(HTML)

    def log_message(self, *_args):
        pass


def contrast_sample(button, state):
    return button.evaluate(
        """(element, state) => {
          const channels = color => color.match(/[\\d.]+/g).map(Number).slice(0, 3);
          const luminance = color => channels(color)
            .map(value => {
              value /= 255;
              return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
            })
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
          const style = getComputedStyle(element);
          const foreground = luminance(style.color);
          const background = luminance(style.backgroundColor);
          const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
          const rect = element.getBoundingClientRect();
          return {
            state,
            color: style.color,
            background: style.backgroundColor,
            opacity: style.opacity,
            ratio,
            disabled: element.disabled,
            focusVisible: element.matches(':focus-visible'),
            visible: rect.width > 0 && rect.height > 0,
            insideViewport: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
          };
        }""",
        state,
    )


def main():
    server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            for viewport in VIEWPORTS:
                page = browser.new_page(viewport=viewport)
                requests = []
                page_errors = []
                page.on("request", lambda request: requests.append({"method": request.method, "url": request.url}))
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                page.route("**/*firebasedatabase.app/**", lambda route: route.abort())
                page.goto(f"http://127.0.0.1:{server.server_address[1]}", wait_until="domcontentloaded")
                page.wait_for_timeout(150)

                button = page.locator("#pinOverlay button")
                samples = [contrast_sample(button, "normal")]
                button.hover()
                samples.append(contrast_sample(button, "hover"))
                button.focus()
                samples.append(contrast_sample(button, "focus"))
                assert samples[-1]["focusVisible"] is True, samples[-1]
                button.evaluate("element => { element.disabled = true; }")
                samples.append(contrast_sample(button, "disabled"))

                for sample in samples:
                    assert sample["color"] == "rgb(255, 255, 255)", sample
                    assert sample["background"] == "rgb(201, 54, 83)", sample
                    assert sample["opacity"] == "1", sample
                    assert sample["ratio"] >= 5.0, sample
                    assert sample["visible"] is True and sample["insideViewport"] is True, sample

                button.evaluate("element => { element.disabled = false; }")
                page.locator("#pinOverlay").evaluate(
                    """overlay => {
                      const fixtures = document.createElement('div');
                      fixtures.id = 'contrastFixtures';
                      fixtures.style.cssText = 'position:fixed;left:4px;top:4px;z-index:10001;display:flex;gap:4px;align-items:center';
                      fixtures.innerHTML = `
                        <span class="badge" data-surface="badge">발주 1개</span>
                        <div class="top"><button class="primary" data-surface="top-primary">저장</button></div>
                        <button class="sfa-tab active" data-surface="sfa-active">발주 누락</button>
                        <div class="snooze-actions"><button class="primary" data-surface="snooze-primary">적용</button></div>`;
                      overlay.appendChild(fixtures);
                    }"""
                )
                for surface in ("badge", "top-primary", "sfa-active", "snooze-primary"):
                    control = page.locator(f'[data-surface="{surface}"]')
                    surface_samples = [contrast_sample(control, f"{surface}-normal")]
                    if surface != "badge":
                        control.hover()
                        surface_samples.append(contrast_sample(control, f"{surface}-hover"))
                        control.focus()
                        surface_samples.append(contrast_sample(control, f"{surface}-focus"))
                        control.evaluate("element => { element.disabled = true; }")
                        surface_samples.append(contrast_sample(control, f"{surface}-disabled"))
                    for sample in surface_samples:
                        assert sample["color"] == "rgb(255, 255, 255)", sample
                        assert sample["background"] == "rgb(201, 54, 83)", sample
                        assert sample["opacity"] == "1", sample
                        assert sample["ratio"] >= 5.0, sample
                    if surface != "badge":
                        control.evaluate("element => { element.disabled = false; }")
                page.locator("#contrastFixtures").evaluate("element => element.remove()")

                page.locator("#pinInput").fill("")
                button.click()
                page.wait_for_function("document.getElementById('pinError').textContent.includes('비밀번호 틀림')")
                assert page.locator("#pinError").inner_text() == "비밀번호 틀림 (1/5)"
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth") is True
                assert not [request for request in requests if request["method"] != "GET"], requests
                assert not page_errors, page_errors
                page.close()
            browser.close()
    finally:
        server.shutdown()

    print("PASS OrderHelper no-write locked-action contrast browser")


if __name__ == "__main__":
    main()
