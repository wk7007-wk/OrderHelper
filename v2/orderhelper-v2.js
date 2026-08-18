(function attachOrderHelperV2(root, factory) {
  'use strict';

  const masterApi = root && root.OrderHelperV2Master
    ? root.OrderHelperV2Master
    : (typeof require === 'function' ? require('./master-data.js') : null);
  const api = factory(masterApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrderHelperV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createOrderHelperV2(Master) {
  'use strict';

  const VIEW_MODES = Object.freeze({ INPUT: 'input', SFA: 'sfa' });
  const DEFAULT_BASE_SALES = 280;
  const RUNTIME_CONTRACT = Object.freeze({
    version: 'orderhelper-v2-ui-model-controller/1',
    events: Object.freeze({ DRAFT: 'draft', CONFIRM: 'confirm' }),
  });
  const runtimeByDocument = new WeakMap();

  class RuntimeContractError extends Error {
    constructor(message) {
      super(message);
      this.name = 'RuntimeContractError';
    }
  }

  function parseDraftNumber(value) {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function finiteNumber(value, fallback) {
    const parsed = parseDraftNumber(value);
    return parsed === null ? fallback : parsed;
  }

  function rounded(value, digits = 6) {
    if (!Number.isFinite(value)) return null;
    const scale = 10 ** digits;
    return Math.round((value + Number.EPSILON) * scale) / scale;
  }

  function recommendedOrderDays(jsDay) {
    return jsDay === 4 || jsDay === 5 ? 4 : 3;
  }

  function salesWeights({ dailySales = [], orderDays = 3, baseSales = DEFAULT_BASE_SALES } = {}) {
    const days = Math.max(0, Math.trunc(finiteNumber(orderDays, 3)));
    const base = finiteNumber(baseSales, DEFAULT_BASE_SALES);
    return Array.from({ length: days }, (_, index) => {
      const sales = parseDraftNumber(dailySales[index]);
      if (sales === null) return 1;
      if (base <= 0) return sales === 0 ? 0 : 1;
      return rounded(sales / base);
    });
  }

  function roundUpTenth(value) {
    const parsed = parseDraftNumber(value);
    if (parsed === null) return null;
    if (parsed <= 0) return 0;
    return Math.ceil((parsed - Number.EPSILON) * 10) / 10;
  }

  function orderQtyForStockNeed(stockNeed, factor, sameUnit) {
    const need = parseDraftNumber(stockNeed);
    const multiplier = parseDraftNumber(factor);
    if (need === null || multiplier === null || multiplier <= 0) return null;
    if (need <= 0) return 0;
    const raw = need / multiplier;
    return sameUnit ? roundUpTenth(raw) : Math.ceil(raw - Number.EPSILON);
  }

  function stockQtyForOrderQty(orderQty, factor) {
    const qty = parseDraftNumber(orderQty);
    const multiplier = parseDraftNumber(factor);
    if (qty === null || multiplier === null || multiplier <= 0) return null;
    return rounded(qty * multiplier);
  }

  function calculateOrder({
    stockTotal,
    buffer = 0,
    dailyUsage = 0,
    orderDays = 3,
    dailySales = [],
    baseSales = DEFAULT_BASE_SALES,
    orderUnitToStockFactor = null,
    sameUnit = false,
    hidden = false,
  } = {}) {
    const issues = [];
    const weights = salesWeights({ dailySales, orderDays, baseSales });
    const factor = parseDraftNumber(orderUnitToStockFactor);

    if (hidden) {
      return {
        stockNeed: 0,
        recommendedOrderQty: 0,
        salesWeights: weights,
        issues,
      };
    }

    const stock = parseDraftNumber(stockTotal);
    if (stock === null) {
      issues.push('STOCK_MISSING');
      if (!sameUnit && (factor === null || factor <= 0)) issues.push('UNIT_UNCONFIRMED');
      return {
        stockNeed: null,
        recommendedOrderQty: null,
        salesWeights: weights,
        issues,
      };
    }

    const k = finiteNumber(buffer, 0);
    const l = finiteNumber(dailyUsage, 0);
    const firstDayNeed = l * (weights[0] ?? 1);
    const periodNeed = l * weights.reduce((sum, weight) => sum + weight, 0);
    const rawNeed = stock < firstDayNeed
      ? periodNeed - firstDayNeed + k
      : periodNeed - stock + k;
    const stockNeed = rounded(Math.max(0, rawNeed));

    if (!sameUnit && (factor === null || factor <= 0)) issues.push('UNIT_UNCONFIRMED');
    const recommendedOrderQty = issues.includes('UNIT_UNCONFIRMED')
      ? null
      : orderQtyForStockNeed(stockNeed, factor, sameUnit);

    return { stockNeed, recommendedOrderQty, salesWeights: weights, issues };
  }

  function comparableText(value) {
    return String(value ?? '').normalize('NFKC');
  }

  function compareText(left, right) {
    const a = comparableText(left);
    const b = comparableText(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function firstEntryKey(row) {
    if (row.entryKey) return row.entryKey;
    const keys = (row.entries || []).map(entry => entry.entryKey).filter(Boolean).sort(compareText);
    return keys[0] || row.itemKey || '';
  }

  function primaryZone(row, zoneOrder) {
    const zones = (row.entries || []).map(entry => String(entry.zone || '').trim()).filter(Boolean);
    if (zones.length === 0) return '';
    const ranks = new Map((zoneOrder || []).map((zone, index) => [String(zone), index]));
    zones.sort((a, b) => {
      const rankA = ranks.has(a) ? ranks.get(a) : Number.MAX_SAFE_INTEGER;
      const rankB = ranks.has(b) ? ranks.get(b) : Number.MAX_SAFE_INTEGER;
      return rankA - rankB || compareText(a, b);
    });
    return zones[0];
  }

  function compareInputRows(left, right, state) {
    const zoneOrder = state.zoneOrder || [];
    const zoneRanks = new Map(zoneOrder.map((zone, index) => [String(zone), index]));
    const zoneA = primaryZone(left, zoneOrder);
    const zoneB = primaryZone(right, zoneOrder);
    const rankA = zoneA === '' ? Number.MAX_SAFE_INTEGER : (zoneRanks.get(zoneA) ?? zoneOrder.length);
    const rankB = zoneB === '' ? Number.MAX_SAFE_INTEGER : (zoneRanks.get(zoneB) ?? zoneOrder.length);
    if (rankA !== rankB) return rankA - rankB;
    const zoneCompare = compareText(zoneA, zoneB);
    if (zoneCompare !== 0) return zoneCompare;
    const missingA = left.stockTotal === null || left.stockTotal === undefined ? 0 : 1;
    const missingB = right.stockTotal === null || right.stockTotal === undefined ? 0 : 1;
    if (missingA !== missingB) return missingA - missingB;
    return finiteNumber(left.inputIndex, Number.MAX_SAFE_INTEGER)
      - finiteNumber(right.inputIndex, Number.MAX_SAFE_INTEGER)
      || compareText(left.itemKey, right.itemKey);
  }

  function compareSfaRows(left, right) {
    return finiteNumber(left.canonicalSeq, Number.MAX_SAFE_INTEGER)
      - finiteNumber(right.canonicalSeq, Number.MAX_SAFE_INTEGER)
      || compareText(left.canonicalName ?? left.internalName, right.canonicalName ?? right.internalName)
      || compareText(firstEntryKey(left), firstEntryKey(right))
      || compareText(left.itemKey, right.itemKey);
  }

  function sortRows(rows, mode, state = {}) {
    const result = Array.from(rows || []);
    result.sort(mode === VIEW_MODES.SFA
      ? compareSfaRows
      : (left, right) => compareInputRows(left, right, state));
    return result;
  }

  function fallbackStableHash(value) {
    let hash = 0x811c9dc5;
    for (const character of comparableText(value)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
  }

  function sourceOnlyRows(latestSfaRows) {
    return (latestSfaRows || [])
      .filter(source => !source.mappedItemKey && !source.itemKey && !source.mapped)
      .map(source => {
        const sourceRowIndex = parseDraftNumber(source.row_index);
        const sourceKey = source.sourceKey || `source_${fallbackStableHash([
          source.originalName || source.name || '',
          source.unit || '',
          sourceRowIndex ?? '',
        ].join('|'))}`;
        return {
          ...source,
          originalName: source.originalName || source.name || '',
          sourceRowIndex,
          sourceKey,
        };
      })
      .sort((left, right) => {
        const rowA = left.sourceRowIndex ?? Number.MAX_SAFE_INTEGER;
        const rowB = right.sourceRowIndex ?? Number.MAX_SAFE_INTEGER;
        return rowA - rowB
          || compareText(left.originalName, right.originalName)
          || compareText(left.unit, right.unit)
          || compareText(left.sourceKey, right.sourceKey);
      });
  }

  function createModel({ masterItems, now } = {}) {
    const items = Array.from(masterItems || (Master && Master.MASTER_ITEMS) || []);
    const nowMilliseconds = now === undefined
      ? () => Date.now()
      : (typeof now === 'function' ? () => Number(now()) : () => new Date(now).getTime());
    const initialNow = new Date(nowMilliseconds());
    const defaultOrderDays = recommendedOrderDays(initialNow.getDay());
    const itemByKey = new Map(items.map(item => [item.itemKey, item]));
    const entriesByItem = new Map();
    const entryToItem = new Map();
    const overrides = new Map();
    const factors = new Map();
    const hiddenUntil = new Map();
    const rowsByItem = new Map();
    const state = {
      viewMode: VIEW_MODES.INPUT,
      orderDays: defaultOrderDays,
      dailySales: [],
      baseSales: DEFAULT_BASE_SALES,
      zoneOrder: [],
      latestSfaRows: [],
    };
    const metrics = { fullResolveCount: 0, rowResolveCount: 0 };

    function defaultEntry(itemKey) {
      return { entryKey: `entry_${itemKey}_0`, itemKey, zone: '', stock: null };
    }

    function resetEntries() {
      entriesByItem.clear();
      entryToItem.clear();
      for (const item of items) {
        const entry = defaultEntry(item.itemKey);
        entriesByItem.set(item.itemKey, [entry]);
        entryToItem.set(entry.entryKey, item.itemKey);
      }
    }

    resetEntries();
    for (const item of items) {
      if (item.defaultOrderUnitToStockFactor !== null) factors.set(item.itemKey, item.defaultOrderUnitToStockFactor);
    }

    function isHidden(itemKey) {
      const value = hiddenUntil.get(itemKey);
      if (typeof value === 'number') return value > nowMilliseconds();
      return false;
    }

    function resolveRow(itemKey) {
      const item = itemByKey.get(itemKey);
      if (!item) return null;
      const storedEntries = entriesByItem.get(itemKey) || [];
      const entries = storedEntries.map(entry => Object.freeze({ ...entry }));
      const presentStocks = entries.map(entry => parseDraftNumber(entry.stock)).filter(value => value !== null);
      const stockTotal = presentStocks.length === 0
        ? null
        : rounded(presentStocks.reduce((sum, value) => sum + value, 0));
      const itemOverride = overrides.get(itemKey) || {};
      const buffer = Object.prototype.hasOwnProperty.call(itemOverride, 'buffer')
        ? itemOverride.buffer
        : item.defaultBuffer;
      const dailyUsage = Object.prototype.hasOwnProperty.call(itemOverride, 'dailyUsage')
        ? itemOverride.dailyUsage
        : item.defaultDailyUsage;
      const factor = factors.has(itemKey) ? factors.get(itemKey) : null;
      const hidden = isHidden(itemKey);
      const calculation = calculateOrder({
        stockTotal,
        buffer,
        dailyUsage,
        orderDays: state.orderDays,
        dailySales: state.dailySales,
        baseSales: state.baseSales,
        orderUnitToStockFactor: factor,
        sameUnit: item.sameUnit,
        hidden,
      });
      const matchStatus = !item.sameUnit && factor === null ? 'UNIT_UNCONFIRMED' : 'ITEM_UNMATCHED';
      const issues = Array.from(new Set([
        ...calculation.issues,
        ...(matchStatus === 'ITEM_UNMATCHED' ? ['ITEM_UNMATCHED'] : []),
      ]));
      return Object.freeze({
        itemKey,
        canonicalSeq: item.canonicalSeq,
        canonicalName: item.canonicalName,
        internalName: item.canonicalName,
        inputIndex: item.inputIndex,
        entryKey: entries.map(entry => entry.entryKey).sort(compareText)[0] || itemKey,
        entries: Object.freeze(entries),
        stockTotal,
        K: buffer,
        L: dailyUsage,
        buffer,
        dailyUsage,
        checkUnit: item.checkUnit,
        orderUnit: item.orderUnit,
        sameUnit: item.sameUnit,
        orderDays: state.orderDays,
        salesWeights: Object.freeze(calculation.salesWeights),
        stockNeed: calculation.stockNeed,
        orderUnitToStockFactor: factor,
        recommendedOrderQty: calculation.recommendedOrderQty,
        actualName: null,
        matchStatus,
        actualOrderQty: null,
        unitPrice: null,
        expectedAmount: null,
        sourceRunId: null,
        sourceRowIndex: null,
        provenance: Object.freeze({ master: '2026-05-08', calculation: 'v2-local-foundation' }),
        issues: Object.freeze(issues),
        hidden,
        hiddenUntil: hiddenUntil.has(itemKey) ? hiddenUntil.get(itemKey) : null,
      });
    }

    function resolveAll() {
      for (const item of items) rowsByItem.set(item.itemKey, resolveRow(item.itemKey));
      metrics.fullResolveCount += 1;
    }

    function resolveOne(itemKey) {
      const row = resolveRow(itemKey);
      if (!row) throw new Error(`Unknown itemKey: ${itemKey}`);
      rowsByItem.set(itemKey, row);
      metrics.rowResolveCount += 1;
      return row;
    }

    function getCanonicalRows() {
      return items.map(item => rowsByItem.get(item.itemKey));
    }

    function readRegister(row, field) {
      if (!row || !Object.prototype.hasOwnProperty.call(row, field)) return { present: false };
      const register = row[field];
      if (!register || typeof register !== 'object' || Array.isArray(register)) {
        throw new RuntimeContractError(`Invalid canonical register: ${field}`);
      }
      if (register.tombstone === true) return { present: true, tombstone: true };
      if (!Object.prototype.hasOwnProperty.call(register, 'value')) {
        throw new RuntimeContractError(`Canonical register has no value: ${field}`);
      }
      return { present: true, tombstone: false, value: register.value };
    }

    function hydrateCanonicalDocument(documentSource) {
      const collections = documentSource && documentSource.collections;
      if (!collections || typeof collections !== 'object' || Array.isArray(collections)) {
        throw new RuntimeContractError('Canonical hydrate requires collections');
      }

      // A default entry is structural and always exists. A field tombstone clears
      // that field; itemKey/deleted tombstones remove only non-default entries.
      resetEntries();
      const canonicalEntries = collections.entries || {};
      for (const entryKey of Object.keys(canonicalEntries).sort(compareText)) {
        const fields = canonicalEntries[entryKey];
        const itemRegister = readRegister(fields, 'itemKey');
        const inferredItem = items.find(item => `entry_${item.itemKey}_0` === entryKey);
        if (itemRegister.present && itemRegister.tombstone) continue;
        const itemKey = itemRegister.present ? String(itemRegister.value) : inferredItem?.itemKey;
        if (!itemKey || !itemByKey.has(itemKey)) {
          throw new RuntimeContractError(`Canonical entry has no valid itemKey: ${entryKey}`);
        }
        const deleted = readRegister(fields, 'deleted');
        if (deleted.present && !deleted.tombstone && deleted.value === true) continue;

        let entry = entriesByItem.get(itemKey).find(candidate => candidate.entryKey === entryKey);
        if (!entry) {
          entry = { entryKey, itemKey, zone: '', stock: null };
          entriesByItem.get(itemKey).push(entry);
          entryToItem.set(entryKey, itemKey);
        }
        const zone = readRegister(fields, 'zone');
        const stock = readRegister(fields, 'stock');
        if (zone.present) entry.zone = zone.tombstone ? '' : String(zone.value ?? '');
        if (stock.present) entry.stock = stock.tombstone ? null : parseDraftNumber(stock.value);
      }

      overrides.clear();
      for (const [itemKey, fields] of Object.entries(collections.usage || {})) {
        if (!itemByKey.has(itemKey)) continue;
        const itemOverride = {};
        for (const field of ['buffer', 'dailyUsage']) {
          const register = readRegister(fields, field);
          if (register.present && !register.tombstone) itemOverride[field] = parseDraftNumber(register.value);
        }
        if (Object.keys(itemOverride).length) overrides.set(itemKey, itemOverride);
      }

      state.baseSales = DEFAULT_BASE_SALES;
      state.dailySales = [];
      state.orderDays = defaultOrderDays;
      const baseSales = readRegister(collections.sales?.base, 'amount');
      if (baseSales.present && !baseSales.tombstone) state.baseSales = parseDraftNumber(baseSales.value);
      for (let index = 0; index < 4; index += 1) {
        const sales = readRegister(collections.sales?.[`day-${index + 1}`], 'amount');
        if (sales.present) state.dailySales[index] = sales.tombstone ? null : parseDraftNumber(sales.value);
      }

      const orderDays = readRegister(collections.settings?.order, 'days');
      if (orderDays.present && !orderDays.tombstone) {
        const parsed = Math.trunc(finiteNumber(orderDays.value, state.orderDays));
        if (parsed < 1 || parsed > 31) throw new RuntimeContractError('Invalid canonical order days');
        state.orderDays = parsed;
      }

      hiddenUntil.clear();
      for (const [settingsKey, fields] of Object.entries(collections.settings || {})) {
        if (!settingsKey.startsWith('item:')) continue;
        const itemKey = settingsKey.slice(5);
        if (!itemByKey.has(itemKey)) continue;
        const register = readRegister(fields, 'hiddenUntil');
        if (!register.present || register.tombstone) continue;
        if (register.value === false) hiddenUntil.set(itemKey, false);
        else {
          const timestamp = Number(register.value);
          if (!Number.isFinite(timestamp) || timestamp < 0) {
            throw new RuntimeContractError(`Invalid hiddenUntil: ${itemKey}`);
          }
          hiddenUntil.set(itemKey, timestamp);
        }
      }

      resolveAll();
      return getCanonicalRows();
    }

    function getState() {
      return {
        ...state,
        dailySales: Array.from(state.dailySales),
        zoneOrder: Array.from(state.zoneOrder),
        latestSfaRows: Array.from(state.latestSfaRows),
        hiddenUntil: Object.fromEntries(hiddenUntil),
      };
    }

    function updateEntryField(entryKey, field, value) {
      if (field !== 'stock' && field !== 'zone') throw new Error(`Unsupported entry field: ${field}`);
      const itemKey = entryToItem.get(entryKey);
      if (!itemKey) throw new Error(`Unknown entryKey: ${entryKey}`);
      const entry = entriesByItem.get(itemKey).find(candidate => candidate.entryKey === entryKey);
      entry[field] = field === 'stock' ? parseDraftNumber(value) : String(value ?? '');
      return resolveOne(itemKey);
    }

    function updateItemField(itemKey, field, value) {
      const allowed = { buffer: 'buffer', K: 'buffer', dailyUsage: 'dailyUsage', L: 'dailyUsage' };
      if (!allowed[field]) throw new Error(`Unsupported item field: ${field}`);
      const itemOverride = { ...(overrides.get(itemKey) || {}) };
      itemOverride[allowed[field]] = parseDraftNumber(value);
      overrides.set(itemKey, itemOverride);
      return resolveOne(itemKey);
    }

    function updateFactor(itemKey, value) {
      const factor = parseDraftNumber(value);
      if (factor === null || factor <= 0) factors.delete(itemKey);
      else factors.set(itemKey, factor);
      return resolveOne(itemKey);
    }

    function addEntry(itemKey, draft = {}) {
      if (!itemByKey.has(itemKey)) throw new Error(`Unknown itemKey: ${itemKey}`);
      const entryKey = draft.entryKey || `entry_${itemKey}_${entriesByItem.get(itemKey).length}`;
      if (entryToItem.has(entryKey)) throw new Error(`Duplicate entryKey: ${entryKey}`);
      const entry = {
        entryKey,
        itemKey,
        zone: String(draft.zone ?? ''),
        stock: parseDraftNumber(draft.stock),
      };
      entriesByItem.get(itemKey).push(entry);
      entryToItem.set(entryKey, itemKey);
      return resolveOne(itemKey);
    }

    function setHidden(itemKey, value) {
      if (!itemByKey.has(itemKey)) throw new Error(`Unknown itemKey: ${itemKey}`);
      if (value === null) hiddenUntil.delete(itemKey);
      else if (value === false) hiddenUntil.set(itemKey, false);
      else {
        const timestamp = value instanceof Date ? value.getTime() : Number(value);
        if (!Number.isFinite(timestamp) || timestamp < 0) throw new TypeError('hiddenUntil must be a timestamp, false, or null tombstone');
        hiddenUntil.set(itemKey, timestamp);
      }
      return resolveOne(itemKey);
    }

    function updateSalesInputs(patch = {}) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('sales patch must be an object');
      if (Object.prototype.hasOwnProperty.call(patch, 'baseSales')) state.baseSales = parseDraftNumber(patch.baseSales);
      if (Object.prototype.hasOwnProperty.call(patch, 'dailySales')) {
        const values = patch.dailySales;
        if (!values || typeof values !== 'object') throw new TypeError('dailySales patch must be indexed values');
        for (const [rawIndex, value] of Object.entries(values)) {
          const dayIndex = Number(rawIndex);
          if (!Number.isSafeInteger(dayIndex) || dayIndex < 0 || dayIndex > 3) {
            throw new RangeError('daily sales index must be 0..3');
          }
          state.dailySales[dayIndex] = parseDraftNumber(value);
        }
      }
      resolveAll();
      return getCanonicalRows();
    }

    function setBaseSales(value) {
      return updateSalesInputs({ baseSales: value });
    }

    function setDailySales(index, value) {
      const dayIndex = Number(index);
      if (!Number.isSafeInteger(dayIndex) || dayIndex < 0 || dayIndex > 3) {
        throw new RangeError('daily sales index must be 0..3');
      }
      return updateSalesInputs({ dailySales: { [dayIndex]: value } });
    }

    function refreshExpiredHidden() {
      const refreshed = [];
      for (const [itemKey, value] of hiddenUntil) {
        if (typeof value !== 'number' || value > nowMilliseconds()) continue;
        const row = rowsByItem.get(itemKey);
        if (row?.hidden) refreshed.push(resolveOne(itemKey));
      }
      return refreshed;
    }

    function getNextHiddenExpiry() {
      const current = nowMilliseconds();
      let next = null;
      for (const value of hiddenUntil.values()) {
        if (typeof value !== 'number' || value <= current) continue;
        if (next === null || value < next) next = value;
      }
      return next;
    }

    function setOrderDays(value) {
      const parsed = Math.max(1, Math.trunc(finiteNumber(value, state.orderDays)));
      if (parsed === state.orderDays) return;
      state.orderDays = parsed;
      resolveAll();
    }

    function setViewMode(mode) {
      if (mode !== VIEW_MODES.INPUT && mode !== VIEW_MODES.SFA) throw new Error(`Unsupported view mode: ${mode}`);
      state.viewMode = mode;
    }

    resolveAll();

    return Object.freeze({
      getCanonicalRows,
      getRow: itemKey => rowsByItem.get(itemKey) || null,
      getState,
      getMetrics: () => ({ ...metrics }),
      hydrateCanonicalDocument,
      updateEntryField,
      updateItemField,
      updateFactor,
      addEntry,
      setHidden,
      updateSalesInputs,
      setBaseSales,
      setDailySales,
      refreshExpiredHidden,
      getNextHiddenExpiry,
      setOrderDays,
      setViewMode,
    });
  }

  function formatNumber(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(Number(value));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function initApp(documentRef) {
    if (!documentRef || !Master || !Master.MASTER_ITEMS) return null;
    if (runtimeByDocument.has(documentRef)) return runtimeByDocument.get(documentRef);
    const tableBody = documentRef.querySelector('[data-role="order-rows"]');
    const app = documentRef.querySelector('[data-orderhelper-v2]');
    if (!tableBody || !app) throw new RuntimeContractError('OrderHelper v2 DOM contract is incomplete');
    const model = createModel({ masterItems: Master.MASTER_ITEMS });
    const subscribers = new Set();
    const view = documentRef.defaultView || null;
    let pendingSalesBase = false;
    let pendingBaseSalesValue = null;
    const pendingDailySales = new Map();
    let salesFrame = null;
    let expiryTimer = null;

    function emit(type, payload = {}) {
      const event = Object.freeze({ type, ...payload });
      for (const subscriber of subscribers) subscriber(event);
    }

    function orderedRows() {
      const state = model.getState();
      return sortRows(model.getCanonicalRows(), state.viewMode, state);
    }

    function badgeText(row) {
      if (row.hidden) return '숨김';
      if (row.stockTotal === null) return '재고 입력';
      if (row.matchStatus === 'UNIT_UNCONFIRMED') return '단위 확인';
      if (row.recommendedOrderQty > 0) return '발주 필요';
      return '충분';
    }

    function rowMarkup(row) {
      const issueClass = row.hidden ? 'is-hidden' : row.stockTotal === null ? 'is-missing' : '';
      const itemKey = escapeHtml(row.itemKey);
      const name = escapeHtml(row.internalName);
      const entryEditors = row.entries.map(entry => {
        const entryKey = escapeHtml(entry.entryKey);
        return `<div class="entry-editor" data-entry-key="${entryKey}">
          <input class="cell-input zone-input" data-field="zone" data-entry-key="${entryKey}" value="${escapeHtml(entry.zone)}" aria-label="${name} 구역">
          <input class="cell-input number-input stock-input" data-field="stock" data-entry-key="${entryKey}" value="${escapeHtml(entry.stock ?? '')}" inputmode="decimal" enterkeyhint="next" step="0.1" aria-label="${name} 재고">
        </div>`;
      }).join('');
      return `<tr data-item-key="${itemKey}" class="${issueClass}">
        <th scope="row" data-label="품목"><span class="item-name">${name}</span><small>${escapeHtml(row.checkUnit || '단위 미정')} → ${escapeHtml(row.orderUnit || '단위 미정')}</small></th>
        <td data-label="구역별 재고"><div class="entry-editor-list">${entryEditors}</div></td>
        <td data-label="재고합계" data-output="stockTotal">${formatNumber(row.stockTotal)}</td>
        <td data-label="K 여유"><input class="cell-input number-input" data-field="buffer" value="${escapeHtml(row.K ?? '')}" inputmode="decimal" step="0.1" aria-label="${name} 여유"></td>
        <td data-label="L 하루사용량"><input class="cell-input number-input" data-field="dailyUsage" value="${escapeHtml(row.L ?? '')}" inputmode="decimal" step="0.1" aria-label="${name} 하루사용량"></td>
        <td data-label="필요재고" data-output="stockNeed">${formatNumber(row.stockNeed)}</td>
        <td data-label="추천발주" data-output="recommendedOrderQty">${formatNumber(row.recommendedOrderQty)}</td>
        <td data-label="SFA 연결"><span class="status-badge" data-output="status">${badgeText(row)}</span></td>
        <td data-label="발주단가" data-output="unitPrice">${formatNumber(row.unitPrice)}</td>
        <td data-label="예상금액" data-output="expectedAmount">${formatNumber(row.expectedAmount)}</td>
        <td data-label="상세"><button type="button" class="hide-button" data-action="toggle-hidden" aria-label="${name} ${row.hidden ? '숨김 해제' : '3일 숨김'}">${row.hidden ? '복귀' : '3일 숨김'}</button></td>
      </tr>`;
    }

    function renderRows() {
      tableBody.innerHTML = orderedRows().map(rowMarkup).join('');
      updateSummary();
    }

    function updateSummary() {
      const rows = model.getCanonicalRows();
      const missing = rows.filter(row => row.stockTotal === null && !row.hidden).length;
      const actionable = rows.filter(row => (row.recommendedOrderQty || 0) > 0 && !row.hidden).length;
      const missingNode = documentRef.querySelector('[data-summary="missing"]');
      const actionableNode = documentRef.querySelector('[data-summary="actionable"]');
      if (missingNode) missingNode.textContent = String(missing);
      if (actionableNode) actionableNode.textContent = String(actionable);
    }

    function patchRow(row, refreshSummary = true) {
      const element = tableBody.querySelector(`[data-item-key="${row.itemKey}"]`);
      if (!element) return;
      element.classList.toggle('is-hidden', row.hidden);
      element.classList.toggle('is-missing', row.stockTotal === null && !row.hidden);
      element.querySelector('[data-output="stockTotal"]').textContent = formatNumber(row.stockTotal);
      element.querySelector('[data-output="stockNeed"]').textContent = formatNumber(row.stockNeed);
      element.querySelector('[data-output="recommendedOrderQty"]').textContent = formatNumber(row.recommendedOrderQty);
      element.querySelector('[data-output="status"]').textContent = badgeText(row);
      const hideButton = element.querySelector('[data-action="toggle-hidden"]');
      hideButton.textContent = row.hidden ? '복귀' : '3일 숨김';
      hideButton.setAttribute('aria-label', `${row.internalName} ${row.hidden ? '숨김 해제' : '3일 숨김'}`);
      if (refreshSummary) updateSummary();
    }

    function patchAllRows() {
      for (const row of model.getCanonicalRows()) patchRow(row, false);
      updateSummary();
    }

    function applyPendingSales() {
      salesFrame = null;
      if (!pendingSalesBase && pendingDailySales.size === 0) return false;
      const patch = {};
      if (pendingSalesBase) patch.baseSales = pendingBaseSalesValue;
      if (pendingDailySales.size) patch.dailySales = Object.fromEntries(pendingDailySales);
      pendingSalesBase = false;
      pendingBaseSalesValue = null;
      pendingDailySales.clear();
      model.updateSalesInputs(patch);
      patchAllRows();
      return true;
    }

    function cancelSalesFrame() {
      if (salesFrame === null) return;
      if (view?.cancelAnimationFrame) view.cancelAnimationFrame(salesFrame);
      else if (view?.clearTimeout) view.clearTimeout(salesFrame);
      salesFrame = null;
    }

    function flushPendingSales() {
      cancelSalesFrame();
      return applyPendingSales();
    }

    function scheduleSalesFrame() {
      if (salesFrame !== null) return;
      if (view?.requestAnimationFrame) salesFrame = view.requestAnimationFrame(applyPendingSales);
      else if (view?.setTimeout) salesFrame = view.setTimeout(applyPendingSales, 16);
      else applyPendingSales();
    }

    function refreshExpiredHiddenRows() {
      for (const row of model.refreshExpiredHidden()) patchRow(row, false);
      updateSummary();
      scheduleExpiryRefresh();
    }

    function scheduleExpiryRefresh() {
      if (expiryTimer !== null && view?.clearTimeout) view.clearTimeout(expiryTimer);
      expiryTimer = null;
      const nextExpiry = model.getNextHiddenExpiry();
      if (nextExpiry === null || !view?.setTimeout) return;
      const delay = Math.max(0, Math.min(2_147_483_647, nextExpiry - Date.now() + 20));
      expiryTimer = view.setTimeout(refreshExpiredHiddenRows, delay);
    }

    function rowForElement(element) {
      const rowElement = element.closest('[data-item-key]');
      return rowElement ? model.getRow(rowElement.dataset.itemKey) : null;
    }

    tableBody.addEventListener('input', event => {
      const input = event.target.closest('input[data-field]');
      if (!input) return;
      const row = rowForElement(input);
      if (!row) return;
      const updated = input.dataset.entryKey
        ? model.updateEntryField(input.dataset.entryKey, input.dataset.field, input.value)
        : model.updateItemField(row.itemKey, input.dataset.field, input.value);
      patchRow(updated);
      emit(RUNTIME_CONTRACT.events.DRAFT, input.dataset.entryKey
        ? {
          collection: 'entries',
          key: input.dataset.entryKey,
          fields: { itemKey: row.itemKey, [input.dataset.field]: input.value },
          composing: Boolean(event.isComposing),
        }
        : {
          collection: 'usage',
          key: row.itemKey,
          fields: { [input.dataset.field]: input.value },
          composing: Boolean(event.isComposing),
        });
    });

    tableBody.addEventListener('keydown', event => {
      const input = event.target.closest('input[data-field]');
      if (!input || event.key !== 'Enter' || event.repeat) return;
      emit(RUNTIME_CONTRACT.events.CONFIRM, { reason: 'enter' });
      if (!input.classList.contains('stock-input')) return;
      event.preventDefault();
      const visibleStocks = Array.from(tableBody.querySelectorAll('.stock-input'));
      const currentIndex = visibleStocks.indexOf(input);
      const next = visibleStocks.slice(currentIndex + 1).find(candidate => candidate.value.trim() === '')
        || visibleStocks.find(candidate => candidate.value.trim() === '');
      if (next && next !== input) {
        next.focus({ preventScroll: true });
        next.select();
        next.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });

    tableBody.addEventListener('change', event => {
      if (!event.target.closest('input[data-field]')) return;
      emit(RUNTIME_CONTRACT.events.CONFIRM, { reason: 'change' });
    });

    tableBody.addEventListener('click', event => {
      const button = event.target.closest('[data-action="toggle-hidden"]');
      if (!button) return;
      const row = rowForElement(button);
      if (!row) return;
      const hiddenUntil = row.hidden ? false : Date.now() + 3 * 24 * 60 * 60 * 1000;
      const updated = model.setHidden(row.itemKey, hiddenUntil);
      patchRow(updated);
      scheduleExpiryRefresh();
      emit(RUNTIME_CONTRACT.events.DRAFT, {
        collection: 'settings',
        key: `item:${row.itemKey}`,
        fields: { hiddenUntil },
        composing: false,
      });
      emit(RUNTIME_CONTRACT.events.CONFIRM, { reason: 'change' });
    });

    app.addEventListener('click', event => {
      const button = event.target.closest('[data-view-mode]');
      if (!button) return;
      flushPendingSales();
      model.setViewMode(button.dataset.viewMode);
      for (const control of app.querySelectorAll('[data-view-mode]')) {
        control.setAttribute('aria-pressed', String(control === button));
      }
      renderRows();
    });

    const daysSelect = documentRef.querySelector('[data-order-days]');
    if (!daysSelect) throw new RuntimeContractError('OrderHelper v2 order-days control is missing');
    daysSelect.value = String(model.getState().orderDays);
    daysSelect.addEventListener('change', () => {
      flushPendingSales();
      model.setOrderDays(daysSelect.value);
      patchAllRows();
      emit(RUNTIME_CONTRACT.events.DRAFT, {
        collection: 'settings', key: 'order', fields: { days: daysSelect.value }, composing: false,
      });
      emit(RUNTIME_CONTRACT.events.CONFIRM, { reason: 'change' });
    });

    const baseSalesInput = documentRef.querySelector('#baseSales');
    const dailySalesInputs = Array.from({ length: 4 }, (_, index) => documentRef.querySelector(`#salesDay${index + 1}`));
    if (!baseSalesInput || dailySalesInputs.some(input => !input)) {
      throw new RuntimeContractError('OrderHelper v2 sales controls are incomplete');
    }

    baseSalesInput.addEventListener('input', event => {
      pendingSalesBase = true;
      pendingBaseSalesValue = baseSalesInput.value;
      if (!event.isComposing) scheduleSalesFrame();
      emit(RUNTIME_CONTRACT.events.DRAFT, {
        collection: 'sales', key: 'base', fields: { amount: baseSalesInput.value }, composing: Boolean(event.isComposing),
      });
    });
    baseSalesInput.addEventListener('compositionend', scheduleSalesFrame);
    baseSalesInput.addEventListener('change', () => {
      flushPendingSales();
      emit(RUNTIME_CONTRACT.events.CONFIRM, { reason: 'change' });
    });

    dailySalesInputs.forEach((input, index) => {
      input.addEventListener('input', event => {
        pendingDailySales.set(index, input.value);
        if (!event.isComposing) scheduleSalesFrame();
        emit(RUNTIME_CONTRACT.events.DRAFT, {
          collection: 'sales', key: `day-${index + 1}`, fields: { amount: input.value }, composing: Boolean(event.isComposing),
        });
      });
      input.addEventListener('compositionend', scheduleSalesFrame);
      input.addEventListener('change', () => {
        flushPendingSales();
        emit(RUNTIME_CONTRACT.events.CONFIRM, { reason: 'change' });
      });
    });

    function hydrateCanonicalDocument(documentSource) {
      cancelSalesFrame();
      pendingSalesBase = false;
      pendingBaseSalesValue = null;
      pendingDailySales.clear();
      model.hydrateCanonicalDocument(documentSource);
      const state = model.getState();
      daysSelect.value = String(state.orderDays);
      baseSalesInput.value = state.baseSales ?? '';
      dailySalesInputs.forEach((input, index) => { input.value = state.dailySales[index] ?? ''; });
      renderRows();
      scheduleExpiryRefresh();
    }

    const runtime = Object.freeze({
      contractVersion: RUNTIME_CONTRACT.version,
      hydrateCanonicalDocument,
      subscribe(listener) {
        if (typeof listener !== 'function') throw new TypeError('runtime subscriber must be a function');
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      },
    });

    runtimeByDocument.set(documentRef, runtime);
    app.dataset.runtimeContract = RUNTIME_CONTRACT.version;
    app.dataset.runtimeState = 'ready';

    documentRef.addEventListener('visibilitychange', () => {
      if (documentRef.visibilityState === 'visible') refreshExpiredHiddenRows();
    });
    view?.addEventListener?.('focus', refreshExpiredHiddenRows);

    renderRows();
    scheduleExpiryRefresh();
    return runtime;
  }

  function requireDomRuntime(documentRef) {
    const runtime = documentRef && runtimeByDocument.get(documentRef);
    if (!runtime || runtime.contractVersion !== RUNTIME_CONTRACT.version) {
      throw new RuntimeContractError('OrderHelper v2 runtime contract is unavailable');
    }
    return runtime;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => initApp(document));
    } else {
      initApp(document);
    }
  }

  return Object.freeze({
    VIEW_MODES,
    RUNTIME_CONTRACT,
    RuntimeContractError,
    parseDraftNumber,
    recommendedOrderDays,
    salesWeights,
    roundUpTenth,
    orderQtyForStockNeed,
    stockQtyForOrderQty,
    calculateOrder,
    sortRows,
    sourceOnlyRows,
    createModel,
    initApp,
    requireDomRuntime,
  });
});
