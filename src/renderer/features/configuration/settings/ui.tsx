function preserveInputAttributeOrder(node: HTMLInputElement | null) {
  if (!node) return;
  const attributes = Array.from(node.attributes).filter(({ name }) => name !== 'type');
  for (const { name } of attributes) node.removeAttribute(name);
  for (const { name, value } of attributes) node.setAttribute(name, value);
}

export function SettingsDialogBody() {
  return <>{'\n    '}
    <nav className="set-nav" aria-label="설정 항목">
      <h2 id="settingsTitle">설정</h2>
      <button className="set-tab" data-sec="general"><svg><use href="#i-mic"/></svg>받아쓰기</button>
      <button className="set-tab" data-sec="cleanup"><svg><use href="#i-wand"/></svg>다듬기</button>
      <button className="set-tab" data-sec="meeting"><svg><use href="#i-people"/></svg>회의</button>
      <button className="set-tab" data-sec="engine"><svg><use href="#i-gear"/></svg>엔진<span className="dot" id="engineDot" hidden></span></button>
      <button className="set-tab" data-sec="accounts"><svg><use href="#i-key"/></svg>계정·토큰<span className="dot" id="accountsDot" hidden></span></button>
      <button className="set-tab" data-sec="perms"><svg><use href="#i-shield"/></svg>권한<span className="dot" id="permDot" hidden></span></button>
    </nav>
    <div className="set-body">
      <button className="icon-btn set-close" id="settingsClose" aria-label="닫기"><svg><use href="#i-x"/></svg></button>

      <section className="set-sec" data-sec="general">
        <h3>받아쓰기</h3>
        <p className="sec-lead"><kbd>fn</kbd>을 꾹 누른 채 말하고 떼면, 다듬은 글이 지금 커서 위치에 들어갑니다. 받아쓴 음성은 글로 바꾼 뒤 바로 지웁니다.</p>
        <div className="field">
          <div className="field-text"><b>fn으로 받아쓰기</b><span>끄면 fn을 눌러도 아무 일도 일어나지 않습니다.</span></div>
          <label className="switch"><input ref={preserveInputAttributeOrder} type="checkbox" id="dictEnabled" /><i></i></label>
        </div>
        <div className="field">
          <div className="field-text"><b>언어</b><span>fn 받아쓰기에 씁니다. 왼쪽 아래에서도 바로 바꿀 수 있습니다. 회의 녹취 언어는 설정 › 회의에서 따로 정합니다.</span></div>
          <select id="dictLanguage">
            <option value="ko">한국어</option>
            <option value="auto">자동 (한·영·일)</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </select>
        </div>
        <div className="field">
          <div className="field-text"><b>마이크</b><span id="micHint">받아쓰기와 회의 녹음에 쓰는 장치</span></div>
          <select id="micSelect"><option value="">시스템 기본값</option></select>
        </div>
        <div className="field">
          <div className="field-text"><b>에코 제거</b><span>스피커 소리가 마이크로 다시 들어갈 때만 켜세요.</span></div>
          <label className="switch"><input ref={preserveInputAttributeOrder} type="checkbox" id="echo" /><i></i></label>
        </div>
        <div className="field">
          <div className="field-text"><b>음성 인식 엔진</b><span id="engineLine"></span></div>
          <div className="field-acts" id="engineActs"></div>
        </div>
        <div className="field">
          <div className="field-text"><b>처음 설정</b><span>권한·엔진·계정·마이크·fn 연습을 처음부터 다시 진행합니다.</span></div>
          <button className="btn small" id="rerunOnboarding">다시 보기</button>
        </div>
        <div className="field">
          <div className="field-text"><b>녹음 폴더</b><span id="recDirPath">~/Documents/MeetingRecorder</span></div>
          <div className="field-acts">
            <button className="btn small" id="openDir"><svg><use href="#i-folder"/></svg>열기</button>
            <button className="btn small" id="chooseDir">변경…</button>
            <button className="btn small ghost" id="resetDir" hidden>기본값으로</button>
          </div>
        </div>
      </section>

      <section className="set-sec" data-sec="cleanup" hidden>
        <h3>다듬기</h3>
        <p className="sec-lead">"음, 3시에, 아니 4시에" → "4시에". 군말을 지우고 문장을 정리합니다. 회의록과 정리본도 같은 계정으로 만듭니다.</p>
        <div className="field">
          <div className="field-text"><b>입력하기 전에 다듬기</b><span>끄면 들린 그대로 입력합니다.</span></div>
          <label className="switch"><input ref={preserveInputAttributeOrder} type="checkbox" id="dictCleanup" /><i></i></label>
        </div>
        <div className="field column">
          <div className="field-text"><b>사용할 계정</b><span>로그인된 Claude Code·Codex 구독을 먼저 씁니다. 없으면 API 키를 씁니다.</span></div>
          <div className="choices" id="providers" role="radiogroup" aria-label="다듬기에 사용할 계정"></div>
        </div>
      </section>

      <section className="set-sec" data-sec="meeting" hidden>
        <h3>회의</h3>
        <p className="sec-lead">회의는 위쪽 <b>회의 녹음</b> 버튼이나 독·메뉴바로 시작하고 멈춥니다. fn은 받아쓰기 전용입니다.</p>
        <div className="field">
          <div className="field-text"><b>회의 언어</b><span>회의 녹취에 씁니다. 자동은 한국어·영어·일본어 중에서 약 10분 조각마다 언어 하나를 정해, 여러 언어가 섞인 회의에서는 주로 쓰는 언어로 두는 편이 정확합니다.</span></div>
          <select id="meetLanguage">
            <option value="ko">한국어</option>
            <option value="auto">자동 (한·영·일)</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </select>
        </div>
        <div className="field">
          <div className="field-text"><b>끝나면 회의록 만들기</b><span>Whisper large-v3로 녹취한 뒤 요약·결정 사항·할 일을 정리합니다. 2시간 회의는 약 20분 걸립니다.</span></div>
          <label className="switch"><input ref={preserveInputAttributeOrder} type="checkbox" id="minutesAuto" /><i></i></label>
        </div>
        <div className="field">
          <div className="field-text"><b>화자 구분</b><span id="diarizeLine">누가 말했는지 구분합니다 (pyannote, 이 Mac 안에서 처리).</span></div>
          <label className="switch"><input ref={preserveInputAttributeOrder} type="checkbox" id="diarizeOn" /><i></i></label>
        </div>
        <div className="field">
          <div className="field-text"><b>화상 회의 상대방 소리</b><span>시스템 오디오를 따로 녹음합니다. 대면 회의에서는 꺼 두세요.</span></div>
          <label className="switch"><input ref={preserveInputAttributeOrder} type="checkbox" id="meetingSystem" /><i></i></label>
        </div>
      </section>

      <section className="set-sec" data-sec="engine" hidden>
        <h3>엔진</h3>
        <p className="sec-lead">음성 인식과 화자 구분에 필요한 프로그램과 모델입니다. 화자 구분은 샌드박스 안에서 앱 폴더에만 설치되고, 실행할 때는 네트워크가 막혀 회의 녹음이 밖으로 나가지 않습니다.</p>
        <div className="comps" id="compList"></div>
        <p className="hint" id="compTotal"></p>
      </section>

      <section className="set-sec" data-sec="accounts" hidden>
        <h3>계정·토큰</h3>
        <p className="sec-lead">토큰과 키는 이 Mac의 키체인으로 암호화해 저장하고, 저장한 뒤에는 다시 보여 주지 않습니다.</p>

        <div className="group">
          <div className="group-head"><b>로그인된 계정</b><button className="btn small" id="connRefresh"><svg><use href="#i-redo"/></svg>다시 확인</button></div>
          <div className="accounts" id="connAccounts"></div>
          <p className="hint">로그인은 터미널에서 <code>claude</code> 또는 <code>codex login</code>으로 합니다.</p>
        </div>

        <div className="group conn-block" data-kind="hf">
          <div className="group-head"><b>Hugging Face 토큰</b><span className="pill" data-state=""></span></div>
          <p className="hint">회의 화자 구분 모델을 처음 받을 때 씁니다.</p>
          <ol className="steps">
            <li>모델 약관에 동의 <button className="link" data-link="https://huggingface.co/pyannote/speaker-diarization-community-1">모델 페이지</button></li>
            <li>Read 권한 토큰 만들기 <button className="link" data-link="https://huggingface.co/settings/tokens">토큰 페이지</button></li>
            <li>아래에 붙여 넣고 저장</li>
          </ol>
          <div className="key-row">
            <input ref={preserveInputAttributeOrder} type="password" placeholder="hf_…" autoComplete="off" spellCheck="false" data-input="" />
            <button className="btn" data-toggle="">보기</button>
            <button className="btn primary" data-save="">저장</button>
          </div>
          <div className="key-acts">
            <button className="btn small" data-verify="">확인</button>
            <button className="btn small" data-clear="">앱에 저장한 토큰 지우기</button>
            <span className="result" data-result="" role="status"></span>
          </div>
        </div>

        <div className="group conn-block" data-kind="anthropic">
          <div className="group-head"><b>Anthropic API 키</b><span className="pill" data-state=""></span></div>
          <p className="hint">Claude Code·Codex 로그인이 없을 때만 씁니다.</p>
          <ol className="steps">
            <li>API 키 만들기 <button className="link" data-link="https://console.anthropic.com/settings/keys">키 페이지</button></li>
            <li>아래에 붙여 넣고 저장</li>
          </ol>
          <div className="key-row">
            <input ref={preserveInputAttributeOrder} type="password" placeholder="sk-ant-…" autoComplete="off" spellCheck="false" data-input="" />
            <button className="btn" data-toggle="">보기</button>
            <button className="btn primary" data-save="">저장</button>
          </div>
          <div className="key-acts">
            <button className="btn small" data-verify="">확인</button>
            <button className="btn small" data-clear="">키 지우기</button>
            <span className="result" data-result="" role="status"></span>
          </div>
        </div>
      </section>

      <section className="set-sec" data-sec="perms" hidden>
        <h3>macOS 권한</h3>
        <p className="sec-lead">시스템 설정에서 바꾸고 돌아오면 바로 반영됩니다.</p>
        <div className="perms" id="permList"></div>
      </section>
    </div>
    {'\n  '}</>;
}
