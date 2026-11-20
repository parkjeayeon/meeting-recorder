// 질문으로 찾기에서 같이 쓰는 모양: 본체가 넘기는 회의 목록의 한 줄, 질문 하나(화면에 그대로 보낸다).
import type { CompleteOptions } from '../llm/call.mjs';

// 본체(src/app/ask.mts의 askMeetings)가 넘기는 회의, 최신순
export interface AskMeeting {
  id: string;
  dir: string;
  startedAt: string | undefined;
  title: string | null;
  summary: string | null;
  status: string;
}

export interface AskConds {
  from: string | null;
  to: string | null;
  status: string[] | null;
  focus: 'main' | 'any';
  topic: string | null;
  terms: string[];
}

export interface AskResult {
  id: string;
  level: 'main' | 'mention' | null;
  reason: string | null;
  quote?: string | null;
}

export interface AskJob {
  id: string;
  q: string;
  scope: { count: number | null; from: string; to: string };
  status: 'running' | 'done' | 'blocked' | 'error' | 'stopped';
  stage: 'parse' | 'search' | 'judge' | 'done' | 'blocked' | 'error' | 'stopped';
  t0: number;
  ms: number | null;
  conds: AskConds | null;
  results: AskResult[];
  candidates: number;
  provider: string | null;
  seen: boolean;
  error: string | null;
  errorKind?: string;
}

export type Complete = (opts: CompleteOptions) => Promise<{ text: string; provider: string }>;
