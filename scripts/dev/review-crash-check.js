// 확인 필요 적용·되돌리기·구간 다시 받아쓰기 반영이 도중에 끊겼을 때의 시험 (가짜 회의 폴더, 실제 회의는 건드리지 않음).
//   npm run build:ts && npx electron scripts/dev/review-crash-check.js
// 1. 끊긴 지점을 하나씩 흉내 내기: 내용 파일을 쓴 뒤·기록(review.json)을 쓰기 전 등 → 다시 누르면 이어서 끝나고, 되돌리면 처음과 같아야 한다
// 2. 실제로 강제 종료: 자식 프로세스가 적용하는 도중 아무 때나 SIGKILL → 다시 누르기 → 되돌리기 → 처음과 같아야 한다
// minutes.js는 Electron 앱 객체를 쓰므로 Electron으로 돌린다 (창은 띄우지 않음, 앱 데이터는 임시 폴더).
const { app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const childDir = process.argv.includes('--child') ? process.argv[process.argv.indexOf('--child') + 1] : null;
const tmpRoot = childDir ? path.dirname(childDir) : fs.mkdtempSync(path.join(os.tmpdir(), 'mr-review-crash-'));
app.setPath('userData', path.join(tmpRoot, childDir ? 'userData-child' : 'userData'));
app.dock?.hide();
const minutes = require('../../src/minutes');

const FILES = ['transcript.txt', 'script-clean.txt', 'minutes.md', 'segments.json'];
const IDS = ['r1', 'r2'];
const FIXES = [{ id: 'r1', guess: 'Memcached' }, { id: 'r2', guess: 'Next.js' }];

// 지어낸 예시 회의
function makeMeeting(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    [2, '화자 1', '랩캐시도 쪽부터 볼까요?'],
    [9, '화자 2', '넥스트 버전은 그대로 둡니다.'],
    [21, '화자 1', '음 그게 그게 그게'],
    [27, '화자 1', '그게 그게'],
    [33, '화자 2', '랩캐시도 설정만 바꾸면 돼요.'],
    [48, '화자 1', '좋아요, 넥스트도 확인할게요.'],
  ];
  const fmt = ([t, who, text]) => `[00:${String(t).padStart(2, '0')}] [${who}] ${text}`;
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ mode: 'meeting', startedAt: '2026-11-01T00:00:00.000Z', files: { mic: { file: 'mic.wav', durationSec: 60 } } }));
  fs.writeFileSync(path.join(dir, 'transcript.txt'), `${lines.map(fmt).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'script-clean.txt'), `${lines.filter((_, i) => i !== 3).map(fmt).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'minutes.md'), '# 캐시 설정\n\n## 요약\n랩캐시도 설정과 넥스트 버전을 확인했다.\n\n## 확인 필요\n- "랩캐시도"(00:02), "넥스트"(00:09)\n- 00:21~00:30 반복\n');
  fs.writeFileSync(path.join(dir, 'segments.json'), JSON.stringify({ model: 'x', tracks: ['mic'], segments: lines.map(([t, , text]) => ({ start: t, end: t + 5, text, track: 'mic' })) }));
  fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify({ items: [
    { id: 'r1', kind: 'word', at: '00:02', heard: '랩캐시도', guess: 'Memcached', note: '오인식', status: 'open' },
    { id: 'r2', kind: 'word', at: '00:09', heard: '넥스트', guess: 'Next.js', note: '오인식', status: 'open' },
    { id: 'r3', kind: 'lost', at: '00:21', heard: null, guess: null, note: '반복', status: 'open',
      redo: { start: 20, end: 31, track: 'mic', lines: [{ start: 21, end: 26, text: '캐시를 먼저 비우고', track: 'mic', label: '화자 1' }, { start: 27, end: 30, text: '그다음 배포해요', track: 'mic', label: '화자 1' }], at: '2026-11-01T00:00:00.000Z' } },
  ] }));
}
const snap = (dir) => Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
const review = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'review.json'), 'utf8'));
const applyAll = (dir) => {
  minutes.applyReview(dir, FIXES);
  minutes.applyRetranscribe(dir, 'r3');
};
const revertAll = (dir) => {
  for (const id of [...IDS, 'r3']) minutes.revertReview(dir, id);
};

const results = [];
const check = (name, ok, detail = '') => results.push([name, Boolean(ok), detail]);
const diff = (a, b) => FILES.filter((f) => a[f] !== b[f]).join(', ') || '없음';

// 자식 프로세스: 적용만 하고 끝낸다 (부모가 아무 때나 강제 종료)
if (childDir) {
  app.whenReady().then(() => {
    process.stdout.write('ready\n');
    applyAll(childDir);
    process.stdout.write('done\n');
    app.exit(0);
  });
} else {
  app.whenReady().then(main).catch((e) => {
    console.error('끊김 시험 오류:', e.stack);
    app.exit(2);
  });
}

async function main() {
  const fresh = (name) => {
    const d = path.join(tmpRoot, name);
    makeMeeting(d);
    return d;
  };
  const d0 = fresh('base');
  const original = snap(d0);
  applyAll(d0);
  const applied = snap(d0);
  const r0 = review(d0);
  check('적용: 세 항목 모두 적용됨', r0.items.every((it) => it.status === 'applied'), r0.items.map((it) => `${it.id}:${it.status}`).join(' '));
  check('적용: 확인 필요 섹션은 그대로', applied['minutes.md'].includes('- "랩캐시도"(00:02)') && applied['minutes.md'].includes('Memcached 설정과 Next.js'));
  revertAll(d0);
  check('되돌리기: 처음과 같음', diff(snap(d0), original) === '없음', `다른 파일: ${diff(snap(d0), original)}`);
  check('남은 임시 파일 없음', !fs.readdirSync(d0).some((n) => n.endsWith('.tmp')));

  // 끊긴 지점 흉내: 적용을 끝까지 한 뒤 일부 파일을 적용 전 상태로 되돌려 "그 파일을 쓰기 전에 끊김"을 만든다
  const cuts = [
    ['기록(review.json)만 못 씀', ['review.json']],
    ['녹취만 쓰고 끊김 (정리본·회의록·기록 못 씀)', ['script-clean.txt', 'minutes.md', 'review.json']],
    ['녹취·정리본만 쓰고 끊김', ['minutes.md', 'review.json']],
  ];
  for (const [name, notWritten] of cuts) {
    const d = fresh(`cut-${results.length}`);
    const before = Object.fromEntries([...notWritten].map((f) => [f, fs.readFileSync(path.join(d, f), 'utf8')]));
    minutes.applyReview(d, FIXES);
    for (const [f, text] of Object.entries(before)) fs.writeFileSync(path.join(d, f), text);
    minutes.applyReview(d, FIXES); // 다시 누름
    const r = review(d);
    const okApply = IDS.every((id) => r.items.find((it) => it.id === id).status === 'applied' && Object.values(r.items.find((it) => it.id === id).undo ?? {}).some((u) => u.changed.length));
    const fullyApplied = ['transcript.txt', 'script-clean.txt', 'minutes.md'].every((f) => snap(d)[f] === applyOnly(original, f));
    check(`단어 적용 ${name} → 다시 누르면 이어서 끝남`, okApply && fullyApplied, `상태 ${r.items.map((it) => `${it.id}:${it.status}`).join(' ')} · 내용 ${fullyApplied ? '맞음' : '다름'}`);
    for (const id of IDS) minutes.revertReview(d, id);
    check(`  └ 되돌리면 처음과 같음`, diff(snap(d), original) === '없음', `다른 파일: ${diff(snap(d), original)}`);
  }

  // 구간 다시 받아쓰기: 녹취를 바꾼 뒤(원래 줄 기록은 먼저 남김) 끊김 → 다시 누르면 이어서 → 되돌리면 처음과 같음
  {
    const d = fresh('redo-cut');
    const rv = fs.readFileSync(path.join(d, 'review.json'), 'utf8');
    minutes.applyRetranscribe(d, 'r3');
    // 반영 표시(appliedAt) 없이 원래 줄 기록만 있는 상태 = 마지막 기록을 쓰기 전에 끊김
    const r = review(d);
    const item = r.items.find((it) => it.id === 'r3');
    delete item.redo.appliedAt;
    item.status = 'open';
    fs.writeFileSync(path.join(d, 'review.json'), JSON.stringify(r));
    minutes.applyRetranscribe(d, 'r3');
    const after = review(d).items.find((it) => it.id === 'r3');
    check('구간 반영 끊긴 뒤 다시 누르면 이어서 끝남', after.status === 'applied' && after.redo.appliedAt && snap(d)['transcript.txt'] === applied['transcript.txt'].replace(/Memcached/g, '랩캐시도').replace(/Next\.js/g, '넥스트'));
    minutes.revertReview(d, 'r3');
    check('  └ 되돌리면 처음과 같음 (예전에는 바뀐 줄을 원래 줄로 기억해 못 돌렸다)', diff(snap(d), original) === '없음', `다른 파일: ${diff(snap(d), original)}`);
    // 처음 기록부터 끊긴 경우(기록 전): 그냥 다시 누르면 됨
    fs.writeFileSync(path.join(d, 'review.json'), rv);
    minutes.applyRetranscribe(d, 'r3');
    minutes.applyRetranscribe(d, 'r3'); // 두 번 눌러도
    minutes.revertReview(d, 'r3');
    check('구간 반영 두 번 눌러도 되돌리면 처음과 같음', diff(snap(d), original) === '없음', `다른 파일: ${diff(snap(d), original)}`);
  }

  // 되돌리기가 내용 파일을 쓴 뒤 기록을 쓰기 전에 끊김 → 다시 되돌리면 끝나고 처음과 같음
  {
    const d = fresh('revert-cut');
    applyAll(d);
    const rv = fs.readFileSync(path.join(d, 'review.json'), 'utf8');
    revertAll(d);
    fs.writeFileSync(path.join(d, 'review.json'), rv);
    revertAll(d);
    check('되돌리기 끊긴 뒤 다시 되돌리면 처음과 같음', diff(snap(d), original) === '없음' && review(d).items.every((it) => it.status === 'open'), `다른 파일: ${diff(snap(d), original)}`);
  }

  // 같은 말을 같은 말로 고친 다른 항목의 줄을 가져가지 않는다
  {
    const d = fresh('dup');
    const r = review(d);
    r.items.push({ id: 'r4', kind: 'word', at: '00:33', heard: '랩캐시도', guess: 'Memcached', note: '같은 말', status: 'open' });
    fs.writeFileSync(path.join(d, 'review.json'), JSON.stringify(r));
    minutes.applyReview(d, [{ id: 'r1', guess: 'Memcached' }]);
    minutes.applyReview(d, [{ id: 'r4', guess: 'Memcached' }]);
    const r4 = review(d).items.find((it) => it.id === 'r4');
    check('같은 말 다른 항목은 적용으로 바뀌지 않음 (r1의 줄을 가져가지 않음)', r4.status === 'open', `r4 ${r4.status}`);
    minutes.revertReview(d, 'r1');
    check('  └ r1을 되돌리면 처음과 같음', ['transcript.txt', 'script-clean.txt', 'minutes.md'].every((f) => snap(d)[f] === original[f]));
  }

  // 실제 강제 종료
  const TRIALS = 40;
  const outcomes = { 끝나기전: 0, 끝난뒤: 0 };
  let bad = 0;
  const badDetail = [];
  for (let i = 0; i < TRIALS; i++) {
    const d = fresh(`kill-${i}`);
    const child = spawn(process.execPath, [__filename, '--child', d], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stderr.on('data', (b) => (err += b));
    const closed = new Promise((r) => child.on('close', r));
    const ready = await Promise.race([
      new Promise((resolve) => child.stdout.on('data', (b) => { out += b; if (out.includes('ready')) resolve(true); })),
      closed.then(() => false),
      new Promise((r) => setTimeout(() => r(false), 15000)),
    ]);
    if (!ready) {
      child.kill('SIGKILL');
      await closed;
      bad++;
      badDetail.push(`#${i} 자식이 시작하지 못함: ${err.split('\n').filter((l) => /Error|error/.test(l)).slice(0, 2).join(' ')}`);
      continue;
    }
    await new Promise((r) => setTimeout(r, Math.random() * 70));
    child.kill('SIGKILL');
    await closed;
    if (process.env.VERBOSE) console.error(`#${i} ${out.includes('done') ? '끝난 뒤' : '도중'}`);
    outcomes[out.includes('done') ? '끝난뒤' : '끝나기전']++;
    try {
      const rv = review(d); // review.json이 깨지지 않았는지 (깨지면 여기서 예외)
      if (!rv.items.find((it) => it.id === 'r3').redo.appliedAt) minutes.applyRetranscribe(d, 'r3');
      minutes.applyReview(d, FIXES);
      if (diff(snap(d), applied) !== '없음') throw new Error(`다시 누른 뒤 적용 결과가 다름: ${diff(snap(d), applied)}`);
      revertAll(d);
      if (diff(snap(d), original) !== '없음') throw new Error(`되돌린 뒤 처음과 다름: ${diff(snap(d), original)}`);
    } catch (e) {
      bad++;
      badDetail.push(`#${i} ${e.message}`);
    }
  }
  check(`강제 종료 ${TRIALS}번 (끝나기 전 ${outcomes.끝나기전} · 끝난 뒤 ${outcomes.끝난뒤}): 다시 누르면 끝나고 되돌리면 처음과 같음`, bad === 0, badDetail.slice(0, 3).join(' / '));

  let failed = 0;
  for (const [name, ok, detail] of results) {
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  }
  console.log(failed ? `끊김 시험 실패 ${failed}건` : `끊김 시험 통과 (${results.length}건)`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
}

// 원본에서 단어 두 개만 고친 모습 (구간 다시 받아쓰기 전)
function applyOnly(original, f) {
  if (f !== 'minutes.md') return original[f].replaceAll('랩캐시도', 'Memcached').replaceAll('넥스트', 'Next.js');
  const [body, ...rest] = original[f].split(/(?=^## 확인 필요)/m);
  return body.replaceAll('랩캐시도', 'Memcached').replaceAll('넥스트', 'Next.js') + rest.join('');
}
