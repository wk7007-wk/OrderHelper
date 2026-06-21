# OrderHelper APP_INTENT.md

## 만든 이유
- BBQ 재고를 사람이 빠르게 입력하고 발주량을 계산해 SFA 입력 부담을 줄인다.

## 사용자 결과
- 모바일에서 재고 입력 흐름이 끊기지 않아야 한다.
- 출력 순서와 발주량이 최초 SFA 발주 동선에 맞아야 한다.

## 절대 기준
- SFA 자동입력은 품목명, 단위, 별칭, 환산 규칙이 확정된 뒤에만 진행한다.
- 계산식과 사용자 입력 기록은 화면 정리 때문에 숨기거나 잃지 않는다.
- 모바일 키보드 Enter/다음 동작은 실제 직원폰 흐름 기준으로 본다.
- 사용자는 단위를 보지 않는다. 체크단위와 발주단위가 다르면 과거 재고 변동값과 SFA 실발주량으로 환산을 추정해 발주량에 반영한다.
- 하루사용량 입력/계산은 수동값을 기준으로 한다. `이전 남은재고 + 실발주 입고량 - 다음 남은재고 = 실사용량` 분석값은 엑셀분석 참고/리포트이며, 수동값과 발주 계산을 자동 덮어쓰지 않는다.
- 엑셀분석으로 기록된 실발주 이력은 실사용 참고 배지/툴팁에 즉시 반영한다. `current/overrides/*/l` 수동 하루사용량은 자동 할당하거나 덮어쓰지 않는다.

## UI/동선 기준
- 미입력, 입력완료, 숨김, 출력보기는 입력 동선을 방해하지 않아야 한다.
- 발주 품목 출력순서는 최초 SFA 순서를 기준으로 고정한다. 저장되어 있던 사용자 지정 `outputOrder`는 읽어도 적용하지 않는다.

## 데이터/경계 기준
- 웹 도구와 SiteBot/SFA 자동입력 경계는 분리한다.
- Firebase 경로 이름에는 RTDB 금지 문자를 넣지 않는다.
- GitHub Pages 반영 여부를 작업 완료와 별도로 확인한다.
- 엑셀분석은 비교/실발주 확인 데이터와 참고 배지로만 쓰고, 수동 하루사용량/품목 단위표/재고/발주 원본을 별도 확인 없이 자동수정하지 않는다.
- 실발주 이력은 `/order/desk_q7m9r3a8/sfaActualHistory/{date}`, 단위/실사용 추정 리포트는 `/order/desk_q7m9r3a8/unitInference/latest`에 남긴다.
- SFA 파일 스캔/분석 실행자는 PC/SiteBot이다. 서버폰 Termux AI Ops는 `/monitor/main_pc/*` 요청·상태·heartbeat 정체를 감시하고, 멈춤/오류 때 self_fix 분석으로 넘기는 운영 감시자다.
- Termux 상주 모니터는 발주 품목, 단위, 환산, 하루사용량 수동값, SFA 실발주 원본을 자동 확정하거나 수정하지 않는다.
- `orderhelper_usage_inference.py --upload`는 `/unitInference/latest` 리포트만 갱신한다. `/sfaActualHistory` 백필은 별도 명시 플래그가 있을 때만 허용하며, 하루사용량 `overrides/*/l` 자동 write는 금지한다.

## C&I / AI Ops 경계
- C&I는 PC/SiteBot heartbeat 정체, SFA 요청/상태 불일치, GitHub Pages 반영 실패, 계산/입력 회귀를 self_fix 후보로 올린다.
- 발주시스템 CLI 역할은 `/monitor/main_pc/*`, `/order/desk_q7m9r3a8/current`, `/order/desk_q7m9r3a8/sfaCompare/latest`, `/sfaActualHistory`, `/unitInference/latest`, 최근 `history`를 대조해 SFA 분석 완료 후 실발주 이력 누락, 단위 환산/실사용량 추정 리포트 누락, 하루사용량 분석 불능을 감지하는 것이다.
- 자동 복구는 웹 코드/테스트/문서/배포 루프 보정까지 허용한다.
- 발주 품목, 단위, 환산, 하루사용량 수동값, SFA 실발주 원본 확정은 자동으로 바꾸지 않는다.
- CLI/LLM은 prompt envelope가 있어야 깨어난다. monitor/worker/사용자/수동 enqueue 또는 상주 판단 루프가 prompt를 주입하며, 이것은 C&I 판단 권한 제한이 아니다.

## 수정 전 질문
- 이 변경이 재고 입력 시간을 줄이는가.
- 계산식/SFA 대응을 불확실하게 만들지 않는가.
- 직원폰 브라우저 이벤트 차이를 검증했는가.

## 완료 기준
- 검증: 정적 검사, 모바일 브라우저 입력 흐름, Firebase 양방향 동기화
- 전달: 웹 URL 반영 확인
- 최신 기준: `20260622-1` / 하루사용량 계산은 수동값 기준, 실사용량 분석은 참고 표시 전용, 엑셀 실발주 이력은 참고 배지 즉시 반영 / 출력순서는 최초 SFA 순서 고정 / 라이브 `https://wk7007-wk.github.io/OrderHelper/`
- 운영 감시: 서버폰 Termux AI Ops가 PC/SiteBot 상태와 SFA 요청 정체를 감시한다. 앱 코드 변경 없이 감시만 바뀐 경우 APK/웹 배포는 필요 없다.
- 남은 위험: 실기기 키보드 이벤트 차이, SFA 화면 변동, 재고 변동 기반 환산은 실발주 반영 기록이 쌓인 뒤 안정화됨, PC/SiteBot이 꺼지면 Termux는 감지만 가능하고 실제 SFA 파일 스캔은 못 한다.
