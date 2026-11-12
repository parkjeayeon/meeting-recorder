// 받아쓰기 한 줄 (옛 dictItem의 짧은 꼴: 홈의 최근 받아쓰기). 받아쓰기 화면을 옮길 때 원문 보기·지우기·인식 시간을 더한다.
import { DictText, markParts, type DictRecord } from '../../entities/dictation/index.ts';
import { seconds, TIME } from '../../shared/lib/index.ts';
import { CopyButton, Icon, Num } from '../../shared/ui/index.tsx';

export interface DictationItemProps {
  readonly r: DictRecord;
  readonly fresh: boolean;
  /** 교정 부호 숨김 (받아쓰기 화면의 '교정 표시' 끔) */
  readonly plain: boolean;
  /** 받아쓰기 화면에서 원문을 펼쳐 둔 줄 */
  readonly rawOpen: boolean;
  readonly onCopy: (text: string) => unknown;
  /** 창을 닫고 직전에 쓰던 앱에 붙여 넣는다 */
  readonly onRepaste: (text: string) => unknown;
}

export function DictationItem({ r, fresh, plain, rawOpen, onCopy, onRepaste }: DictationItemProps) {
  const t = r.transcript;
  const text = t.text ?? t.raw;
  const marked = markParts(t.raw, t.text);
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
          {t.cleanupError ? <span className="err">{`다듬기 실패: ${t.cleanupError}`}</span> : null}
        </div>
      </div>
      <div className="dacts">
        <CopyButton copy={() => onCopy(text)} />
        <button className="icon-btn" title="다시 붙여넣기" aria-label="다시 붙여넣기" onClick={() => onRepaste(text)}>
          <Icon id="i-paste" />
        </button>
      </div>
    </div>
  );
}
