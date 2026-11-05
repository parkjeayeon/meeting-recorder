// 디스크가 가득 찼을 때 파일 쓰기 시험: 작은 RAM 디스크를 만들어 거의 채운 뒤,
// 기존 파일을 더 큰 내용으로 바꿔 쓰면 예전 방식(덮어쓰기)은 파일이 비거나 잘리고, 원자적 쓰기는 원래 파일이 남는지 본다.
//   npm run build:ts && node scripts/dev/disk-full-check.js        (관리자 권한 필요 없음, 끝나면 디스크를 뗀다)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../../lib/core/index.mjs');

const dev = execFileSync('hdiutil', ['attach', '-nomount', 'ram://4096'], { encoding: 'utf8' }).trim().split(/\s+/)[0]; // 2MB
const name = `mrfull${process.pid}`;
let ok = true;
try {
  execFileSync('diskutil', ['erasevolume', 'HFS+', name, dev], { stdio: 'ignore' });
  const vol = `/Volumes/${name}`;
  const original = JSON.stringify({ items: [{ id: 'r1', note: '원래 내용'.repeat(200) }] });
  const bigger = 'x'.repeat(3 * 1024 * 1024); // 디스크보다 큰 새 내용
  for (const mode of ['plain', 'atomic']) {
    const f = path.join(vol, `${mode}.json`);
    fs.writeFileSync(f, original);
    // 남은 공간을 거의 채운다
    const filler = path.join(vol, 'filler');
    try { fs.writeFileSync(filler, Buffer.alloc(4 * 1024 * 1024)); } catch {}
    let error = null;
    try {
      if (mode === 'plain') fs.writeFileSync(f, bigger);
      else writeFileAtomic(f, bigger);
    } catch (e) {
      error = e.code;
    }
    const now = fs.readFileSync(f, 'utf8');
    const intact = now === original;
    const leftovers = fs.readdirSync(vol).filter((n) => n.endsWith('.tmp'));
    console.log(`${mode === 'plain' ? '덮어쓰기' : '원자적  '}: 오류 ${error} · 원래 파일 ${intact ? '그대로' : `망가짐 (${now.length}바이트, 원래 ${original.length})`} · 남은 임시 파일 ${leftovers.length}`);
    if (mode === 'atomic' && (!intact || leftovers.length || error !== 'ENOSPC')) ok = false;
    fs.rmSync(filler, { force: true });
  }
} finally {
  execFileSync('hdiutil', ['detach', dev], { stdio: 'ignore' });
}
console.log(ok ? '디스크 가득 참 시험 통과' : '디스크 가득 참 시험 실패');
process.exit(ok ? 0 : 1);
