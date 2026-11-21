// Whisper 서버에 음성을 보내 받아쓰기: 받아쓰기용(transcribe), 회의용 구간별(transcribeSegments), 지어낸 문장 거르기. src/dictation.js에서 옮김 (결정 70).
// 포트를 주지 않으면 받아쓰기 서버(server.mts)를 쓰고, 아직 없으면 띄워 기다린다.
import fs from 'node:fs';
import { AUTO_LANGUAGES, chooseLanguage, SHORT_VOICED_MS } from '../core/language.mjs';

// whisper-server /inference가 돌려주는 것 중 여기서 읽는 부분 (json: text, verbose_json: 더해서 language_probabilities·segments)
export interface WhisperSegment {
  start?: number;
  end?: number;
  text?: string;
}
export interface WhisperResponse {
  text?: string;
  language_probabilities?: Record<string, number>;
  segments?: WhisperSegment[];
}

export interface AsrSettings {
  language: string; // 'auto'면 자동 감지 (결정 55)
  vocabulary?: string; // 자주 쓰는 고유명사·용어
}

export interface Segment {
  start: number;
  end: number;
  text: string;
}

// language: 실제로 받아쓴 언어, detected: 자동일 때 Whisper가 고른 언어, short: 말소리가 짧아 감지하지 않았다
export interface TranscribeResult {
  text: string;
  language: string;
  detected: string | null;
  short?: true;
}

// 받아쓰기 서버: 준비된 포트, 없으면 띄우기 (server.mts의 port·startServer)
export interface PortSource {
  port(): number | null;
  startServer(): Promise<number> | null;
}

export interface Transcriber {
  transcribe(wavPath: string, settings: AsrSettings, opts?: { voicedMs?: number; port?: number | null }): Promise<TranscribeResult>;
  transcribeSegments(wavPath: string, settings: AsrSettings, port?: number | null, opts?: { noContext?: boolean }): Promise<Segment[]>;
}

// Whisper가 무음·잡음에서 자주 지어내는 문장들
const HALLUCINATIONS = [
  /^(감사합니다|고맙습니다|감사드립니다|시청해 ?주셔서 감사합니다|시청해 ?주셔서 고맙습니다|다음 영상에서 만나요|구독과 좋아요.*|구독 ?좋아요.*|MBC 뉴스.*|KBS 뉴스.*|자막 제공.*|한글자막.*|\.+|thank you\.?|thanks for watching\.?)$/i,
  /^(감사합니다[.!\s]*){2,}$/,
];

export function isHallucination(text: string | null | undefined): boolean {
  return !text || HALLUCINATIONS.some((re) => re.test(text.replace(/[.!?\s]+$/, '').trim()) || re.test(text));
}

export function createTranscriber(server: PortSource): Transcriber {
  // 회의용: 구간별 시작/끝 시각이 붙은 결과. port를 주면 그 서버(회의용 고성능 모델)를 쓴다
  // noContext: 앞 문장을 이어 받지 않는다 (같은 문장 반복에 빠진 구간을 다시 받아쓸 때)
  async function transcribeSegments(wavPath: string, { language, vocabulary }: AsrSettings, port: number | null = null, { noContext = false }: { noContext?: boolean } = {}): Promise<Segment[]> {
    port ??= server.port() ?? (await server.startServer());
    if (!port) throw new Error('음성 인식 엔진이 준비되지 않았습니다');
    const audio = fs.readFileSync(wavPath);
    const ask = async (lang: string): Promise<WhisperResponse> => {
      const form = new FormData();
      form.append('file', new Blob([audio], { type: 'audio/wav' }), 'audio.wav');
      form.append('response_format', 'verbose_json');
      form.append('language', lang);
      form.append('temperature', '0');
      if (vocabulary) form.append('prompt', vocabulary);
      if (noContext) form.append('max_context', '0');
      const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Whisper 오류 (HTTP ${res.status})`);
      return res.json() as Promise<WhisperResponse>;
    };
    let out = await ask(language);
    // 자동 감지: 후보(한국어·영어·일본어) 밖 언어로 받아썼으면 후보 중 가장 높은 언어로 한 번 더 (결정 55)
    if (language === 'auto') {
      const choice = chooseLanguage(out.language_probabilities);
      if (choice.rerun && choice.pick) out = await ask(choice.pick); // rerun이면 pick이 언제나 있다
    }
    const { segments = [] } = out;
    return segments
      .map((seg) => ({ start: seg.start ?? 0, end: seg.end ?? 0, text: (seg.text ?? '').trim() }))
      .filter((seg) => seg.text && !isHallucination(seg.text));
  }

  // 돌려주는 것: { text, language(실제로 받아쓴 언어), detected(자동일 때 Whisper가 고른 언어) }
  // 자동 감지(language 'auto')는 한국어·영어·일본어 안에서만: 후보 밖 언어로 받아썼으면 후보 중 가장 높은 언어로 한 번 더,
  // 말소리가 1.5초보다 짧으면 감지하지 않고 첫 후보(한국어)로 (결정 55)
  async function transcribe(wavPath: string, { language, vocabulary }: AsrSettings, { voicedMs = Infinity, port: usePort = null }: { voicedMs?: number; port?: number | null } = {}): Promise<TranscribeResult> {
    const port = usePort ?? server.port() ?? (await server.startServer()); // usePort: 시험에서 이미 떠 있는 서버를 쓴다
    if (!port) throw new Error('받아쓰기 엔진이 준비되지 않았습니다');
    const audio = fs.readFileSync(wavPath);
    const ask = async (lang: string): Promise<WhisperResponse> => {
      const form = new FormData();
      form.append('file', new Blob([audio], { type: 'audio/wav' }), 'audio.wav');
      form.append('response_format', lang === 'auto' ? 'verbose_json' : 'json'); // 자동이면 언어별 확률을 받는다
      form.append('language', lang);
      form.append('temperature', '0');
      if (vocabulary) form.append('prompt', vocabulary); // 자주 쓰는 고유명사·용어를 알려 주면 인식률이 오른다
      const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Whisper 오류 (HTTP ${res.status})`);
      return res.json() as Promise<WhisperResponse>;
    };
    if (language !== 'auto') return { text: ((await ask(language)).text ?? '').trim(), language, detected: null };
    const first = AUTO_LANGUAGES[0];
    if (voicedMs < SHORT_VOICED_MS) return { text: ((await ask(first)).text ?? '').trim(), language: first, detected: null, short: true };
    const out = await ask('auto');
    const choice = chooseLanguage(out.language_probabilities);
    if (choice.rerun && choice.pick) return { text: ((await ask(choice.pick)).text ?? '').trim(), language: choice.pick, detected: choice.detected }; // rerun이면 pick이 언제나 있다
    return { text: (out.text ?? '').trim(), language: choice.pick ?? choice.detected ?? 'auto', detected: choice.detected };
  }

  return { transcribe, transcribeSegments };
}
