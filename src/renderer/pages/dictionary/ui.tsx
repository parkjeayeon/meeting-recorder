// 사전 화면 (옛 pageDictionary를 그대로 옮김: 같은 글자·같은 클래스·같은 동작).
// 입력칸은 값을 쥐지 않는다(uncontrolled) — 시험이 el.value = …; input 이벤트로 넣는다. Enter는 한글 조합 중엔 무시.
import { useRef, useSyncExternalStore } from 'react';
import type { VocabularyModel } from '../../entities/vocabulary/index.ts';
import { Icon, useNativeEvent } from '../../shared/ui/index.tsx';

export function DictionaryPage({ model }: { readonly model: VocabularyModel }) {
  const words = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const input = useRef<HTMLInputElement>(null);
  const add = async () => {
    const el = input.current;
    if (!el) return;
    if (!(await model.add(el.value))) {
      el.focus();
      return;
    }
    el.value = '';
    el.focus();
  };
  // Enter는 입력칸에 직접 단 처리기로 (거품이 안 오르는 keydown도 받게 — 옛 화면처럼)
  useNativeEvent(input, 'keydown', (_el, e) => {
    const k = e as KeyboardEvent;
    if (k.key === 'Enter' && !k.isComposing) void add();
  });
  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>사전</h1>
          <p className="lead">Whisper가 자주 틀리는 이름과 용어를 알려 줍니다. 받아쓰기와 회의 녹취에 모두 쓰입니다.</p>
        </div>
      </div>
      <div className="add-row">
        <input ref={input} type="text" placeholder="단어나 이름 (예: PJY, Whisper, 김신우)" />
        <button className="btn primary" onClick={() => void add()}>
          <Icon id="i-plus" />
          추가
        </button>
      </div>
      <div className="words">
        {words.length === 0 ? (
          <div className="empty" style={{ width: '100%' }}>
            <b>아직 등록한 단어가 없습니다</b>
            사람 이름, 회사·제품 이름, 전문 용어를 넣어 두면 받아쓰기와 회의 녹취가 그 단어를 더 잘 알아듣습니다.
          </div>
        ) : (
          words.map((w, i) => (
            // 같은 말이 두 번 들어 있을 수도 있다 (설정 글자를 그대로 나눈 것)
            <span className="word" key={`${i}:${w}`}>
              {w}
              <button className="icon-btn" aria-label={`${w} 지우기`} onClick={() => void model.remove(w)}>
                <Icon id="i-x" />
              </button>
            </span>
          ))
        )}
      </div>
      <ul className="tips">
        <li>
          <b>고유명사 위주로: </b>흔한 낱말보다 사람·회사·제품 이름이 효과가 큽니다.
        </li>
        <li>
          <b>적힌 그대로: </b>"PJY", "Electron"처럼 화면에 나와야 하는 모양 그대로 적으세요.
        </li>
        <li>
          <b>너무 많지 않게: </b>수십 개를 넘기면 오히려 엉뚱한 단어로 바꿔 듣는 일이 생깁니다.
        </li>
      </ul>
    </div>
  );
}
