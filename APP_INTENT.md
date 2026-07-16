# OrderHelper APP_INTENT.md

## 만든 이유
- BBQ 재고를 사람이 빠르게 입력하고 발주량을 계산해 SFA 입력 부담을 줄인다.

## 사용자 결과
- 모바일에서 재고 입력 흐름이 끊기지 않아야 한다.
- 출력 순서와 발주량이 최초 SFA 발주 동선에 맞아야 한다.

## 절대 기준
- SFA 자동입력은 품목명, 단위, 별칭, 환산 규칙이 확정된 뒤에만 진행한다.
- 계산식과 사용자 입력 기록은 화면 정리 때문에 숨기거나 잃지 않는다. 수치 입력 이벤트는 값 반영과 local draft 보존을 먼저 끝내고 계산/DOM 갱신을 최신 revision 기준으로 스케줄링해 입력을 막지 않는다. 재고칸의 Enter 또는 모바일 Next가 만든 `change`는 입력 완료로 원격 확정하고, 완료 전 `input` draft와 다른 필드의 일반 blur/change는 원격 전송하지 않는다.
- 입력값과 출력 계산은 별도 화면이 아니라 같은 행에 둔다. 표의 stable `itemKey`와 구역별 stable `entryKey`는 유지하고 `구역 입력순`/`최초 SFA 발주순`은 동일 DOM/data의 정렬 컨텍스트만 바꾼다. 입력순에서는 재고 Enter 뒤 미입력→입력완료→숨김 순으로 다시 정렬하고 다음 미입력 재고칸에 포커스를 유지하며, SFA순에서는 행 순서를 고정하고 다음 칸만 이동한다. `/current`와 `/history/{date}`에는 원본 `entries`와 함께 `inventoryByItemKey`, `stateRevision`, `inventoryRevision`을 저장하고, 저장 중 새 입력이나 포커스 중 대기한 원격 current가 최신 revision을 덮지 못하게 한다.
- 완료 확정본은 localStorage `bbq_confirmed_save_queue_v1`의 immutable `active + queued latest`로 보존한다. `/current`와 같은 KST `/history/{date}`가 모두 성공해야 제거하며 timeout/부분실패/재시작은 확정 당시 입력 snapshot·date를 유지한다. 전송 전 두 node를 ETag로 다시 읽어 다른 client의 ledger event를 합치고, 한 CAS attempt 안에서는 동일 merged body를 두 node에 쓴다. 완료되지 않은 draft는 online/visibility/startup만으로 원격 전송하지 않는다.
- 모바일 키보드 Enter/다음 동작은 실제 직원폰 흐름 기준으로 본다.
- 사용자는 단위를 보지 않는다. `orderUnitToStockFactor=10`의 뜻은 발주수량 10이 아니라 `1발주 단위 = 재고/사용량 10개`다. 발주량은 `ceil(필요 개수 / factor)`로 계산해 25개 필요면 3발주, 실제 2발주는 재고/사용량 20개로 환산한다. factor 방향을 UI, correction payload, AI evidence에서 뒤집지 않는다.
- 체크단위와 발주단위가 다르면 과거 재고 변동값, 날짜별 `필요기준-체크재고` 실사용량 추정값, SFA 실발주량으로 품목별 `orderUnitToStockFactor`를 추정해 발주량에 반영한다.
- 하루사용량 입력/계산은 수동값을 기준으로 한다. `이전 남은재고 + 실발주 입고량 - 다음 남은재고 = 실사용량` 분석값은 엑셀분석 참고/리포트이며, 수동값과 발주 계산을 자동 덮어쓰지 않는다.
- 엑셀분석으로 기록된 실발주 이력은 실사용 참고 배지/툴팁에 즉시 반영한다. `current/overrides/*/l` 수동 하루사용량은 자동 할당하거나 덮어쓰지 않는다.
- 엑셀/SFA 분석은 최신 결과 확인으로 끝내지 않는다. 분석 결과 적용 시 `bbq_sfa_analysis_history` localStorage에 run 단위로 append/merge하고, 원본명·매핑명·수량 0·단위·금액·분석 source·분석일을 보존해 이후 별명 후보와 실사용/환산 후보 계산에서 참조한다.
- 엑셀/SFA 분석 결과가 새로 도착하면 화면 적용 시점에 최신 `entries`/`overrides`/`orderDays`/`orderAliasMappings`와 `sfaActualHistory`로 별명 draft/effective mapping, 환산 후보, inline 보정을 다시 계산한다. 저장된 `confirmed`/`manual` 값은 유지하고 `default`/draft만 최신화한다.

## UI/동선 기준
- 구역/품목/재고/여유/일사용/필요량/추천발주·분석·금액은 한 표에서 본다. 발주가 필요한 각 품목 행에는 실발주 수량, 단가, 오늘 예상액, 가격 출처 또는 한국어 누락 사유를 표시하고, 상단 총액은 유효 금액만 합산해 가격 미해결 건수와 분리한다. 미입력, 입력완료, 숨김, 정렬 전환은 입력 동선을 방해하지 않고 정렬 뒤에도 값·포커스·caret을 복구한다.
- 발주 품목 출력순서는 최초 SFA 순서를 기준으로 고정한다. 저장되어 있던 사용자 지정 `outputOrder`는 읽어도 적용하지 않는다.
- 본 페이지/SFA 비교 패널은 `1:1 매칭`, `단위 보정`, `미매칭`, `입출력`을 한 화면에서 전환해 확인한다.
- SFA 품목명/규격/단위 기반 후보 산정, 확정/후보/미매칭/충돌 상태 표시, 내부 품목 수동 확정, CSV/탭/JSON 입력과 JSON export를 제공한다.
- 사용자사이트 품목명은 실발주 상품명이 아니라 별명/표시명으로 본다. `별명 검수` 탭에서 내부 별명별 실발주 품목 후보와 체크단위→발주단위 환산 후보, 점수, 근거를 보고 사용자가 선택/수정한 경우에만 확정한다.
- 별명 선택/새 실발주명, 사이트 품목 매칭, 신규 내부 품목, 미매칭 행은 주 표 해당 행에서도 처리한다. 상세 패널은 보조 검수면이며 주 표 왕복을 강제하지 않는다.
- 후보에 없는 실발주 별명도 `별명 검수`와 입력 행에서 이름·단위를 직접 입력할 수 있다. 타이핑/blur는 로컬 초안만 유지하고 `별명 생성` 또는 비-IME Enter만 `manual` 확정값으로 current/history에 저장한다.

## 데이터/경계 기준
- 웹 도구와 SiteBot/SFA 자동입력 경계는 분리한다.
- 이 프로젝트는 Web+SiteBot 기준의 웹 발주 보조다.
- read-only preflight는 Firebase `/order/desk_q7m9r3a8` 경로와 이 문서의 기준만 먼저 확인한다.
- SiteBot 의존 preflight는 `/sitebot/heartbeat/main_pc` read-only evidence와 공장 PC browser/SiteBot evidence를 같이 본다.
- read-only 기록 조회와 live 발주 실행은 분리한다.
- 외부 사이트 live 발주/주문 submit, action, write, delete는 read-only preflight와 분리된 별도 safety flow 없이는 진행하지 않는다.
- Browser automation/SiteBot 증거가 필요할 때는 공장 PC에서 Playwright, DOM smoke, Axe, desktop/mobile screenshot, empty state를 확인한다.
- 외부 사이트 live 조작, 발주/주문 write, 삭제, 제출은 별도 safety flow 또는 명시 승인 없이 진행하지 않는다.
- Firebase 경로 이름에는 RTDB 금지 문자를 넣지 않는다.
- GitHub Pages 반영 여부를 작업 완료와 별도로 확인한다.
- 엑셀분석은 비교/실발주 확인 데이터와 참고 배지로만 쓰고, 수동 하루사용량/품목 단위표/재고/발주 원본을 별도 확인 없이 자동수정하지 않는다.
- SFA 원천 품목 행은 보존하고, 사용자 확정 매칭과 단위 보정만 `orderSiteMappings`/`orderUnitCorrections`로 분리 저장한다. 사이트/엑셀 품목이 MASTER에 없으면 분석 화면에서 원명 그대로 또는 임의 이름으로 `orderManualItems`를 추가하고 `orderSiteMappings` target으로 재사용한다.
- 사용자사이트 별명→실발주항목 확정값과 환산 검수값은 `orderAliasMappings`로 분리 저장한다. 점수 높은 품목/환산 후보는 자동 확정하지 않고 `default` 선택값으로 표시/전달하며, 환산 후보에는 최근비교, 재고변동, 날짜별 실사용량 비교 근거를 포함한다. 환산값은 전역값이 아니라 별명/실발주항목별 값이며, 사용자가 `별명 검수` 탭 또는 체크 입력 행에서 후보 선택 시 `confirmed`, 직접 숫자 입력 시 `manual`로 저장한다.
- 최신 엑셀 비교와 `/sfaPriceHistory/latest`의 exact `mappedName` 가격은 확정 별명이 없거나 저장 별명의 actual name이 오래된 경우에도 비저장 후보 증거로만 사용할 수 있다. canonical은 append-only `/sfaAnalysisRuns/{runId}`이고 가격 read model은 원본 run path/hash를 가리킨다. 이 후보는 `orderAliasMappings`를 자동 생성·수정하지 않으며, 가격 null과 versioned 유효 0원을 구분한다.
- 오차보기의 사용자 명시 선택/신규 품목 생성은 `orderSiteMappings`와 `orderAliasMappings`를 함께 갱신한다. 같은 정규화 이름이라도 원문+단위 identity가 다르면 별도 site key로 보존하고, 자동 고신뢰 후보는 `candidate`일 뿐 확정하지 않는다. 수량 `0`, 빈 배열, 충돌 상태도 current/history/effective read model에서 지우지 않는다.
- SFA에 처음 보인 원문+단위는 fuzzy 점수가 높아도 자동 매칭하지 않고 `신규 발주 원문`으로 표시한다. 사용자가 기존 canonical 품목을 명시 선택한 뒤에만 local overlay `bbq_local_new_source_aliases_v1`에 저장하며, 원격 current 새로고침 뒤에도 overlay를 다시 합쳐 기존 확정 매핑과 재고 draft를 잃지 않는다.
- 단위 보정은 환산계수, 묶음단위, 최소발주단위, 표기 보정으로 제한하며 다음 발주량 계산과 엑셀분석 요청에 반영한다.
- `orderSiteMappings`, `orderAliasMappings`, `orderUnitCorrections`, `orderManualItems`는 localStorage, Firebase `/order/desk_q7m9r3a8/current`, `/history/{date}` payload에 분리 저장한다. `orderAliasMappingDrafts`는 후보/default 상태와 `orderUnitToStockFactor` 의미를 보존하고, `effectiveOrderAliasMappings`는 `confirmed/manual` 우선 후 없으면 default를 쓰는 엑셀분석용 read model이다.
- 로컬 분석 누적 이력 key는 `bbq_sfa_analysis_history`다. ledger v2 record는 `runId/source/date/file/items[]`, event는 stable `eventId`와 `eventAt/rowIndex/rawIdentity/originalName/mappedName/aliasName/quantity/actualOrderQty/unit/amount/sourceRunIds`를 보존한다. 같은 run 재수신은 최신 event 기준 idempotent merge하고, 물리 원천이 같은 local/Firebase mirror는 한 event로 합치되 모든 `sourceRunIds`를 남긴다. 다른 run과 같은 품목의 여러 원본 행은 append한다. current/history payload의 canonical `sfaOrderLedger`만 전체 event를 가지며 legacy history field는 compact pointer다.
- 실사용량 AI 분석은 브라우저 직접 모델/API key가 아니라 기존 `/monitor/main_pc/sfa_order_request`의 bounded `aiUsageAnalysis.evidence` 계약으로 PC/SiteBot worker에 전달한다. 브라우저는 `/order/desk_q7m9r3a8/aiUsageAdvisory/latest`의 top-level `analysisRunId/generatedAt/status/items/audit` 결과를 advisory-only일 때만 읽고, 각 item에 run/time/status를 붙여 참고 배지로 표시한다. invalid/unknown-only/과거 retry는 fail-closed로 기존 값을 유지하며 `overrides/*/l`, 수동 환산, 재고, 실제 발주값을 자동 변경하지 않는다.
- DB에서 읽은 구역/entry id/AI 문구는 HTML escape하고 행 버튼은 한 번만 붙는 delegated listener로 처리한다. 저장 데이터가 inline handler나 DOM으로 실행되면 안 된다.
- 실발주 이력은 `/order/desk_q7m9r3a8/sfaActualHistory/{date}`, 누적 가격 read model은 `/order/desk_q7m9r3a8/sfaPriceHistory/latest`, 단위/실사용 추정 리포트는 `/order/desk_q7m9r3a8/unitInference/latest`에 남긴다. 가격 필드가 없는 legacy 행을 `0원`으로 만들거나 newer mirror가 같은 원본의 실제 금액을 지우면 안 된다.
- 로컬 SFA 엑셀 이력의 모든 발주 행은 OrderHelper MASTER 품목에 고신뢰 매핑되어야 한다. 부족한 품목은 전역 threshold를 낮추지 말고 명시 alias 또는 웹 마스터 보강으로 처리한 뒤 백필한다.
- SFA 의미가 다른 품목은 숫자 통과를 위해 기존 MASTER에 묶지 않는다. 예: `BBQ충진식패티(100g)(마일드)`, `BBQ페퍼로니씬피자`는 `두마리치킨,파더스`와 별도 target이다.
- 정적 프론트 인증은 `PIN 통과 AND (CLI 허용 단말 OR 승인된 desktop token OR 활성 grace desktop OR 서버/호스팅 허용 IP OR 매장 GPS 700m)` 구조다. PIN은 항상 필요하고, GPS 없는 desktop은 `/desktopAccess/devices/{deviceHash}` 승인 상태 또는 24시간 grace window에서만 fallback 통과한다.
- IP allowlist는 CLI 기록/서버·호스팅 앞단 적용용이다. 정적 클라이언트의 임의 IP/X-Forwarded-For 값은 신뢰하지 않으며, desktop read model의 `recentIp`는 후보/감사용 보조값이다. Grace 중 수집된 단말은 `candidate/pending`이고 자동 영구 승인되지 않는다. `?authDebug=1`은 로컬 개발에서만 GPS 검증을 우회한다.
- SFA 파일 스캔/분석 실행자는 PC/SiteBot이다. 서버폰 Termux AI Ops는 `/monitor/main_pc/*` 요청·상태·heartbeat 정체를 감시하고, 멈춤/오류 때 self_fix 분석으로 넘기는 운영 감시자다.
- Termux 상주 모니터는 발주 품목, 단위, 환산, 하루사용량 수동값, SFA 실발주 원본을 자동 확정하거나 수정하지 않는다.
- `orderhelper_usage_inference.py --upload`는 `/unitInference/latest` 리포트만 갱신한다. `/sfaActualHistory` 백필은 `--backfill-sfa-actual-history` 또는 `--bulk-backfill-local-sfa-actual-history` 명시 플래그가 있을 때만 허용하며, 하루사용량 `overrides/*/l` 자동 write는 금지한다.

## C&I / AI Ops 경계
- C&I는 PC/SiteBot heartbeat 정체, SFA 요청/상태 불일치, GitHub Pages 반영 실패, 계산/입력 회귀를 self_fix 후보로 올린다. OrderHelper main_pc heartbeat는 20분 초과~45분까지 warn, 45분 초과부터 error/self_fix로 본다.
- 발주시스템 CLI 역할은 `/monitor/main_pc/*`, `/order/desk_q7m9r3a8/current`, `/order/desk_q7m9r3a8/sfaCompare/latest`, `/sfaActualHistory`, `/unitInference/latest`, 최근 `history`를 대조해 SFA 분석 완료 후 실발주 이력 누락, 단위 환산/실사용량 추정 리포트 누락, 하루사용량 분석 불능을 감지하는 것이다.
- 자동 복구는 웹 코드/테스트/문서/배포 루프 보정까지 허용한다.
- 발주 품목, 단위, 환산, 하루사용량 수동값, SFA 실발주 원본 확정은 자동으로 바꾸지 않는다.
- CLI/LLM은 prompt envelope가 있어야 깨어난다. monitor/worker/사용자/수동 enqueue 또는 상주 판단 루프가 prompt를 주입하며, 이것은 C&I 판단 권한 제한이 아니다.

## 수정 전 질문
- 이 변경이 재고 입력 시간을 줄이는가.
- 계산식/SFA 대응을 불확실하게 만들지 않는가.
- 직원폰 브라우저 이벤트 차이를 검증했는가.

## 완료 기준
- 검증: 정적 검사, 모바일 브라우저 입력 흐름, Firebase read-only preflight, Playwright desktop/mobile screenshot, DOM smoke, Axe, empty state, 공장 PC/SiteBot evidence
- 전달: 웹 URL 반영 확인
- 최신 코드·라이브 기준: `20260717-01` / `0717.0059` / 입력순 Enter·모바일 Next 자동저장·정렬 / SFA순 고정 / null·0원 구분 / append-only SFA run과 누적 가격 read model / current-history pair CAS / 기존 stable item·entry key·revision·수동값 보호 유지.
- 완료 포인터: `20260717-01 Stock Next autosave + lossless SFA price history`; 이전 포인터 `20260716-01 Restore Enter autosort in input context`, `20260715-02 Live integration: explicit new-source overlay + dirty-refresh preservation + pair CAS/lossless ledger/advisory latest`.
- 완료 검증: `node tests/orderhelper_static_checks.js`, `node tests/orderhelper_inventory_matching_regression.js`, `node tests/orderhelper_single_grid_ledger_regression.js`, `node tests/orderhelper_p1_review_regression.js`, `node tests/orderhelper_autosave_regression.js`, `python3 tests/orderhelper_autosave_browser.py`, inline JS syntax, `git diff --check`. 로컬 Playwright는 Firebase를 interception해 ETag pair-CAS, IME/change/Enter, stored-XSS, delegated listener를 검증한다. 실제 공장 PC/SiteBot worker·live 배포 검증은 별도 확인 대상이다.
- 운영 감시: 서버폰 Termux AI Ops가 PC/SiteBot 상태와 SFA 요청 정체를 감시한다. 앱 코드 변경 없이 감시만 바뀐 경우 APK/웹 배포는 필요 없다.
- 남은 위험: 실기기 키보드 이벤트 차이, SFA 화면 변동, 재고 변동 기반 환산은 실발주 반영 기록이 쌓인 뒤 안정화됨, 과거 producer가 버린 금액은 원본 Excel 재분석 없이는 복구할 수 없음, PC/SiteBot이 꺼지면 Termux는 감지만 가능하고 실제 SFA 파일 스캔은 못 한다.
