import { Recorder } from './recorder.js';

const api = window.recorderApi;
const $ = (id) => document.getElementById(id);

// ── 녹음 ────────────────────────────────────────────────────────────────
const peakDb = { mic: -Infinity, system: -Infinity };
const tape = { levels: [], ctx: $('tape').getContext('2d') };
const recorder = new Recorder({
  api,
  onLevel: (track, db) => {
    peakDb[track] = Math.max(peakDb[track], db);
    if (track === 'mic') pushLevel(db);
  },
});

// 레벨은 장식 없는 수직 괘선 막대로만 그린다 (100ms마다 한 칸, 오른쪽에서 들어온다)
function pushLevel(db) {
  tape.levels.push(Math.max(0, Math.min(1, (db + 60) / 54)));
  if (tape.levels.length > 120) tape.levels.shift();
  drawTape();
}

function drawTape() {
  const canvas = $('tape');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w) return;
  if (canvas.width !== w * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const { ctx } = tape;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  ctx.fillStyle = css.getPropertyValue('--rule-2');
  ctx.fillRect(0, Math.round(h / 2), w, 1);
  ctx.fillStyle = css.getPropertyValue('--red');
  const step = 4;
  const n = Math.floor(w / step);
  const levels = tape.levels.slice(-n);
  levels.forEach((v, i) => {
    const bar = Math.max(1, Math.round(v * (h - 4)));
    ctx.fillRect(w - (levels.length - i) * step, Math.round((h - bar) / 2), 1.5, bar);
  });
}

let liveTimer;
let recordingMode = null;
let settings = null; // 받아쓰기 설정 (아래 설정 영역에서 채운다)

function clock(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const IDLE_SUB = '<kbd>fn</kbd>을 누른 채 말하면 받아쓰기 · 회의는 오른쪽 위 회의 녹음';

function setLive(state, { text, sub, route } = {}) {
  const live = $('live');
  live.dataset.state = state;
  $('liveText').textContent = text;
  $('liveSub').innerHTML = sub ?? '';
  $('route').hidden = !route;
  $('tape').hidden = state !== 'memo' && state !== 'meeting';
  clearInterval(liveTimer);
  $('liveTime').textContent = '';
  if (state === 'memo' || state === 'meeting') {
    const t0 = Date.now();
    tape.levels = [];
    drawTape();
    liveTimer = setInterval(() => ($('liveTime').textContent = clock(Date.now() - t0)), 250);
  }
}

function setRecording(mode) {
  recordingMode = mode;
  $('memoBtn').classList.toggle('on', mode === 'memo');
  $('meetingBtn').classList.toggle('on', mode === 'meeting');
  $('memoBtn').querySelector('span').textContent = mode === 'memo' ? '받아쓰기 정지' : '받아쓰기';
  $('meetingBtn').querySelector('span').textContent = mode === 'meeting' ? '회의 녹음 정지' : '회의 녹음';
  $('meetingBtn').querySelector('use').setAttribute('href', mode === 'meeting' ? '#i-stop' : '#i-rec');
  $('memoBtn').disabled = mode === 'meeting';
  $('meetingBtn').disabled = mode === 'memo';
  if (mode === 'memo') setLive('memo', { text: '듣는 중', sub: '손을 떼면 받아써서 입력합니다' });
  else if (mode === 'meeting') {
    const after = settings?.minutes ? ' · 끝나면 회의록을 만듭니다' : '';
    setLive('meeting', { text: '회의 녹음 중', sub: `회의 녹음 정지를 누르면 멈춥니다${after}` });
  }
  else if ($('live').dataset.state !== 'working') setLive('idle', { text: '대기 중', sub: IDLE_SUB });
}

// 받아쓰기 노선: 듣기 → 인식 → 다듬기 → 입력
const STAGES = ['listen', 'transcribe', 'cleanup', 'paste'];
function showStage(stage) {
  setLive('working', { text: '받아쓰는 중', route: true });
  const at = STAGES.indexOf(stage);
  for (const li of $('route').children) {
    const i = STAGES.indexOf(li.dataset.stage);
    li.className = i < at ? 'done' : i === at ? 'now' : '';
  }
}

// ── 문제 알림 (권한·엔진·녹음 경고) ──────────────────────────────────────
const notices = new Map(); // key → { title, detail, action, onAction }

function setNotice(key, notice) {
  if (notice) notices.set(key, notice);
  else notices.delete(key);
  renderNotices();
}

function renderNotices() {
  const list = $('corrections');
  list.replaceChildren();
  for (const n of notices.values()) {
    const li = document.createElement('li');
    const msg = document.createElement('div');
    msg.className = 'msg';
    msg.innerHTML = '<b></b> <span></span>';
    msg.querySelector('b').textContent = n.title;
    msg.querySelector('span').textContent = n.detail ?? '';
    li.append(msg);
    if (n.action) {
      const btn = document.createElement('button');
      btn.className = 'line-btn';
      btn.textContent = n.action;
      btn.onclick = n.onAction;
      li.append(btn);
    }
    list.append(li);
  }
  $('settingsFlag').hidden = ![...notices.keys()].some((k) => k.startsWith('perm:') || k === 'engine');
}

function flash(key, title, detail) {
  setNotice(key, { title, detail, action: '닫기', onAction: () => setNotice(key, null) });
  api.log(`${title} ${detail ?? ''}`);
}

// 메인 프로세스가 보내는 명령을 도착 순서대로 하나씩 처리한다.
// (꾹 눌렀다 바로 떼는 경우 start → cancel이 연달아 오므로 버리면 안 된다)
let queue = Promise.resolve();
function enqueue(cmd) {
  queue = queue.then(() => run(cmd)).catch((err) => flash('error', '오류', err.message));
}

async function run({ action, mode }) {
  if (action === 'start') {
    if (recorder.isRecording) return;
    peakDb.mic = peakDb.system = -Infinity;
    try {
      const { warnings, timing } = await recorder.start({
        mode,
        deviceId: $('micSelect').value || undefined,
        echoCancellation: $('echo').checked,
        includeSystem: mode === 'meeting' && Boolean(settings?.meetingSystemAudio),
      });
      setNotice('rec', null);
      warnings.forEach((w, i) => flash(`warn:${i}`, '녹음 경고', w));
      setRecording(mode);
      api.log(`start timing ${mode} ${JSON.stringify(timing)}`);
    } catch (err) {
      setRecording(null);
      api.failed();
      flash('rec', '녹음을 시작하지 못했습니다.', err.message);
    }
    return;
  }

  const wasMode = recordingMode;
  const result = await recorder.stop({ discard: action === 'cancel' });
  setRecording(null);
  if (!result) return;
  if (wasMode === 'memo' && settings?.enabled) showStage('transcribe');
  loadHistory();
  // 권한이 없으면 macOS는 에러 없이 완전한 무음(0)을 넘겨준다
  if (result.files.system && peakDb.system < -150) {
    flash('system-silent', '상대방 소리가 녹음되지 않았습니다.', '설정 › macOS 권한에서 "시스템 오디오 녹음"을 허용한 뒤 앱을 다시 실행하세요.');
  }
}

$('memoBtn').onclick = () => api.toggle('memo');
$('meetingBtn').onclick = () => api.toggle('meeting');
api.onCommand(enqueue);
api.onFnStatus((s) => {
  if (!s.ok) flash('fn', 'fn 키를 감지하지 못합니다.', s.reason);
  else setNotice('fn', null);
});

// ── 기록 (받아쓰기 · 회의) ───────────────────────────────────────────────
let history = [];
let freshId = null;
const openRaw = new Set();

// 다듬기 전/후를 단어 단위로 비교해 지운 말과 고친 말을 교정 부호로 표시한다
// 문장부호는 따로 떼어 비교해야 "하죠"→"하죠." 같은 변경이 어절 전체 교체로 보이지 않는다
const PUNCT = /^[.,!?…·:;"'“”‘’()]$/;
function tokenize(s) {
  return s.match(/[^\s.,!?…·:;"'“”‘’()]+|[.,!?…·:;"'“”‘’()]/g) ?? [];
}

function joinTokens(tokens) {
  return tokens.reduce((out, t, i) => (i && !PUNCT.test(t) ? `${out} ${t}` : out + t), '');
}

function diffWords(a, b) {
  const x = tokenize(a);
  const y = tokenize(b);
  if (x.length * y.length > 250000) return [{ op: 'eq', tokens: y }];
  const dp = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  const push = (op, token) => {
    const last = out.at(-1);
    if (last?.op === op) last.tokens.push(token);
    else out.push({ op, tokens: [token] });
  };
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      push('eq', x[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', x[i++]);
    else push('ins', y[j++]);
  }
  while (i < x.length) push('del', x[i++]);
  while (j < y.length) push('ins', y[j++]);
  return out;
}

// 반환값: 교정 부호를 그렸으면 true, 고친 게 너무 많아 깨끗한 글만 보였으면 false
function renderSaid(el, raw, text) {
  el.replaceChildren();
  if (!text || raw === text) {
    el.textContent = text ?? raw;
    return true;
  }
  const parts = diffWords(raw, text);
  // 지운 군말은 보여 주는 게 목적이므로, 새로 넣은 말의 비율로만 "너무 많이 고쳤는지" 판단한다
  const inserted = parts.filter((p) => p.op === 'ins').reduce((n, p) => n + p.tokens.length, 0);
  const cleaned = parts.filter((p) => p.op !== 'del').reduce((n, p) => n + p.tokens.length, 0);
  if (inserted / Math.max(1, cleaned) > 0.4) {
    el.textContent = text; // 붉은 글자 벽 대신 다듬은 글 + 원문 보기
    return false;
  }
  parts.forEach((part, k) => {
    const words = joinTokens(part.tokens);
    if (k && !PUNCT.test(part.tokens[0])) el.append(' ');
    if (part.op === 'eq') {
      el.append(words);
      return;
    }
    const mark = document.createElement(part.op);
    mark.textContent = words;
    mark.title = part.op === 'del' ? '다듬기가 지운 말' : '다듬기가 넣은 말';
    el.append(mark);
  });
  return true;
}

const PROVIDER_NAME = { 'claude-code': 'Claude Code', codex: 'Codex', api: 'API' };
const DAY = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
const TIME = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}초`;
}

function rowButton(icon, label, onClick) {
  const b = document.createElement('button');
  b.className = 'row-btn';
  b.innerHTML = `<svg><use href="#${icon}"/></svg><span></span>`;
  b.querySelector('span').textContent = label;
  b.onclick = (e) => {
    e.stopPropagation();
    onClick(b);
  };
  return b;
}

function renderLedger(container, items, renderEntry) {
  container.replaceChildren();
  let day = null;
  let line = items.length;
  for (const item of items) {
    const d = new Date(item.startedAt);
    const key = d.toDateString();
    if (key !== day) {
      day = key;
      const head = document.createElement('div');
      head.className = 'day';
      const count = items.filter((r) => new Date(r.startedAt).toDateString() === key).length;
      head.innerHTML = '<span></span><span class="num"></span>';
      head.firstChild.textContent = DAY.format(d);
      head.lastChild.textContent = `${count}건`;
      container.append(head);
    }
    const row = document.createElement('div');
    row.className = 'entry';
    if (item.id === freshId) row.classList.add('fresh');
    row.innerHTML = '<span class="ln"></span><span class="at"></span><div class="body"></div><div class="acts"></div>';
    row.querySelector('.ln').textContent = line--;
    row.querySelector('.at').textContent = TIME.format(d);
    renderEntry(row, item);
    row.querySelector('.body').append(row.querySelector('.acts')); // 행동은 본문 아래 줄에 둬서 글 폭을 지킨다
    container.append(row);
  }
}

function renderRecords() {
  const items = history.filter((r) => r.mode === 'memo');
  $('recordsEmpty').hidden = items.length > 0;
  $('countRecords').textContent = items.length || '';
  renderLedger($('records'), items, (row, r) => {
    const body = row.querySelector('.body');
    const t = r.transcript;
    const said = document.createElement('div');
    said.className = 'said';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const parts = [['', seconds(r.durationSec * 1000)]];
    if (r.app) parts.push([`${r.app}에 입력`, '']);
    if (!t) {
      said.classList.add('muted');
      said.textContent = '받아쓴 글 없음 · 녹음만 저장됨';
    } else {
      const text = t.text ?? t.raw;
      const marked = renderSaid(said, t.raw, t.text);
      if (!marked) parts.push(['많이 고침', '']);
      if (t.timing?.transcribeMs !== undefined) parts.push(['인식 ', seconds(t.timing.transcribeMs)]);
      if (t.cleanupProvider) parts.push([`다듬기 ${PROVIDER_NAME[t.cleanupProvider] ?? t.cleanupProvider} `, seconds(t.timing?.cleanupMs ?? 0)]);
      const acts = row.querySelector('.acts');
      const confirm = (b, label, done) => {
        b.classList.add('ok');
        b.querySelector('span').textContent = done;
        setTimeout(() => {
          b.classList.remove('ok');
          b.querySelector('span').textContent = label;
        }, 1400);
      };
      acts.append(
        rowButton('i-copy', '복사', async (b) => {
          await api.copy(text);
          confirm(b, '복사', '복사됨');
        }),
        rowButton('i-paste', '다시 입력', async (b) => {
          const status = await api.repaste(text);
          if (status !== 'pasted') confirm(b, '다시 입력', '클립보드에 복사됨');
        }),
      );
      row.querySelector('.acts').lastChild.title = '창을 닫고, 직전에 쓰던 앱의 커서 위치에 입력합니다';
      if (t.text && t.text !== t.raw) {
        acts.append(
          rowButton('i-list', openRaw.has(r.id) ? '원문 닫기' : '원문', () => {
            openRaw.has(r.id) ? openRaw.delete(r.id) : openRaw.add(r.id);
            renderRecords();
          }),
        );
      }
      if (openRaw.has(r.id)) {
        const raw = document.createElement('div');
        raw.className = 'raw';
        raw.textContent = t.raw;
        body.append(said, raw, meta);
      }
    }
    parts.forEach(([label, num], i) => {
      if (i) meta.append(' · ');
      meta.append(label);
      if (num) {
        const n = document.createElement('span');
        n.className = 'num';
        n.textContent = num;
        meta.append(n);
      }
    });
    if (t?.cleanupError) {
      const err = document.createElement('span');
      err.className = 'err';
      err.textContent = ` · 다듬기 실패: ${t.cleanupError}`;
      meta.append(err);
    }
    if (!body.childElementCount) body.append(said, meta);
  });
}

// ── 회의록 ──────────────────────────────────────────────────────────────
const openDoc = new Map(); // 회의 id → 'minutes' | 'script'
const scriptVersion = new Map(); // 회의 id → 'raw' | 'clean'
const redoOpen = new Set(); // 다시 만들기 서식을 펼친 회의
const docCache = new Map(); // 회의 id → { minutes, transcript }

const MINUTES_STATE = {
  queued: '회의록 차례를 기다리는 중…',
  transcribe: '녹취하는 중…',
  write: '회의록 쓰는 중…',
  empty: '들린 말이 없어 회의록을 만들지 않았습니다',
};

// 회의록 마크다운 중 쓰는 것만 그린다: 소제목, 목록, 할 일, 문단, **굵게**
function inline(el, text) {
  text.split(/\*\*(.+?)\*\*/g).forEach((part, i) => {
    if (!part) return;
    if (i % 2) {
      const b = document.createElement('b');
      b.textContent = part;
      el.append(b);
    } else el.append(part);
  });
}

function renderMarkdown(el, md) {
  el.replaceChildren();
  let list = null;
  for (const line of md.split('\n')) {
    const todo = line.match(/^\s*- \[( |x)\]\s+(.*)$/i);
    const item = line.match(/^\s*[-*]\s+(.*)$/);
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (todo || item) {
      if (!list) el.append((list = document.createElement('ul')));
      const li = document.createElement('li');
      if (todo) li.className = todo[1].trim() ? 'todo done' : 'todo';
      inline(li, todo ? todo[2] : item[1]);
      list.append(li);
      continue;
    }
    list = null;
    if (!line.trim()) continue;
    if (heading) {
      if (heading[1] === '#') continue; // 제목은 기록 줄에 이미 적혀 있다
      const h = document.createElement(heading[1] === '##' ? 'h3' : 'h4');
      inline(h, heading[2]);
      el.append(h);
    } else {
      const p = document.createElement('p');
      inline(p, line);
      el.append(p);
    }
  }
}

function renderTranscript(el, text, onRename = null) {
  el.replaceChildren();
  for (const line of text.trim().split('\n')) {
    const m = line.match(/^\[([\d:]+)\]\s*(?:\[([^\]]+)\]\s*)?(.*)$/);
    const row = document.createElement('div');
    row.className = 'line';
    const at = document.createElement('span');
    at.className = 'num';
    at.textContent = m ? m[1] : '';
    row.append(at);
    if (m?.[2]) {
      const who = document.createElement(onRename ? 'button' : 'span');
      who.className = 'who';
      who.textContent = m[2];
      if (onRename) {
        who.title = '눌러서 이 화자의 이름 바꾸기';
        who.onclick = () => onRename(who, m[2]);
      }
      row.append(who);
    } else row.append(document.createElement('span')); // 화자 칸을 비워 둬 글이 같은 줄에 맞춰지게
    const said = document.createElement('span');
    said.textContent = m ? m[3] : line;
    row.append(said);
    el.append(row);
  }
}

// 대화 스크립트: 원본 / 정리본(흐름과 무관한 가지를 쳐낸 것) 두 버전을 오가며 본다
function renderScript(box, r, doc) {
  box.className = 'script';
  const version = scriptVersion.get(r.id) ?? (doc.scriptClean ? 'clean' : 'raw');
  const bar = document.createElement('div');
  bar.className = 'script-bar';
  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  tabs.setAttribute('role', 'tablist');
  for (const [id, label] of [['clean', '정리본'], ['raw', '원본']]) {
    const t = document.createElement('button');
    t.className = 'tab';
    t.setAttribute('role', 'tab');
    t.setAttribute('aria-selected', String(id === version));
    t.textContent = label;
    t.onclick = () => {
      scriptVersion.set(r.id, id);
      renderMeetings();
    };
    tabs.append(t);
  }
  const text = version === 'clean' ? doc.scriptClean : doc.transcript;
  bar.append(tabs);
  if (text) {
    bar.append(
      rowButton('i-copy', '복사', async (b) => {
        await api.copy(text);
        b.classList.add('ok');
        b.querySelector('span').textContent = '복사됨';
        setTimeout(() => {
          b.classList.remove('ok');
          b.querySelector('span').textContent = '복사';
        }, 1400);
      }),
    );
  }
  const lines = document.createElement('div');
  lines.className = 'transcript';
  // 화자 이름 바꾸기: 라벨을 누르면 그 자리에서 입력칸으로 바뀐다
  const rename = (btn, from) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename';
    input.value = from;
    btn.replaceWith(input);
    input.focus();
    input.select();
    const done = async (save) => {
      if (save && input.value.trim() && input.value.trim() !== from) {
        await api.renameSpeaker(r.dir, from, input.value);
        docCache.set(r.id, await api.readMinutes(r.dir));
      }
      renderMeetings();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    };
    input.onblur = () => done(true);
  };
  if (text) renderTranscript(lines, text, rename);
  else if (version === 'clean' && doc.transcript) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '대화 흐름과 상관없는 맞장구·하다 만 말·잡담을 쳐낸 정리본이 아직 없습니다. ';
    const make = document.createElement('button');
    make.className = 'line-btn primary';
    make.textContent = '만들기';
    make.onclick = async () => {
      make.disabled = true;
      make.textContent = '만드는 중…';
      await api.cleanScript(r.dir);
      docCache.set(r.id, await api.readMinutes(r.dir));
      renderMeetings();
    };
    p.append(make);
    lines.append(p);
  } else lines.textContent = '대화 스크립트가 없습니다.';
  box.append(bar, lines);
}

async function toggleDoc(r, kind) {
  if (openDoc.get(r.id) === kind) openDoc.delete(r.id);
  else {
    openDoc.set(r.id, kind);
    docCache.set(r.id, await api.readMinutes(r.dir));
  }
  renderMeetings();
}

function renderMeetings() {
  const items = history.filter((r) => r.mode === 'meeting');
  $('meetingsEmpty').hidden = items.length > 0;
  $('countMeetings').textContent = items.length || '';
  renderLedger($('meetings'), items, (row, r) => {
    row.classList.add('meeting');
    const body = row.querySelector('.body');
    const acts = row.querySelector('.acts');
    const m = r.minutes;
    const status = m?.status;
    const busy = ['queued', 'transcribe', 'write'].includes(status);

    const said = document.createElement('div');
    said.className = 'said';
    if (status === 'done') said.textContent = m.title ?? '회의록';
    else if (status === 'error') {
      said.classList.add('muted');
      said.append('회의록을 만들지 못했습니다. ');
      const why = document.createElement('span');
      why.className = 'err';
      why.textContent = m.error;
      said.append(why);
    } else {
      said.classList.add('muted');
      said.textContent = MINUTES_STATE[status] ?? '회의록 없음 · 녹음만 저장됨';
      if (status === 'transcribe' && m.progress !== undefined) {
        said.textContent = `녹취하는 중 ${Math.round(m.progress * 100)}%${m.diarizing ? ' · 화자 구분 중' : ''}`;
      }
      if (busy) said.classList.add('busy');
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    const len = document.createElement('span');
    len.className = 'num';
    len.textContent = clock(r.durationSec * 1000);
    meta.append(len, ` · ${r.tracks.map((k) => (k === 'mic' ? '마이크' : '상대방 소리')).join(' + ')} WAV`);
    if (m?.speakers) meta.append(` · 화자 ${m.speakers}명`);
    if (m?.diarizeError) {
      const e = document.createElement('span');
      e.className = 'err';
      e.textContent = ` · 화자 구분 실패: ${m.diarizeError}`;
      meta.append(e);
    }
    if (status === 'done') {
      meta.append(` · ${PROVIDER_NAME[m.provider] ?? m.provider}로 작성`);
      if (m.timing?.transcribeMs !== undefined) {
        const t = document.createElement('span');
        t.className = 'num';
        t.textContent = seconds(m.timing.transcribeMs + (m.timing.writeMs ?? 0));
        meta.append(' · ', t);
      }
    }
    body.append(said, meta);

    const open = openDoc.get(r.id);
    if (status === 'done') {
      acts.append(rowButton('i-list', open === 'minutes' ? '회의록 닫기' : '회의록', () => toggleDoc(r, 'minutes')));
      acts.append(
        rowButton('i-copy', '복사', async (b) => {
          const doc = docCache.get(r.id) ?? (await api.readMinutes(r.dir));
          await api.copy(doc.minutes ?? '');
          b.classList.add('ok');
          b.querySelector('span').textContent = '복사됨';
          setTimeout(() => {
            b.classList.remove('ok');
            b.querySelector('span').textContent = '복사';
          }, 1400);
        }),
      );
    }
    if (status === 'done' || status === 'error' || status === 'empty') {
      acts.append(rowButton('i-people', open === 'script' ? '대화 스크립트 닫기' : '대화 스크립트', () => toggleDoc(r, 'script')));
    }
    if (!busy) {
      const label = status === 'done' || status === 'error' ? '다시 만들기' : '회의록 만들기';
      acts.append(rowButton('i-rec', label, () => {
        redoOpen.has(r.id) ? redoOpen.delete(r.id) : redoOpen.add(r.id);
        renderMeetings();
      }));
    }
    acts.append(rowButton('i-folder', 'Finder에서 보기', () => api.reveal(`${r.dir}/${r.firstFile}`)));

    // 다시 만들기: 참석 인원을 알려 주면 화자 구분이 정확해진다
    if (redoOpen.has(r.id) && !busy) {
      const form = document.createElement('div');
      form.className = 'redo';
      const lbl = document.createElement('label');
      lbl.textContent = '참석 인원';
      const sel = document.createElement('select');
      sel.append(new Option('자동', ''));
      for (let n = 2; n <= 10; n++) sel.append(new Option(`${n}명`, String(n)));
      lbl.append(sel);
      const go = document.createElement('button');
      go.className = 'line-btn primary';
      go.textContent = '녹취·화자 구분·회의록 다시 만들기';
      go.onclick = () => {
        redoOpen.delete(r.id);
        docCache.delete(r.id);
        openDoc.delete(r.id);
        api.makeMinutes(r.dir, sel.value || null);
      };
      form.append(lbl, go);
      body.append(form);
    }

    const doc = docCache.get(r.id);
    if (open && doc) {
      const box = document.createElement('div');
      if (open === 'minutes' && doc.minutes) {
        box.className = 'doc';
        renderMarkdown(box, doc.minutes);
      } else {
        renderScript(box, r, doc);
      }
      body.append(box);
    }
  });
}

api.onMinutes(({ id, status }) => {
  if (status === 'done') docCache.delete(id);
  loadHistory();
});

async function loadHistory() {
  history = await api.history();
  renderRecords();
  renderMeetings();
}

// ── 페이지 전환 ─────────────────────────────────────────────────────────
const TITLES = { records: '기록', meetings: '회의', settings: '설정' };
function showPage(page) {
  for (const btn of document.querySelectorAll('.toc-item')) {
    if (btn.dataset.page === page) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  for (const id of Object.keys(TITLES)) $(`page-${id}`).hidden = id !== page;
  $('pageTitle').textContent = TITLES[page];
  if (page === 'settings') {
    renderPerms();
    renderProviders(true);
  }
}
for (const btn of document.querySelectorAll('.toc-item')) btn.onclick = () => showPage(btn.dataset.page);

// ── 설정: 받아쓰기 · 다듬기 ─────────────────────────────────────────────

function renderEngine(engine) {
  const mb = (n) => `${Math.round(n / 1e6)}MB`;
  const line = $('engineLine');
  line.replaceChildren();
  const text = {
    ready: 'Whisper large-v3-turbo · 기기 안에서 실행',
    loading: '모델을 메모리에 올리는 중…',
    stopped: '꺼져 있음',
    'no-engine': 'whisper.cpp가 설치되어 있지 않습니다.',
    'no-model': '음성 인식 모델(약 0.9GB)을 받아야 합니다.',
    downloading: `모델 받는 중 ${mb(engine.received)}${engine.total ? ` / ${mb(engine.total)}` : ''}`,
    error: `오류: ${engine.error}`,
  }[engine.state] ?? engine.state;
  const span = document.createElement('span');
  span.textContent = text;
  const bad = ['no-engine', 'no-model', 'error'].includes(engine.state);
  span.className = bad ? 'bad' : '';
  line.append(span);
  if (engine.state === 'no-engine') {
    const code = document.createElement('code');
    code.textContent = 'brew install whisper-cpp';
    line.append(code);
  }
  if (engine.state === 'no-model' || engine.state === 'error') {
    const btn = document.createElement('button');
    btn.className = 'line-btn';
    btn.textContent = '모델 받기';
    btn.onclick = () => {
      btn.disabled = true;
      api.dictDownload();
    };
    line.append(btn);
  }

  $('sideEngine').textContent = { ready: '준비됨', loading: '불러오는 중', downloading: '모델 받는 중', stopped: '꺼짐' }[engine.state] ?? '설정 필요';
  $('sideEngine').classList.toggle('bad', bad);
  if (bad) {
    setNotice('engine', {
      title: '받아쓰기를 쓸 수 없습니다.',
      detail: engine.state === 'no-engine' ? '터미널에서 brew install whisper-cpp 를 실행하세요.' : text,
      action: engine.state === 'no-engine' ? null : '모델 받기',
      onAction: () => api.dictDownload(),
    });
  } else setNotice('engine', null);
}

let providers = null;
async function renderProviders(fresh = false) {
  providers = await api.providers({ fresh });
  const box = $('providers');
  box.replaceChildren();
  const rows = [
    ['auto', '자동', '로그인된 계정 중 가장 빠른 것'],
    ['claude-code', 'Claude Code', providers['claude-code']],
    ['codex', 'Codex', providers.codex],
    ['api', 'Anthropic API 키', providers.api],
  ];
  for (const [id, name, info] of rows) {
    const usable = typeof info === 'string' || info.loggedIn || id === 'api';
    const who = typeof info === 'string' ? info : !info.installed ? '설치 안 됨' : info.loggedIn ? info.account ?? '로그인됨' : id === 'api' ? '키 없음' : '로그인 필요';
    const label = document.createElement('label');
    label.className = `choice${usable ? '' : ' off'}`;
    label.innerHTML = '<input type="radio" name="provider" /><span></span><span class="who"></span>';
    const input = label.querySelector('input');
    input.value = id;
    input.checked = settings.provider === id;
    input.disabled = !usable;
    input.onchange = () => saveDict({ provider: id });
    label.querySelector('span').textContent = name;
    label.querySelector('.who').textContent = who;
    box.append(label);
  }
  $('keyRow').hidden = settings.provider !== 'api';
  renderSideCleanup();
}

function renderSideCleanup() {
  if (!settings || !providers) return;
  let label;
  if (!settings.cleanup) label = '꺼짐';
  else if (settings.provider !== 'auto') label = PROVIDER_NAME[settings.provider];
  else label = ['claude-code', 'codex', 'api'].map((id) => providers[id]?.loggedIn && PROVIDER_NAME[id]).find(Boolean) ?? '계정 없음';
  $('sideCleanup').textContent = label;
  $('sideCleanup').classList.toggle('bad', label === '계정 없음');
}

function renderDictSettings(s) {
  settings = s;
  $('minutesAuto').checked = s.minutes;
  $('diarizeOn').checked = s.diarize;
  const dl = $('diarizeLine');
  dl.replaceChildren();
  const st = document.createElement('span');
  if (!s.diarizeReady) {
    st.className = 'bad';
    st.textContent = '화자 구분 엔진(pyannote)이 설치되어 있지 않습니다.';
  } else if (!s.hasHfToken) {
    st.className = 'bad';
    st.textContent = 'Hugging Face 토큰이 필요합니다.';
  } else st.textContent = 'pyannote community-1 · 준비됨';
  dl.append(st);
  $('hfRow').hidden = !s.diarize || !s.diarizeReady;
  $('hfToken').placeholder = s.hasHfToken ? '저장됨 · 바꾸려면 새 토큰 입력' : 'hf_…';
  $('meetingSystem').checked = s.meetingSystemAudio;
  $('dictEnabled').checked = s.enabled;
  $('dictLanguage').value = s.language;
  $('dictCleanup').checked = s.cleanup;
  $('providerRow').hidden = !s.cleanup && !s.minutes; // 회의록도 같은 계정을 쓴다
  if (document.activeElement !== $('dictVocab')) $('dictVocab').value = s.vocabulary;
  $('apiKey').value = '';
  $('apiKey').placeholder = s.hasApiKey ? '저장됨 · 바꾸려면 새 키 입력' : 'sk-ant-…';
  $('keyRow').hidden = s.provider !== 'api';
  renderEngine(s.engine);
  renderSideCleanup();
}

async function saveDict(patch) {
  renderDictSettings(await api.dictSaveSettings(patch));
  if ('apiKey' in patch || 'provider' in patch || 'cleanup' in patch) renderProviders();
}

$('dictEnabled').onchange = (e) => saveDict({ enabled: e.target.checked });
$('dictLanguage').onchange = (e) => saveDict({ language: e.target.value });
$('dictCleanup').onchange = (e) => saveDict({ cleanup: e.target.checked });
$('minutesAuto').onchange = (e) => saveDict({ minutes: e.target.checked });
$('diarizeOn').onchange = (e) => saveDict({ diarize: e.target.checked });
$('saveHf').onclick = () => {
  saveDict({ hfToken: $('hfToken').value.trim() });
  $('hfToken').value = '';
};
$('meetingSystem').onchange = async (e) => {
  await saveDict({ meetingSystemAudio: e.target.checked });
  renderPerms();
};
$('dictVocab').onchange = (e) => saveDict({ vocabulary: e.target.value.trim() });
$('saveKey').onclick = () => saveDict({ apiKey: $('apiKey').value.trim() });
$('openDir').onclick = () => api.openRecordings();

api.onDictEngine(renderEngine);
api.onDictStage(({ stage }) => showStage(stage));

const PASTE_STATUS = {
  'no-permission': ['입력하지 못했습니다.', '손쉬운 사용 권한이 없어 클립보드에만 복사했습니다. ⌘V로 붙여 넣으세요.'],
  failed: ['입력하지 못했습니다.', '클립보드에 복사해 두었습니다. ⌘V로 붙여 넣으세요.'],
};

api.onDictResult((r) => {
  setLive('idle', { text: '대기 중', sub: IDLE_SUB });
  if (r.status === 'error') flash('dict', '받아쓰기 실패.', r.error);
  else if (PASTE_STATUS[r.status]) flash('dict', ...PASTE_STATUS[r.status]);
  else setNotice('dict', null);
  freshId = r.id ?? null;
  loadHistory();
});

// ── 마이크 장치 ─────────────────────────────────────────────────────────
const BLUETOOTH_HINT = /airpods|bluetooth|buds|headset|hands-?free|beats|jabra|bose|wh-1000|wf-1000/i;

async function loadDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const select = $('micSelect');
  const current = select.value;
  select.replaceChildren(new Option('시스템 기본값', ''));
  for (const d of devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')) {
    select.append(new Option(d.label || '알 수 없는 마이크', d.deviceId));
  }
  select.value = current;
  updateMicHint();
}

function updateMicHint() {
  const select = $('micSelect');
  const label = select.value ? select.selectedOptions[0]?.textContent : '';
  $('micHint').hidden = !BLUETOOTH_HINT.test(label ?? '');
  $('micHint').textContent = '블루투스 마이크는 16kHz 이하로 녹음되고, 켜는 순간 스피커 음질도 떨어집니다. 내장·유선 마이크를 권장합니다.';
}
$('micSelect').onchange = updateMicHint;
navigator.mediaDevices.addEventListener('devicechange', loadDevices);

// ── 권한 ────────────────────────────────────────────────────────────────
const PERMS = [
  { kind: 'microphone', name: '마이크', what: '내 목소리 녹음' },
  { kind: 'inputMonitoring', name: '입력 모니터링', what: 'fn 키 감지' },
  { kind: 'accessibility', name: '손쉬운 사용', what: '받아쓴 글을 커서 위치에 입력' },
  { kind: 'systemAudio', name: '시스템 오디오 녹음', what: '화상 회의 상대방 소리 녹음', optional: () => !settings?.meetingSystemAudio },
];

async function requestPerm(kind, btn) {
  if (btn) {
    btn.disabled = true;
    btn.textContent = '기다리는 중…';
  }
  renderPerms(await api.permRequest(kind));
}

async function renderPerms(status) {
  status ??= await api.permStatus();
  const list = $('permList');
  list.replaceChildren();
  for (const p of PERMS) {
    const st = status[p.kind];
    const li = document.createElement('li');
    li.innerHTML = '<span class="name"></span><span class="what"></span>';
    li.querySelector('.name').textContent = p.name;
    li.querySelector('.what').textContent = p.what;
    if (st === 'granted' || st === 'unsupported') {
      const ok = document.createElement('span');
      ok.className = 'ok';
      ok.textContent = st === 'granted' ? '허용됨' : '이 macOS에서는 지원 안 됨';
      li.append(ok);
      setNotice(`perm:${p.kind}`, null);
    } else {
      const first = st === 'not-determined' || st === 'unknown';
      const btn = document.createElement('button');
      btn.className = 'line-btn primary';
      btn.textContent = first ? '허용하기' : '시스템 설정 열기';
      btn.onclick = () => requestPerm(p.kind, btn);
      li.append(btn);
      if (p.optional?.()) {
        // 화상 회의 녹음을 켜지 않았으면 경고하지 않는다 (목록에서는 허용할 수 있게 둔다)
        setNotice(`perm:${p.kind}`, null);
        li.querySelector('.what').textContent = `${p.what} · 화상 회의 녹음을 켤 때만 필요`;
        list.append(li);
        continue;
      }
      setNotice(`perm:${p.kind}`, {
        title: `${p.name} 권한이 필요합니다.`,
        detail: `${p.what}에 씁니다.`,
        action: first ? '허용하기' : '시스템 설정 열기',
        onAction: () => requestPerm(p.kind),
      });
    }
    list.append(li);
  }
}

// 시스템 설정에서 바꾸고 돌아오면 바로 반영되도록 다시 확인
setInterval(() => document.visibilityState === 'visible' && renderPerms(), 3000);
window.addEventListener('focus', () => {
  renderPerms();
  loadHistory();
});
api.onPermChanged(() => renderPerms());

// ── 시작 ────────────────────────────────────────────────────────────────
setRecording(null);
const info = await api.info();
renderDictSettings(await api.dictSettings());
renderPerms();
renderProviders();
loadHistory();
if (info.capability === 'unsupported') flash('os', '이 macOS에서는 상대방 소리를 녹음할 수 없습니다.', '회의 모드도 마이크만 녹음합니다.');
if (info.fnWarning) flash('fnUsage', 'fn 키가 다른 동작과 겹칩니다.', info.fnWarning);
await loadDevices();
recorder.prepare().catch((err) => flash('engine-audio', '오디오 엔진 준비 실패.', err.message));
