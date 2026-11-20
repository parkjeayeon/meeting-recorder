// 스크립트(정리본·원본)·화자 탭과 화자 이름 막대: 그리기는 features/meeting-player. 여기는 이름 바꾸기·복사·정리본 만들기
import { scriptMarkdown, speakerStats, type ScriptLine } from '../../../core/script.mts';
import type { Term, TermMatcher } from '../../entities/minutes/index.ts';
import type { Rename, ScriptProps, SpeakerBarBody, SpeakersBody } from '../../features/meeting-player/index.ts';
import type { MeetingRecord, PageCtx } from './state.ts';
import type { TermsRole } from './terms.ts';

type Color = (w: string) => string;

export interface ScriptRole {
  readonly scriptView: (r: MeetingRecord, lines: ScriptLine[], color: Color, matcher: TermMatcher | null) => ScriptProps;
  /** 화자 구분 결과가 없으면 null ('화자 구분 결과가 없습니다') */
  readonly speakersView: (r: MeetingRecord, raw: ScriptLine[], color: Color) => Parameters<typeof SpeakersBody>[0] | null;
  readonly speakerBar: (r: MeetingRecord, order: string[], color: Color) => Parameters<typeof SpeakerBarBody>[0];
  readonly copyScript: (clean: boolean) => Promise<void>;
  readonly makeClean: () => Promise<void>;
}

export function createScript(ctx: PageCtx, terms: Pick<TermsRole, 'openCard'>): ScriptRole {
  const { api, docs, toast, playback, id } = ctx;

  // 스크립트·화자: 이름 바꾸기는 여기서 파일에 (끝나면 다시 그린다)
  const renameTo = (r: MeetingRecord): Rename => (from: string, to: string | null) => queueMicrotask(async () => {
    if (to) {
      await api.renameSpeaker(r.dir, from, to);
      docs.delete(r.id);
      toast(`'${from}'을 '${to}'(으)로 바꿨습니다`, '회의록과 스크립트에 모두 반영했습니다');
    }
    void ctx.draw();
  });

  return {
    scriptView: (r, lines, color, matcher) => ({ lines, color, playback, matcher, openTerm: (anchor: HTMLElement, t: Term) => terms.openCard(anchor, t), rename: renameTo(r) }),
    speakersView: (r, raw, color) => {
      if (!speakerStats(raw, r.durationSec).length) return null; // '화자 구분 결과가 없습니다'
      return { raw, total: r.durationSec, color, seek: (sec: number) => ctx.seek(sec), rename: renameTo(r) };
    },
    // 화자 이름 정하기: 회의록·스크립트의 '화자 N'을 실제 이름으로 바꾼다
    speakerBar: (r, order, color) => ({ order, color, rename: renameTo(r) }),
    copyScript: async (clean) => {
      const d = docs.get(id) ?? {};
      await api.copy(scriptMarkdown(clean ? d.scriptClean : d.transcript));
      toast(`${clean ? '정리본' : '원본'}을 복사했습니다`, '마크다운 형식');
    },
    makeClean: async () => {
      await api.cleanScript(ctx.recNow().dir);
      docs.delete(id);
      void ctx.draw();
    },
  };
}
