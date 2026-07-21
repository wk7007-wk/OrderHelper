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
    state = page.evaluate(
        """() => ({
            saveState: document.getElementById('saveState')?.textContent || '',
            queue: localStorage.getItem('bbq_confirmed_save_queue_v1'),
            entries,
        })"""
    )
    raise AssertionError(f"timed out waiting for PUT #{count}: writes={len(writes)} state={state}")


def install_fixture(page, zone="기존구역", revision=1000):
    page.evaluate(
        """({zone, revision}) => {
            startOrderHelperApp();
            unlockOrderHelper();
            document.activeElement?.blur();
            const first = MASTER[0];
            const second = MASTER.find(item => item.name !== first.name);
            entries = [
                { id: 'zone-row', entryKey: 'zone-row', itemKey: itemKeyForName(first.name), name: first.name, zone, stock: null },
                { id: 'zone-row-2', entryKey: 'zone-row-2', itemKey: itemKeyForName(second.name), name: second.name, zone: '보조', stock: null },
            ];
            zoneOrder = sanitizeZoneOrder([], entries);
            stateRevision = revision;
            inventoryRevision = revision;
            localDirty = false;
            pendingEntryZonePatches = new Map();
            saveInFlight = false;
            pendingSave = false;
            activeSaveCommitId = '';
            confirmedSaveQueueBlocked = false;
            localStorage.removeItem('bbq_confirmed_save_queue_v1');
            localStorage.removeItem('bbq_pending_sync_revision');
            localStorage.setItem('bbq_savedAt', String(revision));
            gridSortMode = 'input';
            render({ allowDuringGridEdit: true });
        }""",
        {"zone": zone, "revision": revision},
    )


def main():
    server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_address[1]}"
    first_item_state = {"name": "", "itemKey": ""}
    remote = {"current": None, "history": None}
    versions = {"current": 0, "history": 0}
    writes = []
    put_attempts = []
    force_412 = {"enabled": False}

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)

            def firebase_route(route, request):
                cors_headers = {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS, PATCH",
                    "Access-Control-Allow-Headers": "Content-Type, If-Match, X-Firebase-ETag",
                    "Access-Control-Expose-Headers": "ETag",
                }
                kind = "current" if "/current.json" in request.url else ("history" if "/history/" in request.url else "other")
                if request.method == "OPTIONS":
                    route.fulfill(status=204, headers=cors_headers, body="")
                elif request.method == "GET" and kind in {"current", "history"}:
                    route.fulfill(
                        status=200,
                        content_type="application/json",
                        headers={**cors_headers, "ETag": f'"v{versions[kind]}"'},
                        body=json.dumps(remote[kind]),
                    )
                elif request.method == "PUT" and kind in {"current", "history"}:
                    time.sleep(0.7)
                    body = request.post_data or ""
                    put_attempts.append({"kind": kind, "body": body})
                    if force_412["enabled"]:
                        route.fulfill(status=412, content_type="application/json", headers=cors_headers, body='{"error":"forced conflict"}')
                        return
                    expected_etag = f'"v{versions[kind]}"'
                    if request.headers.get("if-match") != expected_etag:
                        route.fulfill(status=412, content_type="application/json", headers=cors_headers, body='{"error":"etag mismatch"}')
                        return
                    versions[kind] += 1
                    remote[kind] = json.loads(body)
                    writes.append({"kind": kind, "body": body})
                    route.fulfill(status=200, content_type="application/json", headers=cors_headers, body=body)
                else:
                    route.fulfill(status=200, content_type="application/json", headers=cors_headers, body="null")

            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.route("**/*firebasedatabase.app/**", firebase_route)
            page.goto(origin, wait_until="domcontentloaded")
            install_fixture(page)
            first_item_state.update(page.evaluate("""() => ({ name: MASTER[0].name, itemKey: itemKeyForName(MASTER[0].name) })"""))
            remote["current"] = {"savedAt": 900, "stateRevision": 900, "inventoryRevision": 900, "entries": []}
            remote["history"] = dict(remote["current"])

            immediate = page.evaluate(
                """async () => {
                    const input = document.querySelector('input.cell[data-field="zone"][data-id="zone-row"]');
                    const t0 = performance.now();
                    input.focus();
                    input.value = '즉시구역';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    const tInput = performance.now();
                    const optionBeforeSave = Array.from(document.querySelectorAll('#zoneOptions option')).some(option => option.value === '즉시구역');
                    flushAutoSave('manual');
                    const tSave = performance.now();
                    setGridSortMode('sfa');
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    const tVisible = performance.now();
                    return {
                        inputToOptionMs: tInput - t0,
                        saveToSelectionMs: tVisible - tSave,
                        optionBeforeSave,
                        optionAfterSelection: Array.from(document.querySelectorAll('#zoneOptions option')).some(option => option.value === '즉시구역'),
                        rowValue: document.querySelector('input.cell[data-field="zone"][data-id="zone-row"]')?.value || '',
                        saveState: document.getElementById('saveState')?.textContent || '',
                    };
                }"""
            )
            assert immediate["optionBeforeSave"] is True, immediate
            assert immediate["optionAfterSelection"] is True and immediate["rowValue"] == "즉시구역", immediate
            assert immediate["saveToSelectionMs"] < 80, immediate
            wait_for_puts(page, writes, 2)
            success_payload = json.loads(writes[0]["body"])
            assert success_payload["entries"][0]["zone"] == "즉시구역"

            route_group = page.evaluate(
                """() => {
                    const first = MASTER[0];
                    const second = MASTER.find(item => item.name !== first.name);
                    entries = [
                        { id: 'a1', entryKey: 'a1', itemKey: itemKeyForName(first.name), name: first.name, zone: 'Group A', stock: 1 },
                        { id: 'b1', entryKey: 'b1', itemKey: itemKeyForName(first.name), name: first.name, zone: 'Group B', stock: 1 },
                        { id: 'a2', entryKey: 'a2', itemKey: itemKeyForName(second.name), name: second.name, zone: 'Group A', stock: null },
                        { id: 'b2', entryKey: 'b2', itemKey: itemKeyForName(second.name), name: second.name, zone: 'Group B', stock: null },
                    ];
                    zoneOrder = ['Group A', 'Group B'];
                    pendingEntryZonePatches = new Map();
                    localStorage.removeItem('bbq_confirmed_save_queue_v1');
                    saveInFlight = true;
                    render({ allowDuringGridEdit: true });
                    const moved = moveZoneCategory('Group B', -1);
                    const renamed = renameZoneCategory('Group B', 'Cold route');
                    const queue = JSON.parse(localStorage.getItem('bbq_confirmed_save_queue_v1'));
                    const payload = JSON.parse(queue.queued.body);
                    const result = {
                        moved,
                        renamed,
                        rowOrder: Array.from(document.querySelectorAll('#tbody tr[data-entry-key]')).map(row => row.dataset.entryKey),
                        zones: entries.map(entry => [entry.entryKey, entry.zone]),
                        zoneOrder: [...zoneOrder],
                        storedZoneOrder: JSON.parse(localStorage.getItem(ZONE_ORDER_STORAGE_KEY)),
                        payloadZoneOrder: payload.zoneOrder,
                        payloadZones: payload.entries.map(entry => [entry.entryKey, entry.zone]),
                        pendingPatches: Array.from(pendingEntryZonePatches.values()).map(patch => patch.entryKey).sort(),
                        bodyScrollWidth: document.body.scrollWidth,
                        viewportWidth: window.innerWidth,
                    };
                    saveInFlight = false;
                    localStorage.removeItem('bbq_confirmed_save_queue_v1');
                    return result;
                }"""
            )
            assert route_group["moved"] is True and route_group["renamed"] is True, route_group
            assert route_group["rowOrder"] == ["b2", "b1", "a2", "a1"], route_group
            assert route_group["zones"] == [
                ["a1", "Group A"],
                ["b1", "Cold route"],
                ["a2", "Group A"],
                ["b2", "Cold route"],
            ], route_group
            assert route_group["zoneOrder"] == ["Cold route", "Group A"], route_group
            assert route_group["storedZoneOrder"] == route_group["zoneOrder"], route_group
            assert route_group["payloadZoneOrder"] == route_group["zoneOrder"], route_group
            assert route_group["payloadZones"] == route_group["zones"], route_group
            assert route_group["pendingPatches"] == ["b1", "b2"], route_group
            assert route_group["bodyScrollWidth"] <= route_group["viewportWidth"], route_group

            remote_revision = 9999999999999
            remote["current"] = {
                "savedAt": remote_revision,
                "stateRevision": remote_revision,
                "inventoryRevision": remote_revision,
                "remoteOnly": "preserve-current",
                "entries": [{"id": "zone-row", "entryKey": "zone-row", "itemKey": first_item_state["itemKey"], "name": first_item_state["name"], "zone": "원격구역", "stock": 8}],
            }
            remote["history"] = {**remote["current"], "remoteOnly": "preserve-history"}
            versions["current"] = 20
            versions["history"] = 20
            writes.clear()
            conflict_page = browser.new_page(viewport={"width": 390, "height": 844})
            conflict_page.route("**/*firebasedatabase.app/**", firebase_route)
            conflict_page.goto(origin, wait_until="domcontentloaded")
            install_fixture(conflict_page, "충돌전", 1000)
            conflict_result = conflict_page.evaluate(
                """async () => {
                    const input = document.querySelector('input.cell[data-field="zone"][data-id="zone-row"]');
                    input.value = '충돌병합구역';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    flushAutoSave('manual');
                    setGridSortMode('sfa');
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    return {
                        optionVisible: Array.from(document.querySelectorAll('#zoneOptions option')).some(option => option.value === '충돌병합구역'),
                        rowValue: document.querySelector('input.cell[data-field="zone"][data-id="zone-row"]')?.value || '',
                    };
                }"""
            )
            assert conflict_result == {"optionVisible": True, "rowValue": "충돌병합구역"}, conflict_result
            wait_for_puts(conflict_page, writes, 2)
            merged_payload = json.loads(writes[0]["body"])
            merged_row = next(row for row in merged_payload["entries"] if row["entryKey"] == "zone-row")
            assert merged_row["zone"] == "충돌병합구역", merged_payload
            assert merged_row["stock"] == 8, "remote stock must be preserved during category merge"
            assert merged_payload["zoneOrder"][-1] == "충돌병합구역", merged_payload
            assert merged_payload["remoteOnly"] in {"preserve-current", "preserve-history"}
            assert merged_payload["stateRevision"] > remote_revision

            remote["current"] = {
                "savedAt": 900,
                "stateRevision": 900,
                "inventoryRevision": 900,
                "entries": [{"id": "zone-row", "entryKey": "zone-row", "itemKey": first_item_state["itemKey"], "name": first_item_state["name"], "zone": "remote-repeat", "stock": 1}],
            }
            remote["history"] = dict(remote["current"])
            versions["current"] = 40
            versions["history"] = 40
            writes.clear()
            put_attempts.clear()
            force_412["enabled"] = True
            retry_page = browser.new_page(viewport={"width": 390, "height": 844})
            retry_page.route("**/*firebasedatabase.app/**", firebase_route)
            retry_page.goto(origin, wait_until="domcontentloaded")
            install_fixture(retry_page, "repeat-base", 1000)
            retry_page.evaluate(
                """async () => {
                    const input = document.querySelector('input.cell[data-field="zone"][data-id="zone-row"]');
                    input.value = 'retry-preserved-zone';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    flushAutoSave('manual');
                }"""
            )
            for _ in range(160):
                if len(put_attempts) >= 4:
                    break
                retry_page.wait_for_timeout(25)
            retry_page.wait_for_timeout(100)
            retry_state = retry_page.evaluate(
                """() => ({
                    saveState: document.getElementById('saveState')?.textContent || '',
                    queue: localStorage.getItem('bbq_confirmed_save_queue_v1'),
                    pendingPatchCount: pendingEntryZonePatches.size,
                    optionVisible: Array.from(document.querySelectorAll('#zoneOptions option')).some(option => option.value === 'retry-preserved-zone'),
                })"""
            )
            assert len(put_attempts) == 4, f"retry must be bounded to one pair retry: attempts={len(put_attempts)} state={retry_state}"
            assert len(writes) == 0, f"forced 412 conflict should not record successful writes: {writes}"
            assert "저장충돌" in retry_state["saveState"] and "보존" in retry_state["saveState"], retry_state
            assert retry_state["queue"] and '"active"' in retry_state["queue"], retry_state
            assert retry_state["pendingPatchCount"] == 1 and retry_state["optionVisible"] is True, retry_state
            retry_page.close()
            force_412["enabled"] = False

            desktop_layouts = []
            for viewport in (
                {"width": 360, "height": 800},
                {"width": 390, "height": 844},
                {"width": 412, "height": 915},
                {"width": 1366, "height": 768},
                {"width": 1920, "height": 1080},
            ):
                layout_page = browser.new_page(viewport=viewport)
                layout_page.route("**/*firebasedatabase.app/**", firebase_route)
                layout_page.goto(origin, wait_until="domcontentloaded")
                install_fixture(layout_page)
                layout = layout_page.evaluate(
                    """() => {
                        const row = document.querySelector('#tbody tr[data-entry-key]');
                        const zone = row.querySelector('td[data-column="zone"]').getBoundingClientRect();
                        const name = row.querySelector('td[data-column="name"]').getBoundingClientRect();
                        const stock = row.querySelector('td[data-column="stock"]').getBoundingClientRect();
                        const need = row.querySelector('td[data-column="need"]').getBoundingClientRect();
                        const order = row.querySelector('td[data-column="order"]').getBoundingClientRect();
                        const stockInput = row.querySelector('input.cell[data-field="stock"]').getBoundingClientRect();
                        const zoneInput = row.querySelector('input.cell[data-field="zone"]').getBoundingClientRect();
                        const itemTitle = row.querySelector('.item-title').getBoundingClientRect();
                        const needValue = row.querySelector('.need-output-value').getBoundingClientRect();
                        const orderValue = row.querySelector('.output-order-value').getBoundingClientRect();
                        const table = document.querySelector('.table-wrap table').getBoundingClientRect();
                        const wrap = document.querySelector('.table-wrap').getBoundingClientRect();
                        const contentTops = [zoneInput.top, itemTitle.top, stockInput.top, needValue.top, orderValue.top];
                        return {
                            viewport: window.innerWidth,
                            tableWidth: table.width,
                            wrapWidth: wrap.width,
                            stickyRight: stock.right,
                            zoneWidth: zone.width,
                            nameWidth: name.width,
                            stockWidth: stock.width,
                            needLeft: need.left,
                            needRight: need.right,
                            orderLeft: order.left,
                            orderWidth: order.width,
                            contentTopSpread: Math.max(...contentTops) - Math.min(...contentTops),
                            zoneInputHeight: zoneInput.height,
                            stockInputHeight: stockInput.height,
                            zoneVisible: zone.left >= -1 && zone.right <= window.innerWidth + 1,
                            nameVisible: name.left >= -1 && name.right <= window.innerWidth + 1,
                            stockVisible: stock.left >= -1 && stock.right <= window.innerWidth + 1,
                        };
                    }"""
                )
                assert layout["zoneVisible"] and layout["nameVisible"] and layout["stockVisible"], layout
                assert layout["needLeft"] < layout["viewport"] and layout["orderLeft"] < layout["viewport"], layout
                if viewport["width"] <= 600:
                    assert layout["zoneInputHeight"] >= 32 and layout["stockInputHeight"] >= 32, layout
                else:
                    assert layout["tableWidth"] >= layout["wrapWidth"] - 1, layout
                    assert layout["contentTopSpread"] <= 2, layout
                    desktop_layouts.append(layout)
                layout_page.close()

            assert len(desktop_layouts) == 2, desktop_layouts
            assert desktop_layouts[1]["nameWidth"] >= desktop_layouts[0]["nameWidth"] + 80, desktop_layouts
            assert desktop_layouts[1]["orderWidth"] >= desktop_layouts[0]["orderWidth"] + 100, desktop_layouts
            assert desktop_layouts[1]["stickyRight"] > desktop_layouts[0]["stickyRight"], desktop_layouts

            browser.close()
        print("PASS orderhelper category save browser")
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
