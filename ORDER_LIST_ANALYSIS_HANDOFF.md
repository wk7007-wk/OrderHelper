# OrderHelper Order List Analysis Handoff

## 목적
- 이 문서는 Claude가 `발주리스트` 기준으로 `OrderHelper`를 빠르게 분석하고 다음 작업을 이어받기 위한 인계용 MD다.
- 구현 완료 문서가 아니라, 현재 확인된 구조와 남은 분석 갭을 정리한 문서다.

## 먼저 볼 파일
- `/root/OrderHelper/index.html`
- `/root/my-first-project/AI_HANDOFF.md`
- `/root/my-first-project/CODEMAP.txt`
- `/root/my-first-project/rules/openclaw.txt`

## 현재 범위
- 대상 프로젝트: `OrderHelper`
- 역할: 직원폰 재고입력 웹 + Firebase `/order/` 기반 발주 보조
- 현재 확인 수준:
  - `발주리스트` 원본 엑셀 구조 파악됨
  - `OrderHelper` 웹 UI 구조 파악됨
  - BBQ SFA 발주창은 별도 자동입력 대상이며, 아직 구현 전 조사 단계

## 2026-05-28 엔터 문제
- 상태: **미해결 보고 후 진단/보강 진행**. 실기기에서 확인되기 전까지 해결 완료로 쓰지 않는다.
- 최근 이력: `c636ff4 발주 모바일 엔터 이동 보강` 이후에도 현장에서는 엔터/다음 이동 문제가 남았다고 보고됨.
- 현재 가설: 모바일 숫자 키보드가 `keydown Enter`를 보내지 않고 `change`만 보내면, 기존 `change` 핸들러가 현재 입력칸이 active라는 이유로 다음 재고칸 이동을 스킵할 수 있었다.
- 2026-05-29 보강: `index.html` `APP_VERSION=20260529-3`. `advanceStockInput()` 공통 헬퍼와 `change` fallback을 추가해, active가 현재 재고칸이면 다음 재고칸으로 이동하게 함.
- 2026-05-29 추가 진단: Enter 후 오른쪽 `여유/일사용` 등 다른 input으로 먼저 이동하는 케이스를 잡기 위해 `keydown/input/change/보정/이동` 로그를 화면 `자동저장 기록`과 Firebase `current.debugLogs`에 남김.
- 테스트: `node tests/orderhelper_static_checks.js` 로 JS 문법, 버전, Enter/change fallback 연결을 확인한다.
- 실기기 확인 기준: PIN 통과 → 첫 재고칸 입력 → 모바일 키보드 `다음/엔터` → 다음 재고칸 focus+select → 저장 상태가 `저장 대기/저장됨`으로 이어지는지 확인.

## 원본 기준
- 엑셀 원본: `/sdcard/Download/출근260414.xlsm`
- 시트명: `발주리스트`
- 기존 조사 기준 핵심 컬럼:
  - `E`: 현재재고
  - `F`: 품목명
  - `G`: 계산 발주량
  - `H`: 단위
  - `K`: 여유분
  - `L`: 하루사용량
  - `M:T`: 일자별 필요량
  - `V/W/X`: 단가/금액
- 현재 판단:
  - 실 발주 입력의 핵심값은 `F 품목명`, `G 계산 발주량`, `H 단위`
  - 금액 컬럼은 참고값이고 자동입력 1차 필수값은 아님

## 웹 구조
- 메인 파일은 단일 페이지: `/root/OrderHelper/index.html`
- 현재 버전 표시는 `APP_VERSION` 상수 기준.
- 헤더: 앱 제목, 발주 개수 배지, 발주일수 선택, 입력/출력 전환, 저장 버튼, 저장 상태.
- 매출 행: 기준매출, 일자별 예상매출, 가중 평균.
- 입력 화면: `미입력 → 입력완료 → 숨김` 우선순위와 `구역` 기준으로 재고 입력칸을 보여준다.
- 출력 화면: 발주량 있는 항목만 `발주 D순`으로 보여준다.
- 재고 입력 Enter 이동 핵심 구간: `focusNextStockInput()`, `advanceStockInput()`, `shouldFallbackAdvanceFromChange()`, `input.cell[data-field="stock"]` 이벤트 바인딩.

## 데이터 구조
- Firebase 경로: `/order/desk_q7m9r3a8`
- 품목 정의는 현재 `index.html` 안의 `MASTER` 상수에 하드코딩되어 있다.
- 각 품목은 대체로 아래 필드를 가진다.
  - `name`
  - `sfaSeq`
  - `unit`
  - `policy`
  - `buffer`
  - `daily`
- 현재 구조상 계산 로직은 엑셀을 읽는 방식이 아니라 웹 내부 품목 정의 + 입력 재고 기반 계산에 가깝다.

## 발주리스트와 웹의 대응
- 엑셀 `F 품목명` ↔ 웹 `ALL_ITEMS[].name`
- 엑셀 `L 하루사용량` ↔ 웹 `ALL_ITEMS[].daily`
- 엑셀 `K 여유분` ↔ 웹 `ALL_ITEMS[].buffer`
- 엑셀 `H 단위` ↔ 웹 `unit` / `orderUnit`
- 엑셀 `G 계산 발주량` ↔ 웹 계산 결과 + `발주 목록` 모달 표시값

## 이미 확인된 리스크
- 원본 엑셀 수식 행 참조 오타 가능성:
  - `11`
  - `44`
  - `47`
  - `86`
- 따라서 엑셀 수식을 그대로 앱 로직으로 옮기면 오판이 전파될 수 있다.
- BBQ SFA 자동입력에 필요한 정보는 아직 부족하다.
  - `상품코드`
  - `탭/카테고리`
  - `별칭`
  - `주문단위 환산규칙`
- 즉 현재 상태로는 `발주량 계산 보조`는 가능해도 `SFA 자동입력`까지 바로 연결하기엔 데이터가 모자란다.

## 현재 결론
- `발주리스트` 분석은 1차 완료로 봐도 된다.
- 다음 핵심은 계산 로직 추가보다 `품목 매핑 테이블` 분리 여부 판단이다.
- 구현을 바로 시작할 때 우선순위는 아래 순서가 맞다.
  1. `ALL_ITEMS`와 엑셀 품목명 차이 표 정리
  2. BBQ SFA 화면의 실제 품목명/단위/입력칸 구조 확정
  3. 환산규칙이 필요한 품목 식별
  4. 그 다음에만 자동입력 설계

## Claude가 바로 볼 포인트
- `index.html`에서 확인할 구간:
  - 헤더/매출 입력/저장 상태 UI
  - `MASTER`
  - `focusNextStockInput()` / `advanceStockInput()` / stock input 이벤트 바인딩
  - 계산 로직
  - Firebase 저장/로드 함수
- `tests/orderhelper_static_checks.js`:
  - JS 문법과 Enter fallback 연결 정적 검증
- `AI_HANDOFF.md`에서 확인할 구간:
  - `BBQ 발주 자동화 조사`
  - `OrderHelper 엔터 이동 미해결`
- `CODEMAP.txt`에서 확인할 구간:
  - `13. BBQ 발주 자동화 조사 (2026-05-06)`

## 다음 작업 제안
- 분석만 이어갈 경우:
  - `index.html` 계산식이 엑셀 `G 계산 발주량`과 얼마나 같은지 비교
  - 품목명 표준화가 필요한 항목 목록화
- 구현까지 갈 경우:
  - `품목 매핑 JSON` 별도 분리
  - `SFA 자동입력용 별칭/코드/단위 환산` 구조 추가
  - `발주 목록`을 SiteBot/메인PC 입력 포맷으로 직렬화
