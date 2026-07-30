#!/usr/bin/env python3
"""Local-only browser gate for the OrderHelper v2 shell/model contract."""

import contextlib
import http.server
import socketserver
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *_args):
        pass


class ReusableServer(socketserver.TCPServer):
    allow_reuse_address = True


def layout_snapshot(page):
    return page.evaluate(
        """() => {
          const rows = Array.from(document.querySelectorAll('#orderRowsMount tr[data-item-key]'));
          const first = rows[0];
          return {
            width: window.innerWidth,
            rows: rows.length,
            headerCells: document.querySelectorAll('#orderGrid thead th').length,
            firstRowCells: first ? first.children.length : 0,
            firstHeaderDisplay: first ? getComputedStyle(first.children[0]).display : null,
            firstDataDisplay: first ? getComputedStyle(first.children[1]).display : null,
            documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
            bodyOverflow: document.body.scrollWidth - window.innerWidth,
            tableOverflow: document.querySelector('.table-frame').scrollWidth
              - document.querySelector('.table-frame').clientWidth,
          };
        }"""
    )


def wait_animation_frame(page):
    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => resolve()))")


def assert_corrupt_storage_fails_closed(browser, origin, storage_key):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    page_errors = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.goto(f"{origin}/v2/index.html", wait_until="load")
    page.evaluate(
        "([key, raw]) => localStorage.setItem(key, raw)",
        [storage_key, "{malformed-bootstrap"],
    )
    storage_before = page.evaluate("Object.fromEntries(Object.entries(localStorage))")
    page.reload(wait_until="load")
    page.wait_for_function("document.body.dataset.runtimeState === 'blocked'", timeout=3_000)
    controls = page.locator(
        "#orderGrid input[data-field], #baseSales, #dailySalesControls input, #orderDays, [data-action='toggle-hidden']"
    )
    assert controls.count() > 0
    assert controls.evaluate_all("elements => elements.every(element => element.disabled)")
    assert "입력 및 저장 중지" in page.locator("#syncStatus").inner_text()
    assert page.evaluate("key => localStorage.getItem(key)", storage_key) == "{malformed-bootstrap"
    assert page.evaluate("Object.fromEntries(Object.entries(localStorage))") == storage_before
    controls.first.evaluate(
        "element => { element.value = '99'; element.dispatchEvent(new Event('input', { bubbles: true })); }"
    )
    assert page.evaluate("Object.fromEntries(Object.entries(localStorage))") == storage_before
    assert page_errors == [], page_errors
    context.close()


def main():
    server = ReusableServer(("127.0.0.1", 0), QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_address[1]}"
    external_requests = []
    page_errors = []

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            assert_corrupt_storage_fails_closed(browser, origin, "orderhelper_v2_draft_v1")
            assert_corrupt_storage_fails_closed(browser, origin, "orderhelper_v2_outbox_v1")
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            page.on(
                "request",
                lambda request: external_requests.append(request.url)
                if not request.url.startswith(origin)
                else None,
            )
            page.goto(f"{origin}/v2/index.html", wait_until="load")

            page.wait_for_function(
                "document.querySelectorAll('#orderRowsMount tr[data-item-key]').length === 88",
                timeout=3_000,
            )
            desktop = layout_snapshot(page)
            assert desktop["rows"] == 88, desktop
            assert desktop["headerCells"] == desktop["firstRowCells"] == 11, desktop
            assert desktop["firstHeaderDisplay"] == "table-cell", desktop
            assert desktop["firstDataDisplay"] == "table-cell", desktop
            assert desktop["documentOverflow"] <= 1, desktop
            assert desktop["bodyOverflow"] <= 1, desktop
            assert desktop["tableOverflow"] <= 1, desktop

            first_row = page.locator("#orderRowsMount tr[data-item-key]").first
            first_item_key = first_row.get_attribute("data-item-key")
            first_zone = first_row.locator(".zone-input")
            first_stock = first_row.locator(".stock-input")
            first_need = first_row.locator('[data-output="stockNeed"]')
            second_stock = page.locator("#orderRowsMount .stock-input").nth(1)

            page.locator("#orderDays").select_option("3")
            first_zone.fill("주방")
            first_stock.fill("1")
            assert first_zone.input_value() == "주방"
            assert first_stock.input_value() == "1"
            assert first_need.inner_text() == "4.2"

            day1 = page.locator("#salesDay1")
            burst = page.evaluate(
                """async () => {
                  const input = document.querySelector('#salesDay1');
                  const output = document.querySelector('#orderRowsMount tr[data-item-key] [data-output="stockNeed"]');
                  let mutations = 0;
                  const observer = new MutationObserver(records => { mutations += records.length; });
                  observer.observe(output, { childList: true, characterData: true, subtree: true });
                  input.focus();
                  for (const value of ['5', '56', '560']) {
                    input.value = value;
                    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value.slice(-1) }));
                  }
                  await new Promise(resolve => requestAnimationFrame(() => resolve()));
                  await Promise.resolve();
                  observer.disconnect();
                  return { mutations, need: output.textContent, active: document.activeElement === input };
                }"""
            )
            assert burst["mutations"] <= 1, burst
            assert burst["need"] == "4.7" and burst["active"] is True, burst

            completion = page.evaluate(
                """() => {
                  const input = document.querySelector('#salesDay1');
                  input.value = '0';
                  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '0' }));
                  input.dispatchEvent(new Event('change', { bubbles: true }));
                  const outbox = JSON.parse(localStorage.getItem('orderhelper_v2_outbox_v1'));
                  const confirmed = [outbox.active, outbox.queued].filter(Boolean).some(intent => {
                    const register = intent.document.collections.sales['day-1']?.amount;
                    return register && register.value === '0';
                  });
                  return {
                    confirmed,
                    need: document.querySelector('#orderRowsMount tr[data-item-key] [data-output="stockNeed"]').textContent
                  };
                }"""
            )
            assert completion == {"confirmed": True, "need": "3.7"}, completion

            composition = page.evaluate(
                """async () => {
                  const input = document.querySelector('#salesDay1');
                  const output = document.querySelector('#orderRowsMount tr[data-item-key] [data-output="stockNeed"]');
                  input.value = '560';
                  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '560', isComposing: true }));
                  await new Promise(resolve => requestAnimationFrame(() => resolve()));
                  const during = output.textContent;
                  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '560' }));
                  await new Promise(resolve => requestAnimationFrame(() => resolve()));
                  return { during, after: output.textContent, active: document.activeElement === input };
                }"""
            )
            assert composition == {"during": "3.7", "after": "4.7", "active": True}, composition

            day1.fill("")
            day1.press_sequentially("560", delay=8)
            wait_animation_frame(page)
            caret = day1.evaluate(
                "element => ({active: element === document.activeElement, start: element.selectionStart, end: element.selectionEnd})"
            )
            assert caret["active"] is True, caret
            assert first_need.inner_text() == "4.7", "day-1 560 must update visible resolver output"
            day1.fill("0")
            wait_animation_frame(page)
            assert first_need.inner_text() == "3.7", "explicit zero must differ from blank"
            day1.fill("")
            wait_animation_frame(page)
            assert first_need.inner_text() == "4.2", "blank must restore weight one"

            for day in (2, 3):
                sales_input = page.locator(f"#salesDay{day}")
                sales_input.fill("560")
                wait_animation_frame(page)
                assert first_need.inner_text() == "4.7", f"day-{day} must update resolver"
                sales_input.fill("")
                wait_animation_frame(page)
                assert first_need.inner_text() == "4.2"

            page.locator("#orderDays").select_option("4")
            assert first_need.inner_text() == "4.7"
            page.locator("#salesDay4").fill("560")
            wait_animation_frame(page)
            assert first_need.inner_text() == "5.2", "day-4 must update the four-day resolver"
            page.locator("#salesDay4").fill("")
            wait_animation_frame(page)
            page.locator("#orderDays").select_option("3")

            day1.fill("560")
            wait_animation_frame(page)
            assert first_need.inner_text() == "4.7"
            page.locator("#baseSales").fill("560")
            wait_animation_frame(page)
            assert first_need.inner_text() == "4.2", "base sales must update the same resolver"
            page.locator("#baseSales").fill("280")
            wait_animation_frame(page)
            day1.fill("0")
            day1.press("Tab")
            assert first_need.inner_text() == "3.7"

            first_stock.fill("")
            first_stock.press_sequentially("12.5", delay=8)
            stock_caret = first_stock.evaluate(
                "element => ({active: element === document.activeElement, start: element.selectionStart, end: element.selectionEnd})"
            )
            assert stock_caret == {"active": True, "start": 4, "end": 4}, stock_caret
            first_stock.fill("1")

            first_stock.press("Enter")
            assert second_stock.evaluate("element => element === document.activeElement")

            page.locator("#sfaOrderButton").click()
            assert page.locator("#sfaOrderButton").get_attribute("aria-pressed") == "true"
            assert page.locator("#inputOrderButton").get_attribute("aria-pressed") == "false"
            assert page.locator("#orderRowsMount .item-name").first.inner_text() == "(신)올리브오일"
            reordered_first = page.locator("#orderRowsMount tr[data-item-key]").first
            assert reordered_first.locator(".zone-input").input_value() == "주방"
            assert reordered_first.locator(".stock-input").input_value() == "1"

            need_before_reload = reordered_first.locator('[data-output="stockNeed"]').inner_text()
            page.reload(wait_until="load")
            page.wait_for_function(
                "document.querySelectorAll('#orderRowsMount tr[data-item-key]').length === 88",
                timeout=3_000,
            )
            hydrated_first = page.locator(f'#orderRowsMount tr[data-item-key="{first_item_key}"]')
            assert page.locator("#baseSales").input_value() == "280"
            assert page.locator("#salesDay1").input_value() == "0"
            assert hydrated_first.locator(".zone-input").input_value() == "주방"
            assert hydrated_first.locator(".stock-input").input_value() == "1"
            assert hydrated_first.locator('[data-output="stockNeed"]').inner_text() == need_before_reload
            assert page.evaluate("typeof window.__ORDERHELPER_V2_TEST__") == "undefined"
            assert page.locator("body").get_attribute("data-runtime-state") == "bound-local"

            page.evaluate(
                """({ itemKey }) => {
                  const key = 'orderhelper_v2_draft_v1';
                  const draft = JSON.parse(localStorage.getItem(key));
                  const document = draft.document;
                  const counter = document.meta.maxCounter + 1;
                  const stamp = { epoch: document.reset.epoch, counter, actorId: draft.actorId };
                  document.collections.entries['extra-zone-reload'] = {
                    itemKey: { value: itemKey, tombstone: false, stamp },
                    zone: { value: '창고', tombstone: false, stamp },
                    stock: { value: 0.25, tombstone: false, stamp }
                  };
                  document.meta.maxCounter = counter;
                  draft.dirty = true;
                  draft.mutationCount += 1;
                  draft.updatedAt = Date.now();
                  localStorage.setItem(key, JSON.stringify(draft));
                }""",
                {"itemKey": first_item_key},
            )
            page.reload(wait_until="load")
            page.wait_for_function(
                "document.querySelectorAll('#orderRowsMount tr[data-item-key]').length === 88",
                timeout=3_000,
            )
            hydrated_first = page.locator(f'#orderRowsMount tr[data-item-key="{first_item_key}"]')
            assert hydrated_first.locator(".entry-editor").count() == 2
            zones = hydrated_first.locator(".zone-input").evaluate_all("elements => elements.map(element => element.value).sort()")
            stocks = hydrated_first.locator(".stock-input").evaluate_all("elements => elements.map(element => element.value).sort()")
            assert zones == ["주방", "창고"]
            assert stocks == ["0.25", "1"]
            assert hydrated_first.locator('[data-output="stockTotal"]').inner_text() == "1.25"

            hide_button = hydrated_first.locator('[data-action="toggle-hidden"]')
            hide_button.click()
            assert "is-hidden" in (hydrated_first.get_attribute("class") or "")
            assert hydrated_first.locator('[data-output="stockNeed"]').inner_text() == "0"
            hidden_value_type = page.evaluate(
                """({ itemKey }) => {
                  const draft = JSON.parse(localStorage.getItem('orderhelper_v2_draft_v1'));
                  return typeof draft.document.collections.settings['item:' + itemKey].hiddenUntil.value;
                }""",
                {"itemKey": first_item_key},
            )
            assert hidden_value_type == "number"
            assert page.evaluate(
                """({ itemKey }) => {
                  const outbox = JSON.parse(localStorage.getItem('orderhelper_v2_outbox_v1'));
                  return [outbox.active, outbox.queued].filter(Boolean).some(intent => {
                    const register = intent.document.collections.settings['item:' + itemKey]?.hiddenUntil;
                    return register && typeof register.value === 'number';
                  });
                }""",
                {"itemKey": first_item_key},
            ), "hide must create a confirmed immutable intent"

            page.reload(wait_until="load")
            page.wait_for_function(
                "document.querySelectorAll('#orderRowsMount tr[data-item-key]').length === 88",
                timeout=3_000,
            )
            hydrated_first = page.locator(f'#orderRowsMount tr[data-item-key="{first_item_key}"]')
            assert "is-hidden" in (hydrated_first.get_attribute("class") or "")
            assert hydrated_first.locator('[data-output="stockNeed"]').inner_text() == "0"
            hydrated_first.locator('[data-action="toggle-hidden"]').click()
            assert "is-hidden" not in (hydrated_first.get_attribute("class") or "")
            assert page.evaluate(
                """({ itemKey }) => {
                  const draft = JSON.parse(localStorage.getItem('orderhelper_v2_draft_v1'));
                  return draft.document.collections.settings['item:' + itemKey].hiddenUntil.value;
                }""",
                {"itemKey": first_item_key},
            ) is False
            assert page.evaluate(
                """({ itemKey }) => {
                  const outbox = JSON.parse(localStorage.getItem('orderhelper_v2_outbox_v1'));
                  return [outbox.active, outbox.queued].filter(Boolean).some(intent => {
                    const register = intent.document.collections.settings['item:' + itemKey]?.hiddenUntil;
                    return register && register.value === false;
                  });
                }""",
                {"itemKey": first_item_key},
            ), "unhide must create a confirmed immutable intent"

            page.reload(wait_until="load")
            page.wait_for_function(
                "document.querySelectorAll('#orderRowsMount tr[data-item-key]').length === 88",
                timeout=3_000,
            )
            hydrated_first = page.locator(f'#orderRowsMount tr[data-item-key="{first_item_key}"]')
            assert "is-hidden" not in (hydrated_first.get_attribute("class") or "")
            assert hydrated_first.locator('[data-output="stockTotal"]').inner_text() == "1.25"

            page.evaluate(
                """({ itemKey }) => {
                  const key = 'orderhelper_v2_draft_v1';
                  const draft = JSON.parse(localStorage.getItem(key));
                  const document = draft.document;
                  const counter = document.meta.maxCounter + 1;
                  document.collections.settings['item:' + itemKey].hiddenUntil = {
                    value: Date.now() + 2_500,
                    tombstone: false,
                    stamp: { epoch: document.reset.epoch, counter, actorId: draft.actorId }
                  };
                  document.meta.maxCounter = counter;
                  draft.dirty = true;
                  draft.mutationCount += 1;
                  draft.updatedAt = Date.now();
                  localStorage.setItem(key, JSON.stringify(draft));
                }""",
                {"itemKey": first_item_key},
            )
            page.reload(wait_until="load")
            page.wait_for_function(
                "document.querySelectorAll('#orderRowsMount tr[data-item-key]').length === 88",
                timeout=3_000,
            )
            hydrated_first = page.locator(f'#orderRowsMount tr[data-item-key="{first_item_key}"]')
            assert "is-hidden" in (hydrated_first.get_attribute("class") or "")
            page.wait_for_function(
                "itemKey => !document.querySelector(`#orderRowsMount tr[data-item-key=\"${itemKey}\"]`).classList.contains('is-hidden')",
                arg=first_item_key,
                timeout=5_000,
            )
            assert hydrated_first.locator('[data-output="stockNeed"]').inner_text() == "3.45"

            page.set_viewport_size({"width": 390, "height": 844})
            page.wait_for_timeout(50)
            mobile = layout_snapshot(page)
            assert mobile["rows"] == desktop["rows"] == 88, (desktop, mobile)
            assert mobile["headerCells"] == mobile["firstRowCells"] == 11, mobile
            assert mobile["firstHeaderDisplay"] == "grid", mobile
            assert mobile["firstDataDisplay"] == "grid", mobile
            assert mobile["documentOverflow"] <= 1, mobile
            assert mobile["bodyOverflow"] <= 1, mobile
            assert mobile["tableOverflow"] <= 1, mobile
            assert page_errors == [], page_errors
            assert external_requests == [], external_requests
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    print("orderhelper_v2_dom_integration: PASS")


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        main()
