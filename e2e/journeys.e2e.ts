// 검증 스킬의 흐름(.claude/skills/verify-meeting-recorder/journeys/*.json)을 흐름 하나 = 시험 하나로 돌린다 (npm run verify:journeys).
// 단계 실행은 drive.js와 같은 scripts/dev/verify/steps.js. 실패하면 단계별 결과가 오류 글에, trace가 .work/e2e/results/에 남는다.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { launch, runSteps } = require('../scripts/dev/verify/steps.js');
const dir = path.join(__dirname, '../.claude/skills/verify-meeting-recorder/journeys');

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  test(`흐름 · ${file.replace('.json', '')}`, async () => {
    const plan = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const run = await launch(plan);
    try {
      const lines: string[] = [];
      const results: { ok: boolean }[] = await runSteps(run.page, plan, { id: run.id, meetingDir: run.meetingDir, out: null, log: (l: string) => lines.push(l) });
      expect(results.every((r) => r.ok), lines.join('\n')).toBe(true);
      expect(run.consoleErrors, '화면 오류 없음').toEqual([]);
    } finally {
      await run.close();
    }
  });
}
