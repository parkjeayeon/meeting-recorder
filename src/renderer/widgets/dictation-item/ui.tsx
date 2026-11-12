// 받아쓰기 한 줄 (옛 dictItem과 같은 마크업). compact는 홈의 짧은 꼴: 인식·다듬기 시간, 원문 보기, 삭제가 없다.
import { DictText, markParts, type DictRecord } from '../../entities/dictation/index.ts';
import { PROVIDER_NAME, seconds, TIME } from '../../shared/lib/index.ts';
import { CopyButton, Icon, Num } from '../../shared/ui/index.tsx';

export interface DictationItemProps {
  readonly r: DictRecord;
  readonly compact?: boolean;
  readonly fresh: boolean;
  /** 교정 부호 숨김 (받아쓰기 화면의 '고친 곳 표시' 끔) */
  readonly plain: boolean;
  /** 원문을 펼쳐 둔 줄 */
  readonly rawOpen: boolean;
  readonly onCopy: (text: string) => unknown;
  /** 창을 닫고 직전에 쓰던 앱에 붙여 넣는다 */
  readonly onRepaste: (text: string) => unknown;
  readonly onToggleRaw?: (id: string) => void;
  /** 확인 창을 거쳐 지운다 (주인 쪽) */
  readonly onDelete?: (id: string) => void;
}

export function DictationItem({ r, compact = false, fresh, plain, rawOpen, onCopy, onRepaste, onToggleRaw, onDelete }: DictationItemProps) {
  const t = r.transcript;
  const text = t.text ?? t.raw;
  const marked = markParts(t.raw, t.text);
  const changed = Boolean(t.text && t.text !== t.raw);
  return (
    <div className={fresh ? 'ditem fresh' : 'ditem'}>
      <time>{TIME.format(new Date(r.startedAt))}</time>
      <div>
        <DictText marked={marked} plain={plain} />
        {rawOpen ? <div className="draw">{t.raw}</div> : null}
        <div className="dmeta">
          {r.app ? <span className="tag">{r.app}</span> : null}
          <Num>{seconds(r.durationSec * 1000)}</Num>
          {marked.heavy ? <span>많이 고침</span> : null}
          {!compact && t.timing?.transcribeMs !== undefined ? <span>{'인식 '}<Num>{seconds(t.timing.transcribeMs)}</Num></span> : null}
          {!compact && t.cleanupProvider ? <span>{`다듬기 ${PROVIDER_NAME[t.cleanupProvider] ?? t.cleanupProvider} `}<Num>{seconds(t.timing?.cleanupMs ?? 0)}</Num></span> : null}
          {t.cleanupError ? <span className="err">{`다듬기 실패: ${t.cleanupError}`}</span> : null}
        </div>
      </div>
      <div className="dacts">
        <CopyButton copy={() => onCopy(text)} />
        <button className="icon-btn" title="다시 붙여넣기" aria-label="다시 붙여넣기" onClick={() => onRepaste(text)}>
          <Icon id="i-paste" />
        </button>
        {changed && !compact ? (
          <button className="icon-btn" title={rawOpen ? '원문 닫기' : '원문 보기'} aria-label="원문" onClick={() => onToggleRaw?.(r.id)}>
            <Icon id="i-book" />
          </button>
        ) : null}
        {!compact && !r.dir ? (
          <button className="icon-btn" title="삭제" aria-label="삭제" onClick={() => onDelete?.(r.id)}>
            <Icon id="i-trash" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
