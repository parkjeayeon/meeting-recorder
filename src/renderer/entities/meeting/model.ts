// 회의 하나의 상태와 그 말 (홈·회의 목록·회의 화면이 같이 쓴다. 옛 화면 코드도 이것을 쓴다 — 두 벌 없음)

/** 화면이 받은 회의 기록 하나 (history의 mode: 'meeting') — 여기서 쓰는 칸만 */
export interface MeetingItem {
  readonly id: string;
  readonly dir?: string;
  readonly startedAt: string;
  readonly durationSec: number;
  readonly summary?: string;
  readonly tracks?: readonly string[];
  readonly minutes?: {
    readonly status?: string;
    readonly title?: string;
    readonly speakers?: number;
    readonly provider?: string;
    readonly progress?: number;
    readonly diarizing?: boolean;
    readonly error?: string;
  } | null;
  readonly review?: { readonly finalized?: boolean; readonly open?: number; readonly total?: number } | null;
  readonly audio?: {
    readonly bytes: number;
    readonly wav?: boolean;
    readonly supported?: boolean;
    readonly declined?: boolean;
    readonly estimate?: number;
  } | null;
}
type Minutes = MeetingItem['minutes'];

export const BUSY: readonly string[] = ['queued', 'transcribe', 'write'];

/** busy(만드는 중) fail(실패) none(녹음만) short empty | open(확인 남음) draft(확인 마치기 전) done(확정) plain(확인할 것 없음) */
export type MeetState = 'busy' | 'fail' | 'none' | 'short' | 'empty' | 'open' | 'draft' | 'done' | 'plain';

export function meetState(r: MeetingItem): MeetState {
  const s = r.minutes?.status;
  if (s !== undefined && BUSY.includes(s)) return 'busy';
  if (s === 'error') return 'fail';
  if (s === 'short' || s === 'empty') return s;
  if (s !== 'done') return 'none';
  const rv = r.review;
  if (!rv) return 'plain';
  if (rv.finalized) return 'done';
  if (rv.open) return 'open';
  return rv.total ? 'draft' : 'plain';
}

export function meetTitle(r: MeetingItem): string {
  const st = meetState(r);
  if (st === 'busy') return '회의록 만드는 중';
  if (st === 'fail') return '회의록을 만들지 못했습니다';
  if (st === 'none') return '녹음만 저장됨';
  if (st === 'short') return '짧은 녹음 (10초 미만)';
  if (st === 'empty') return '들린 말 없음';
  return r.minutes?.title ?? '제목 없는 회의';
}

/** 받아쓰는 중의 진행률 (0~1), 모르면 null */
export function progressOf(m: Minutes): number | null {
  if (m?.status === 'transcribe' && m.progress !== undefined) return m.progress;
  return null;
}

export function statusText(m: Minutes): string {
  const s = m?.status;
  if (s === 'queued') return '차례를 기다리는 중';
  if (s === 'transcribe') {
    const p = progressOf(m);
    return `받아쓰는 중${p !== null ? ` ${Math.round(p * 100)}%` : ''}${m?.diarizing ? ' · 화자 구분 중' : ''}`;
  }
  if (s === 'write') return '회의록 쓰는 중';
  if (s === 'error') return m?.error ?? '실패';
  if (s === 'empty') return '들린 말이 없어 회의록을 만들지 않았습니다';
  if (s === 'short') return '10초 미만이라 회의록을 만들지 않았습니다';
  return '녹음만 저장됨';
}

export function busyShort(m: Minutes): string {
  const p = progressOf(m);
  if (m?.status === 'transcribe') return `받아쓰는 중${p !== null ? ` ${Math.round(p * 100)}%` : ''}`;
  return m?.status === 'write' ? '회의록 쓰는 중' : '기다리는 중';
}

/** 지금 바로 압축할 수 있나: 회의록이 있고 확인을 마친(확정) 원본 WAV, 그대로 두기를 고르지 않음 */
export const canCompressNow = (r: MeetingItem): boolean => Boolean(r.minutes?.status === 'done' && r.review?.finalized && r.audio?.wav && r.audio.supported && !r.audio.declined);
