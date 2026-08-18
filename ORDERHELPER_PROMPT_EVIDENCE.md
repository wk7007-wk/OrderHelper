# OrderHelper User Prompt Evidence

이 문서는 Constitution의 근거 포인터다. 모든 fork/resume 중복, `계속/진행`, 음성 오타의 동일 의미, AGENTS/environment wrapper를 제거하고 OrderHelper 고유 의도만 날짜별로 정규화했다. BankTotal 등 다른 앱의 SFA 발화는 제외했다.

## 판정 규칙

- 최초 범위: 2026-05-05 최초 설계부터 2026-07-30 최신 지시까지의 local Codex user input_text.
- 최신의 명시적 정정이 이전 가정·구현·테스트를 대체한다.
- 질문은 자동 규칙으로 승격하지 않고, 뒤의 사용자 확인 또는 반복 요구가 있는 경우만 채택한다.
- 원문 전체는 아래 rollout 경로가 증거이며 이 문서는 짧은 의미만 보존한다.

## 날짜별 의도와 정정

| 날짜 | 정규화한 사용자 의도 | 현행 판정 |
|---|---|---|
| 05-05 | 사람이 재고를 파악하고, 필요한 기간 사용량과 재고 차이로 발주량을 같은 위치에서 본다. | 목적 조항의 기준점 |
| 05-14 | 출력에서 품목 옆 발주량, 입력에서 재고 reset과 저장 이력, 날짜별 발주 이력이 필요하다. | 명시 reset/receipt/history로 구현 |
| 05-17 | 입력은 구역 공간순, 출력은 이미 정한 SFA 순서다. 구역 이동을 최소화한다. | 입력순과 최초 SFA순 분리 |
| 05-26~28 | Enter 후 다음 재고칸, 정렬로 focus가 튀지 않음, 헤더가 입력을 가리지 않음. | 입력·geometry gate |
| 05-31 | 재고 전후와 실제 발주 누적으로 실사용량·단위차를 추정한다. | 누적 advisory evidence |
| 06-02 | 폰/PC 발주일과 상태가 동기화되고 입력/출력 계산이 같아야 한다. | 같은 canonical/resolver |
| 06-07 | 발주량 0.1 표시, 재고/K/L 변경 즉시 계산, 목·금 4일·그 외 3일, 빈 값도 동기화한다. | 계산 최신 기준 |
| 06-07 | 체크단위와 발주단위가 다르면 재고변동과 실발주로 추정한다. 사용자는 기술 단위를 직접 관리하지 않는다. | factor 후보 자동, 확정은 사용자 |
| 06-16 | 출력순서를 최초순서로 원복한다. 분석은 참고일 뿐 수동 일사용량을 바꾸면 안 된다. | 자동 K/L 적용 폐기 |
| 06-21 | 실발주·재고·매출가중 근거를 누적하고 예상금액도 본다. | append-only evidence와 가격 |
| 07-07 | alias와 factor 후보를 AI/로직이 기본값으로 제안하되 사용자가 검수·수정·확정한다. | default != confirmed |
| 07-07 | factor는 `1발주 = 재고 N개`; 내부 비교는 재고단위로 통일한다. | factor 방향 고정 |
| 07-09 | 계산은 즉시여도 입력이 느려지면 안 된다. SFA 신규 원문은 코드 수정 없이 연결/생성 가능해야 한다. | row-only input path, manual item |
| 07-09 | 엑셀 분석은 일회성이 아니라 누적으로 패턴과 사용량을 파악한다. | run append-only |
| 07-12~13 | 중복·버그가 많아 rollback. Next 후 reset, 저장 먹통, 출력 재고 불일치, 소수 누락을 하나씩 고친다. | greenfield 회귀 fixture |
| 07-14 | 입력/출력 별도 탭 대신 한 화면, 모드 차이는 정렬뿐이다. 입력은 카테고리/구역순, 발주는 최초 발주순이다. | one-grid 헌법 |
| 07-14~16 | 별명·단위·미매칭 탭 중복을 줄이고 실제 단가·예상액·미확정 사유를 보여준다. | 단일 resolver/issue |
| 07-20 | 며칠 숨긴 품목을 살리고 수동 해제할 수 있어야 한다. | snooze recovery |
| 07-21 | 반응이 느리고 카테고리 수정이 즉시 목록에 반영되지 않는다. | local patch + bounded render |
| 07-26~27 | 폰의 발주항목이 PC로 안 가고 충돌한다. 양쪽 기능은 같고 교집합을 잃지 않아야 한다. | per-domain/per-key merge |
| 07-29 | Firebase/Google 트래픽 초과로 발주가 먹통이 됐다. | 대용량 polling/PUT 금지 |
| 07-30 | 펼침 렌더로 화면이탈, 폰/PC 충돌, 국소패치 아닌 전체 greenfield 재작성, 최초 SFA순 복원. | v2 전체 scope |
| 07-30 | 기존 사용자 프롬프트를 먼저 취합해 헌법을 세운 뒤 진행한다. | 구현 선행 gate |

## 명시적 supersession

| 폐기된 과거 방향 | 최신 사용자 기준 |
|---|---|
| 토·일·월 4일 같은 오래된 추천일 가정 | 목·금 4일, 그 외 3일 |
| 분석 평균을 K/L에 자동 할당 | 분석은 참고, 수동 K/L 자동 변경 금지 |
| 매칭필요 → 발주양수 → 0의 작업 우선순위를 SFA순으로 사용 | MASTER 최초 `sfaSeq` 고정 |
| 전체 LWW snapshot과 phoneWins | 독립 domain/key 병합, 전체 덮어쓰기 금지 |
| 입력/출력/별명/단위 탭별 별도 상태 | 한 표와 한 resolver |
| 매 입력마다 전체 계산·저장 | local row 계산과 완료 commit 분리 |
| latest 엑셀 한 건 중심 | append-only run과 누적 evidence |
| 기기별 local alias overlay | canonical mapping+tombstone |

## 대표 원문 rollout 포인터

- 최초 목적: `/root/.codex/sessions/2026/05/05/rollout-2026-05-05T15-20-00-019df8b9-82a3-7a70-8621-21a50a7f2e03.jsonl`
- 공간순/출력순: `/root/.codex/sessions/2026/05/15/rollout-2026-05-15T17-35-46-019e2cb5-67c4-7001-8f15-0496933c6c71.jsonl`
- 계산·동기화·단위: `/root/.codex/sessions/2026/06/07/rollout-2026-06-07T15-24-30-019ea2af-7c9f-7240-9379-7d72de935033.jsonl`
- 최초순 원복/수동값 보호: `/root/.codex/sessions/2026/06/15/rollout-2026-06-15T21-27-29-019ecd2e-ae54-70e1-b537-b4d20ff3eedc.jsonl`
- alias/factor 사용자 확정: `/root/.codex/sessions/2026/07/07/rollout-2026-07-07T18-13-42-019f3dc9-2985-7092-80ac-b38b2113b2c3.jsonl`
- one-grid와 구조 정정: `/root/.codex/sessions/2026/07/13/rollout-2026-07-13T19-01-22-019f5cda-f894-7172-a7a3-dee11ed0f2d1.jsonl`
- 폰/PC 충돌: `/root/.codex/sessions/2026/07/26/rollout-2026-07-26T17-48-14-019f9f8a-afcd-7c20-b60f-d547e8f0f7c7.jsonl`
- 최신 greenfield/헌법 지시: `/root/.codex/sessions/2026/07/29/rollout-2026-07-29T14-50-32-019fae5b-162f-7511-8dc7-3d422c46681d.jsonl`

## 대조한 보조 자료

- `APP_INTENT.md`: 현재 사용자 결과와 절대 기준
- `CODEMAP.txt`: 실제 코드·Firebase·SiteBot 소비 경계
- `ORDERHELPER_UNIFIED_ROW_CONTRACT.md`: resolver와 가격 계약
- Claude memory `orderhelper.md`: 2026-05-10 당시 구조 증거. 현재 규칙으로 사용하지 않음.
- 2026-07-31 read-only 진단: live current/history hash는 같지만 whole-snapshot merge가 독립 변경을 지우며 current payload는 약 2.2MB.
