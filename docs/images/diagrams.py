"""README 아키텍처 그림(SVG) 생성기. 고친 뒤 `python3 docs/images/diagrams.py`로 다시 만든다.

라이트·다크 두 벌을 만든다 (README가 <picture>로 GitHub 테마에 맞는 쪽을 보여 준다).
선 색 = 흐르는 것: 주홍 음성 · 파랑 글 · 회색 이벤트·데이터 · 점선 설치할 때만/선택.
"""
from pathlib import Path

OUT = Path(__file__).parent
FONT = "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif"
MONO = "'SF Mono', ui-monospace, Menlo, Consolas, monospace"

THEMES = {
    'light': dict(bg='#ffffff', panel='#f6f7f9', panel2='#eef0f3', ink='#15171a', ink2='#4a5059', ink3='#6b727c', line='#d5d9df',
                  voice='#c83a1a', text='#2a78d6', ok='#1a7a50', warn='#b26a00', box='#ffffff', sand='#fdf3f0'),
    'dark': dict(bg='#0d1117', panel='#161b22', panel2='#1c2129', ink='#e6edf3', ink2='#b1bac4', ink3='#8b949e', line='#30363d',
                 voice='#ff7b5c', text='#58a6ff', ok='#3fb950', warn='#d29922', box='#0d1117', sand='#2a1a16'),
}


class Svg:
    def __init__(self, w, h, t):
        self.w, self.h, self.t, self.parts = w, h, t, []

    def add(self, s):
        self.parts.append(s)

    def text(self, x, y, s, size=13, color='ink', weight=400, anchor='start', mono=False, italic=False):
        fam = MONO if mono else FONT
        style = ' font-style="italic"' if italic else ''
        self.add(f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" font-weight="{weight}" fill="{self.t[color]}" text-anchor="{anchor}"{style}>{esc(s)}</text>')

    def rect(self, x, y, w, h, fill='box', stroke='line', r=10, dash=None, sw=1.2):
        d = f' stroke-dasharray="{dash}"' if dash else ''
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{self.t[fill] if fill in self.t else fill}" stroke="{self.t[stroke]}" stroke-width="{sw}"{d}/>')

    def node(self, x, y, w, h, title, lines=(), tag=None, fill='box', stroke='line', dash=None, title_color='ink'):
        self.rect(x, y, w, h, fill=fill, stroke=stroke, dash=dash)
        ty = y + 22
        self.text(x + 12, ty, title, 14, title_color, 650)
        if tag:
            self.text(x + w - 10, ty, tag, 10.5, 'ink3', 500, 'end', mono=True)
        for i, ln in enumerate(lines):
            self.text(x + 12, ty + 19 + i * 17, ln, 11.5, 'ink2')

    def group(self, x, y, w, h, label, stroke='line', dash='5 4', fill='panel', label_color='ink3'):
        self.rect(x, y, w, h, fill=fill, stroke=stroke, dash=dash, r=14)
        self.text(x + 14, y + 20, label, 12, label_color, 650)

    def cyl(self, x, y, w, h, title, lines=()):
        t = self.t
        e = 9
        self.add(f'<path d="M{x},{y+e} a{w/2},{e} 0 0 0 {w},0 v{h-2*e} a{w/2},{e} 0 0 1 {-w},0 z" fill="{t["box"]}" stroke="{t["line"]}" stroke-width="1.2"/>')
        self.add(f'<ellipse cx="{x+w/2}" cy="{y+e}" rx="{w/2}" ry="{e}" fill="{t["panel2"]}" stroke="{t["line"]}" stroke-width="1.2"/>')
        self.text(x + w / 2, y + 2 * e + 20, title, 13, 'ink', 650, 'middle')
        for i, ln in enumerate(lines):
            self.text(x + w / 2, y + 2 * e + 38 + i * 15, ln, 10.5, 'ink2', 400, 'middle')

    def arrow(self, pts, color='ink3', label=None, at=None, dash=None, both=False, lx=0, ly=-6, anchor='middle'):
        c = self.t[color]
        d = 'M' + ' L'.join(f'{x},{y}' for x, y in pts)
        da = f' stroke-dasharray="{dash}"' if dash else ''
        ms = f' marker-start="url(#a-{color})"' if both else ''
        self.add(f'<path d="{d}" fill="none" stroke="{c}" stroke-width="1.8"{da} marker-end="url(#a-{color})"{ms} stroke-linejoin="round"/>')
        if label:
            if at is None:
                (x1, y1), (x2, y2) = pts[0], pts[1]
                at = ((x1 + x2) / 2, (y1 + y2) / 2)
            x, y = at[0] + lx, at[1] + ly
            w = text_w(label, 11) + 10
            bx = x - w / 2 if anchor == 'middle' else (x - 4 if anchor == 'start' else x - w + 4)
            self.add(f'<rect x="{bx}" y="{y-12}" width="{w}" height="17" rx="4" fill="{self.t["bg"]}" opacity="0.92"/>')
            self.text(x if anchor == 'middle' else (bx + 5 if anchor == 'start' else bx + w - 5), y, label, 11, color, 600, anchor if anchor != 'start' else 'start')

    def render(self, title, subtitle):
        t = self.t
        markers = ''.join(
            f'<marker id="a-{k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{t[k]}"/></marker>'
            for k in ('ink3', 'voice', 'text', 'ok', 'warn'))
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">'
                f'<defs>{markers}</defs><rect width="100%" height="100%" fill="{t["bg"]}"/>')
        hdr = (f'<text x="28" y="38" font-family="{FONT}" font-size="20" font-weight="750" fill="{t["ink"]}">{esc(title)}</text>'
               f'<text x="28" y="60" font-family="{FONT}" font-size="12.5" fill="{t["ink3"]}">{esc(subtitle)}</text>')
        return head + hdr + ''.join(self.parts) + '</svg>\n'


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def text_w(s, size):
    return sum(size * (0.95 if ord(ch) > 0x2E80 else 0.56) for ch in s)


def legend(s, x, y):
    items = [('voice', None, '음성'), ('text', None, '글'), ('ink3', None, '이벤트·데이터'), ('warn', '5 4', '설치할 때만'), ('text', '5 4', '선택 (키가 있을 때)')]
    for i, (c, dash, label) in enumerate(items):
        xx = x + i * 150
        da = f' stroke-dasharray="{dash}"' if dash else ''
        s.add(f'<line x1="{xx}" y1="{y}" x2="{xx+34}" y2="{y}" stroke="{s.t[c]}" stroke-width="2"{da} marker-end="url(#a-{c})"/>')
        s.text(xx + 42, y + 4, label, 11.5, 'ink2')


# ── 1. 전체 구조 ────────────────────────────────────────────────────
def architecture(t):
    s = Svg(1240, 900, t)
    s.group(20, 82, 990, 728, '이 Mac — 음성은 이 경계 밖으로 나가지 않는다', stroke='ok', dash=None, fill='bg', label_color='ok')
    s.group(1030, 82, 190, 728, '인터넷', dash='5 4', fill='panel')

    # 입력·출력 (왼쪽)
    s.node(40, 130, 170, 56, 'fn 키', ['꾹·톡·두 번·세 번'])
    s.node(40, 220, 170, 60, '다른 앱', ['커서 위치에 글 입력'])
    s.node(40, 427, 170, 56, '마이크', ['내장·유선 권장'])
    s.node(40, 512, 170, 56, '사용자', ['창·독·메뉴바 클릭'])

    # Swift 도우미
    s.node(250, 130, 165, 64, 'fn-listener', ['CGEventTap', '듣기만 (키를 막지 않음)'], tag='Swift')
    s.node(250, 216, 165, 68, 'permissions', ['⌘V 입력 · 권한 확인', '앞에 있는 앱 이름'], tag='Swift')

    # Electron 앱
    s.group(450, 100, 285, 630, 'Meeting Recorder (Electron)', dash=None, fill='panel')
    s.node(468, 132, 250, 250, '메인 프로세스', [
        'fn 상태 머신 (0.5초 규칙)',
        '녹음 WAV 저장 · 말소리 길이 측정',
        '받아쓰기: 인식 → 다듬기 → 입력',
        '회의 파이프라인 (minutes.js)',
        '엔진 설치 · 샌드박스 (setup.js)',
        '녹음 재생 rec:// (Range)',
        '처음 설정 중 fn 막기',
        '고아 프로세스 정리',
        '메뉴바',
    ], tag='src/main.js')
    s.node(468, 420, 250, 150, '메인 창', [
        '화면 · 처음 설정 · ⌘K · 설정',
        '녹음: getUserMedia → AudioWorklet',
        '48kHz · 100ms 조각을 IPC로',
        '회의 재생 · 확인 필요 · 채팅',
    ], tag='src/renderer')
    s.node(468, 600, 250, 110, '플로팅 독', ['항상 표시 · 화면 왼쪽', '받아쓰기 진행 띠', '회의 녹음 시간 (일시정지 반영)'], tag='src/overlay')

    # 샌드박스
    s.group(765, 100, 225, 385, '샌드박스 (sandbox-exec)', stroke='voice', dash='6 4', fill='sand', label_color='voice')
    s.node(778, 134, 199, 104, 'whisper-server', ['받아쓰기 turbo (상주)', '회의 large-v3 (회의 때만)', '쓰기: 임시 · 망: 127.0.0.1만'], tag='C++')
    s.node(778, 252, 199, 104, 'diarize.py', ['pyannote 화자 구분', '앱 전용 파이썬 3.12', '쓰기: 임시 · 망: 차단'], tag='Python')
    s.node(778, 370, 199, 104, '설치 도구', ['uv → 파이썬 → pyannote', '모델 받기 (setup.js가 실행)', '쓰기: 앱 폴더 · 망: 허용'])

    s.node(765, 505, 225, 72, 'Claude Code / Codex', ['로그인된 구독 · 도구 끔 · 읽기 전용', '없으면 Anthropic API 키'], tag='CLI')

    s.cyl(765, 640, 108, 150, '녹음 폴더', ['회의 WAV·회의록', 'dictations.jsonl', 'settings.json', '(사용자가 위치 선택)'])
    s.cyl(882, 640, 108, 150, '앱 폴더', ['모델 4GB', '파이썬·pyannote', '설정·토큰(암호화)', '(고정)'])

    # 인터넷
    s.node(1042, 380, 166, 82, 'Hugging Face', ['GitHub (uv) · PyPI', 'Homebrew'], stroke='warn')
    s.node(1042, 505, 166, 72, 'Anthropic · OpenAI', ['다듬기·회의록 (글만)'], stroke='text')
    s.node(1042, 600, 166, 60, 'Anthropic API', ['키가 있을 때만'], stroke='text', dash='5 4')

    # 화살표
    s.arrow([(210, 158), (250, 158)], 'ink3', '키')
    s.arrow([(415, 158), (468, 158)], 'ink3', 'down/up')
    s.arrow([(210, 455), (468, 455)], 'voice', '음성', at=(339, 455))
    s.arrow([(593, 420), (593, 382)], 'voice', '100ms 조각', at=(593, 401), lx=46, ly=4)
    s.arrow([(210, 540), (468, 540)], 'ink3', '클릭', at=(339, 540))
    s.arrow([(468, 262), (415, 262)], 'text', '글+⌘V', at=(441, 262))
    s.arrow([(250, 250), (210, 250)], 'text', '입력')
    s.arrow([(700, 382), (700, 400), (728, 400), (728, 655), (718, 655)], 'ink3')
    s.arrow([(718, 172), (778, 172)], 'voice', 'WAV', at=(748, 172))
    s.arrow([(778, 206), (718, 206)], 'text', '글', at=(748, 206))
    s.arrow([(718, 290), (778, 290)], 'voice', '16k WAV', at=(748, 290))
    s.arrow([(778, 324), (718, 324)], 'ink3', '화자 구간', at=(748, 324))
    s.arrow([(718, 360), (742, 360), (742, 541), (765, 541)], 'text', '글', at=(742, 450), lx=-4, anchor='end')
    s.arrow([(990, 541), (1042, 541)], 'text')
    s.arrow([(742, 541), (742, 628), (1042, 628)], 'text', '키가 있을 때', at=(900, 628), dash='5 4')
    s.arrow([(718, 375), (754, 375), (754, 700), (765, 700)], 'ink3')
    s.arrow([(977, 422), (1042, 422)], 'warn', '내려받기', at=(1010, 422), dash='5 4')
    s.text(40, 840, '녹음·회의록·받아쓰기 데이터는 녹음 폴더에, 모델·환경은 앱 폴더에. 샌드박스 프로그램은 앱 폴더를 읽기만 한다.', 11.5, 'ink3')
    legend(s, 40, 874)
    return s.render('전체 구조', '프로세스 · 샌드박스 경계 · 저장소 · 바깥으로 나가는 것')


# ── 2. 받아쓰기 ────────────────────────────────────────────────────
def dictation(t):
    s = Svg(1240, 640, t)
    steps = [
        ('fn 꾹 누름', ['바로 듣기 시작', '첫 음절이 안 잘리게'], 'ink3', '0'),
        ('말하기', ['48kHz · 100ms 조각', '말소리 길이 측정'], 'voice', '말하는 동안'),
        ('fn 뗌', ['0.5초 이상 눌렀으면', '끝내고 처리'], 'ink3', ''),
        ('무음 판정', ['-50dBFS 이상이', '0.3초 미만이면 버림'], 'ink3', '즉시'),
        ('Whisper turbo', ['샌드박스 · 127.0.0.1', '지어낸 문장 거르기'], 'voice', '약 0.3초'),
        ('다듬기', ['Claude Code → Codex', '→ API 키 (600자씩 나눔)'], 'text', '2.5~5초'),
        ('입력', ['클립보드 + ⌘V', '0.6초 뒤 클립보드 복원'], 'text', '약 0.4초'),
        ('기록', ['음성은 지움', '글·통계 데이터만'], 'ok', ''),
    ]
    x0, y0, w, h, gap = 28, 96, 136, 96, 15
    for i, (title, lines, color, time) in enumerate(steps):
        x = x0 + i * (w + gap)
        s.node(x, y0, w, h, title, lines, stroke=color if color != 'ink3' else 'line', title_color='ink')
        if time:
            s.text(x + w / 2, y0 + h + 22, time, 12, color if color != 'ink3' else 'ink2', 650, 'middle', mono=True)
        if i < len(steps) - 1:
            s.arrow([(x + w, y0 + h / 2), (x + w + gap, y0 + h / 2)], 'ink3')
    s.text(28, 250, '말이 없으면 4단계에서 끝 ("들린 말이 없습니다") · 다듬기 계정이 없으면 들린 그대로 입력 · 입력하지 못하면 클립보드에 남김', 12, 'ink3')

    # fn 규칙 (시간 축)
    s.group(28, 280, 1184, 330, 'fn 규칙 — Wispr Flow와 같은 500ms 기준 (앱 코드에서 확인한 DICTATION_DEBOUNCE_DELAY)', dash=None, fill='panel')
    ax0, ax1, px = 330, 1150, (1150 - 330) / 2000  # 0~2000ms
    rows = [
        ('꾹 누르기', '0.5초 이상 누르고 뗌 → 입력', [(0, 1400, 'press')], [(1400, '뗌 → 처리', 'text')]),
        ('톡', '0.5초 안에 뗌 → 0.5초 더 기다렸다 버림', [(0, 200, 'press')], [(700, '두 번째 누름 없음 → 버림', 'voice')]),
        ('두 번', '0.5초 안에 다시 누름 → 손 떼도 계속 (잠금)', [(0, 150, 'press'), (330, 430, 'press'), (430, 1700, 'lock')], [(1800, '다시 누르면 끝·입력', 'text')]),
        ('세 번', '잠긴 뒤 시작 0.5초 안에 또 누름 → 취소', [(0, 120, 'press'), (240, 330, 'press'), (330, 430, 'lock'), (430, 520, 'press')], [(560, '취소', 'voice')]),
    ]
    for i, (name, desc, segs, marks) in enumerate(rows):
        y = 335 + i * 62
        s.text(48, y + 5, name, 14, 'ink', 650)
        s.text(48, y + 24, desc, 11.5, 'ink2')
        s.add(f'<line x1="{ax0}" y1="{y}" x2="{ax1}" y2="{y}" stroke="{t["line"]}" stroke-width="1"/>')
        for a, b, kind in segs:
            col = t['voice'] if kind == 'press' else t['ok']
            op = '1' if kind == 'press' else '0.55'
            s.add(f'<rect x="{ax0 + a*px}" y="{y-9}" width="{max(3,(b-a)*px)}" height="18" rx="4" fill="{col}" opacity="{op}"/>')
        for ms, label, color in marks:
            s.add(f'<line x1="{ax0+ms*px}" y1="{y-14}" x2="{ax0+ms*px}" y2="{y+14}" stroke="{t[color]}" stroke-width="2"/>')
            s.text(ax0 + ms * px + 6, y - 14, label, 11, color, 600)
    # 500ms 눈금
    for ms in (0, 500, 1000, 1500, 2000):
        x = ax0 + ms * px
        s.add(f'<line x1="{x}" y1="560" x2="{x}" y2="566" stroke="{t["ink3"]}"/>')
        s.text(x, 582, f'{ms/1000:.1f}초', 10.5, 'ink3', 400, 'middle', mono=True)
    s.add(f'<line x1="{ax0+500*px}" y1="318" x2="{ax0+500*px}" y2="556" stroke="{t["warn"]}" stroke-dasharray="4 4"/>')
    s.text(ax0 + 500 * px + 6, 318, '0.5초', 11, 'warn', 650)
    s.add(f'<rect x="{ax0}" y="596" width="22" height="10" rx="3" fill="{t["voice"]}"/>')
    s.text(ax0 + 28, 605, '누름', 11, 'ink2')
    s.add(f'<rect x="{ax0+80}" y="596" width="22" height="10" rx="3" fill="{t["ok"]}" opacity="0.55"/>')
    s.text(ax0 + 108, 605, '손을 떼도 듣는 중 (잠금)', 11, 'ink2')
    s.text(ax0 + 300, 605, '처리 중 누름은 무시 · 최대 20분 (19분에 경고) · 처음 설정 중에는 연습 단계에서만', 11, 'ink3')
    return s.render('받아쓰기 흐름', 'fn을 누르고 글이 커서 위치에 들어가기까지 (시간은 이 Mac 실측)')


# ── 3. 회의록 ──────────────────────────────────────────────────────
def meeting(t):
    s = Svg(1240, 760, t)
    # 1행: 녹음 → 판정 → 변환
    s.node(28, 96, 190, 96, '회의 녹음 종료', ['mic.wav 48kHz', 'meta.json (참석 인원)', '일시정지 구간은 빠짐'], stroke='voice')
    s.node(250, 112, 130, 64, '10초 이상?', ['아니면 "짧은 녹음"', '으로 저장만'])
    s.node(412, 96, 170, 96, '16kHz 변환', ['3샘플 평균', '1시간 345 → 115MB'])
    s.arrow([(218, 144), (250, 144)], 'voice')
    s.arrow([(380, 144), (412, 144)], 'voice', '예', at=(396, 144))

    # 2행: 동시 진행
    s.group(612, 82, 600, 236, '동시 진행 · 2시간 회의 약 18분 30초', dash=None, fill='panel')
    s.node(630, 116, 270, 88, 'Whisper large-v3', ['회의 때만 띄우는 전용 서버 (샌드박스)', '약 10분 조각 · 조용한 곳(±5초)에서 자름', '같은 문장 반복 구간은 앞 문장 없이 다시'], stroke='voice')
    s.node(924, 116, 270, 88, 'pyannote 화자 구분', ['파일 전체를 한 번에 (조각마다 하면', '"화자 1"이 달라짐) · 참석 인원 · Mac GPU'], stroke='voice')
    s.node(630, 224, 564, 76, '원본 스크립트 조립 (1초 미만)', ['문장마다 가장 많이 겹치는 화자, 없으면 앞뒤 2초 안 가장 가까운 화자 · 같은 말 반복 합치기',
                                                          '→ [mm:ss] [화자 N] 말  ·  transcript.txt · segments.json · diarization.json'])
    s.arrow([(582, 144), (630, 144)], 'voice')
    s.arrow([(582, 170), (600, 170), (600, 72), (1059, 72), (1059, 116)], 'voice')
    s.arrow([(765, 204), (765, 224)], 'text')
    s.arrow([(1059, 204), (1059, 224)], 'ink3')

    # 3행: LLM 동시 작성
    s.group(28, 344, 1184, 140, '로그인된 Claude Code / Codex로 동시 작성 · 약 1분 30초', dash=None, fill='panel')
    s.node(46, 378, 360, 88, '정리본', ['맞장구·하다 만 말·잡담을 쳐내고 같은 사람 말을 합침', '2,500자씩 화자가 바뀌는 곳에서 나눠 4개씩 동시', 'script-clean.txt (2시간 3,100줄 → 361줄)'], stroke='text')
    s.node(426, 378, 360, 88, '회의록 초안', ['요약 · 논의 내용 · 결정 사항 · 할 일 · 확인 필요', '중요한 결정·숫자에 (mm:ss) → 눌러서 듣기', 'minutes.md · 약 45초'], stroke='text')
    s.node(806, 378, 388, 88, '확인 필요 목록 (약 10초)', ['회의록의 "확인 필요"를 항목으로: 오인식 · 이름 · 의미 불명 · 유실', '고칠 말 추정은 녹취에 실제 있는 글자만', 'review.json  →  알림 "초안 · 확인 N개"'], stroke='text')
    s.arrow([(912, 300), (912, 330), (226, 330), (226, 378)], 'text')
    s.arrow([(912, 330), (606, 330), (606, 378)], 'text')
    s.arrow([(786, 422), (806, 422)], 'text')

    # 4행: 사용자 확인
    s.group(28, 510, 1184, 230, '사용자 확인 → 확정 (원할 때, 회의록은 그 전에도 쓸 수 있다)', dash='5 4', fill='bg')
    s.node(46, 548, 270, 92, '추정대로 적용 / 직접 고치기', ['녹취·정리본·회의록 본문의 같은 글자를', '모두 바꿈 · 여러 개 한꺼번에', '처음 한 번 *.before-review.* 보관'])
    s.node(334, 548, 270, 92, '채팅으로 확인', ['고른 항목 시각 앞뒤 ±45초 녹취만', '넘겨 LLM이 고칠 말 제안', '제안은 바로 적용 · 채팅 요지 저장'])
    s.node(622, 548, 270, 92, '그대로 두기', ['기억나지 않음 · 녹음 유실', '나중에 다시 열 수 있음'])
    s.node(918, 548, 276, 170, '확인 마치기 → 확정', ['남은 항목은 그대로 둔 것으로',
                                                    '문장에 영향 있는 결과만 반영:',
                                                    '채팅으로 밝혀진 내용 · 고친 이름',
                                                    '→ 해당 문장만 고쳐 씀 (약 26초)',
                                                    '단어만 고쳤으면 다시 쓰지 않음',
                                                    'minutes.before-finalize.md 보관'], stroke='ok')
    s.arrow([(1000, 466), (1000, 548)], 'ink3', '사용자', at=(1000, 505), lx=26)
    for x in (181, 469, 757):
        s.arrow([(x, 640), (x, 680), (918, 680)], 'ink3')
    s.text(46, 708, '회의 페이지에서 시각을 누르면 그 부분부터 녹음을 들으며 확인할 수 있다 · 화자 이름은 제목 아래 막대에서 바꾸면 전체에 반영', 11.5, 'ink3')
    return s.render('회의록 흐름', '녹음 종료부터 확정까지 (시간은 2시간 5분 1:1 면담, 이 Mac 실측)')


for name, fn in (('architecture', architecture), ('dictation-flow', dictation), ('meeting-flow', meeting)):
    for theme, t in THEMES.items():
        (OUT / f'{name}-{theme}.svg').write_text(fn(t), encoding='utf-8')
print('ok')
