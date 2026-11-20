// 회의 폴더 사본에 회의록 파이프라인(녹취 → 반복 구간 다시 받아쓰기 → 화자 구분 → 회의록)을 다시 돌린다.
// 실제 회의 폴더를 바꾸지 않도록 사본 폴더에만 쓴다: mic.wav와 meta.json만 복사해서 쓴다.
//   cp -c ~/Documents/MeetingRecorder/<회의>/{mic.wav,meta.json} /tmp/m/
//   npx electron scripts/dev/rerun-meeting.js /tmp/m
// --transcribe-only: 녹취 단계(16kHz 변환 → 조각별 Whisper → 반복 구간 다시 → 화자 구분 → transcript.txt·segments.json·diarization.json)만 돌리고
// LLM 단계(정리본·회의록·확인 필요·용어)는 건너뛴다. 끝나면 잰 값을 JSON 한 줄로 찍는다. 화자 수는 meta.json의 speakers(녹음할 때 고른 값)를 쓴다, 없으면 자동.
// VAD를 켜 재려면 Silero VAD 모델 경로를 MR_MEETING_VAD로 준다 (MR_MEETING_VAD_THRESHOLD·_PAD_MS·_MIN_SILENCE_MS로 값 바꾸기):
//   MR_MEETING_VAD=$PWD/.work/vad/dl/ggml-silero-v5.1.2.bin npx electron scripts/dev/rerun-meeting.js --transcribe-only <사본 폴더>
// 메인 창을 띄우지 않으므로 설치된 앱이 켜져 있어도 된다 (같은 모델·설정 폴더를 읽기만 한다).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const transcribeOnly = process.argv.includes('--transcribe-only');
// 폴더는 플래그를 뺀 마지막 인자 (플래그는 폴더 앞뒤 어디에 와도 된다)
const dir = path.resolve(process.argv.filter((a) => a !== '--transcribe-only').at(-1));
if (dir.startsWith(path.join(os.homedir(), 'Documents', 'MeetingRecorder'))) {
  console.error('실제 녹음 폴더입니다. 사본 폴더를 지정하세요.');
  process.exit(1);
}
app.setPath('userData', path.join(app.getPath('appData'), 'meeting-recorder'));
app.dock?.hide();

async function transcribe(minutes) {
  const dictation = require('../../src/dictation');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const timing = {};
  const t = Date.now();
  const report = (status, extra = {}) => console.error(`${((Date.now() - t) / 1000).toFixed(0)}s`, status, extra.progress != null ? `${Math.round(extra.progress * 100)}%` : '');
  const { transcript, diarizeInfo } = await minutes.transcribeMeeting(dir, meta, dictation.getSettings(), meta.speakers ?? null, timing, report);
  const seg = JSON.parse(fs.readFileSync(path.join(dir, 'segments.json'), 'utf8'));
  const redo = seg.redo ?? [];
  console.log(
    JSON.stringify({
      model: timing.model,
      vad: timing.vad ?? null,
      transcribeMs: timing.transcribeMs,
      diarizeMs: timing.diarizeMs ?? null,
      segments: seg.segments.length,
      chars: transcript.replace(/\s/g, '').length,
      redo: redo.length,
      redoSec: Math.round(redo.reduce((s, r) => s + (r.end - r.start), 0) * 10) / 10,
      stillLooping: redo.filter((r) => r.stillLooping).length,
      speakers: diarizeInfo.speakers,
      diarizeError: diarizeInfo.diarizeError,
    }),
  );
}

app.whenReady().then(async () => {
  const minutes = require('../../src/minutes');
  if (transcribeOnly) {
    try {
      await transcribe(minutes);
    } catch (err) {
      console.error(err);
      process.exitCode = 1;
    }
    app.quit();
    return;
  }
  const t = Date.now();
  await minutes.makeMinutes(dir, {
    onStage: (s) => console.log(`${((Date.now() - t) / 1000).toFixed(0)}s`, s.status, s.progress != null ? `${Math.round(s.progress * 100)}%` : '', s.error ?? ''),
  });
  app.quit();
});
