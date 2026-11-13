// 회의록 지시문을 바꿨을 때 실제 회의로 새 회의록을 써 보고 지금 것과 비교한다 — 회의 폴더는 읽기만 하고, 결과는 .work/minutes/에만 쓴다.
//   npx electron scripts/dev/try-minutes.js ~/Documents/MeetingRecorder/<회의 폴더>
// 앱과 같은 지시문(minutesSystem)·입력 꼴·모델·설정 계정으로 회의록 쓰기 단계만 돈다(받아쓰기·화자 구분은 다시 하지 않는다).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const dir = path.resolve(process.argv.at(-1));
const out = process.env.OUT ?? path.join(__dirname, '../../.work/minutes'); // OUT: 결과 폴더
app.setPath('userData', path.join(app.getPath('appData'), 'meeting-recorder')); // 설정·계정을 앱과 같이 (읽기만)
app.dock?.hide();

app.whenReady().then(async () => {
  try {
    const { minutesSystem } = require('../../src/minutes');
    const { complete } = require('../../src/cleanup');
    const dictation = require('../../src/dictation');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    // 앱처럼 정리본으로 (없으면 원본 녹취로)
    const cleanFile = path.join(dir, 'script-clean.txt');
    const cleaned = fs.existsSync(cleanFile) && fs.readFileSync(cleanFile, 'utf8').trim().length > 0;
    const transcript = fs.readFileSync(cleaned ? cleanFile : path.join(dir, 'transcript.txt'), 'utf8').trim();
    const durationSec = Math.max(0, ...Object.values(meta.files).map((f) => f.durationSec ?? 0));
    const clock = (sec) => { const s = Math.floor(sec); const h = Math.floor(s / 3600); const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0'); const ss = String(s % 60).padStart(2, '0'); return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`; }; // minutes.js와 같은 꼴
    const when = new Date(meta.startedAt).toLocaleString('ko-KR', { dateStyle: 'full', timeStyle: 'short' });
    const settings = dictation.getSettings();
    const t = Date.now();
    const { text, provider } = await complete({
      system: minutesSystem(transcript, { cleaned }),
      input: `<meeting started="${when}" duration="${clock(durationSec)}">\n${transcript}\n</meeting>${meta.notes ? `\n<notes>\n${meta.notes}\n</notes>` : ''}`,
      choice: settings.provider,
      apiKey: dictation.apiKey(),
      effort: 'medium',
      timeouts: { 'claude-code': 600000, codex: 600000, api: 600000 },
      maxTokens: 16000,
    });
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, `${path.basename(dir)}-new.md`);
    fs.writeFileSync(file, `${text}\n`);
    console.log(`만듦 ${file} · ${text.length}자 · ${provider} · ${((Date.now() - t) / 1000).toFixed(0)}초`);
  } catch (err) {
    console.error('쓰지 못함:', err.message);
  }
  app.quit();
});
