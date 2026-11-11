// window.recorderApi의 타입. src/preload.js의 실제 객체에서 끌어낸다 — 따로 적은 목록이 없어 어긋날 수 없다.
// 새 화면 코드는 이 값을 바로 쓰지 말고, 그 상태의 주인(entities/…)이 주는 함수를 쓴다 (주인이 아직 옛 코드면 옛 코드가 넘겨준다).
// on…으로 시작하는 이벤트는 해제 함수를 돌려주지 않는다 — React 효과(useEffect)에서 구독하면 화면을 열 때마다 쌓인다. 구독은 주인이 한 번만.
export type RecorderApi = import('../../../preload.js').RecorderApi;
