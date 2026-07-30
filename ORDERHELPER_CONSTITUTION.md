# OrderHelper Constitution

- constitution_version: `20260731.0252-KST`
- effective_at_kst: `2026-07-31T02:52:00+09:00`
- status: `ACTIVE_FOR_V2_DESIGN`
- authority: 루트 `AGENTS.md`의 안전·협업 규칙 아래에서 OrderHelper 제품 의도의 단일 기준
- evidence: `ORDERHELPER_PROMPT_EVIDENCE.md`
- digest_receipt: `ORDERHELPER_CONSTITUTION_RECEIPT.json`
- digest_method: 각 파일의 UTF-8 raw bytes에 `SHA-256` 적용. self-reference를 피하기 위해 현재 digest 값은 receipt 파일에 둔다.
- supersession: 더 최신의 명시적 사용자 정정이 이전 구현·테스트·문서를 대체한다.

## 0. 적용 규칙

1. 구현 전 이 문서와 evidence를 읽고 constitution hash를 작업 receipt에 남긴다.
2. 코드·테스트·기존 문서가 이 문서와 다르면 코드를 정답으로 보지 않는다.
3. 규칙 변경은 사용자 정정 근거와 acceptance 변경을 함께 기록해야 한다.
4. 모순이 해소되지 않으면 임의 선택하지 않고 fail-closed로 보류한다.
5. 현재 v1 live와 DB는 v2 검증 완료 전까지 rollback 기준으로 보존한다.

## 1. 목적과 비목적

- 목적은 직원이 공간별 재고를 빠르게 입력하고, 같은 화면에서 결정론적으로 필요한 SFA 발주량과 예상금액을 확인하는 것이다.
- 폰과 PC는 같은 기능·같은 의미·같은 canonical state를 사용한다.
- SFA 엑셀 분석은 실발주·단가·사용량·환산의 누적 근거를 제공한다.
- 실제 SFA 주문 제출은 별도 승인과 안전 흐름이 필요한 비목적이다. 분석 버튼이나 v2 동기화가 주문을 실행하면 안 된다.

## 2. 하나의 표, 하나의 resolver

- 입력과 출력은 별도 데이터 화면이 아니다. 같은 행·같은 itemKey·같은 resolver를 쓴다.
- 화면, 합계, Firebase projection, SFA 요청, JSON/CSV export가 서로 다른 계산기를 가지면 실패다.
- resolver는 최소한 다음을 한 번에 산출한다.
  - `itemKey`, `canonicalSeq`, `entries`, `stockTotal`, `K`, `L`
  - `orderDays`, `salesWeights`, `stockNeed`, `orderUnitToStockFactor`, `recommendedOrderQty`
  - `actualName`, `matchStatus`, `actualOrderQty`, `unitPrice`, `expectedAmount`
  - `sourceRunId`, `sourceRowIndex`, `provenance`, `issues`
- 매칭 상태는 `MATCHED`, `CANDIDATE`, `ALIAS_CONFLICT`, `UNIT_UNCONFIRMED`, `ITEM_UNMATCHED`, `ITEM_UNLINKED`를 구분한다.

## 3. 정렬 헌법

### 입력순

- 입력순은 실제 매장 공간인 구역 순서가 우선이다.
- 같은 구역 안에서는 이동을 최소화하고 미입력 재고를 먼저 처리한다.
- Enter 또는 모바일 Next 후 다음 미입력 재고칸으로 이동하며 focus·caret가 리렌더로 튀면 실패다.

### 최초 SFA 발주순

- `SFA 발주순`은 `MASTER.sfaSeq ASC`가 절대 기준이다.
- 동률은 canonical name, 그 다음 stable `entryKey`로 정렬한다.
- 최신 SFA 원문의 `row_index`는 source-only 미연결 행의 순서와 identity에만 사용한다.
- 매칭 필요, 발주량 양수, 발주량 0, 숨김 같은 작업 우선순위는 색·배지일 뿐 순서를 바꾸지 않는다.
- 수동 품목은 영속 `canonicalSeq`를 받아 MASTER 뒤의 안정 구간에 둔다.
- 사용자 지정 `outputOrder`와 "작업 필요 우선"을 `SFA 발주순`이라 부르는 구현은 폐기한다.

## 4. 입력과 반응성

- 숫자 입력은 즉시 local draft와 현재 행 계산만 갱신한다.
- 타이핑·IME composition·일반 blur는 원격 write를 만들지 않는다.
- Enter와 모바일 Next/change 같은 완료 동작만 immutable confirmed commit을 만든다.
- 한 키 입력에서 전체 표 render, 전체 resolver 재계산, 90일 ledger scan, network request를 실행하지 않는다.
- 저장·분석·동기화가 느려도 입력칸은 멈추거나 값이 리셋되면 안 된다.
- 0, 소수, 빈 값, `null`은 서로 다른 사용자 의미로 보존한다.

## 5. 계산 헌법

- `K`는 여유, `L`은 사용자 수동 하루사용량이다. 사용자가 입력한 K/L이 기본값보다 우선한다.
- SFA·AI·재고이력 분석값은 참고 evidence이며 K/L을 자동 변경하지 않는다.
- 추천 발주일은 최신 정정 기준 `목·금 4일`, 그 외 `3일`이다.
- 예상매출의 기준매출 기본값은 280이며, 일별 매출 빈 값은 weight 1, 명시적 0은 weight 0이다.
- Excel 동등 계산은 재고를 `E`, `M=L×첫날 weight`, `SUM=L×전체 weight 합`으로 두고 `E<M`이면 `SUM-M+K`, 아니면 `SUM-E+K`의 의미를 유지한다.
- 숨김 품목의 필요량과 추천발주는 0이다.
- 계산 입력이 바뀌면 같은 행 결과는 즉시 바뀌되 저장과 렌더 비용 때문에 입력이 느려지면 실패다.
- 표시 정밀도는 의미 있는 소수 0.1 단위를 보존한다.

## 6. 발주단위 환산

- `orderUnitToStockFactor=N`의 유일한 뜻은 `발주 1단위 = 재고/체크 N개`다.
- 필요 재고 25, factor 10이면 추천 발주는 `ceil(25/10)=3`이다.
- 실제 발주 2, factor 10이면 재고 입고 근거는 20이다.
- factor를 가격에 다시 곱하지 않는다. 예상금액은 `추천 발주수량 × 발주 1단위 가격`이다.
- 같은 단위는 0.1 정밀도를 허용한다. 묶음 단위는 부족분을 만들지 않도록 올림한다.
- 재고 전후와 실제 발주 누적 이력은 factor 후보를 만들 수 있지만 자동 확정하지 않는다.

## 7. SFA 매칭과 누적 근거

- fuzzy·AI·동일문구 후보는 `candidate/default`이며 `confirmed/manual`로 위장하지 않는다.
- 사용자가 후보 선택·직접 입력·명시적 연결 해제를 할 수 있어야 한다.
- SFA에는 있으나 canonical 목록에 없는 원문 품목은 source-only로 보존하고 새 수동 품목 또는 기존 품목에 연결할 수 있어야 한다.
- `unlinked`는 자동 매칭·가격 fallback·AI 적용보다 우선한다.
- 실발주 이력, 0수량, 원명, 단위, 금액, row identity는 run 단위 append-only 증거로 누적한다.
- canonical SFA 원천은 `/sfaAnalysisRuns/{runId}`와 lossless `sourceTable`이다. latest·candidate·합계는 read model이다.
- 원문 CSV는 sourceTable만 사용하고 spreadsheet formula injection을 차단한다.

## 8. 가격과 예상금액

- run-backed 직접 단가가 우선이며, 없을 때만 `실발주금액 ÷ 실발주수량`을 사용한다.
- 0수량은 유효한 근거다. `0/0` 또는 매칭 충돌은 미확정으로 표시한다.
- 추천 3, 발주단가 2400이면 예상금액은 7200이다.
- 가격을 못 찾으면 짧은 사용자 사유와 provenance를 표시하고 임의 금액을 만들지 않는다.
- 전체 예상금액은 유효한 행만 합산하고 제외 건수를 함께 표시한다.

## 9. 동기화 헌법

- v2의 canonical state는 작고 하나이며 legacy `/current`·`history`는 projection이다.
- inventory, zones, K/L, sales, mappings, manual items, accepted advisory를 독립 domain과 per-key/per-field clock으로 병합한다.
- 삭제·빈 배열·빈 object·0·`null`은 tombstone/명시 값으로 구분한다.
- 시간값을 revision으로 사용하지 않는다. stable actor, sync epoch, Lamport counter를 사용한다.
- 폰 재고와 PC alias처럼 독립 변경은 둘 다 살아야 한다.
- 전체 snapshot winner, 전체 `phoneWins`, 미래 timestamp revision, 기기별 local overlay의 원격 재등장은 금지한다.
- local draft와 confirmed commit queue를 분리하고 offline·timeout·reload 뒤 exact commit을 재시도한다.
- canonical CAS receipt가 성공 기준이다. legacy projection 실패는 repair 대상으로 남기며 canonical 성공을 되돌리지 않는다.
- v1의 약 2058년 수준 revision은 v2로 승계하지 않고 migration receipt와 새 epoch로 격리한다.

## 10. 트래픽 헌법

- 2026-07-31 read-only 측정에서 v1 `/current`는 약 2.2MB다. 이를 5초마다 GET하거나 매 Enter마다 전체 PUT하는 구조는 금지한다.
- full SFA ledger와 sourceTable을 canonical sync state에 복제하지 않는다.
- 앱은 작은 head/domain 변경만 확인하고 바뀐 domain만 가져온다.
- immutable SFA run과 가격·사용량 read model은 별도 경로를 참조한다.
- projection·history·backup은 background repair와 명시 checkpoint에서만 갱신한다.
- size budget과 read/write 횟수는 테스트와 receipt에 남긴다.

## 11. 구역·숨김·화면

- 같은 품목이 여러 구역에 있어도 entry는 보존하고 계산은 itemKey 합계로 한다.
- 구역은 자유입력·기존 선택·그룹 이동·전체 rename을 지원하며 그룹 소속을 흩뜨리지 않는다.
- 품목은 N일 숨김, 수동 해제, 만료 복귀가 가능하고 다른 상태를 지우지 않는다.
- 모바일과 PC는 같은 DOM 의미와 데이터 흐름을 사용한다.
- 모바일 390×844에서 수평 overflow가 없어야 하고 펼침/접기 전후 viewport anchor를 유지한다.
- PC는 가로공간을 활용하되 별도 기능 구현으로 갈라지지 않는다.
- 별명·단위·미매칭을 같은 의미의 여러 탭으로 중복 노출하지 않는다.

## 12. 인증과 외부 경계

- 검증된 exact device identity만 자동 진입하고, 그 외는 `PIN+factor` 또는 아래의 엄격한 fresh 등록창 계약을 사용한다.
- 자동 진입은 실접속으로 확인된 exact device hash만 허용한다. 이름·label·candidate row는 자동 승인 근거가 아니다.
- 일반 미신뢰 단말은 `PIN + 거리 또는 명시 승인 factor`를 모두 통과해야 한다. PIN 단독으로 진입시키지 않는다.
- fresh 등록창은 `autoApprove=false`, 안전한 windowId, 최대 1시간, fresh network 재조회, candidate 기록 성공, 동일 active window 재검증을 모두 통과한 임시 진입만 허용한다. candidate를 영구 승인으로 승격하지 않는다.
- 네트워크·등록후보·검증 실패는 fail-closed다.
- 직원 화면에 device hash, 내부 token, GPS 거리, DB key를 노출하지 않는다.
- Firebase 동적 path key는 `. # $ / [ ] ?`, 공백, 제어문자를 sanitize하고 raw 값은 payload 필드에 보존한다.
- SFA 분석 요청 전 canonical commit receipt와 main-PC fresh preflight를 확인한다.
- SFA 파일 scan·원문 보존·비교 분석의 실행자는 PC/SiteBot이다. 서버폰 Termux는 요청·상태·heartbeat 정체를 감시하고 self-fix 진단으로 넘길 뿐 분석 원본 writer나 repo executor가 아니다.
- Termux 상주 monitor는 품목, mapping, factor, 수동 K/L, 실제 발주 원본을 자동 확정하거나 수정하지 않는다.
- actual SFA submit과 analyzer의 live 원본 write는 별도 business safety flow와 명시 승인이 없으면 실행하지 않는다.
- analyzer가 legacy current를 읽거나 actualOrders를 직접 PATCH하는 동안 v2를 sole writer로 승격하지 않는다.

## 13. migration과 rollback

- v2 localStorage는 `orderhelper_v2_*` namespace만 쓴다.
- v1 localStorage와 live current/history는 read-only import하며 삭제하지 않는다.
- migration receipt에는 v1 ETag/hash, local snapshot hash, domain별 변환 결과를 남긴다.
- shadow 단계는 v2 canonical과 UI를 검증하되 v1 current를 쓰지 않는다.
- cutover는 analyzer 호환 projection과 두 기기 검증 후 별도 승인으로 한다.
- rollback은 URL/feature flag를 v1으로 돌리고 projector를 멈추는 것으로 즉시 가능해야 한다.

## 14. 완료 게이트

- 정렬: exact `sfaSeq`, 동률 안정성, source-only row_index, 작업 우선순위 미개입.
- 계산: 목·금 4일, 기타 3일, K/L, 매출 blank/0, hidden, multi-zone, decimal, factor 방향.
- 입력: PC Enter, 모바일 Next/change, IME, rapid input, focus/caret, 펼침 viewport.
- 매칭: candidate/manual/unlinked, 신규 source, 수동 품목, tombstone, 가격 provenance.
- sync: phone stock+PC alias, phone sales+PC correction, same-key conflict receipt, offline/reload, bounded CAS retry, clock skew.
- SFA bridge: request receipt, current projection, compare, actual history, sourceTable export.
- 보안: trusted/unknown/expired/network failure와 path-key sanitize.
- traffic: steady-state small head/domain I/O, full 2.2MB polling/commit 0회.
- 화면: 390×844, tablet, wide PC actual browser geometry.
- rollback: v2 사용 후 v1 UI가 projection으로 열리고 핵심 계산이 일치.
- live 완료 보고는 `source revision/hash → hosted artifact/hash → fresh DB/render receipt → 두 기기 물리 증거`를 분리한다.

## 15. 금지된 회귀

- 테스트가 통과한다는 이유로 잘못된 과거 계약을 유지하지 않는다.
- 분석값으로 수동 K/L·재고·확정 mapping을 덮지 않는다.
- 입력/출력/탭마다 별도 state와 계산을 만들지 않는다.
- `SFA 발주순`에 매칭필요·양수·0 우선순위를 섞지 않는다.
- 폰/PC 충돌을 전체 덮어쓰기로 해결하지 않는다.
- 대용량 current/ledger를 상시 폴링·전체 저장하지 않는다.
- local build, hosted artifact, DB 반영, 물리 두 기기 검증을 같은 완료 증거로 보고하지 않는다.
