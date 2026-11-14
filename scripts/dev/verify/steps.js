// 흐름(journeys/*.json)의 단계를 Playwright 화면(page)에서 실행한다 — drive.js(증거를 남기는 한 번 실행)와
// e2e/journeys.e2e.ts(npm run verify:journeys)가 같이 쓴다. 단계 종류는 .claude/skills/verify-meeting-recorder/SKILL.md.
// 찾는 규칙은 예전 그대로(fixture.js의 HELPERS: aria-label → 글자 → title, 정확히 → 앞부분 → 포함, 보이는 것만)이고,
// 누르기·입력·키는 Playwright의 진짜 입력(마우스·키보드)으로 한다. 찾기·expect는 정해진 시간 안에서 될 때까지 다시 본다.
const fs = require('fs');
const path = require('path');
const { makeMeeting, HELPERS } = require('./fixture');

const ROOT = path.join(__dirname, '../../..');
const ENTRY = path.join(ROOT, 'e2e/main.cjs');
const IGNORED_ERRORS = /rec:\/\/|net::ERR|Autofill/;
const TARGET = 'data-verify-target'; // 찾은 요소에 잠깐 붙이는 표시 — Playwright가 그 요소를 진짜로 누르게
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MODS = { meta: 'Meta', shift: 'Shift', alt: 'Alt', control: 'Control', ctrl: 'Control' };

// 앱(가짜 API)을 띄운다. 설정·기록은 새 임시 폴더에만 — 실제 앱 데이터는 건드리지 않는다
async function launch(plan, { prefix = 'mr-verify-' } = {}) {
  const { _electron } = require('@playwright/test');
  const os = require('os');
  const meetingDir = plan.noMeeting ? null : makeMeeting(prefix);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-e2e-'));
  const env = { ...process.env, STUB_MEETING_DIR: meetingDir ?? '', STUB_MANY: '0', STUB_DICTS: '0', STUB_STRAY: 'none', STUB_JOB_MS: '300', STUB_ASK_MS: '100', ...(plan.env ?? {}), E2E_USER_DATA: userData };
  if (plan.width) env.E2E_WIDTH = String(plan.width);
  if (plan.height) env.E2E_HEIGHT = String(plan.height);
  if (plan.dark) env.E2E_DARK = '1';
  for (const [k, v] of Object.entries(env)) if (v === '' || v === null || v === undefined) delete env[k]; else env[k] = String(v);
  const app = await _electron.launch({ args: [ENTRY], env });
  const page = await app.firstWindow();
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && !IGNORED_ERRORS.test(m.text()) && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  // 준비: 화면 첫 그리기가 끝나고 도우미를 넣을 수 있을 때
  await page.waitForFunction(() => Boolean(document.querySelector('#view')?.children.length));
  await page.evaluate(`${HELPERS}; true`);
  const close = async ({ keep = false } = {}) => {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
    if (meetingDir && !keep) fs.rmSync(path.dirname(meetingDir), { recursive: true, force: true });
  };
  return { app, page, meetingDir, id: meetingDir ? path.basename(meetingDir) : '', consoleErrors, close };
}

// 될 때까지 다시 본다 (ms 안에). 마지막 값을 돌려준다
async function retry(fn, ms) {
  let last;
  for (const t0 = Date.now(); ; await wait(100)) {
    last = await fn();
    if (last || Date.now() - t0 >= ms) return last;
  }
}

// 이름으로 찾은 요소에 표시를 붙인다 (못 찾으면 false). kind: 'click' | 'field'
const mark = (page, kind, text, opts) => page.evaluate(([kind, text, opts, TARGET]) => {
  document.querySelectorAll(`[${TARGET}]`).forEach((e) => e.removeAttribute(TARGET));
  const e = kind === 'field' ? window.__t.field(text) : window.__t.find(text, opts);
  if (!e) return false;
  e.setAttribute(TARGET, '');
  return true;
}, [kind, text, opts, TARGET]);

const ARIA = (page) => page.locator('body').ariaSnapshot().then((s) => `hash ${page.url().split('#')[1] ? `#${page.url().split('#')[1]}` : ''}\n${s}`);

async function runSteps(page, plan, { id, meetingDir, out, log = () => {} }) {
  const sub = (v) => (typeof v === 'string' ? v.replaceAll('{id}', id).replaceAll('{dir}', meetingDir ?? '') : v); // 자리표시: 예시 회의 id·폴더
  const has = (text) => page.evaluate((t) => window.__t.has(t), text);
  const results = [];
  let n = 0;
  for (const step of plan.steps ?? []) {
    n++;
    const tag = String(n).padStart(2, '0');
    let ok = true;
    let detail = null;
    try {
      if (step.go !== undefined) {
        const hash = sub(step.go);
        await page.evaluate((h) => { location.hash = h; }, hash);
        if (String(hash).startsWith('#meeting/')) await page.waitForFunction(() => document.querySelector('[role=tab][aria-selected=true]') || document.querySelector('.page')?.innerText.includes('다시'), null, { timeout: 5000 });
        else await wait(300);
      } else if (step.click !== undefined) {
        const sel = step.role === 'tab' ? '[role=tab]' : step.role === 'link' ? 'a[href]' : step.role === 'button' ? 'button' : undefined;
        const opts = { ...(sel ? { sel } : {}), ...(step.within ? { within: step.within } : {}), ...(step.exact ? { exact: true } : {}) };
        ok = await retry(() => mark(page, 'click', sub(step.click), opts), step.ms ?? 3000);
        if (ok) await page.locator(`[${TARGET}]`).click({ timeout: 3000 });
        detail = ok ? null : `"${step.click}"를 찾지 못함`;
        await wait(step.wait ?? 200); // 누른 뒤 다시 그려질 틈 (스냅샷·캡처가 바로 뒤에 올 때)
      } else if (step.fill !== undefined) {
        ok = await retry(() => mark(page, 'field', step.fill), step.ms ?? 3000);
        if (ok) {
          const field = page.locator(`[${TARGET}]`);
          await field.fill(sub(step.value ?? ''));
          if (step.enter) await field.press('Enter');
        }
        detail = ok ? null : `입력칸 "${step.fill}"을 찾지 못함 (aria-label·placeholder 앞부분·label 글자)`;
        await wait(step.wait ?? 200); // 누른 뒤 다시 그려질 틈 (스냅샷·캡처가 바로 뒤에 올 때)
      } else if (step.key !== undefined) {
        // 진짜 키 입력 — 키 처리기 버그까지 드러난다. mods: ["meta"], ["shift"] 등
        await page.keyboard.press([...(step.mods ?? []).map((m) => MODS[m] ?? m), step.key].join('+'));
        await wait(step.wait ?? 200);
      } else if (step.confirm !== undefined) {
        const button = page.locator(`dialog#confirm[open] #${step.confirm ? 'confirmYes' : 'confirmNo'}`);
        ok = await button.waitFor({ timeout: 3000 }).then(() => true, () => false);
        if (ok) await button.click();
        detail = ok ? null : '확인 창이 열려 있지 않음';
        await wait(200);
      } else if (step.until !== undefined) {
        ok = await retry(() => has(sub(step.until)), step.ms ?? 5000);
        detail = ok ? null : `"${step.until}"가 ${step.ms ?? 5000}ms 안에 보이지 않음`;
      } else if (step.expect !== undefined) {
        // expect: { text } 보임 · { noText } 안 보임 · { tab } 선택된 탭 · { hash } · { called, args } 본체 호출(args 부분 일치)/times · { file, includes, excludes } · { toast }
        const e = step.expect;
        const check = async () => {
          if (e.text !== undefined) return has(sub(e.text));
          if (e.noText !== undefined) return !(await has(sub(e.noText)));
          if (e.tab !== undefined) return String(await page.evaluate(() => window.__t.tab())).startsWith(e.tab);
          if (e.hash !== undefined) return (await page.evaluate(() => location.hash)) === sub(e.hash);
          if (e.toast !== undefined) return (await page.evaluate(() => window.__t.toasts())).some((t) => t.includes(e.toast));
          if (e.called !== undefined) {
            const calls = (await page.evaluate(() => window.stubLog())).filter(([k]) => k === e.called).map(([, a]) => a);
            const match = (have, need) => need === null || (typeof need !== 'object' ? have === sub(need) : Array.isArray(need) ? need.every((x, i) => match(have?.[i], x)) : Object.entries(need).every(([k, v]) => match(have?.[k], v)));
            detail = { calls, want: e.args ?? null };
            return e.times !== undefined ? calls.length === e.times : calls.some((c) => match(c, e.args ?? null));
          }
          if (e.file !== undefined) {
            const body = meetingDir ? fs.readFileSync(path.join(meetingDir, e.file), 'utf8') : '';
            detail = body.slice(0, 400);
            return (e.includes ?? []).every((x) => body.includes(x)) && (e.excludes ?? []).every((x) => !body.includes(x));
          }
          detail = `모르는 expect: ${JSON.stringify(e)}`;
          return false;
        };
        ok = await retry(check, step.ms ?? 3000);
        if (ok) detail = null;
        else if (!detail) detail = { tab: await page.evaluate(() => window.__t.tab()), hash: await page.evaluate(() => location.hash), toasts: await page.evaluate(() => window.__t.toasts()) };
      } else if (step.snapshot !== undefined) {
        if (out) fs.writeFileSync(path.join(out, `${tag}-${step.snapshot}.aria.txt`), await ARIA(page));
      } else if (step.screenshot !== undefined) {
        if (out) await page.screenshot({ path: path.join(out, `${tag}-${step.screenshot}.png`) });
      } else if (step.js !== undefined) {
        // 마지막 수단(화면에 길이 없는 확인용): 값을 detail에 남긴다. 사용자 경로의 증거로는 쓰지 않는다
        detail = await page.evaluate(step.js);
        await wait(step.wait ?? 300);
      } else if (step.wait !== undefined) {
        await wait(step.wait);
      } else {
        ok = false;
        detail = `모르는 단계: ${JSON.stringify(step)}`;
      }
    } catch (err) {
      ok = false;
      detail = err.message.split('\n')[0];
    }
    results.push({ n, step, ok, detail });
    log(`${ok ? '✓' : '✗'} ${tag} ${JSON.stringify(step)}${ok ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
    if (!ok && plan.stopOnFail !== false) break;
  }
  return results;
}

module.exports = { launch, runSteps, ARIA, ROOT };
