// 입력(트랙)마다 채널 0을 모아 CHUNK 샘플 단위로 메인 스레드에 보낸다.
// 어떤 입력이 잠깐 비어도 0으로 채워서 트랙 간 시간축이 항상 일치하게 한다.
const CHUNK = 4800; // 48kHz 기준 100ms

class RecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.trackCount = options.numberOfInputs;
    this.buffers = Array.from({ length: this.trackCount }, () => new Float32Array(CHUNK));
    this.index = 0;
    this.recording = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') {
        this.flush();
        this.recording = false;
        this.port.postMessage('done');
      }
    };
  }

  flush() {
    if (this.index === 0) return;
    const tracks = this.buffers.map((b) => b.slice(0, this.index));
    this.port.postMessage({ tracks }, tracks.map((t) => t.buffer));
    this.index = 0;
  }

  process(inputs) {
    if (!this.recording) return false;
    const frames = 128;
    let offset = 0;
    while (offset < frames) {
      const n = Math.min(frames - offset, CHUNK - this.index);
      for (let t = 0; t < this.trackCount; t++) {
        const ch = inputs[t]?.[0];
        if (ch) this.buffers[t].set(ch.subarray(offset, offset + n), this.index);
        else this.buffers[t].fill(0, this.index, this.index + n);
      }
      this.index += n;
      offset += n;
      if (this.index === CHUNK) this.flush();
    }
    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
