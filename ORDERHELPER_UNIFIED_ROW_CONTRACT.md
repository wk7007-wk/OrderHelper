# OrderHelper unified order row contract

Status: integration design gate. Live/deploy 금지.

## Canonical inputs

- Inventory: `entries` + `inventoryByItemKey`, joined only by stable `itemKey`.
- Actual order evidence: lossless `sfaOrderLedger.records[].items[]`; every physical Excel/SFA row keeps `originalName`, `mappedName`, `aliasName`, `actualOrderQty`, `amount`, `unit`, `runId`, `eventAt`, and row identity.
- User decisions: explicit `orderSiteMappings`, `orderAliasMappings`, `orderManualItems`, `orderUnitCorrections`, and accepted AI defaults. Fuzzy/default candidates are never confirmed state.
- Dedicated AI source remains `/aiUsageAdvisory/latest`; the canonical SFA run and AI latest are not rewritten into each other.

## Single resolver output

`resolveUnifiedOrderRows()` returns one row per `itemKey`:

```text
itemKey, internalName, actualName, matchStatus, factor,
stockTotal, stockNeed, orderQty,
priceEvidence, unitPrice, expectedAmount,
aiUsage, issues
```

Each derived numeric value also has an evidence node: `value`, `sourceRunId`, `asOf`, `formula`, `inputRefs`, and `provenance`.

- `matchStatus` is exactly one of `MATCHED`, `CANDIDATE`, `ALIAS_CONFLICT`, `UNIT_UNCONFIRMED`, `ITEM_UNMATCHED`.
- A row can never be both matched and unmatched. UI, totals, SFA/AI request read-models, and exports consume this resolver only.
- Derived rows/totals are not persisted as another source of truth. Current/history may carry a versioned cache/pointer, but reload recomputes from canonical inputs.

## Price join and amount rule

1. `itemKey/internalName` -> effective explicit confirmed/manual `actualName`.
2. Join the newest valid lossless ledger event by exact normalized actual name/alias.
3. `unitPrice = amount / actualOrderQty` on the Excel/SFA order-unit basis.
4. `expectedAmount = recommended orderQty * unitPrice`. A stock/order factor never converts the price a second time.
5. A zero-quantity current row may use the newest older event with both positive quantity and amount, and must expose that run/time as `priceEvidence`.
6. For an explicitly matched alias, unresolved price is `PRICE_JOIN_BUG` (error), not a normal missing-source state. No fabricated price and no NaN-to-zero fallback.

## Deterministic equation engine

- Order line: `amount = actualOrderQty * actualUnitPrice`, `actualUnitPrice = amount / actualOrderQty`, `actualOrderQty = amount / actualUnitPrice`.
- Recommendation: `stockNeed = recommendedOrderQty * factor`; converted units use discrete ceiling, while same-unit factor 1 retains the existing decimal rule.
- Expected amount: `todayExpectedAmount = todayRecommendedOrderQty * actualUnitPrice`. Factor is applied only in stock need -> order quantity and never again to price.
- Precedence is explicit user decision -> exact current Excel row -> latest valid lossless ledger event -> deterministic derivation -> AI advisory. AI is never an arithmetic input.
- Numeric zero is present evidence. `0 / 0` is ambiguous, so a zero-quantity current line falls back to the latest older independently valid quantity+amount evidence.
- Two independent equations outside tolerance produce `DATA_CONFLICT` and no derived fill. If a matched row has sufficient arithmetic inputs but a derived field remains blank, emit `DERIVATION_BUG`.

Issue codes include `PRICE_JOIN_BUG`, `DATA_CONFLICT`, `DERIVATION_BUG`, `ALIAS_CONFLICT`, `UNIT_UNCONFIRMED`, `ITEM_UNMATCHED`, `PRICE_STALE`, and `PRICE_SOURCE_MISSING` (only when no explicit matched alias exists).

## Movement factor inference

- A movement sample uses `(nextStock - prevStock + estimatedUsage) / actualOrderQty`; timing-unknown, missing-inventory, zero-quantity, and non-positive-delivery samples are preserved as excluded evidence rather than coerced to zero.
- Multiple samples use median/MAD outlier handling. One usable sample is low confidence; stable `9.8 / 10 / 10.2` evidence is a high-confidence factor `10`; incompatible clusters remain a conflict with no usable factor.
- The suggestion is evidence only and is never auto-applied. A user must explicitly accept it, and a manual/confirmed factor always wins.

## Mutation boundary

- Only explicit user alias/manual-item/unit-factor changes and explicit AI acceptance mutate confirmed state.
- Manual/confirmed aliases, factors, and `overrides/*/l` are never overwritten by fuzzy, SFA, or AI-derived candidates.
- IME composition/blur stays local-only. Enter or an explicit correction/accept action creates the paired current+history remote commit.
- Dynamic HTML uses escaped data attributes and delegated listeners.

## Reuse / retire map

- Reuse: stable item keys and inventory aggregation, lossless ledger/dedupe/CAS, explicit correction sanitizers, Enter-only durable queue, `recommendedOrderQty`, `sfaUnitPriceFromRow`, advisory latest validation.
- Replace: `expectedOrderAmountForItem` latest-comparison-only join with ledger-backed resolver price evidence.
- Retire as competing resolvers: tab-specific `buildOrderSiteMatches`/unmatched/alias/unit arrays after their controls move inline. The visible single grid and request/export paths read only the unified rows.
- Preserve current dirty integration work: factor direction, exact AI `ledger.events` request contract, compact persisted evidence summary, desktop stored-XSS fix, stale revision fail-closed, authoritative latest advisory guard.

## Acceptance fixtures

The executable implementation must satisfy `tests/fixtures/orderhelper_unified_order_row_contract.json` plus VM and Playwright checks. The matched-price fixture is mandatory: Excel amount `12,000` / quantity `5` => unit price `2,400`; recommended order `3` => expected amount `7,200`; the same item appears once with `MATCHED` and never in unmatched output.

## Deferred integration (not part of this checkpoint)

- Replace the legacy separate comparison tabs with one resolver-backed row per `itemKey`; do not append a second unmatched row for an already matched item.
- Show recent actual quantity/amount/unit-price provenance beside today's recommended quantity/expected amount, plus one exact `오늘 발주 예상 총액` computed from resolver rows (missing price stays missing; explicit zero stays zero).
- Add an inline movement-factor accept control. Acceptance must be an explicit user action and must never overwrite an existing manual/confirmed factor.
- Make request/export/read-model consumers use the same resolver rows, then run 390px browser, XSS, stale-CAS, exact SiteBot payload, and full save/alias regression gates before any live deployment.
