import { primaryBtn, quietBtn, type StepCtx } from './state.ts';
import type { Control, ResultView } from './view.ts';

const BLUETOOTH = /airpods|bluetooth|buds|headset|hands-?free|beats|jabra|bose|wh-1000|wf-1000/i;

// ── 6. 마이크 확인: 말하면 막대가 움직이는지 ───────────────────────
// 스트림·AudioContext는 첫 그리기 뒤에 연다. 장치를 바꾸면 앞의 것을 닫고 다시 열고, 떠날 때 트랙을 멈추고 닫는다
// (ctxAudio를 비워 requestAnimationFrame 고리도 멈춘다). 20초 안에 말소리가 없으면 '그래도 계속'을 보인다.
export async function mic(ctx: StepCtx) {
  const { frame, next, later, onLeave } = ctx;
  const instance = ctx.instance();
  let stream: MediaStream | null = null;
  let ctxAudio: AudioContext | null = null;
  let heard = 0;
  let level = 0;
  let slow = false;
  const select: Control<HTMLSelectElement> = { current: null };
  const bars: Control<HTMLDivElement> = { current: null };
  const note: Control<HTMLParagraphElement> = { current: null };
  const initialNote: ResultView = { ref: note, className: 'ob-result', text: '' };
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default');
  const mics = devices.map((d) => ({ id: d.deviceId, label: d.label || '알 수 없는 마이크' }));
  const initialMic = ctx.getMic();
  const start = async () => {
    stream?.getTracks().forEach((t) => t.stop());
    ctxAudio?.close();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: select.current!.value ? { deviceId: { exact: select.current!.value } } : true });
    } catch (err) {
      note.current!.className = 'ob-result bad';
      note.current!.textContent = `마이크를 열지 못했습니다: ${(err as Error).message}`;
      return;
    }
    ctxAudio = new AudioContext();
    const analyser = ctxAudio.createAnalyser();
    analyser.fftSize = 1024;
    ctxAudio.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (!ctxAudio) return;
      analyser.getFloatTimeDomainData(buf);
      const rms = Math.sqrt(buf.reduce((n, v) => n + v * v, 0) / buf.length);
      level = 0.7 * level + 0.3 * Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-9) + 60) / 45));
      [...bars.current!.children].forEach((b, i) => b.classList.toggle('on', i < Math.round(level * 16)));
      if (level > 0.45) heard++;
      if (heard === 12) draw(); // 말소리가 잠깐 이어지면 확인 완료
      requestAnimationFrame(tick);
    };
    tick();
  };
  const change = () => {
    ctx.setMic(select.current!.value);
    heard = 0;
    draw();
    start();
  };
  const draw = () => {
    const ok = heard >= 12;
    const bt = BLUETOOTH.test(select.current?.selectedOptions[0]?.textContent ?? '');
    if (note.current) {
      note.current.className = `ob-result${ok ? ' ok' : ''}`;
      note.current.textContent = ok ? '잘 들립니다.' : slow ? '소리가 들리지 않습니다. 다른 마이크를 골라 보세요.' : '';
    }
    frame({
      instance,
      title: '마이크를 확인합니다',
      lead: '평소처럼 아무 말이나 해 보세요. 막대가 움직이면 됩니다. 내장·유선 마이크를 권장합니다.',
      body: { kind: 'mic', select, bars, note: initialNote, mics, initialMic, change, bt, ok },
      primary: primaryBtn(ok ? '계속' : '말해 보세요…', next, !ok && !slow),
      secondary: !ok && slow && quietBtn('그래도 계속', next),
    });
  };
  draw();
  start();
  later(() => {
    slow = true;
    if (heard < 12) draw();
  }, 20000);
  onLeave(() => {
    stream?.getTracks().forEach((t) => t.stop());
    ctxAudio?.close();
    ctxAudio = null;
  });
}
