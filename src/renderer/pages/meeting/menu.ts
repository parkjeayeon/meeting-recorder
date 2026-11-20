// 머리의 버튼·메뉴(회의록 복사·다시 만들기·Finder·원본 복사·압축·휴지통), 회의록이 없을 때의 상태 카드, 녹음 압축 안내.
// 그리기·메뉴 열고 닫기는 ui.tsx. 여기는 무엇을 보일지와 명령, 압축하는 중(compressBusy)
import { parseScript } from '../../../core/script.mts';
import { BUSY, progressOf, statusText } from '../../entities/meeting/index.ts';
import { speakerOrder } from '../../entities/minutes/index.ts';
import { sizeLabel } from '../../shared/lib/index.ts';
import { errText, type MeetingDoc, type MeetingRecord, type PageCtx } from './state.ts';
import type { CompressNote, MeetingCommands, MeetingMenu, StateCard } from './ui.tsx';

export interface MenuRole {
  readonly menu: (r: MeetingRecord, doc: MeetingDoc) => MeetingMenu;
  readonly stateCard: (r: MeetingRecord) => StateCard;
  readonly compressNote: (r: MeetingRecord) => CompressNote | null;
  /** 녹취부터 다시 만들면 사라지는 것 (없으면 빈 목록 — 묻지 않는다) */
  readonly remakeLoss: () => string[];
  readonly commands: Pick<MeetingCommands, 'copyMinutes' | 'copyTranscript' | 'remake' | 'resume' | 'reveal' | 'compress' | 'declineCompress' | 'trash'>;
}

export function createMenu(ctx: PageCtx): MenuRole {
  const { api, docs, toast, loadHistory, audio, deps, id } = ctx;

  // 참석 인원 고르기의 처음 값: 지정한 인원, 없으면 회의록이 센 화자 수
  function speakersValue() {
    const r = ctx.rec();
    return r?.speakersHint ? String(r.speakersHint) : r?.minutes?.speakers ? String(r.minutes.speakers) : '';
  }

  // 녹취부터 다시 만들면 사라지는 것: 처리한 확인 항목(고친 말은 새 녹취에 없다), 바꿔 둔 화자 이름, 확정 상태
  function remakeLoss(): string[] {
    const doc = docs.get(id);
    const done = (doc?.review?.items ?? []).filter((it) => it.status !== 'open').length;
    const named = speakerOrder(parseScript(doc?.transcript)).filter((w) => !/^(화자 \d+|나|상대방)$/.test(w)).length;
    return [done ? `처리한 확인 항목 ${done}개` : '', named ? `바꿔 둔 화자 이름 ${named}개` : '', doc?.review?.finalizedAt ? '회의록 확정' : ''].filter(Boolean);
  }

  async function remake(r: MeetingRecord, speakers: string) {
    const loss = remakeLoss();
    if (loss.length && !(await deps.confirm('녹취부터 다시 만들까요?', `다시 만들면 사라집니다: ${loss.join(', ')}. 녹음은 그대로 둡니다.`, '다시 만들기'))) return;
    docs.delete(r.id);
    api.makeMinutes(r.dir, speakers || null);
    toast('회의록을 다시 만듭니다', '녹취·화자 구분·회의록을 처음부터 만듭니다');
    setTimeout(loadHistory, 400);
  }

  // 회의록이 없을 때의 카드: 만드는 중 · 짧은 녹음 · 쓰다가 멈춤(회의록만 다시 쓰기) · 없음/실패/들린 말 없음
  function stateCard(r: MeetingRecord): StateCard {
    const m = r.minutes;
    const s = m?.status;
    if (s !== undefined && BUSY.includes(s)) return { kind: 'busy', text: statusText(m), progress: progressOf(m) };
    if (s === 'short' || r.durationSec < 10) return { kind: 'short' };
    // 회의록 쓰기에서 멈췄으면(인터넷 끊김·앱 종료) 저장된 녹취로 회의록만 다시 쓴다
    if (s === 'error' && m?.stage === 'write') return { kind: 'stalled', offline: Boolean(m.offline), error: m.error ?? '', speakersValue: speakersValue() };
    return { kind: s === 'error' ? 'error' : s === 'empty' ? 'empty' : 'none', error: m?.error ?? '', speakersValue: speakersValue() };
  }

  // 녹음 압축 (AAC 96kbps): 확인을 마친 회의에만 안내한다. 고를 때까지 늘 보이고(모달 아님), '그대로 두기'면 숨기고 … 메뉴에 남긴다.
  // 처음 녹취·회의록·확인은 원본 WAV로 하고, 다 끝난 뒤에만 줄인다 (측정: 96kbps는 받아쓰기 결과가 원본의 흔들림 폭 안)
  function canCompress(r: MeetingRecord) {
    return Boolean(r.minutes?.status === 'done' && r.review?.finalized && r.audio?.wav && r.audio.supported); // 32kHz 미만(가져온 전화 녹음 등)은 압축하지 않는다
  }
  let compressBusy = false;
  async function runCompress(r: MeetingRecord) {
    if (compressBusy) return;
    compressBusy = true;
    void ctx.draw();
    const at = audio.currentTime;
    const playing = !audio.paused;
    audio.pause(); // 압축하는 동안 원본을 읽고 있으면 지울 수 없다
    try {
      const res = await api.compressMeeting(r.dir);
      toast('녹음을 압축했습니다', `${sizeLabel(res.before)} → ${sizeLabel(res.after)} · 재생·구간 다시 받아쓰기는 그대로 됩니다`);
      await loadHistory();
      const next = deps.records().find((x) => x.id === r.id);
      if (next?.firstFile) {
        audio.src = `rec://m/${encodeURIComponent(next.id)}/${encodeURIComponent(next.firstFile)}`;
        audio.currentTime = at;
        if (playing) void audio.play();
      }
    } catch (err) {
      toast('압축하지 못했습니다', errText(err), { bad: true, ms: 8000 });
    }
    compressBusy = false;
    void ctx.draw();
  }
  function compressNote(r: MeetingRecord): CompressNote | null {
    if (!canCompress(r) || r.audio!.declined) return null;
    return { bytes: r.audio!.bytes, estimate: r.audio!.estimate ?? 0, busy: compressBusy };
  }

  // 오른쪽 위 버튼과 메뉴에 무엇을 보일지 (그리기·메뉴 열고 닫기는 pages/meeting)
  function meetingMenu(r: MeetingRecord, doc: MeetingDoc): MeetingMenu {
    const s = r.minutes?.status;
    const busy = s !== undefined && BUSY.includes(s);
    return {
      minutes: Boolean(doc.minutes),
      remake: !busy && Boolean(s) && s !== 'short',
      busy,
      transcript: Boolean(doc.transcript),
      compress: canCompress(r) ? { bytes: r.audio!.bytes, estimate: r.audio!.estimate ?? 0 } : null,
      compressBusy,
      speakersValue: speakersValue(),
    };
  }

  return {
    menu: meetingMenu,
    stateCard,
    compressNote,
    remakeLoss,
    commands: {
      copyMinutes: async () => {
        await api.copy(docs.get(id)?.minutes ?? '');
        toast('회의록을 복사했습니다', '마크다운 형식');
      },
      copyTranscript: () => {
        api.copy(docs.get(id)?.transcript);
        toast('원본 스크립트를 복사했습니다');
      },
      remake: (speakers: string) => remake(ctx.recNow(), speakers),
      resume: () => {
        docs.delete(id);
        api.resumeMinutes(ctx.recNow().dir).catch((err: Error) => toast('이어서 쓰지 못했습니다', err.message, { bad: true }));
        setTimeout(loadHistory, 400);
      },
      reveal: () => {
        const r = ctx.recNow();
        api.reveal(`${r.dir}/${r.firstFile}`);
      },
      compress: () => void runCompress(ctx.recNow()),
      declineCompress: async () => {
        await api.declineCompress(ctx.recNow().dir, true);
        toast('원본 그대로 둡니다', '… 메뉴에서 언제든 압축할 수 있습니다');
        await loadHistory();
      },
      trash: async () => {
        if (!(await deps.confirm('이 회의를 휴지통으로 옮길까요?', '녹음 파일과 회의록이 함께 옮겨집니다. Finder 휴지통에서 되살릴 수 있습니다.', '휴지통으로'))) return;
        try {
          audio.pause();
          await api.trashMeeting(ctx.recNow().dir);
          toast('휴지통으로 옮겼습니다');
          deps.replaceRoute('#meetings');
          void loadHistory();
        } catch (err) {
          toast('옮기지 못했습니다', (err as Error).message, { bad: true });
        }
      },
    },
  };
}
