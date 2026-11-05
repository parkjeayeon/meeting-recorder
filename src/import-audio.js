// 녹음 파일 가져오기: 다른 앱에서 녹음한 파일을 회의 폴더(mic.wav + meta.json)로 만든다. 여러 개면 이름 순서대로 이어 붙인다.
// macOS 기본 변환기(afconvert)로 16비트 모노 WAV로 바꾼다. 16kHz 이하 녹음은 16kHz, 그 밖은 48kHz로 맞춘다
// (회의록이 정수 배로 묶어 16kHz로 줄이므로 44.1kHz 같은 값은 쓰지 않는다).
// Apple이 쓴 WAV는 'FLLR' 같은 덩어리가 붙어 소리 데이터가 44바이트 뒤에서 시작하지 않는다. 회의록 파이프라인은 44바이트 헤더를
// 가정하므로 data 덩어리만 꺼내 표준 헤더로 다시 쓴다. 원본 파일은 읽기만 한다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const sandbox = require('./sandbox');
const { writeJsonAtomic } = require('../lib/core/index.mjs'); // 파일 쓰기는 끊겨도 깨지지 않게 (결정 45)

const AFCONVERT = '/usr/bin/afconvert';
const AFINFO = '/usr/bin/afinfo';
const EXTS = ['.wav', '.m4a', '.mp3', '.aac', '.caf', '.aif', '.aiff', '.flac', '.mp4', '.mov', '.3gp'];

function run(cmd, args, { write = [] } = {}) {
  const [bin, argv] = sandbox.wrap(cmd, args, { write, network: 'none' });
  return new Promise((resolve, reject) => {
    execFile(bin, argv, { timeout: 30 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim().split('\n')[0])) : resolve(stdout)));
  });
}

async function probe(file) {
  const out = await run(AFINFO, [file]).catch(() => '');
  return { rate: Number(/Data format:.*?(\d+) Hz/.exec(out)?.[1]) || null, durationSec: Number(/estimated duration: ([\d.]+)/.exec(out)?.[1]) || null };
}
const sampleRate = async (file) => (await probe(file)).rate;

// 이어 붙일 순서: 이름 순서 (녹음 앱은 보통 시각을 넣어 이름을 짓는다)
const sortFiles = (files) => [...files].sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'ko', { numeric: true }));

// 가져오기 확인 창에 보여 줄 목록 (순서·길이). 형식이 맞지 않으면 여기서 알린다
async function describe(files) {
  const bad = files.find((f) => !EXTS.includes(path.extname(f).toLowerCase()));
  if (bad) throw new Error(`가져올 수 없는 형식입니다: ${path.basename(bad)}`);
  return Promise.all(sortFiles(files).map(async (f) => ({ path: f, name: path.basename(f), durationSec: (await probe(f)).durationSec })));
}

// WAV 안 data 덩어리의 위치와 길이
function dataChunk(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    for (let i = 12; i + 8 <= n; ) {
      const id = head.toString('latin1', i, i + 4);
      const size = head.readUInt32LE(i + 4);
      if (id === 'data') return { offset: i + 8, size: Math.min(size, fs.fstatSync(fd).size - i - 8) };
      i += 8 + size + (size & 1);
    }
  } finally {
    fs.closeSync(fd);
  }
  throw new Error('변환한 파일에서 소리 데이터를 찾지 못했습니다');
}

function wavHeader(dataBytes, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // 모노
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

// 파일 이름에 녹음 시각이 있으면 그걸 쓴다 ("2026-11-04 오후 4.49.27", "20261104_164927", "2026-11-04 16-49-27" 등)
function timeFromName(name) {
  const m = /(\d{4})[-._]?(\d{2})[-._]?(\d{2})[\s_T-]*(오전|오후|AM|PM)?\s*(\d{1,2})[.:\-_]?(\d{2})[.:\-_]?(\d{2})/i.exec(name);
  if (!m) return null;
  let hour = Number(m[5]);
  if (/오후|PM/i.test(m[4] ?? '') && hour < 12) hour += 12;
  if (/오전|AM/i.test(m[4] ?? '') && hour === 12) hour = 0;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, Number(m[6]), Number(m[7]));
  return Number.isNaN(d.getTime()) || hour > 23 ? null : d;
}

function folderName(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}_meeting`;
}

/**
 * @param {string[]} files 가져올 녹음 파일 (이름 순서대로 이어 붙인다)
 * @param {string} recordingsDir 녹음 폴더
 * @param {{notes?: string, speakers?: number|null}} opts notes: 녹음에 담기지 않은 내용(회의록에 '녹음 외 메모'로), speakers: 참석 인원
 * @returns {Promise<string>} 만든 회의 폴더
 */
async function importAudio(files, recordingsDir, { notes = '', speakers = null } = {}) {
  if (!files.length) throw new Error('가져올 파일이 없습니다');
  const bad = files.find((f) => !EXTS.includes(path.extname(f).toLowerCase()));
  if (bad) throw new Error(`가져올 수 없는 형식입니다: ${path.basename(bad)}`);
  const sorted = sortFiles(files);
  const rates = await Promise.all(sorted.map(sampleRate));
  const rate = rates.every((r) => r && r <= 16000) ? 16000 : 48000;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-import-'));
  let dir = null;
  try {
    const parts = [];
    for (const [i, file] of sorted.entries()) {
      const out = path.join(tmp, `${i}.wav`);
      await run(AFCONVERT, ['-f', 'WAVE', '-d', `LEI16@${rate}`, '-c', '1', file, out], { write: [tmp] }).catch((err) => {
        throw new Error(`${path.basename(file)}을(를) 변환하지 못했습니다: ${err.message}`);
      });
      parts.push({ file: out, ...dataChunk(out) });
    }

    // 녹음 시각: 첫 파일 이름의 시각, 없으면 첫 파일 수정 시각(녹음이 끝난 때)에서 길이를 뺀다
    const durations = parts.map((p) => p.size / 2 / rate);
    const total = durations.reduce((a, b) => a + b, 0);
    const startedAt = timeFromName(path.basename(sorted[0])) ?? new Date(fs.statSync(sorted[0]).mtimeMs - durations[0] * 1000);
    let name = folderName(startedAt);
    for (let n = 2; fs.existsSync(path.join(recordingsDir, name)); n++) name = `${folderName(startedAt)}-${n}`;
    dir = path.join(recordingsDir, name);
    fs.mkdirSync(dir);

    // 표준 44바이트 헤더 + 각 파일의 소리 데이터를 차례로
    const mic = path.join(dir, 'mic.wav');
    const dataBytes = parts.reduce((a, p) => a + p.size, 0);
    const fd = fs.openSync(mic, 'w');
    try {
      fs.writeSync(fd, wavHeader(dataBytes, rate));
      const buf = Buffer.alloc(4 * 1024 * 1024);
      for (const p of parts) {
        const src = fs.openSync(p.file, 'r');
        for (let pos = 0; pos < p.size; ) {
          const n = fs.readSync(src, buf, 0, Math.min(buf.length, p.size - pos), p.offset + pos);
          if (!n) break;
          fs.writeSync(fd, buf, 0, n);
          pos += n;
        }
        fs.closeSync(src);
      }
    } finally {
      fs.closeSync(fd);
    }

    let offset = 0;
    const sources = sorted.map((f, i) => {
      const s = { name: path.basename(f), offsetSec: Number(offset.toFixed(2)), durationSec: Number(durations[i].toFixed(2)) };
      offset += durations[i];
      return s;
    });
    // meta.json을 마지막에 써야 목록에 나타난다 (그 전에는 만드는 중인 폴더로 보고 건너뛴다)
    const meta = {
      mode: 'meeting', sampleRate: rate, bitDepth: 16, startedAt, endedAt: new Date(startedAt.getTime() + total * 1000),
      devices: null, files: { mic: { file: 'mic.wav', durationSec: Number(total.toFixed(2)) } }, imported: sources,
      ...(speakers ? { speakers } : {}), ...(notes.trim() ? { notes: notes.trim().slice(0, 4000) } : {}),
    };
    writeJsonAtomic(path.join(dir, 'meta.json'), meta);
    return dir;
  } catch (err) {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { importAudio, describe, timeFromName, EXTS };
