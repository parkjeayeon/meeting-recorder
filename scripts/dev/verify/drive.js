// 검증 조작 도구: 가짜 API(stub-preload.js)로 메인 창을 숨긴 채 띄우고, 단계 목록(JSON)대로 사용자처럼 조작한 뒤
// 증거(단계별 결과, 화면 접근성 스냅샷·캡처, 본체로 간 호출 기록, 예시 회의 폴더에서 바뀐 파일)를 verify-runs/<실행 id>/에 남긴다.
//   npx electron scripts/dev/verify/drive.js <단계 파일.json> [--keep]
// 단계 파일: { "env": { "STUB_MANY": "30" }, "steps": [ { "go": "#meeting/{id}" }, { "click": "확인 필요", "role": "tab" }, ... ] }
//   {id}·{dir}은 예시 회의 id·폴더로 바뀐다. 단계 종류는 scripts/dev/verify/README.md (또는 아래 STEP 처리)
// 실제 녹음 폴더·설정·설치된 앱은 건드리지 않는다: 예시 회의는 임시 폴더, 앱 이름도 따로(단일 실행 잠금이 겹치지 않게).
// 끝나면 창을 닫고 예시 회의 폴더를 지운다(--keep이면 남김). 증거는 지우지 않는다. 끝 코드: 모든 expect가 맞으면 0, 아니면 1.
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const { makeMeeting, HELPERS } = require('./fixture');

const ROOT = path.join(__dirname, '../../..');
const args = process.argv.slice(2).filter((a) => !a.endsWith('drive.js'));
const file = args.find((a) => a.endsWith('.json'));
const keep = args.includes('--keep');
const dropOnPass = args.includes('--drop-on-pass'); // 여러 흐름을 한꺼번에 돌릴 때(run-all.js): 통과한 흐름의 증거는 남기지 않는다
if (!file) {
  console.error('단계 파일(.json)을 주세요: npx electron scripts/dev/verify/drive.js <단계.json>');
  process.exit(2);
}
const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
const runId = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${path.basename(file, '.json')}`;
const out = path.join(ROOT, 'verify-runs', runId);
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(file, path.join(out, 'steps.json'));

app.setName(`mr-verify-${process.pid}`);
nativeTheme.themeSource = plan.dark ? 'dark' : 'light';
app.dock?.hide();
app.on('window-all-closed', () => {});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => {
  console.error('시간 초과 (3분)');
  process.exit(1);
}, 180000);

// 화면 접근성 스냅샷: 보이는 제목·탭·버튼·링크·입력칸·알림을 역할과 이름으로 (클래스·DOM 위치가 아니라 사용자가 보는 것)
const ARIA = `(() => {
  const vis = (e) => e.isConnected && !e.closest('[hidden]') && e.getClientRects().length > 0;
  const name = (e) => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || e.placeholder || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
  const role = (e) => e.getAttribute('role') || ({ A: 'link', BUTTON: 'button', H1: 'heading 1', H2: 'heading 2', H3: 'heading 3', SELECT: 'combobox', TEXTAREA: 'textbox', DIALOG: 'dialog' }[e.tagName]) || (e.tagName === 'INPUT' ? ({ checkbox: 'checkbox', radio: 'radio' }[e.type] || 'textbox') : null);
  const lines = [];
  for (const e of document.querySelectorAll('h1, h2, h3, a[href], button, input, select, textarea, [role], dialog[open]')) {
    if (!vis(e)) continue;
    const r = role(e); if (!r) continue;
    const st = [e.getAttribute('aria-selected') === 'true' && 'selected', e.getAttribute('aria-pressed') === 'true' && 'pressed', e.checked && 'checked', e.disabled && 'disabled', e.getAttribute('aria-busy') === 'true' && 'busy', (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') && e.value && 'value=' + JSON.stringify(e.value.slice(0, 60))].filter(Boolean);
    lines.push(r + ' ' + JSON.stringify(name(e)) + (st.length ? ' [' + st.join(', ') + ']' : ''));
  }
  return 'hash ' + location.hash + '\\n' + lines.join('\\n');
})()`;

app.whenReady().then(async () => {
  const meetingDir = plan.noMeeting ? null : makeMeeting('mr-verify-');
  const id = meetingDir ? path.basename(meetingDir) : '';
  const env = { STUB_MEETING_DIR: meetingDir ?? '', STUB_MANY: '0', STUB_DICTS: '0', STUB_STRAY: 'none', STUB_JOB_MS: '300', STUB_ASK_MS: '100', ...(plan.env ?? {}) };
  for (const [k, v] of Object.entries(env)) if (v === '' || v === null) delete process.env[k]; else process.env[k] = String(v);
  const w = new BrowserWindow({ width: plan.width ?? 1240, height: plan.height ?? 860, show: false, webPreferences: { preload: path.join(ROOT, 'scripts/dev/stub-preload.js'), sandbox: false, offscreen: true } });
  const consoleErrors = [];
  w.webContents.on('console-message', (e) => e.level === 'error' && !/rec:\/\/|net::ERR|Autofill/.test(e.message) && consoleErrors.push(e.message));
  await w.loadFile(path.join(ROOT, 'src/renderer/index.html'));
  const js = (c) => w.webContents.executeJavaScript(c);
  // 준비: 화면 첫 그리기가 끝나고 도우미를 넣을 수 있을 때
  for (let i = 0; i < 50 && !(await js(`Boolean(document.querySelector('#view')?.children.length)`)); i++) await wait(100);
  await js(`${HELPERS}; true`);
  const sub = (v) => (typeof v === 'string' ? v.replaceAll('{id}', id).replaceAll('{dir}', meetingDir ?? '') : v); // 단계 파일의 자리표시: 예시 회의 id·폴더
  const until = async (expr, ms = 5000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(100)) if (await js(`Boolean(${expr})`)) return true;
    return false;
  };
  const results = [];
  let n = 0;
  for (const step of plan.steps ?? []) {
    n++;
    const tag = String(n).padStart(2, '0');
    let ok = true;
    let detail = null;
    try {
      if (step.go !== undefined) {
        await js(`location.hash=${JSON.stringify(sub(step.go))}`);
        await wait(500);
        if (String(sub(step.go)).startsWith('#meeting/')) await until(`document.querySelector('[role=tab][aria-selected=true]') || document.querySelector('.page')?.innerText.includes('다시')`);
      } else if (step.click !== undefined) {
        const sel = step.role === 'tab' ? '[role=tab]' : step.role === 'link' ? 'a[href]' : step.role === 'button' ? 'button' : undefined;
        ok = await js(`__t.click(${JSON.stringify(sub(step.click))}, ${JSON.stringify({ ...(sel ? { sel } : {}), ...(step.within ? { within: step.within } : {}), ...(step.exact ? { exact: true } : {}) })})`);
        detail = ok ? null : `"${step.click}"를 찾지 못함`;
        await wait(step.wait ?? 400);
      } else if (step.fill !== undefined) {
        ok = await js(`__t.type(${JSON.stringify(step.fill)}, ${JSON.stringify(sub(step.value ?? ''))}, ${JSON.stringify({ enter: Boolean(step.enter) })})`);
        detail = ok ? null : `입력칸 "${step.fill}"을 찾지 못함 (aria-label·placeholder 앞부분·label 글자)`;
        await wait(step.wait ?? 300);
      } else if (step.key !== undefined) {
        // 진짜 키 입력 (sendInputEvent) — 키 처리기 버그까지 드러난다. mods: ["meta"], ["shift"] 등
        const mods = step.mods ?? [];
        w.webContents.sendInputEvent({ type: 'keyDown', keyCode: step.key, modifiers: mods });
        if (step.key.length === 1 && !mods.includes('meta')) w.webContents.sendInputEvent({ type: 'char', keyCode: step.key, modifiers: mods });
        w.webContents.sendInputEvent({ type: 'keyUp', keyCode: step.key, modifiers: mods });
        await wait(step.wait ?? 300);
      } else if (step.confirm !== undefined) {
        ok = await js(`(() => { const d = document.getElementById('confirm'); if (!d?.open) return false; document.getElementById(${JSON.stringify(step.confirm ? 'confirmYes' : 'confirmNo')}).click(); return true; })()`);
        detail = ok ? null : '확인 창이 열려 있지 않음';
        await wait(400);
      } else if (step.until !== undefined) {
        ok = await until(`__t.has(${JSON.stringify(sub(step.until))})`, step.ms ?? 5000);
        detail = ok ? null : `"${step.until}"가 ${step.ms ?? 5000}ms 안에 보이지 않음`;
      } else if (step.expect !== undefined) {
        // expect: { text } 화면에 보임 · { noText } 안 보임 · { tab } 선택된 탭 · { hash } · { called, args } 본체 호출(args는 부분 일치) · { file, includes } 예시 회의 파일 내용 · { toast }
        const e = step.expect;
        if (e.text !== undefined) ok = await js(`__t.has(${JSON.stringify(sub(e.text))})`);
        else if (e.noText !== undefined) ok = !(await js(`__t.has(${JSON.stringify(sub(e.noText))})`));
        else if (e.tab !== undefined) ok = String(await js('__t.tab()')).startsWith(e.tab);
        else if (e.hash !== undefined) ok = (await js('location.hash')) === sub(e.hash);
        else if (e.toast !== undefined) ok = (await js('__t.toasts()')).some((t) => t.includes(e.toast));
        else if (e.called !== undefined) {
          const calls = (await js('window.stubLog()')).filter(([k]) => k === e.called).map(([, a]) => a);
          const want = JSON.stringify(e.args ?? null);
          const match = (have, need) => need === null || (typeof need !== 'object' ? have === sub(need) : Array.isArray(need) ? need.every((x, i) => match(have?.[i], x)) : Object.entries(need).every(([k, v]) => match(have?.[k], v)));
          ok = e.times !== undefined ? calls.length === e.times : calls.some((c) => match(c, e.args ?? null));
          detail = { calls, want: JSON.parse(want) };
        } else if (e.file !== undefined) {
          const body = meetingDir ? fs.readFileSync(path.join(meetingDir, e.file), 'utf8') : '';
          ok = (e.includes ?? []).every((x) => body.includes(x)) && (e.excludes ?? []).every((x) => !body.includes(x));
          detail = ok ? null : body.slice(0, 400);
        }
        if (!ok && !detail) detail = { tab: await js('__t.tab()'), hash: await js('location.hash'), toasts: await js('__t.toasts()') };
      } else if (step.snapshot !== undefined) {
        fs.writeFileSync(path.join(out, `${tag}-${step.snapshot}.aria.txt`), await js(ARIA));
      } else if (step.screenshot !== undefined) {
        w.webContents.invalidate();
        await wait(300);
        fs.writeFileSync(path.join(out, `${tag}-${step.screenshot}.png`), (await w.webContents.capturePage()).toPNG());
      } else if (step.js !== undefined) {
        // 마지막 수단(화면에 길이 없는 확인용): 값을 detail에 남긴다. 사용자 경로의 증거로는 쓰지 않는다
        detail = await js(step.js);
      } else if (step.wait !== undefined) {
        await wait(step.wait);
      } else {
        ok = false;
        detail = `모르는 단계: ${JSON.stringify(step)}`;
      }
    } catch (err) {
      ok = false;
      detail = err.message;
    }
    results.push({ n, step, ok, detail });
    console.log(`${ok ? '✓' : '✗'} ${tag} ${JSON.stringify(step)}${ok ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
    if (!ok && plan.stopOnFail !== false) break;
  }
  // 증거: 끝 상태의 스냅샷, 호출 기록, 바뀐 예시 회의 파일
  fs.writeFileSync(path.join(out, 'end.aria.txt'), await js(ARIA));
  fs.writeFileSync(path.join(out, 'stub-log.json'), JSON.stringify(await js('window.stubLog()'), null, 1));
  if (meetingDir) {
    fs.mkdirSync(path.join(out, 'meeting-after'), { recursive: true });
    for (const f of fs.readdirSync(meetingDir)) fs.copyFileSync(path.join(meetingDir, f), path.join(out, 'meeting-after', f));
  }
  const failed = results.filter((r) => !r.ok).length;
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ runId, file, meetingDir, kept: keep, consoleErrors, failed, results }, null, 1));
  w.destroy();
  if (meetingDir && !keep) fs.rmSync(path.dirname(meetingDir), { recursive: true, force: true });
  if (consoleErrors.length) console.log(`화면 오류 ${consoleErrors.length}건: ${consoleErrors.slice(0, 2).join(' | ')}`);
  console.log(`${failed || consoleErrors.length ? '실패' : '통과'} · 증거: ${dropOnPass && !failed && !consoleErrors.length ? '(통과라 남기지 않음)' : `${path.relative(ROOT, out)}/`}`);
  if (dropOnPass && !failed && !consoleErrors.length) fs.rmSync(out, { recursive: true, force: true });
  app.exit(failed || consoleErrors.length ? 1 : 0);
});
