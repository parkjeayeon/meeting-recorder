const api = window.overlayApi;
const dock = document.getElementById('dock');
const tip = document.getElementById('tip');
const strip = document.getElementById('strip');
const label = document.getElementById('label');
const time = document.getElementById('time');
const canvas = document.getElementById('levels');
let closeTimer;

// 투명한 부분은 클릭이 아래 앱으로 통과하고, 독 위에 있을 때만 마우스를 받는다
dock.addEventListener('mouseenter', () => {
  clearTimeout(closeTimer);
  api.setInteractive(true);
  dock.classList.add('open');
});
dock.addEventListener('mouseleave', () => {
  closeTimer = setTimeout(() => {
    dock.classList.remove('open');
    tip.classList.remove('show');
    api.setInteractive(false);
  }, 180);
});

const tipText = {
  memo: { idle: ['받아쓰기', 'fn 꾹'], active: ['받아쓰기 정지', ''] },
  meeting: { idle: ['회의 녹음', ''], active: ['회의 녹음 정지', ''] },
  open: { idle: ['기록 열기', ''] },
};

for (const btn of document.querySelectorAll('.btn')) {
  btn.addEventListener('mouseenter', () => {
    const action = btn.dataset.action;
    const [text, key] = tipText[action][dock.dataset.state === action ? 'active' : 'idle'];
    tip.textContent = text;
    if (key) {
      const k = document.createElement('kbd');
      k.textContent = key;
      tip.append(k);
    }
    const b = btn.getBoundingClientRect();
    const d = dock.getBoundingClientRect();
    tip.style.top = `${b.top - d.top + b.height / 2 - tip.offsetHeight / 2}px`;
    tip.classList.add('show');
  });
  btn.addEventListener('mouseleave', () => tip.classList.remove('show'));
  btn.addEventListener('click', () => api.action(btn.dataset.action));
}

// ── 진행 띠 ───────────────────────────────────────────────────────────
let levels = [];
let clockTimer;
let hideTimer;
let recording = null;
let clockBase = { elapsedMs: 0, at: Date.now(), paused: false }; // 메인 프로세스가 알려 주는 녹음 시간 (회의 일시정지 반영)

function setStrip(mode, text = '') {
  clearTimeout(hideTimer);
  strip.dataset.mode = mode;
  strip.classList.remove('fail');
  label.textContent = text;
}

function startListening(mode) {
  levels = [];
  draw();
  setStrip('listen', mode === 'meeting' ? '회의' : '');
  clearInterval(clockTimer);
  const tick = () => {
    const ms = clockBase.paused ? clockBase.elapsedMs : clockBase.elapsedMs + Date.now() - clockBase.at;
    const s = Math.floor(ms / 1000);
    time.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  tick();
  clockTimer = setInterval(tick, 250);
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  ctx.fillStyle = css.getPropertyValue('--rule');
  ctx.fillRect(0, Math.round(h / 2), w, 1);
  ctx.fillStyle = getComputedStyle(strip).color; // 다크 모드에서도 띠의 글자색과 같게
  const step = 4;
  const shown = levels.slice(-Math.floor(w / step));
  shown.forEach((v, i) => {
    const bar = Math.max(1, Math.round(v * (h - 2)));
    ctx.fillRect(w - (shown.length - i) * step, Math.round((h - bar) / 2), 1.5, bar);
  });
}

api.onLevel(({ track, db }) => {
  if (track !== 'mic' || strip.dataset.mode !== 'listen') return;
  levels.push(Math.max(0, Math.min(1, (db + 58) / 50)));
  if (levels.length > 60) levels.shift();
  draw();
});

const STAGES = ['listen', 'transcribe', 'cleanup', 'paste'];
const STAGE_LABEL = { transcribe: '알아듣는 중', cleanup: '다듬는 중', paste: '입력하는 중' };

function showStage(stage) {
  setStrip('working', STAGE_LABEL[stage]);
  const at = STAGES.indexOf(stage);
  for (const li of document.querySelectorAll('.route li')) {
    const i = STAGES.indexOf(li.dataset.stage);
    li.className = i < at ? 'done' : i === at ? 'now' : '';
  }
}

function showResult({ status, text, error }) {
  if (recording) return;
  const done = (title, body, fail = false, ms = 2600) => {
    setStrip('done');
    strip.classList.toggle('fail', fail);
    label.replaceChildren();
    const b = document.createElement('b');
    b.textContent = title;
    label.append(b, body ?? '');
    hideTimer = setTimeout(() => setStrip('hidden'), ms);
  };
  if (status === 'pasted') done('입력함', text);
  else if (status === 'meeting-saved') done('회의 녹음 저장함', '회의록을 만드는 중입니다', false, 3000);
  else if (status === 'minutes-done') done('회의록 완료', text ?? '', false, 4000);
  else if (status === 'minutes-error') done('회의록 실패', error ?? '', true, 4500);
  else if (status === 'no-permission' || status === 'failed') done('클립보드에 복사함', '⌘V로 붙여 넣으세요', true, 4500);
  else if (status === 'silent' || status === 'empty') done('들린 말이 없습니다', '', false, 1400);
  else done('받아쓰기 실패', error ?? '', true, 4500);
}

// 띠의 글자만 잠깐 바꿨다가 되돌린다 (처리 중에 fn을 눌렀을 때)
let flashTimer;
function flashLabel(text, ms = 1600) {
  const before = label.textContent;
  clearTimeout(flashTimer);
  if (strip.dataset.mode === 'hidden') setStrip('done');
  label.textContent = text;
  flashTimer = setTimeout(() => {
    if (strip.dataset.mode === 'done' && label.textContent === text) setStrip('hidden');
    else if (label.textContent === text) label.textContent = before;
  }, ms);
}

api.onStage((s) => {
  if (s.stage === 'busy') return flashLabel('앞 받아쓰기를 입력하는 중입니다');
  if (s.stage === 'limit') return void (label.textContent = '1분 뒤 자동으로 끝납니다');
  if (s.stage === 'done') showResult(s);
  else if (!recording) showStage(s.stage);
});

api.onState((state) => {
  const prev = recording;
  recording = state.recording;
  if (state.clock) clockBase = { elapsedMs: state.clock.elapsedMs, at: Date.now(), paused: state.clock.paused };
  dock.dataset.state = recording ?? (state.transcribing ? 'working' : 'idle');
  if (recording && recording !== prev) startListening(recording);
  if (recording === 'meeting') label.textContent = clockBase.paused ? '일시정지' : '회의';
  if (recording === 'memo') label.textContent = state.handsfree ? 'fn 누르면 끝' : '';
  if (!recording) clearInterval(clockTimer);
  if (!recording && prev) {
    // 받아쓰기는 단계 표시로 넘어가고, 회의·취소는 띠를 거둔다
    if (state.transcribing) showStage('transcribe');
    else setStrip('hidden');
  }
});
