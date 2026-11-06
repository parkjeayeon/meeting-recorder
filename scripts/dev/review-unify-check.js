// 이름이 두 가지로 섞인 확인 필요 항목 (지어낸 회의): 들린 말과 같은 말로 적용, 통일 버튼, 되돌리기, 바꾸지 못한 이유.
//   npx electron scripts/dev/review-unify-check.js   (npm run dist가 빌드 전에 돌린다)
// 2026-11-06: 이름이 '원성'·'원석'으로 섞인 항목에 맞는 쪽('원석')을 넣고 적용하면 들린 말과 같아 조용히 건너뛰고 "0개를 그대로 두었습니다"만 떴다
const { app } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-unify-'));
app.setPath('userData', path.join(tmp, 'ud')); app.dock?.hide();
const minutes = require(path.resolve('src/minutes'));
const mk = () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'm-'));
  const t = '[00:01] [화자 1] 원성 님 말씀처럼요\n[00:05] [화자 2] 저는 원석입니다\n[00:09] [화자 1] 원성 님은 어떻게 보세요\n';
  fs.writeFileSync(path.join(dir, 'transcript.txt'), t);
  fs.writeFileSync(path.join(dir, 'script-clean.txt'), t);
  fs.writeFileSync(path.join(dir, 'minutes.md'), '# 상담\n\n## 요약\n- 원성 님이 조언함\n\n## 확인 필요\n- 화자 2 이름: 원성/원석\n');
  fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify({ items: [{ id: 'r2', kind: 'name', at: null, heard: '원석', heardNote: '원석', guess: null, status: 'open', note: "화자 2의 이름이 '원성'과 '원석'으로 혼재되어 정확한 이름 확인이 필요함." }] }));
  return dir;
};
// 회의록은 본문만 센다 ('## 확인 필요' 칸은 원래 기록으로 남긴다)
const body = (dir, f) => { const t = fs.readFileSync(path.join(dir, f), 'utf8'); return f === 'minutes.md' ? t.split(/^## 확인 필요/m)[0] : t; };
const count = (dir, w) => ['transcript.txt', 'script-clean.txt', 'minutes.md'].map((f) => (body(dir, f).match(new RegExp(w, 'g')) || []).length).join('/');
app.whenReady().then(async () => {
  const out = [];
  // 1. 고칠 말을 들린 말과 똑같이 (원석이 맞다)
  let d = mk(); const before = fs.readFileSync(path.join(d, 'transcript.txt'), 'utf8');
  let r = minutes.applyReview(d, [{ id: 'r2', guess: '원석' }]);
  out.push(['같은 말로 적용 → 원성이 원석으로', r.items[0].status === 'applied' && count(d, '원성') === '0/0/0' && r.items[0].heard === '원성', `상태 ${r.items[0].status} · 원성 ${count(d, '원성')} · 원석 ${count(d, '원석')} · skipped ${JSON.stringify(r.skipped)}`]);
  await minutes.revertReview(d, 'r2');
  out.push(['되돌리면 처음과 같음', fs.readFileSync(path.join(d, 'transcript.txt'), 'utf8') === before, '']);
  // 2. 통일 버튼: 모두 '원성'으로 (heard 원석 → 원성)
  d = mk(); r = minutes.applyReview(d, [{ id: 'r2', heard: '원석', guess: '원성' }]);
  out.push(["'원성'으로 통일", count(d, '원석') === '0/0/0' && r.items[0].status === 'applied', `원석 ${count(d, '원석')} · 원성 ${count(d, '원성')}`]);
  // 3. 다른 표기가 없는데 같은 말 → 바꾸지 않고 이유
  d = mk(); fs.writeFileSync(path.join(d, 'review.json'), JSON.stringify({ items: [{ id: 'r1', kind: 'word', heard: '원석', status: 'open', note: '이름 확인' }] }));
  r = minutes.applyReview(d, [{ id: 'r1', guess: '원석' }]);
  out.push(['다른 표기 없음 → 이유를 돌려줌', r.items[0].status === 'open' && r.skipped?.[0]?.reason === 'same', JSON.stringify(r.skipped)]);
  // 4. 녹취에 없는 말
  r = minutes.applyReview(d, [{ id: 'r1', heard: '없는말', guess: '원석' }]);
  out.push(['녹취에 없음 → 이유', r.skipped?.[0]?.reason === 'notfound', JSON.stringify(r.skipped)]);
  let failed = 0;
  console.log('이름 통일 시험');
  for (const [n, ok, info] of out) { if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${n} ${info}`); }
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
});
