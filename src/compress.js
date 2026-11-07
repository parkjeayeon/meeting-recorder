// 회의 녹음 압축: 확인을 마친 회의의 WAV를 AAC 96kbps(.m4a)로 바꿔 용량을 약 1/8로 (사용자가 고를 때만).
// 측정(docs/measurements.md): 96kbps는 받아쓰기 결과가 원본 WAV의 흔들림 폭 안, 64kbps는 반복 고장이 크게 늘어 쓰지 않는다.
// 압축한 녹음도 재생·구간 다시 받아쓰기·녹취부터 다시 만들기가 된다 (src/minutes.js가 읽을 때 16kHz WAV로 풀어 쓴다).
// 순서: m4a를 임시 이름으로 만든다 → 길이를 확인한다 → 이름을 바꾼다 → meta.json을 고친다 → WAV를 지운다.
// 중간에 끊겨도 원본이 먼저 사라지는 일은 없고, 다시 누르면 남은 WAV·임시 파일을 정리하며 이어서 끝낸다.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { writeJsonAtomic } = require('../lib/core/index.mjs');

const AFCONVERT = '/usr/bin/afconvert';
const AFINFO = '/usr/bin/afinfo';
const BITRATE = 96000;
// macOS AAC 변환기는 표본율이 낮으면 96kbps를 받지 않는다 (16kHz는 48kbps까지, 22·24kHz는 64kbps까지). 측정한 것은 48kHz의 96kbps뿐이고
// 64kbps 이하는 반복 고장이 늘었다 → 32kHz 미만 녹음(전화 녹음 등을 가져온 회의는 16kHz로 저장된다)은 압축하지 않는다. 16kHz WAV는 원래 1시간 115MB
const MIN_RATE = 32000;

const run = (bin, args) => new Promise((resolve, reject) => execFile(bin, args, { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim().split('\n')[0])) : resolve(stdout))));
const sizeOf = (file) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
};
async function durationOf(file) {
  const out = await run(AFINFO, [file]);
  return Number(/estimated duration:\s*([\d.]+)/.exec(out)?.[1] ?? NaN);
}

// 회의 녹음의 크기와 압축 상태 (회의 목록·회의 화면에 쓴다). estimate: 96kbps로 줄였을 때의 크기 (실측 2시간 689MB → 85MB)
function audioInfo(dir, meta) {
  const files = Object.values(meta.files ?? {});
  const bytes = files.reduce((n, f) => n + sizeOf(path.join(dir, f.file)), 0);
  const sec = files.reduce((n, f) => n + (f.durationSec ?? 0), 0);
  const wav = files.some((f) => /\.wav$/i.test(f.file ?? ''));
  const supported = (meta.sampleRate ?? 48000) >= MIN_RATE;
  return { bytes, wav, supported, compressed: !wav && Boolean(meta.compressed), estimate: Math.round(sec * (BITRATE / 8) * 1.01), declined: Boolean(meta.compressDeclined) };
}

async function compressMeeting(dir) {
  const metaFile = path.join(dir, 'meta.json');
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  const info = audioInfo(dir, meta);
  if (!info.supported) throw new Error(`표본율이 낮은 녹음(${meta.sampleRate}Hz)은 압축하지 않습니다 — 원본이 이미 작습니다`);
  const before = info.bytes;
  for (const [track, f] of Object.entries(meta.files ?? {})) {
    const m4a = `${track}.m4a`;
    const wavPath = path.join(dir, `${track}.wav`);
    if (f.file === m4a) {
      fs.rmSync(wavPath, { force: true }); // 지난번에 meta를 고친 뒤 WAV를 지우기 전에 끊긴 경우
      continue;
    }
    if (!fs.existsSync(wavPath)) throw new Error(`${track} 녹음 파일이 없습니다`);
    const tmp = path.join(dir, `.${track}.m4a.part`);
    fs.rmSync(tmp, { force: true });
    await run(AFCONVERT, ['-f', 'm4af', '-d', 'aac', '-b', String(BITRATE), wavPath, tmp]);
    // 길이가 맞는지 (AAC는 앞뒤로 아주 조금 붙을 수 있다)
    const got = await durationOf(tmp);
    const want = f.durationSec ?? (await durationOf(wavPath));
    if (!(Math.abs(got - want) < 1)) {
      fs.rmSync(tmp, { force: true });
      throw new Error(`압축한 녹음의 길이가 다릅니다 (${got.toFixed(1)}초, 원본 ${want.toFixed(1)}초) — 원본은 그대로 두었습니다`);
    }
    fs.renameSync(tmp, path.join(dir, m4a));
    meta.files[track] = { ...f, file: m4a };
    writeJsonAtomic(metaFile, { ...meta, compressed: { at: new Date(), codec: 'aac', bitrate: BITRATE, beforeBytes: before } });
    fs.rmSync(wavPath, { force: true });
  }
  const after = audioInfo(dir, JSON.parse(fs.readFileSync(metaFile, 'utf8')));
  return { before, after: after.bytes };
}

// "그대로 두기": 압축 안내를 다시 띄우지 않는다 (… 메뉴에서는 언제든 압축할 수 있다)
function declineCompress(dir, declined = true) {
  const metaFile = path.join(dir, 'meta.json');
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  if (declined) meta.compressDeclined = true;
  else delete meta.compressDeclined;
  writeJsonAtomic(metaFile, meta);
}

module.exports = { compressMeeting, declineCompress, audioInfo, BITRATE };
