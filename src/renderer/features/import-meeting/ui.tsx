function preserveInputAttributeOrder(node: HTMLInputElement | null) {
  if (!node) return;
  const attributes = Array.from(node.attributes).filter(({ name }) => name !== 'type');
  for (const { name } of attributes) node.removeAttribute(name);
  for (const { name, value } of attributes) node.setAttribute(name, value);
}

export function ImportMeetingDialogBody() {
  return <>{'\n    '}
    <header className="sheet-head">
      <span className="sheet-mark"><svg><use href="#i-folder"/></svg></span>
      <div>
        <h3 id="importTitle">녹음 파일 가져오기</h3>
        <p id="importLead">가져오면 받아쓰기와 회의록을 바로 만듭니다.</p>
      </div>
      <button className="icon-btn" id="importClose" aria-label="닫기"><svg><use href="#i-x"/></svg></button>
    </header>
    <section className="sheet-sec">
      <div className="sheet-label"><b>파일</b><span id="importOrder"></span></div>
      <ol className="import-files" id="importFiles"></ol>
    </section>
    <section className="sheet-sec">
      <div className="sheet-label"><b>회의 날짜</b><span id="importWhenSrc"></span></div>
      <div className="import-when">
        <input ref={preserveInputAttributeOrder} type="date" id="importDate" aria-label="회의 날짜" required />
        <input ref={preserveInputAttributeOrder} type="time" id="importTime" aria-label="회의 시작 시각" step="60" required />
      </div>
    </section>
    <section className="sheet-sec">
      <div className="sheet-label"><b>참석 인원</b><span>알려 주면 누가 말했는지 더 정확하게 나눕니다</span></div>
      <div className="segbar" id="importSpeakers" role="radiogroup" aria-label="참석 인원"></div>
    </section>
    <section className="sheet-sec">
      <div className="sheet-label"><b>녹음에 담기지 않은 내용</b><span>선택 · 녹음을 끝낸 뒤 오간 말, 정해진 일</span></div>
      <textarea className="import-notes" id="importNotes" rows={4} maxLength={4000} placeholder="예: 녹음을 끝낸 뒤 배포일을 목요일로 바꾸기로 함. 디자인 검토는 화자 2가 맡음."></textarea>
      <p className="sheet-hint">회의록에 함께 반영하고, 녹음에서 나온 내용과 구분되게 "(녹음 외 메모)"로 표시합니다.</p>
    </section>
    <footer className="sheet-foot">
      <span ref={(node) => { node?.setAttribute('style', 'flex:1'); }}></span>
      <button className="btn" id="importNo">닫기</button>
      <button className="btn primary" id="importYes"><svg><use href="#i-folder"/></svg>가져오기</button>
    </footer>{'\n  '}</>;
}
