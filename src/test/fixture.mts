// 테스트용 가짜 녹음 폴더 (실제 회의 내용 대신 지어낸 예시)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Fixture {
  root: string;
  home: string;
  latest: string;
  older: string;
  cleanup: () => void;
}

const write = (dir: string, file: string, data: unknown) => fs.writeFileSync(path.join(dir, file), typeof data === 'string' ? data : JSON.stringify(data, null, 2));

export function makeFixture(): Fixture {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-core-'));
  const root = path.join(home, 'Documents', 'MeetingRecorder');
  const latest = '2026-11-02_14-00-00_meeting';
  const older = '2026-11-01_09-30-00_meeting';
  const a = path.join(root, latest);
  const b = path.join(root, older);
  for (const d of [a, b, path.join(root, '2026-11-02_15-00-00_memo'), path.join(root, '2026-11-03_10-00-00_meeting')]) fs.mkdirSync(d, { recursive: true });

  // 최근 회의: 회의록·정리본·액션·확인 필요까지 있고 화자 1 이름을 바꿈
  write(a, 'meta.json', { mode: 'meeting', startedAt: '2026-11-02T05:00:00.000Z', files: { mic: { file: 'mic.wav', durationSec: 95.4 } }, speakerNames: { '화자 1': '민준' } });
  write(a, 'minutes.json', { status: 'done', speakers: 2 });
  write(a, 'minutes.md', '# 배포 일정 정리\n\n## 요약\n화자 1은 화요일 배포를 제안했다.\n화자 2가 QA를 맡았다.\n\n## 할 일\n- [ ] QA 마치기 — 담당: 화자 2\n');
  const lines = ['[00:02] [화자 1] 다음 주 배포 일정 얘기해 볼까요?', '[00:10] [화자 2] 네, 화요일 오전이 좋겠어요.', '[00:20] [화자 1] 그럼 화요일로 하죠.', '[01:30] [화자 2] QA는 제가 마칠게요.'];
  write(a, 'transcript.txt', `${lines.join('\n')}\n`);
  write(a, 'script-clean.txt', `${lines.slice(0, 3).join('\n')}\n`);
  write(a, 'review.json', { items: [{ id: 'r1', status: 'open' }, { id: 'r2', status: 'applied' }] });
  write(a, 'actions.json', {
    kind: 'work', adviceTitle: '알아 둘 것',
    actions: [{ id: 'a1', owner: '화자 2', task: 'QA 마치기', due: '화요일', kind: 'promise', at: '01:30', quote: 'QA는 제가 마칠게요', done: false }],
    advice: [{ id: 'v1', group: '배포', key: true, why: '배포 전 확인', from: '화자 1', to: '화자 2', text: '화자 1이 정한 순서를 따르기', at: '00:20', quote: '그럼 화요일로 하죠' }],
  });

  // 이전 회의: 녹음만 하고 회의록을 만드는 중
  write(b, 'meta.json', { mode: 'meeting', startedAt: '2026-11-01T00:30:00.000Z', files: { mic: { file: 'mic.wav', durationSec: 30 } } });
  write(b, 'minutes.json', { status: 'transcribe' });
  // memo 폴더(받아쓰기)와 meta.json 없는 폴더(녹음 중)는 목록에 나오지 않아야 한다
  write(path.join(root, '2026-11-02_15-00-00_memo'), 'meta.json', { mode: 'memo', startedAt: '2026-11-02T06:00:00.000Z' });

  return { root, home, latest, older, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}
