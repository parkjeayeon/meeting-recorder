// 화자 구분만 바꿔 다시 만들어 본다 — 녹취 줄(segments.json)은 그대로 두고 새 화자 구분 결과로 화자를 다시 붙인 뒤 정리본·회의록을 다시 만든다.
//   npx electron scripts/dev/try-rediarize.js <비교용 회의 폴더> <화자 구분 결과.json>
// 원래 회의를 덮어쓰지 않도록 '.comparison-copy' 표시가 있는 폴더(회의 폴더를 복사해 만든 비교용)에만 쓴다.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const [dir, diarizationFile] = process.argv.slice(-2).map((p) => path.resolve(p));
app.setPath('userData', path.join(app.getPath('appData'), 'meeting-recorder')); // 설정·계정을 앱과 같이 (읽기만)
app.dock?.hide();

app.whenReady().then(async () => {
  try {
    if (!fs.existsSync(path.join(dir, '.comparison-copy'))) throw new Error('비교용 표시(.comparison-copy)가 없는 폴더입니다 — 원래 회의일 수 있어 쓰지 않습니다');
    const minutes = require('../../src/minutes');
    const { complete } = require('../../src/cleanup');
    const dictation = require('../../src/dictation');
    const seg = JSON.parse(fs.readFileSync(path.join(dir, 'segments.json'), 'utf8'));
    const diarization = JSON.parse(fs.readFileSync(diarizationFile, 'utf8'));
    const { text, speakerCount } = minutes.buildTranscript(seg.segments, diarization, seg.tracks ?? ['mic']);
    fs.writeFileSync(path.join(dir, 'transcript.txt'), `${text}\n`);
    fs.writeFileSync(path.join(dir, 'diarization.json'), JSON.stringify(diarization));
    console.log(`화자 다시 붙임 · ${speakerCount}명`);
    const cleaned = await minutes.makeCleanScript(dir);
    console.log(`정리본 · ${cleaned.text.length}자`);
    const script = cleaned.text.trim();
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const durationSec = Math.max(0, ...Object.values(meta.files).map((f) => f.durationSec ?? 0));
    const clock = (sec) => { const s = Math.floor(sec); const h = Math.floor(s / 3600); const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0'); const ss = String(s % 60).padStart(2, '0'); return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`; }; // minutes.js와 같은 꼴
    const when = new Date(meta.startedAt).toLocaleString('ko-KR', { dateStyle: 'full', timeStyle: 'short' });
    const settings = dictation.getSettings();
    const out = await complete({
      system: minutes.minutesSystem(script, { cleaned: true }),
      input: `<meeting started="${when}" duration="${clock(durationSec)}">\n${script}\n</meeting>${meta.notes ? `\n<notes>\n${meta.notes}\n</notes>` : ''}`,
      choice: settings.provider,
      apiKey: dictation.apiKey(),
      effort: 'medium',
      timeouts: { 'claude-code': 600000, codex: 600000, api: 600000 },
      maxTokens: 16000,
    });
    const lines = out.text.trim().split('\n');
    lines[0] = `${lines[0]} (화자 다시 비교)`;
    fs.writeFileSync(path.join(dir, 'minutes.md'), `${lines.join('\n')}\n`);
    const statusFile = path.join(dir, 'minutes.json');
    const st = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    fs.writeFileSync(statusFile, JSON.stringify({ ...st, title: lines[0].replace(/^#\s+/, ''), speakers: speakerCount }));
    console.log(`회의록 · ${out.text.length}자 · ${out.provider}`);
  } catch (err) {
    console.error('만들지 못함:', err.message);
  }
  app.quit();
});
