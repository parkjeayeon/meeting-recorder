// 녹음 중 미리 받아쓰기(결정 83)를 실제 녹음 사본으로 재 본다: 녹음기처럼 WAV를 키우며 찌르고(poke), 멈추면 finish() 뒤 녹취(transcribeMeeting)를 돌린다.
// 실제 회의 폴더를 바꾸지 않도록 사본 폴더에만 쓴다 (mic.wav와 meta.json만 복사해서 쓴다):
//   cp -c ~/Documents/MeetingRecorder/<회의>/{mic.wav,meta.json} .work/pre/a/
//   cp -c ~/Documents/MeetingRecorder/<회의>/{mic.wav,meta.json} .work/pre/b/
//   npx electron scripts/dev/pretranscribe-replay.js .work/pre/a            # 미리 받아쓰기
//   npx electron scripts/dev/pretranscribe-replay.js --no-pre .work/pre/b   # 비교 기준 (미리 받아쓰지 않음)
//   diff <(sed -E 's/"ms":[0-9]+/"ms":0/g' .work/pre/a/segments.json) <(sed -E 's/"ms":[0-9]+/"ms":0/g' .work/pre/b/segments.json)
//   diff .work/pre/a/transcript.txt .work/pre/b/transcript.txt; cmp .work/pre/a/diarization.json .work/pre/b/diarization.json
// 먼저 `npm run build:ts` (lib/를 쓴다).
// --step <초>: 한 번에 키우는 녹음 길이 (기본 60). 실제 시간만큼 기다리지 않는다 — 한 걸음마다 poke()를 부르고 그 돌기가 끝나기를 기다린다.
// 녹음은 녹음기와 같은 WavWriter로 쓴다(16bit 값 → float → 16bit라 원본과 바이트까지 같다, 끝나면 확인한다).
// 원본은 처음에 .replay-<트랙>.wav로 옮겨 두고, 다 키운 파일이 원본과 같으면 지운다 (중간에 끊기면 다음 실행이 그것을 원본으로 다시 쓴다).
// 시작할 때 지난 실행이 남긴 .pre(미리 받아 둔 조각)·segments.json·transcript.txt·diarization.json을 지운다.
// 끝나면 JSON 한 줄: 조각 수·다시 쓴 수, 녹음 중 돌기마다 걸린 초와 합, 멈춘 뒤 finish()를 기다린 초, 녹취 초, diarizeMs, timing 전체.
// 메인 창을 띄우지 않는다. 같은 모델·설정 폴더를 읽기만 한다 (설치된 앱이 켜져 있어도 되지만 GPU를 나눠 쓰면 시간이 늘어난다).
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { app } = require('electron');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--inspect'));
const noPre = args.includes('--no-pre');
const stepAt = args.indexOf('--step');
const stepSec = stepAt >= 0 ? Number(args[stepAt + 1]) : 60;
if (!(stepSec > 0)) {
  console.error('--step 값은 0보다 큰 초여야 합니다');
  process.exit(1);
}
const rest = args.filter((a, i) => a !== '--no-pre' && a !== '--step' && !(stepAt >= 0 && i === stepAt + 1) && !a.startsWith('-') && !a.endsWith('.js'));
const dir = rest.length ? path.resolve(rest.at(-1)) : null;
if (!dir || !fs.existsSync(path.join(dir, 'meta.json'))) {
  console.error('사본 폴더(meta.json과 녹음 WAV가 있는 곳)를 지정하세요');
  process.exit(1);
}
const inside = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
if (inside(path.join(os.homedir(), 'Documents', 'MeetingRecorder'), dir)) {
  console.error('실제 녹음 폴더입니다. 사본 폴더를 지정하세요.');
  process.exit(1);
}
app.setPath('userData', path.join(app.getPath('appData'), 'meeting-recorder'));
app.dock?.hide();

// 파일의 [start, end) 바이트 해시 (2시간 녹음도 메모리에 다 올리지 않게)
const hashRange = (file, start, end) =>
  new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    if (end <= start) return resolve(h.digest('hex'));
    fs.createReadStream(file, { start, end: end - 1 })
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });

async function replay() {
  const dictation = require('../../src/dictation');
  const minutes = require('../../src/minutes'); // 회의 모듈에 Whisper 서버·설정을 이어 둔다
  const { WavWriter } = require('../../lib/meeting/wav-writer.mjs');
  const settings = dictation.getSettings();
  // 앱 설정에서 녹음 폴더를 바꿨으면 그 폴더도 막는다
  if (typeof settings.recordingsDir === 'string' && inside(path.resolve(settings.recordingsDir), dir)) throw new Error('실제 녹음 폴더입니다. 사본 폴더를 지정하세요.');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const tracks = Object.keys(meta.files ?? {});
  if (!tracks.length) throw new Error('meta.json에 트랙이 없습니다');

  // 지난 실행이 남긴 것
  for (const f of ['segments.json', 'transcript.txt', 'diarization.json']) fs.rmSync(path.join(dir, f), { force: true });
  fs.rmSync(path.join(dir, '.pre'), { recursive: true, force: true });

  // 원본을 옆으로 옮기고 녹음기처럼 새로 쓴다
  const sources = {};
  for (const track of tracks) {
    const file = meta.files[track]?.file ?? `${track}.wav`;
    if (!/\.wav$/i.test(file)) throw new Error(`${track}: 압축한 녹음(${file})은 재생할 수 없습니다 — WAV 사본을 쓰세요`);
    if (file !== `${track}.wav`) throw new Error(`${track}: 녹음기가 쓰는 이름(${track}.wav)이 아닙니다 (${file})`);
    const src = path.join(dir, `.replay-${track}.wav`);
    if (!fs.existsSync(src)) fs.renameSync(path.join(dir, file), src);
    const fd = fs.openSync(src, 'r');
    const h = Buffer.alloc(44);
    fs.readSync(fd, h, 0, 44, 0);
    const size = fs.fstatSync(fd).size;
    if (h.toString('ascii', 0, 4) !== 'RIFF' || h.readUInt16LE(22) !== 1 || h.readUInt16LE(34) !== 16) throw new Error(`${track}: 16bit 모노 WAV가 아닙니다`);
    const rate = h.readUInt32LE(24);
    sources[track] = { fd, rate, samples: Math.floor((size - 44) / 2), at: 0, writer: new WavWriter(path.join(dir, `${track}.wav`), { sampleRate: rate }) };
  }
  const audioSec = Math.max(...Object.values(sources).map((s) => s.samples / s.rate));

  const pre = noPre ? null : minutes.createPretranscriber({ dir, tracks, log: (...a) => console.error(...a) });
  const runs = [];
  for (let sec = stepSec; ; sec += stepSec) {
    let more = false;
    for (const s of Object.values(sources)) {
      const to = Math.min(s.samples, Math.round(sec * s.rate));
      if (to <= s.at) continue;
      const buf = Buffer.alloc((to - s.at) * 2);
      fs.readSync(s.fd, buf, 0, buf.length, 44 + s.at * 2);
      const f = new Float32Array(to - s.at);
      for (let i = 0; i < f.length; i++) {
        const v = buf.readInt16LE(i * 2);
        f[i] = v < 0 ? v / 32768 : v / 32767; // WavWriter가 같은 값으로 되돌려 쓴다
      }
      s.writer.append(f);
      s.at = to;
      if (to < s.samples) more = true;
    }
    if (pre) {
      const r = await pre.poke();
      if (r) {
        runs.push({ atSec: Math.min(sec, Math.round(audioSec)), sec: Math.round(r.ms / 100) / 10, transcribed: r.transcribed, cached: r.cached, final: r.final });
        console.error(`${Math.min(sec, Math.round(audioSec))}초까지 녹음: ${r.transcribed}조각 받아씀 (${(r.ms / 1000).toFixed(1)}초)`);
      }
    }
    if (!more) break;
  }
  for (const s of Object.values(sources)) s.writer.close();
  const tf = Date.now();
  if (pre) await pre.finish();
  const finishWaitSec = Math.round((Date.now() - tf) / 100) / 10;

  // 다 키운 녹음이 원본과 바이트까지 같은지 (같으면 원본을 지운다)
  for (const [track, s] of Object.entries(sources)) {
    fs.closeSync(s.fd);
    const src = path.join(dir, `.replay-${track}.wav`);
    const grown = path.join(dir, `${track}.wav`);
    // PCM만 비교한다 (손으로 만든 WAV면 머리만 다를 수 있다)
    const same = fs.statSync(grown).size === 44 + s.samples * 2 && (await hashRange(src, 44, 44 + s.samples * 2)) === (await hashRange(grown, 44, 44 + s.samples * 2));
    if (!same) throw new Error(`${track}: 다시 쓴 녹음이 원본과 다릅니다 (원본은 ${src}에 남겨 둠)`);
    fs.rmSync(src);
  }

  const timing = {};
  const t = Date.now();
  const report = (status, extra = {}) => console.error(`${((Date.now() - t) / 1000).toFixed(0)}s`, status, extra.progress != null ? `${Math.round(extra.progress * 100)}%` : '');
  const { transcript } = await minutes.transcribeMeeting(dir, meta, dictation.getSettings(), meta.speakers ?? null, timing, report);
  const transcribeSec = Math.round((Date.now() - t) / 100) / 10;
  console.log(
    JSON.stringify({
      mode: noPre ? 'no-pre' : 'pre',
      stepSec,
      audioSec: Math.round(audioSec),
      piecesTotal: timing.pre?.total ?? null,
      piecesReused: timing.pre?.reused ?? null,
      liveRuns: runs,
      liveSec: Math.round(runs.reduce((x, r) => x + r.sec, 0) * 10) / 10,
      finishWaitSec,
      transcribeSec,
      diarizeMs: timing.diarizeMs ?? null,
      chars: transcript.replace(/\s/g, '').length,
      timing,
    }),
  );
}

app.whenReady().then(async () => {
  try {
    await replay();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
  app.quit();
});
