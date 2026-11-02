// 고아 프로세스 점검: 부모가 사라져 launchd(PID 1)에 입양된 도우미 프로세스를 찾는다.
// 앱 본체(.app/Contents/MacOS/…)·시스템 프로세스·launchd가 직접 관리하는 서비스는 원래 PID 1이므로 뺀다.
//   node scripts/dev/orphans.js            → 의심 목록
//   node scripts/dev/orphans.js --app      → 이 앱의 도우미(whisper-server, fn-listener)만
const { execFileSync } = require('child_process');

const launchd = new Set(execFileSync('launchctl', ['list']).toString().split('\n').slice(1).map((l) => l.split('\t')[0]).filter((p) => /^\d+$/.test(p)));
const onlyApp = process.argv.includes('--app');
const rows = [];
for (const line of execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,etime=,command=']).toString().split('\n')) {
  const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
  if (!m || m[2] !== '1' || launchd.has(m[1])) continue;
  const cmd = m[5];
  const exe = cmd.split(' -')[0].trim();
  if (/^\/(System|usr|sbin|bin|Library\/Apple)\//.test(exe) || /\.app\/Contents\/MacOS\/[^/ ]+$/.test(exe)) continue;
  if (onlyApp && !/whisper-server|fn-listener|diarize\.py/.test(cmd)) continue;
  rows.push({ pid: m[1], mb: Math.round(m[3] / 1024), age: m[4], cmd: cmd.slice(0, 140) });
}
rows.sort((a, b) => b.mb - a.mb);
for (const r of rows) console.log(`${String(r.mb).padStart(6)}MB  ${r.age.padStart(12)}  pid=${r.pid}  ${r.cmd}`);
console.log(`후보 ${rows.length}개 (크래시 리포터·의도된 데몬도 섞일 수 있으니 하나씩 확인)`);
