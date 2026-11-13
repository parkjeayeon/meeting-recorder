function preserveInputAttributeOrder(node: HTMLInputElement | null) {
  if (!node) return;
  const attributes = Array.from(node.attributes).filter(({ name }) => name !== 'type');
  for (const { name } of attributes) node.removeAttribute(name);
  for (const { name, value } of attributes) node.setAttribute(name, value);
}

// 원래 index.html의 줄바꿈·들여쓰기까지 그대로 둔다 — 인라인 요소 사이의 공백은 화면 간격이 될 수 있다.
const nl = (indent: number) => `\n${' '.repeat(indent)}`;

export function MeetingStartDialogBody() {
  return <>{nl(4)}
    <header className="sheet-head">{nl(6)}
      <span className="sheet-mark"><svg><use href="#i-rec"/></svg></span>{nl(6)}
      <div>{nl(8)}
        <h3 id="meetStartTitle">회의 녹음 시작</h3>{nl(8)}
        <p>시작한 뒤에도 일시정지하거나 취소할 수 있습니다.</p>{nl(6)}
      </div>{nl(6)}
      <button className="icon-btn" id="startClose" aria-label="닫기"><svg><use href="#i-x"/></svg></button>{nl(4)}
    </header>{nl(4)}
    <section className="sheet-sec">{nl(6)}
      <div className="sheet-label"><b>참석 인원</b><span>알려 주면 누가 말했는지 더 정확하게 나눕니다</span></div>{nl(6)}
      <div className="segbar" id="startSpeakers" role="radiogroup" aria-label="참석 인원"></div>{nl(4)}
    </section>{nl(4)}
    <section className="sheet-sec">{nl(6)}
      <div className="sheet-label"><b>회의 방식</b></div>{nl(6)}
      <div className="kinds" id="startKind" role="radiogroup" aria-label="회의 방식">{nl(8)}
        <button type="button" role="radio" data-kind="offline"><svg><use href="#i-people"/></svg><b>대면 회의</b><span>이 Mac 마이크로만 녹음</span></button>{nl(8)}
        <button type="button" role="radio" data-kind="online"><svg><use href="#i-mic"/></svg><b>화상 회의</b><span>상대방 소리(시스템 오디오)도 함께</span></button>{nl(6)}
      </div>{nl(4)}
    </section>{nl(4)}
    <footer className="sheet-foot">{nl(6)}
      <label className="inline-switch"><span className="switch"><input ref={preserveInputAttributeOrder} type="checkbox" id="startMinutes" /><i></i></span>끝나면 회의록 만들기</label>{nl(6)}
      <button className="btn" id="startNo">닫기</button>{nl(6)}
      <button className="btn rec" id="startYes"><svg><use href="#i-rec"/></svg>녹음 시작</button>{nl(4)}
    </footer>{nl(2)}</>;
}

export function RecordingLiveBody() {
  return <>{nl(10)}
    <span className="live-dot"></span>{nl(10)}
    <span className="live-text" id="liveText"></span>{nl(10)}
    <ol className="route" id="route" hidden>{nl(12)}
      <li data-stage="listen">듣기</li><li data-stage="transcribe">인식</li><li data-stage="cleanup">다듬기</li><li data-stage="paste">입력</li>{nl(10)}
    </ol>{nl(10)}
    <canvas className="tape" id="tape" width="96" height="18" hidden></canvas>{nl(10)}
    <span className="live-time" id="liveTime"></span>{nl(8)}</>;
}

export function RecordingSpeakersBody() {
  return <>{nl(10)}
    <svg><use href="#i-people"/></svg>{nl(10)}
    <select id="liveSpeakersSel" aria-label="참석 인원"></select>{nl(8)}</>;
}

export function RecordingActionsBody() {
  return <>{nl(10)}
    <button className="btn ghost" id="cancelBtn" hidden title="저장하지 않고 버립니다"><svg><use href="#i-x"/></svg><span>취소</span></button>{nl(10)}
    <button className="btn ghost" id="pauseBtn" hidden><svg><use href="#i-pause"/></svg><span>일시정지</span></button>{nl(10)}
    <button className="btn ghost" id="memoBtn" title="fn을 꾹 눌러도 됩니다"><svg><use href="#i-mic"/></svg><span>받아쓰기</span></button>{nl(10)}
    <button className="btn rec" id="meetingBtn"><svg><use href="#i-rec"/></svg><span>회의 녹음</span></button>{nl(8)}</>;
}
