// 회의 녹음 압축 시험 (src/compress.js, src/minutes.js decodeTo16k): macOS 음성으로 만든 가짜 회의로. 실제 녹음은 건드리지 않는다.
//   npx electron scripts/dev/compress-check.js     (npm run test:crash, npm run dist가 빌드 전에 돌린다)
// 보는 것: WAV → AAC 96kbps(.m4a), meta.json(files·compressed) 고침, WAV 지움, 크기, 16kHz WAV(44바이트 머리)로 풀기,
// 길이가 다르면 원본을 두고 멈춤, meta를 고친 뒤 WAV를 지우기 전에 끊긴 경우 다시 누르면 정리, '그대로 두기' 표시
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-compress-'));
app.setPath('userData', path.join(tmp, 'userData'));
app.setName(`mr-compress-check-${process.pid}`);
app.dock?.hide();
setTimeout(() => {
  console.error('압축 시험 시간 초과');
  process.exit(1);
}, 120000);

// 48kHz 16bit 모노 WAV (앱 녹음과 같은 형식): say → afconvert, 약 30초가 되게 문장을 이어 붙인다
function makeMeeting(name, rate = 48000) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  const aiff = path.join(tmp, `${name}.aiff`);
  execFileSync('/usr/bin/say', ['-v', 'Yuna', '-o', aiff, '다음 주 배포 일정은 화요일 오전으로 정했습니다. 성능 시험 결과는 금요일에 다시 보겠습니다. '.repeat(5)]);
  execFileSync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', `LEI16@${rate}`, '-c', '1', aiff, path.join(dir, 'mic.wav')]);
  const sec = Number(/estimated duration:\s*([\d.]+)/.exec(execFileSync('/usr/bin/afinfo', [path.join(dir, 'mic.wav')]).toString())[1]);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ mode: 'meeting', sampleRate: rate, bitDepth: 16, startedAt: new Date().toISOString(), files: { mic: { file: 'mic.wav', durationSec: sec } } }));
  return { dir, sec };
}
const readMeta = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));

app.whenReady().then(async () => {
  const compress = require('../../src/compress');
  const minutes = require('../../src/minutes');
  const results = [];
  const check = (name, ok, detail) => results.push([name, ok, detail]);

  // 압축
  const a = makeMeeting('2026-11-07_10-00-00_meeting');
  const before = compress.audioInfo(a.dir, readMeta(a.dir));
  const r = await compress.compressMeeting(a.dir);
  const meta = readMeta(a.dir);
  const after = compress.audioInfo(a.dir, meta);
  check('WAV → AAC 96kbps', meta.files.mic.file === 'mic.m4a' && fs.existsSync(path.join(a.dir, 'mic.m4a')) && !fs.existsSync(path.join(a.dir, 'mic.wav')) && meta.compressed?.bitrate === 96000 && !fs.readdirSync(a.dir).some((f) => f.endsWith('.part')),
    `${JSON.stringify(meta.files.mic)} · 폴더 ${fs.readdirSync(a.dir).join(',')}`);
  check('크기 약 1/8, 짐작과 비슷', r.after < r.before / 6 && Math.abs(after.bytes - before.estimate) / before.estimate < 0.25 && after.compressed && !after.wav,
    `${r.before} → ${r.after}바이트 (짐작 ${before.estimate})`);

  // 풀기: 구간 다시 받아쓰기·녹취부터 다시 만들기가 읽는 16kHz WAV (44바이트 머리)
  const out = path.join(tmp, 'back-16k.wav');
  await minutes.decodeTo16k(path.join(a.dir, 'mic.m4a'), out);
  const head = fs.readFileSync(out).subarray(0, 44);
  const sec = (fs.statSync(out).size - 44) / 32000;
  check('16kHz WAV로 풀기', head.toString('ascii', 0, 4) === 'RIFF' && head.readUInt16LE(20) === 1 && head.readUInt32LE(24) === 16000 && head.toString('ascii', 36, 40) === 'data' && Math.abs(sec - a.sec) < 0.2 && !fs.existsSync(`${out}.af.wav`),
    `형식 ${head.readUInt16LE(20)} · ${head.readUInt32LE(24)}Hz · ${sec.toFixed(2)}초 (원본 ${a.sec.toFixed(2)}초)`);

  // 길이가 다르면 원본을 두고 멈춤
  const b = makeMeeting('2026-11-07_11-00-00_meeting');
  const mb = readMeta(b.dir);
  mb.files.mic.durationSec = b.sec + 5;
  fs.writeFileSync(path.join(b.dir, 'meta.json'), JSON.stringify(mb));
  let err = null;
  try {
    await compress.compressMeeting(b.dir);
  } catch (e) {
    err = e.message;
  }
  check('길이가 다르면 원본 그대로', Boolean(err?.includes('원본은 그대로')) && fs.existsSync(path.join(b.dir, 'mic.wav')) && !fs.existsSync(path.join(b.dir, 'mic.m4a')) && readMeta(b.dir).files.mic.file === 'mic.wav' && !fs.readdirSync(b.dir).some((f) => f.endsWith('.part')), String(err));

  // meta를 고친 뒤 WAV를 지우기 전에 끊긴 경우: 다시 누르면 남은 WAV를 지우고 끝
  fs.writeFileSync(path.join(a.dir, 'mic.wav'), 'leftover');
  await compress.compressMeeting(a.dir);
  check('끊긴 뒤 다시 누르면 정리', !fs.existsSync(path.join(a.dir, 'mic.wav')) && readMeta(a.dir).files.mic.file === 'mic.m4a', fs.readdirSync(a.dir).join(','));

  // 32kHz 미만(가져온 전화 녹음 등, 16kHz로 저장)은 압축하지 않는다 — macOS AAC 변환기가 96kbps를 받지 않는다
  const c = makeMeeting('2026-11-07_12-00-00_meeting', 16000);
  let lowErr = null;
  try {
    await compress.compressMeeting(c.dir);
  } catch (e) {
    lowErr = e.message;
  }
  check('16kHz 녹음은 압축하지 않음', !compress.audioInfo(c.dir, readMeta(c.dir)).supported && Boolean(lowErr?.includes('16000Hz')) && fs.existsSync(path.join(c.dir, 'mic.wav')) && readMeta(c.dir).files.mic.file === 'mic.wav', String(lowErr));

  // 그대로 두기
  compress.declineCompress(b.dir);
  const declined = compress.audioInfo(b.dir, readMeta(b.dir)).declined;
  compress.declineCompress(b.dir, false);
  check("'그대로 두기' 표시와 되돌리기", declined && !compress.audioInfo(b.dir, readMeta(b.dir)).declined, `${declined}`);

  let failed = 0;
  for (const [name, ok, detail] of results) {
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
  }
  console.log(failed ? `압축 시험 실패 ${failed}건` : `압축 시험 통과 (${results.length}건)`);
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
});
