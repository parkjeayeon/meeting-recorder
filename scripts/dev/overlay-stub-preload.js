// 떠 있는 막대(src/overlay) 시험용 가짜 overlayApi: 언어 버튼을 누르면 메인 프로세스처럼 다음 언어를 알려 준다
const { contextBridge } = require('electron');
let stateCb = () => {};
const actions = [];
const ORDER = ['ko', 'en', 'ja', 'auto'];
let lang = 'ko';
contextBridge.exposeInMainWorld('overlayApi', {
  setInteractive: () => {},
  onLevel: () => {},
  onStage: () => {},
  onState: (cb) => {
    stateCb = cb;
    setTimeout(() => cb({ recording: null, transcribing: false, language: lang }), 50);
  },
  action: (n) => {
    actions.push(n);
    if (n === 'lang-next') {
      lang = ORDER[(ORDER.indexOf(lang) + 1) % ORDER.length];
      stateCb({ recording: null, transcribing: false, language: lang });
    }
  },
});
contextBridge.exposeInMainWorld('overlayCalls', () => [...actions]);
