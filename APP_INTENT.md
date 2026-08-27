# OrderHelper APP_INTENT.md

## 만든 이유
- BBQ 재고를 사람이 빠르게 입력하고 발주량을 계산해 SFA 입력 부담을 줄인다.

## 사용자 결과
- 모바일에서 재고 입력 흐름이 끊기지 않아야 한다.
- 출력 순서와 발주량이 최초 SFA 발주 동선에 맞아야 한다.

## 절대 기준
- SFA 자동입력은 품목명, 단위, 별칭, 환산 규칙이 확정된 뒤에만 진행한다.
- 계산식과 사용자 입력 기록은 화면 정리 때문에 숨기거나 잃지 않는다. 숫자 입력·스크롤 중에는 발주량/금액 resolver/90일 분석처럼 순간 메모리를 쓰는 계산을 돌리지 않는다. 그런 계산은 idle 시간 조각으로 나누고, 결과가 안정되기 전에는 부분 숫자를 그리지 않으며 `계산 중`만 보여 준다. Enter 또는 모바일 다음(아직 그 칸에 있을 때)은 기존 행을 그 자리에서 한 번 정렬한 뒤 다음 미입력 재고칸으로 커서를 한 번만 옮긴다. 그 뒤에 다시 정렬하거나 커서를 다시 두지 않고, tbody를 통째로 다시 만들지 않는다. 이미 다른 칸에 있으면 정렬만 하고 커서는 그대로 둔다. 완료 전 `input` draft와 다른 필드의 일반 blur/change는 원격 전송하지 않는다.
- 입력값과 출력 계산은 별도 화면이 아니라 같은 행에 둔다. 표의 stable `itemKey`와 구역별 stable `entryKey`는 유지하고 `구역 입력순`/`SFA 발주순`은 동일 DOM/data의 정렬 컨텍스트만 바꾼다. 입력순 정렬은 미입력→입력완료→숨김이다. SFA순은 최초 SFA 생성 순서(`sfaSeq`)만 본다. 매칭/발주량 묶음으로 다시 정렬하지 않으며, 색 표시와 미연결 행은 그 순서를 바꾸지 않는다. `/current`와 `/history/{date}`에는 원본 `entries`와 함께 `inventoryByItemKey`, `stateRevision`, `inventoryRevision`을 저장하고, 저장 중 새 입력이나 포커스 중 대기한 원격 current가 최신 revision을 덮지 못하게 한다.
- 완료 확정본은 localStorage `bbq_confirmed_save_queue_v1`의 immutable `active + queued latest`로 보존한다. `/current`와 같은 KST `/history/{date}`가 모두 성공해야 제거하며 timeout/부분실패/재시작은 확정 당시 입력 snapshot·date를 유지한다. 전송 전 두 node를 ETag로 다시 읽어 다른 client의 ledger event를 합치고, 한 CAS attempt 안에서는 동일 merged body를 두 node에 쓴다. 완료되지 않은 draft는 online/visibility/startup만으로 원격 전송하지 않는다.
- 기기 간 revision 충돌은 기본적으로 자동 덮어쓰지 않는다. 사용자가 충돌 화면의 `이 폰 내용으로 PC 덮어쓰기` 또는 1회용 `?phoneWins=1`을 명시한 경우에만, 부팅 시점에 기존 폰 localStorage 발주항목이 확인된 브라우저에서 폰의 발주항목·재고·구역·수동 보정·매칭·예상매출 전체를 우선한다. SFA ledger는 원격과 합쳐 보존하고 `/current`와 같은 날짜 `/history`를 ETag-CAS로 갱신한 뒤 두 node의 동일 receipt를 재조회해 성공을 판정한다. 이 경로는 SFA 실발주를 실행하지 않는다.
- 모바일 키보드 Enter/다음 동작은 실제 직원폰 흐름 기준으로 본다.
- 사용자는 단위를 보지 않는다. `orderUnitToStockFactor=10`의 뜻은 발주수량 10이 아니라 `1발주 단위 = 재고/사용량 10개`다. 발주량은 `ceil(필요 개수 / factor)`로 계산해 25개 필요면 3발주, 실제 2발주는 재고/사용량 20개로 환산한다. factor 방향을 UI, correction payload, AI evidence에서 뒤집지 않는다.
- 후보/default는 완료값과 구분해 `확인 필요`로 표시한다. 직원 행에는 `1발주=N개` 대신 실제 단위를 써서 `1박스 = 재고 16개`처럼 방향을 보여주고, 단위명이 없을 때만 `발주 1개 = 재고 N개`로 표시한다. 상세 분석면에는 자동 후보 상태를 보존한다. 단일 최신비교의 `필요량 ÷ 실발주량`이 1.5처럼 소수로 나온 경우는 환산 후보에는 남기되 자동 적용 기본값으로 쓰지 않는다. 사용자 확정, 동일단위, 정수 묶음 후보 또는 충분히 반복된 실사용 근거만 자동 기본값이 될 수 있다.
- 사용자가 `연결 안 함`을 선택하면 `orderAliasMappings`에 `unlinked` 상태로 저장한다. 이 상태는 자동 후보, exact mapped-name 가격 fallback, SFA/AI 분석 매핑, 사이트 자동 연결보다 우선하며 `effectiveOrderAliasMappings`에서는 제외한다. 후보는 나중에 다시 연결할 수 있도록 선택 목록에만 남긴다. 기존 사용자 확정 환산값은 raw 상태에 보존하되 연결 안 함 동안 계산에는 적용하지 않는다.
- 체크단위와 발주단위가 다르면 과거 재고 변동값, 날짜별 `필요기준-체크재고` 실사용량 추정값, SFA 실발주량으로 품목별 `orderUnitToStockFactor`를 추정해 발주량에 반영한다.
- 하루사용량 입력/계산은 수동값을 기준으로 한다. `이전 남은재고 + 실발주 입고량 - 다음 남은재고 = 실사용량` 분석값은 엑셀분석 참고/리포트이며, 수동값과 발주 계산을 자동 덮어쓰지 않는다. 봇이 일사용/여유/추천을 채우고 원규가 사이트에서 수정한 값은 소스 오브 트루스다. `DAILY_USAGE_STORAGE_VERSION` 원샷 보정은 같은 버전이 아닐 때만 실행하며, 이미 있는 `overrides.l`은 지우지 않고 없는 품목만 `MASTER.daily`로 채운다. `overrides.k`(여유)는 바꾸지 않는다. 다음 SFA 엑셀/입고 작업에서 실발주나 현장 일사용/여유가 봇 추천과 다르면 사용자 조정으로 유지한다.
- 엑셀분석으로 기록된 실발주 이력은 실사용 참고 배지/툴팁에 즉시 반영한다. 오늘 발주 예상 총액의 단가는 최신 엑셀/Firebase `sfaPriceHistory`를 쓰고, 없을 때만 `DEFAULT_ORDER_UNIT_PRICES`(기간 파일 amount/qty, 발주 1단위 KRW)를 쓴다. 예상액은 추천 발주수량 × 발주 1단위 가격이며 N을 가격에 다시 곱하거나 나누어 뒤집지 않는다.
- 엑셀/SFA 분석은 최신 결과 확인으로 끝내지 않는다. 분석 결과 적용 시 `bbq_sfa_analysis_history` localStorage에 run 단위로 append/merge하고, 원본명·매핑명·수량 0·단위·금액·분석 source·분석일을 보존해 이후 별명 후보와 실사용/환산 후보 계산에서 참조한다.
- 엑셀/SFA 분석 결과가 새로 도착하면 화면 적용 시점에 최신 `entries`/`overrides`/`orderDays`/`orderAliasMappings`와 `sfaActualHistory`로 별명 draft/effective mapping, 환산 후보, inline 보정을 다시 계산한다. 저장된 `confirmed`/`manual` 값은 유지하고 `default`/draft만 최신화한다.

## UI/동선 기준
- 구역·재고·여유·일사용 입력은 화면 위치만으로 구분하지 않고, 동적 렌더·재정렬 뒤에도 `품목명 + 필드명` 접근 가능한 이름을 유지한다. 품목명은 기존 HTML escape 경로를 거쳐야 하며 이 이름 추가가 값·포커스·저장/CAS 계약을 바꾸면 안 된다.
- 상단 작업 줄은 `미입력 N개`와 `다음 미입력`을 항상 보여 재고 확인 동선을 끊지 않는다. 숨긴 행은 Enter/다음 이동 대상에서 빼며, 예상매출 칸은 수정 가능하고 입력 완료(blur/Enter) 때 current+history에 동기화한다. 중간 한 자리 동기화는 금지한다.
- 예상매출 원격저장은 입력 완료(blur/Enter). 중간 한 자리 동기화 금지.
- 모바일 기본 화면은 품목마다 `구역 · 품목 · 재고 · 필요 · 발주`가 compact list로 보이게 유지한다. 구역 값은 선택 화살표 때문에 잘리지 않을 너비를 확보하고 품목명은 말줄임표로 숨기지 않고 필요한 만큼 줄바꿈한다. 구역은 재고 확인 동선을 나타내는 상위 그룹이며, 그룹 순서 변경은 입력 완료 여부와 관계없이 모든 소속 품목을 한 덩어리로 이동한다. 그룹 이름 변경도 해당 구역의 모든 entry에 함께 적용하고 current/history CAS 충돌 병합에 각 entry patch와 `zoneOrder`를 보존한다. 여유·일사용·단위·추가/숨김과 발주 연결·예상금액 상세는 행 끝 펼침 버튼에서만 카드 형태로 확장해, 기본 재고 입력 목록의 세로 스크롤을 과도하게 늘리지 않는다.
- 모바일 펼침/접기는 토글과 행의 viewport anchor를 보존해 토글이 화면 밖으로 밀리지 않게 하고, 화면보다 높은 행은 sticky 영역 아래에 상단 정렬하며 수평 스크롤은 생성하지 않는다.
- 구역/품목/재고/여유/일사용/필요량/추천발주·예상금액은 한 표에서 본다. 발주가 필요한 각 품목의 기본 카드는 `예상 N원`과 가격 한 줄만 표시한다. 환산 품목은 `개당 N원 · 1박스 N원 · 최근 3개월 발주 기준`처럼 재고 1단위 가격과 발주 1단위 가격을 분리하며, 예상액은 추천 발주수량 × 발주 1단위 가격으로 계산한다. 계산이 안 되면 `예상금액 확인 필요`와 직원이 할 일을 짧게 보여준다. 실발주 수량, 상세 가격 출처, 산식, 파일·날짜·근거 수량은 데이터와 카드 title에 보존하되 기본 화면에는 나열하지 않는다. 상단 총액은 유효 금액만 합산해 `가격 확인 필요` 건수와 분리한다. 미입력, 입력완료, 숨김, 정렬 전환은 입력 동선을 방해하지 않고 정렬 뒤에도 값·포커스·caret을 복구한다.
- 오늘 발주가 0인 행도 확인된 단가는 `봉당 N원 · 최근 3개월 발주 기준`처럼 한 줄로 남기고, 근거가 정말 없을 때만 `단가 확인 필요`로 표시한다. `미확인`만 단독 표시해 단가 누락으로 오해하게 하지 않는다. 구역 칸은 기존 입력값을 선택 목록으로 제공하면서 새 구역을 계속 수기로 입력할 수 있어야 한다.
- 직원 인증 화면에는 단말 hash, GPS 반경·거리, 후보 기록 결과, 등록창 ID·만료시각, 단말기명 입력칸 같은 내부 진단/등록 UI를 표시하지 않는다. 내부 인증 증거와 후보 기록은 유지하되 화면에는 PIN 입력만 짧은 한국어로 안내한다. 신뢰 단말 hash는 기존처럼 PIN 없이 자동 진입할 수 있다. 기기 hash·IP·user-agent·승인/개방 제어를 담은 `접근관리` 패널은 live 직원 화면에서 숨기고 로컬 `authDebug` 검증에서만 연다.
- 저장 성공·대기·오류는 상단 `saveState`와 `lastSaved` 한 줄로만 안내한다. 연속 입력 때 쌓이는 내부 저장 로그는 8개 제한을 유지하되 직원 화면 DOM에는 렌더링하지 않는다.
- 발주 입력 표는 `구역 → 품목명 → 필요량 → 추천발주·분석·금액 → 재고 → 여유 → 일사용 → 단위 → 작업` 순서를 유지한다. 구역·품목명만 sticky로 두고 필요량·추천발주를 재고보다 먼저 보여 발주 판단을 우선한다.
- 행의 발주 연결 수정창은 `1. 발주명 연결`과 `2. 수량 맞춤` 두 단계만 보여준다. 접힌 줄은 `발주 연결 · 확인 필요/설정 완료 · 연결명 · 1박스 = 재고 16개`처럼 실제 단위로 요약하고, 후보 점수·자동추정 근거·최근비교·산식은 데이터에만 보존한다. `orderUnitCorrections`에 사용자가 저장한 숫자는 수량만 확정으로 표시하되 발주명 후보까지 자동 확정하지 않는다. 수량은 숫자 한 칸과 `수량 저장`으로 확인하며 후보 선택칸을 중복 표시하지 않는다. 목록 밖 발주명 입력은 보조 펼침으로 감추고 `연결 안 함`이면 거부한 후보와 환산·가격 카드를 활성값처럼 표시하지 않는다. 사이트 연결은 `엑셀 연결 N건 · 연결됨/확인 필요`로 짧게 표시한다.
- 발주 품목 출력순서는 최초 SFA 순서를 기준으로 고정한다. 저장되어 있던 사용자 지정 `outputOrder`는 읽어도 적용하지 않는다.
- 본 페이지/SFA 비교 패널은 `품목 연결`, `발주명 확인`, `발주 단위 확인`, `연결 필요`, `입출력`을 한 화면에서 전환해 확인한다.
- SFA 품목명/규격/단위 기반 후보 산정, 확정/후보/미매칭/충돌 상태 표시, 내부 품목 수동 확정, CSV/탭/JSON 입력과 JSON export를 제공한다.
- 사용자사이트 품목명은 내부 데이터에서 alias로 관리하되 직원 화면에는 `발주명 연결`로 설명한다. `발주명 확인` 탭에서 후보와 발주 1개당 재고 수량을 보고 사용자가 선택/수정한 경우에만 확정한다. 실제로 연결할 품목이 아니면 같은 목록의 `연결 안 함`을 선택한다.
- 발주명 선택/직접 입력, 사이트 품목 연결, 신규 내부 품목, 연결 필요 행은 주 표 해당 행에서도 처리한다. 상세 패널은 보조 확인면이며 주 표 왕복을 강제하지 않는다.
- 후보에 없는 발주 사이트 품목명도 `발주명 확인`과 입력 행에서 이름·단위를 직접 입력할 수 있다. 타이핑/blur는 로컬 초안만 유지하고 상세 패널의 `이 이름으로 확정`, 입력 행의 `이 이름으로 연결`, 또는 비-IME Enter만 `manual` 확정값으로 current/history에 저장한다. 입력 행에는 같은 직접 입력칸을 한 벌만 표시한다.

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
- 사용자사이트 이름→실발주항목 확정값과 환산 확인값은 `orderAliasMappings`로 분리 저장한다. 점수 높은 품목/환산 후보는 자동 확정하지 않고 `default`로 표시/전달하며, 환산 후보에는 최근비교, 재고변동, 날짜별 실사용량 비교 근거를 내부 데이터로 보존한다. 직원 화면의 펼친 입력 행에는 이 기술 근거를 길게 노출하지 않는다. 환산값은 전역값이 아니라 발주명/실발주항목별 값이며, 사용자가 `발주명 확인` 탭 또는 체크 입력 행에서 후보 선택 시 `confirmed`, 직접 숫자 입력 시 `manual`로 저장한다.
- 최신 엑셀 비교와 `/sfaPriceHistory/latest`의 exact `mappedName` 가격은 비저장 후보 증거로 사용할 수 있다. canonical append-only `/sfaAnalysisRuns/{runId}`에는 정규화 행과 선택 시트 전체 셀 `sourceTable`이 있어 로컬 파일 삭제 뒤에도 재분석·원문CSV export가 가능해야 한다. 가격은 Excel direct `단가` 우선, 없으면 `금액÷수량`이며 수량 0 direct 단가도 유효하다. 후보는 alias를 자동 변경하지 않는다.
- 오차보기의 사용자 명시 선택/신규 품목 생성은 `orderSiteMappings`와 `orderAliasMappings`를 함께 갱신한다. 같은 정규화 이름이라도 원문+단위 identity가 다르면 별도 site key로 보존하고, 자동 고신뢰 후보는 `candidate`일 뿐 확정하지 않는다. 수량 `0`, 빈 배열, 충돌 상태도 current/history/effective read model에서 지우지 않는다.
- SFA에 처음 보인 원문+단위는 fuzzy 점수가 높아도 자동 매칭하지 않고 `신규 발주 원문`으로 표시한다. 사용자가 기존 canonical 품목을 명시 선택한 뒤에만 local overlay `bbq_local_new_source_aliases_v1`에 저장하며, 원격 current 새로고침 뒤에도 overlay를 다시 합쳐 기존 확정 매핑과 재고 draft를 잃지 않는다.
- 단위 보정은 환산계수, 묶음단위, 최소발주단위, 표기 보정으로 제한하며 다음 발주량 계산과 엑셀분석 요청에 반영한다.
- `orderSiteMappings`, `orderAliasMappings`, `orderUnitCorrections`, `orderManualItems`는 localStorage, Firebase `/order/desk_q7m9r3a8/current`, `/history/{date}` payload에 분리 저장한다. `orderAliasMappingDrafts`는 후보/default와 사용자 `unlinked` 상태 및 `orderUnitToStockFactor` 의미를 보존한다. `effectiveOrderAliasMappings`는 `unlinked`를 제외하고 `confirmed/manual` 우선 후 없으면 default를 쓰는 엑셀분석용 read model이다.
- 로컬 분석 누적 이력 key는 `bbq_sfa_analysis_history`다. ledger v2 record는 `runId/source/date/file/items[]`, event는 stable `eventId`와 `eventAt/rowIndex/rawIdentity/originalName/mappedName/aliasName/quantity/actualOrderQty/unit/amount/sourceRunIds`를 보존한다. 같은 run 재수신은 최신 event 기준 idempotent merge하고, 물리 원천이 같은 local/Firebase mirror는 한 event로 합치되 모든 `sourceRunIds`를 남긴다. 다른 run과 같은 품목의 여러 원본 행은 append한다. current/history payload의 canonical `sfaOrderLedger`만 전체 event를 가지며 legacy history field는 compact pointer다.
- 실사용량 AI 분석은 브라우저 직접 모델/API key가 아니라 기존 `/monitor/main_pc/sfa_order_request`의 bounded `aiUsageAnalysis.evidence` 계약으로 PC/SiteBot worker에 전달한다. 브라우저는 `/order/desk_q7m9r3a8/aiUsageAdvisory/latest`의 top-level `analysisRunId/generatedAt/status/items/audit` 결과를 advisory-only일 때만 읽고, 각 item에 run/time/status를 붙여 참고 배지로 표시한다. invalid/unknown-only/과거 retry는 fail-closed로 기존 값을 유지하며 `overrides/*/l`, 수동 환산, 재고, 실제 발주값을 자동 변경하지 않는다.
- DB에서 읽은 구역/entry id/AI 문구는 HTML escape하고 행 버튼은 한 번만 붙는 delegated listener로 처리한다. 저장 데이터가 inline handler나 DOM으로 실행되면 안 된다.
- 실발주 이력은 `/order/desk_q7m9r3a8/sfaActualHistory/{date}`, 누적 가격 read model은 `/order/desk_q7m9r3a8/sfaPriceHistory/latest`, 단위/실사용 추정 리포트는 `/order/desk_q7m9r3a8/unitInference/latest`에 남긴다. 가격 필드가 없는 legacy 행을 `0원`으로 만들거나 newer mirror가 같은 원본의 실제 금액을 지우면 안 된다.
- 로컬 SFA 엑셀 이력의 모든 발주 행은 OrderHelper MASTER 품목에 고신뢰 매핑되어야 한다. 부족한 품목은 전역 threshold를 낮추지 말고 명시 alias 또는 웹 마스터 보강으로 처리한 뒤 백필한다.
- SFA 의미가 다른 품목은 숫자 통과를 위해 기존 MASTER에 묶지 않는다. 예: `BBQ충진식패티(100g)(마일드)`, `BBQ페퍼로니씬피자`는 `두마리치킨,파더스`와 별도 target이다.
- 정적 프론트 인증은 2026-07-17 등록창 실접속으로 확인된 개인폰 1개·공장PC 일반 브라우저 1개·공장PC Codex 앱 내 브라우저 1개의 exact SHA-256 hash 세 개만 거리·PIN·네트워크와 무관하게 자동 진입한다. 미등록 브라우저는 PIN(또는 동일 SHA-256 비밀번호)만으로 잠금 해제하며, 올바른 PIN 뒤에 `verifyAuthFactor()`/GPS/데스크탑 등록을 차단 조건으로 두지 않는다. 이름/label이나 `/desktopAccess` candidate row만으로는 passwordless 근거가 되지 않는다.
- 사용자 명시 1시간 등록창은 `/desktopAccess/registrationWindow`의 `enabled/windowId/startsAt/expiresAt/autoApprove=false`가 네트워크에서 fresh 확인되고 최대 1시간 범위 안에서 active일 때만 unknown 단말을 임시 진입시킨다. 진입 전 `/desktopAccess/registrationCandidates/{windowId}/{tokenHash}`에 raw token 없이 display-only 이름·환경 증거를 PATCH하며, 창을 다시 읽어 같은 active window임을 확인한다. disabled/expired/network failure/write failure는 fail-closed다.
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
- 최신 배포판 기준: `20260816-02` / `0816.2151` / SFA view uses original sfaSeq only. 상단에서 미입력 재고 수와 다음 칸 이동을 바로 쓰고, 숨김 행은 재고 Enter 다음 대상으로 쓰지 않는다. 예상매출은 수정 가능하며 입력/blur 즉시 current+history에 동기화한다. 재고 숫자 Enter 게이트와 분리한다. 필요량 숫자와 추천발주 숫자는 같은 28px 첫 줄의 수평선에 배치하고 분석·예상금액은 그 아래에 표시한다. 표는 `구역 → 품목명 → 재고 → 필요량 → 추천발주` 순서이며, 재고까지 왼쪽 고정 열로 유지해 가로 스크롤 중에도 연속 입력할 수 있다. 발주 0행도 확인된 단가를 compact card로 표시하고 실제 누락만 `단가 확인 필요`로 구분한다. 구역은 기존값 선택과 수기 입력을 함께 지원한다. `직사각용기1(190,감자)`와 `직사각용기2(230,치즈스틱)`는 별도 품목·별도 실발주명·별도 가격으로 처리하며, 과거 합본 재고는 1호에 한 번만 이관하고 2호를 빈 재고로 추가해 중복하지 않는다. SFA의 20G 소포장/58G 조리용 시즈닝은 규격을 지우지 않고 각각 25g/58g 체크 품목에 고정 연결하며, `JHP종이봉투(대)`는 대/소 통합 체크 품목의 우선 원명으로 쓴다. 기존 이름 연결·숫자 보정 2단계, `연결 안 함`, compact save status, exact hash 자동 진입, 저장/CAS/수동값 보호는 유지한다.
- 완료 포인터: `20260717-23 Align need and recommended-order numbers`; 이전 포인터 `20260717-22 Keep stock input beside item names`, `20260717-21 Show idle unit prices and split rectangular containers`.
- 완료 검증: `node tests/orderhelper_static_checks.js`, `node tests/orderhelper_inventory_matching_regression.js`, `node tests/orderhelper_single_grid_ledger_regression.js`, `node tests/orderhelper_p1_review_regression.js`, `node tests/orderhelper_autosave_regression.js`, `python3 tests/orderhelper_autosave_browser.py`, `python3 tests/orderhelper_expand_viewport_browser.py`, inline JS syntax, `git diff --check`. 로컬 Playwright는 Firebase를 interception해 ETag pair-CAS, IME/change/Enter, stored-XSS, delegated listener와 390×844 펼침/접기 viewport anchor를 검증한다. 실제 공장 PC/SiteBot worker·live 배포 검증은 별도 확인 대상이다.
- 운영 감시: 서버폰 Termux AI Ops가 PC/SiteBot 상태와 SFA 요청 정체를 감시한다. 앱 코드 변경 없이 감시만 바뀐 경우 APK/웹 배포는 필요 없다.
- 남은 위험: 실기기 키보드 이벤트 차이, SFA 화면 변동, 재고 변동 기반 환산은 실발주 반영 기록이 쌓인 뒤 안정화됨, 과거 producer가 버린 금액은 원본 Excel 재분석 없이는 복구할 수 없음, PC/SiteBot이 꺼지면 Termux는 감지만 가능하고 실제 SFA 파일 스캔은 못 한다.

## 2026-07-22 handoff
- APP_VERSION 0722.0229 adds an explicit cross-device inventory reset epoch. A newer Firebase `syncReset` marker is applied before dirty-draft and confirmed-queue protection, discards stale local inventory/actual-order drafts and confirmed retry queues once, then accepts the reset server snapshot. Configuration such as route zones, aliases, manual items, unit corrections, sales settings, and the lossless SFA ledger remains in the server snapshot. Startup checks the reset marker before retrying an old queue, and in-flight saves are fenced by a reset generation.
- APP_VERSION 0722.0215 turns SFA ordering into a work queue: unmatched, conflicting, and unconfirmed aliases are first; positive effective order quantities are next; zero quantities and hidden rows move down. Initial SFA order remains stable inside each band. Unmatched SFA source rows render above the grid in SFA mode with the existing alias/new-item controls, while all sort inputs are cached once per render and persistence payloads remain unchanged.
- APP_VERSION 0722.0204 keeps the same inventory grid semantics across devices. Mobile remains a vertically aligned compact list; PC fluidly expands the sticky zone/name/stock tracks, order evidence column, and route-group editor across the available viewport instead of leaving wide-screen space unused.
- The detail toggle restores the full editable card (usage, daily amount, unit, row actions, matching controls, and amount evidence) only when requested; collapsed rows remain compact with no horizontal overflow.
- Remaining verification pointer: live GitHub Pages reflection plus actual Codex in-app-browser list screenshot after deployment, without live order/payment/Firebase writes.

## 2026-08-23 handoff
- Matching: SFA original names for 필크런치플레이크/소스, 버라이어티팩패키지, 피자비닐봉투, BBQ종이봉투(대) are new MASTER targets with daily 0. One-off 햄야채볶음밥, 등심돈까스(통살), 황금죽 are not MASTER. Do not alias 피자비닐봉투 onto 비닐-BBQ비닐봉투(소), merge 대/소 vinyl bags, merge BBQ종이봉투(대) onto JHP종이봉투(대)or(소), merge 1호/2호 containers, or merge 마늘/파더스 two-piece chicken.
- `BBQ두마리치킨(파더스치킨)(국내산)` and `(신규)BBQ비닐쇼핑백(대)` are aliases only onto existing MASTER `두마리치킨,파더스` and `비닐-(신규)BBQ비닐쇼핑백(대)`.
- Static `DEFAULT_ORDER_UNIT_TO_STOCK_FACTORS`: 냉동-핫윙,비비윙스 N=10 and 냉동-떡볶이(16개) N=16. Check in 개, order in 박스, qty=ceil(need/N). User-saved corrections still override; do not write these N values to live Firebase.
- Baseline sales default is 268.06만원 (MATE daily POS 2026-06-01..08-21 / 82 days). Need scales by expected/baseline ratio, not by adding expected onto baseline.

## 2026-08-23 inbound-window daily
- APP_VERSION 0823.0405 replaces 83-day even period averages with inbound-to-cutoff windows × real MATE daily POS. `daily = qty_stock * baseline_won / sales_in_windows`. Baseline 268.06만원. Last incomplete inbound dropped. Unknown-N 개/박스 (멘보샤, 바사칸윙, 크런치너겟, 두마리치킨·파더스, 필크런치플레이크, 스티커T) keep previous MASTER.daily. Single-inbound items keep 83-day values. `overrides.k` unchanged. Unit prices unchanged.

## 2026-08-23 PIN-only login
- APP_VERSION 0823.0408 removes `#deviceNameInput` / 단말 이름 from the PIN overlay. Note and locked copy are `PIN을 입력하세요.` Trusted passwordless hashes still auto-unlock. Correct PIN hash unlocks immediately without `verifyAuthFactor()` as a blocker. `ensureAuthDevice()` stays null-safe and defaults leftover desktopAccess logging names to `단말`.

## 2026-08-23 agent-pc passwordless trust
- APP_VERSION 0823.0416 adds SHA-256 `50329b86dec951289d905364f156d5fd620400284d984a818cd84fd2e21e3395` to PASSWORDLESS_TRUSTED_DEVICE_HASHES and AUTH_GEO.allowedDevices as enabled agent-pc / user_this_pc. Existing three hashes stay. restoreAuthIfPossible still auto-unlocks trusted hashes without PIN. PIN overlay stays PIN-only (no 단말기명). PIN_HASH, MASTER dailies, prices, and buffers unchanged.

## 2026-08-25 oil freeze + keep overrides.l
- `(신)올리브오일` 일사용은 소비량이 아니라 최대 교체량이다. `OIL_REPLACEMENT_ITEMS=['(신)올리브오일']`. `calcG = max(0, L+K-E)`. 최근/3개월 혼합, 예상매출 가중, 화 3.5 선입고, 냉장고 매출스케일을 적용하지 않는다. `MASTER.daily`는 live 0825.0746 값 1.09로 동결. MUST_HAVE 여유 4, `getK` 유지. 발주량은 기존 `recommendedOrderQty` ceil.
- 화 3.5 / 목 4 / 토 3 일수 분할이 주 3회 입고 금액을 비슷하게 만든다. 오늘 총액을 250~320만 상자로 클램프하지 않는다.
- 냉장고 10호 leftover ≤9, 장사필수 매출스케일 면제, 벌크신선통날개 화 3.5→3 는 유지한다.
