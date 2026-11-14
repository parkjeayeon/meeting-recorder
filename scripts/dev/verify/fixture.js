// 검증용 예시 회의와 화면 도우미 (지어낸 내용). Playwright 시험(e2e/app.ts)과 검증 도구(steps.js — drive.js·verify:journeys)가 같이 쓴다.
// 예시 회의 폴더는 임시 폴더에 새로 만든다 — 실제 녹음 폴더·설정은 건드리지 않는다.
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── 예시 회의 (지어낸 내용) ──
const TRANSCRIPT = [
  '[00:02] [화자 1] 다음 주 배포 일정 얘기해 볼까요?',
  '[00:06] [화자 2] 네, 화요일 오전이 좋을 것 같아요.',
  '[00:11] [화자 1] QA는 월요일까지 끝낼 수 있죠?',
  '[00:15] [화자 2] 랩캐시도 쪽 확인만 하면 됩니다.',
  '[00:40] [화자 1] 알림은 다음 배포로 넘기죠.',
];
const MINUTES = `# 예시 회의: 배포 일정 정리

## 요약
배포 일정과 QA 범위를 정리함.

## 논의 내용
### 배포
- 배포는 화요일 오전으로 함 (00:06)

## 결정 사항
- 알림은 다음 배포로 넘김 (00:40)

## 할 일
- [ ] QA 마치기 — 담당: 화자 2, 기한: 월요일
- [ ] 배포 공지 쓰기 — 담당: 화자 1

## 확인 필요
- "랩캐시도"(00:15): Memcached로 추정됨
`;
const REVIEW = { items: [
  { id: 'r1', kind: 'word', at: '00:15', heard: '랩캐시도', guess: 'Memcached', note: '캐시 관련 용어가 잘못 인식된 것으로 보임', status: 'open' },
  { id: 'r2', kind: 'word', at: '00:06', heard: '화요일', guess: null, note: '요일이 맞는지', status: 'open' },
  { id: 'r3', kind: 'name', at: null, heard: null, heardNote: '도윤님', note: "'도윤님'이 누구인지 확인이 필요함", status: 'open' },
  { id: 'r4', kind: 'meaning', at: '00:40', heard: null, heardNote: null, note: '회의록의 이 문장에 붙은 시각 앞뒤 녹취에서 관련된 말을 찾지 못했습니다: "예시"', status: 'open', source: 'check', check: 'ungrounded' },
  { id: 'r5', kind: 'word', at: '00:11', heard: '큐에이', applied: 'QA', count: 1, note: '약어', status: 'applied', undo: { 'transcript.txt': { changed: [], inserted: [] } } },
  { id: 'r6', kind: 'meaning', at: null, heard: null, note: '잠깐 끊긴 말', status: 'kept' },
] };
const GLOSSARY = { terms: [
  { id: 'g1', term: 'QA', note: '출시 전에 기능이 제대로 동작하는지 확인하는 품질 검사', basis: 'general', status: 'confirmed', source: 'llm', at: ['00:11'] },
  { id: 'g2', term: '알림', note: '앱 푸시 알림 기능', basis: 'meeting', status: 'suggested', source: 'llm', at: ['00:40'] },
] };
// 흐름도·액션 예시 (화면 캡처 e2e/screens.e2e.ts와 같은 것)
const FLOW = { flows: [{
  id: 'f1', title: '배포 절차', summary: 'QA를 마친 뒤 화요일에 배포하고 지켜보는 순서', lanes: [],
  steps: [
    { id: 's1', title: 'QA', detail: '결제·로그인·알림만 확인', at: '00:11', quote: 'QA는 월요일까지' },
    { id: 's2', title: '배포', detail: '화요일 오전에 배포', at: '00:06', quote: '화요일 오전이 좋을 것 같아요' },
    { id: 's3', title: '모니터링', detail: '나머지는 배포 뒤 확인', at: '00:15', quote: '확인만 하면 됩니다', optional: true },
  ],
  edges: [{ from: 's1', to: 's2' }, { from: 's2', to: 's3' }],
  notes: [{ step: 's2', kind: 'warn', text: '일정이 밀리면\n알림은 다음 배포로', at: '00:11', quote: '알림은 다음 배포로' }],
  annotations: [],
}], handoff: null, reason: '배포 순서를 설명함' };
const ACTIONS = {
  kind: 'work', adviceTitle: '알아 둘 것',
  actions: [
    { id: 'a1', owner: '화자 2', task: 'QA 마치기', due: '월요일', kind: 'assigned', at: '00:11', quote: 'QA는 월요일까지', done: false },
    { id: 'a2', owner: '화자 1', task: '배포 일정 공지하기', due: null, kind: 'promise', at: '00:06', quote: '화요일 오전이 좋을 것 같아요', done: true },
    { id: 'a3', owner: '화자 2', task: '결제 화면 오류 재현 영상 공유하기', due: '내일', kind: 'promise', at: '00:15', quote: 'x', done: false },
    { id: 'a4', owner: '화자 1', task: '롤백 절차 문서 다시 확인하기', due: null, kind: 'assigned', at: '00:20', quote: 'x', done: false },
    { id: 'a5', owner: '화자 1', task: '다음 주부터 매일 배포 전 체크리스트 보기', due: '다음 주', kind: 'resolution', at: '00:24', quote: 'x', done: false },
  ],
  advice: [
    { id: 'v1', group: '배포', key: true, why: '일정이 밀리면 범위부터 줄여야 해서', from: '화자 1', to: '화자 2', text: '일정이 밀리면 알림은 다음 배포로 넘기기', at: '00:11', quote: 'x' },
    { id: 'v2', group: 'QA', key: false, why: null, from: '화자 1', to: '화자 2', text: '결제·로그인·알림만 먼저 확인하기', at: '00:15', quote: 'x' },
  ],
};
// flowAndActions: 흐름도·액션 파일까지 (기능 시험·흐름은 없는 상태에서 시작한다)
function makeMeeting(prefix = 'mr-feature-', { flowAndActions = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)) + '/2026-11-01_23-00-00_meeting';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'transcript.txt'), `${TRANSCRIPT.join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'script-clean.txt'), `${TRANSCRIPT.join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'minutes.md'), MINUTES);
  fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(REVIEW));
  fs.writeFileSync(path.join(dir, 'glossary.json'), JSON.stringify(GLOSSARY));
  if (flowAndActions) {
    fs.writeFileSync(path.join(dir, 'flow.json'), JSON.stringify(FLOW));
    fs.writeFileSync(path.join(dir, 'actions.json'), JSON.stringify(ACTIONS));
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ startedAt: '2026-11-01T14:00:00Z', files: { mic: { file: 'mic.wav', durationSec: 1800 } } }));
  return dir;
}

// ── 화면 안에서 쓰는 도우미: 이름(aria-label·글자·title)으로 버튼·탭·칩을 찾는다 ──
const HELPERS = `window.__t = (() => {
  const vis = (e) => e && e.isConnected && !e.closest('[hidden]') && e.getClientRects().length > 0;
  const name = (e) => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || '').replace(/\\s+/g, ' ').trim();
  const CLICKABLE = 'button, a[href], [role=tab], [role=button], summary, label, input[type=checkbox], input[type=radio]';
  const find = (text, { within = document, sel = CLICKABLE, exact = false } = {}) => {
    const all = [...(typeof within === 'string' ? document.querySelector(within) : within).querySelectorAll(sel)].filter(vis);
    return all.find((e) => name(e) === text) || (!exact && all.find((e) => name(e).startsWith(text))) || (!exact && all.find((e) => name(e).includes(text))) || null;
  };
  const click = (text, opts) => { const e = find(text, opts); if (!e) return false; e.click(); return true; };
  const field = (label) => [...document.querySelectorAll('input, textarea, select')].filter(vis).find((e) => e.getAttribute('aria-label') === label || e.placeholder?.startsWith(label) || e.closest('label')?.textContent.trim().startsWith(label)) || null;
  const type = (label, value, { enter = false } = {}) => {
    const e = field(label); if (!e) return false;
    e.focus(); e.value = value; e.dispatchEvent(new Event('input', { bubbles: true }));
    if (enter) e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  };
  const has = (text, within = document.body) => vis((typeof within === 'string' ? document.querySelector(within) : within)) && (typeof within === 'string' ? document.querySelector(within) : within).innerText.includes(text);
  const toasts = () => [...document.querySelectorAll('[role=status]')].map((e) => e.innerText.replace(/\\s+/g, ' '));
  const tab = () => document.querySelector('[role=tab][aria-selected=true]')?.textContent.trim() ?? null;
  return { find, click, field, type, has, toasts, tab, name };
})();`;

module.exports = { TRANSCRIPT, MINUTES, REVIEW, GLOSSARY, FLOW, ACTIONS, makeMeeting, HELPERS };
