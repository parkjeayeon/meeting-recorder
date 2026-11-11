// 메인 창 화면의 진입점 (Vite가 lib/renderer/main.js·main.css로 묶는다, src/renderer/index.html이 불러옴).
// 지금은 옛 화면 코드(legacy/)를 그대로 띄운다. 화면을 하나씩 React로 옮길 때는 legacy/app.js의 ROUTES에서
// 그 화면 자리만 shared/page-host의 reactPage(...)로 바꾼다 (docs/react-migration.md).
// legacy/는 여기서만 가져온다 — 새 코드가 옛 전역 상태에 기대지 않게 (scripts/dev/check-boundaries.js가 막는다).
import './style.css';
import './legacy/app.js';
