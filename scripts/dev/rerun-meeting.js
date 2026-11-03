// 회의 폴더 사본에 회의록 파이프라인(녹취 → 반복 구간 다시 받아쓰기 → 화자 구분 → 회의록)을 다시 돌린다.
// 실제 회의 폴더를 바꾸지 않도록 사본 폴더에만 쓴다: mic.wav와 meta.json만 복사해서 쓴다.
//   cp -c ~/Documents/MeetingRecorder/<회의>/{mic.wav,meta.json} /tmp/m/
//   npx electron scripts/dev/rerun-meeting.js /tmp/m
// 메인 창을 띄우지 않으므로 설치된 앱이 켜져 있어도 된다 (같은 모델·설정 폴더를 읽기만 한다).
const path = require('path');
const os = require('os');
const { app } = require('electron');

const dir = path.resolve(process.argv.at(-1));
if (dir.startsWith(path.join(os.homedir(), 'Documents', 'MeetingRecorder'))) {
  console.error('실제 녹음 폴더입니다. 사본 폴더를 지정하세요.');
  process.exit(1);
}
app.setPath('userData', path.join(app.getPath('appData'), 'meeting-recorder'));
app.dock?.hide();

app.whenReady().then(async () => {
  const minutes = require('../../src/minutes');
  const t = Date.now();
  await minutes.makeMinutes(dir, {
    onStage: (s) => console.log(`${((Date.now() - t) / 1000).toFixed(0)}s`, s.status, s.progress != null ? `${Math.round(s.progress * 100)}%` : '', s.error ?? ''),
  });
  app.quit();
});
