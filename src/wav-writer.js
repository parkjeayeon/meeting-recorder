// 디스크에 바로바로 쓰는 WAV(PCM 16bit) 작성기.
// 헤더를 주기적으로 갱신해서 앱이 죽어도 그때까지 녹음된 부분은 재생 가능하다.
const fs = require('fs');

const HEADER_BYTES = 44;
const HEADER_REFRESH_MS = 5000;

class WavWriter {
  constructor(filePath, { sampleRate, channels = 1 }) {
    this.filePath = filePath;
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.dataBytes = 0;
    this.fd = fs.openSync(filePath, 'w');
    this.writeHeader();
    this.lastHeaderAt = Date.now();
  }

  writeHeader() {
    const h = Buffer.alloc(HEADER_BYTES);
    const blockAlign = this.channels * 2;
    h.write('RIFF', 0);
    h.writeUInt32LE(36 + this.dataBytes, 4);
    h.write('WAVE', 8);
    h.write('fmt ', 12);
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20); // PCM
    h.writeUInt16LE(this.channels, 22);
    h.writeUInt32LE(this.sampleRate, 24);
    h.writeUInt32LE(this.sampleRate * blockAlign, 28);
    h.writeUInt16LE(blockAlign, 32);
    h.writeUInt16LE(16, 34);
    h.write('data', 36);
    h.writeUInt32LE(this.dataBytes, 40);
    fs.writeSync(this.fd, h, 0, HEADER_BYTES, 0);
  }

  // samples: Float32Array (-1..1)
  append(samples) {
    const buf = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      buf.writeInt16LE(s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), i * 2);
    }
    fs.writeSync(this.fd, buf, 0, buf.length, HEADER_BYTES + this.dataBytes);
    this.dataBytes += buf.length;
    if (Date.now() - this.lastHeaderAt > HEADER_REFRESH_MS) {
      this.writeHeader();
      this.lastHeaderAt = Date.now();
    }
  }

  get durationSec() {
    return this.dataBytes / (this.sampleRate * this.channels * 2);
  }

  close() {
    this.writeHeader();
    fs.closeSync(this.fd);
  }
}

module.exports = { WavWriter };
