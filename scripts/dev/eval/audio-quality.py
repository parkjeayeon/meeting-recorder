#!/usr/bin/env python3 -I
# 녹음 원본(WAV)과 압축본(AAC)의 받아쓰기 품질을 정답 없이 통계로 비교한다 (docs/measurements.md).
#   python3 -I scripts/dev/eval/audio-quality.py run  <회의 폴더> <이름> [비트레이트=96000]  → /tmp/aq/<이름>/*.json
#   python3 -I scripts/dev/eval/audio-quality.py stats <이름>...                               → 표
# 회의 폴더는 읽기만 한다. 변형(원본·1·2샘플 밀기·압축·압축+1샘플)은 /tmp/aq에 만들고, 앱과 같은 조건(large-v3, -sns, ko,
# temperature 0, 사전 단어 힌트)으로 5분 구간마다 받아써 Whisper가 낸 단어별 확률·구간 평균 로그확률을 모은다.
# 원본 계열(3)과 압축 계열(2)을 구간별로 짝지어 비교하고, 원본끼리의 차이(1샘플 밀기)를 흔들림 기준으로 둔다.
import json, os, random, re, subprocess, sys, time, urllib.request

OUT = '/tmp/aq'
WIN = 300
MODEL = os.path.expanduser('~/Library/Application Support/meeting-recorder/models/ggml-large-v3.bin')
SETTINGS = os.path.expanduser('~/Documents/MeetingRecorder/settings.json')
PORT = 18777


def sh(*a):
    subprocess.run(a, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def make_variants(src, out, bitrate):
    # 앱처럼 녹음을 16kHz 모노로 줄여 받아쓴다 (압축본은 풀어서 16kHz로)
    v = {}
    for name, shift in (('wav', 0), ('wav+1', 1), ('wav+2', 2)):
        p = f'{out}/{name}.wav'
        af = ['-af', f'adelay={shift}S'] if shift else []
        if not os.path.exists(p): sh('ffmpeg', '-loglevel', 'error', '-y', '-i', src, *af, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', p)
        v[name] = p
    for name, shift in (('aac', 0), ('aac+1', 1)):
        p = f'{out}/{name}.wav'
        if not os.path.exists(p):
            pre = src
            if shift:
                pre = f'{out}/.{name}-src.wav'
                sh('ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-af', f'adelay={shift}S', '-c:a', 'pcm_s16le', pre)
            m4a = f'{out}/.{name}.m4a'
            sh('/usr/bin/afconvert', '-f', 'm4af', '-d', 'aac', '-b', str(bitrate), pre, m4a)
            sh('ffmpeg', '-loglevel', 'error', '-y', '-i', m4a, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', p)
            if pre != src: os.remove(pre)
        v[name] = p
    return v


def post(wav, vocab):
    # multipart를 직접 만든다 (표준 라이브러리만)
    b = '----aq' + str(random.random())[2:]
    parts = []
    def field(k, val): parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{val}\r\n'.encode())
    field('response_format', 'verbose_json'); field('language', 'ko'); field('temperature', '0')
    if vocab: field('prompt', vocab)
    parts.append(f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode() + open(wav, 'rb').read() + b'\r\n')
    parts.append(f'--{b}--\r\n'.encode())
    req = urllib.request.Request(f'http://127.0.0.1:{PORT}/inference', data=b''.join(parts), headers={'Content-Type': f'multipart/form-data; boundary={b}'})
    return json.load(urllib.request.urlopen(req, timeout=3600))


def run(meeting, name, bitrate):
    out = f'{OUT}/{name}'
    os.makedirs(out, exist_ok=True)
    open(f'{out}/meeting.txt', 'w').write(meeting)
    vocab = json.load(open(SETTINGS)).get('vocabulary', '')
    variants = make_variants(f'{meeting}/mic.wav', out, bitrate)
    info = subprocess.run(['/usr/bin/afinfo', variants['wav']], capture_output=True, text=True).stdout
    dur = float(re.search(r'estimated duration: ([\d.]+)', info)[1])
    srv = subprocess.Popen(['/opt/homebrew/bin/whisper-server', '-m', MODEL, '--host', '127.0.0.1', '--port', str(PORT), '-sns', '-t', '8'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(240):
            try: urllib.request.urlopen(f'http://127.0.0.1:{PORT}/', timeout=2); break
            except Exception: time.sleep(0.5)
        for vname, wav in variants.items():
            dst = f'{out}/{vname}.json'
            if os.path.exists(dst): continue
            t0 = time.time(); wins = []
            for i in range(int(dur // WIN) + (1 if dur % WIN > 30 else 0)):
                piece = f'{out}/.piece.wav'
                sh('ffmpeg', '-loglevel', 'error', '-y', '-ss', str(i * WIN), '-t', str(WIN), '-i', wav, '-c:a', 'pcm_s16le', piece)
                r = post(piece, vocab)
                wins.append([{'s': s['start'], 'e': s['end'], 'text': s['text'], 'lp': s.get('avg_logprob'), 'ns': s.get('no_speech_prob'), 'p': [w['probability'] for w in s.get('words', [])]} for s in r.get('segments', [])])
            json.dump({'variant': vname, 'sec': round(time.time() - t0), 'windows': wins}, open(dst, 'w'), ensure_ascii=False)
            print(name, vname, f'{time.time() - t0:.0f}s', flush=True)
    finally:
        srv.terminate()
    for f in os.listdir(out):
        if f.endswith('.wav') or f.endswith('.m4a'): os.remove(f'{out}/{f}')


# ── 통계 ──
def norm(s): return re.sub(r'[\s.,?!~…"\'·]', '', s)


def win_metrics(segs):
    ps = [p for s in segs for p in s['p']]
    texts = [norm(s['text']) for s in segs]
    rep = sum(1 for a, b in zip(texts, texts[1:]) if b and a == b)
    lp_w = sum((s['e'] - s['s']) for s in segs if s['lp'] is not None)
    return {
        'p': sum(ps) / len(ps) if ps else None,  # 단어 평균 확률
        'low': sum(1 for p in ps if p < 0.5) / len(ps) if ps else None,  # 확률 0.5 미만 단어 비율
        'lp': sum(s['lp'] * (s['e'] - s['s']) for s in segs if s['lp'] is not None) / lp_w if lp_w else None,
        'rep': rep,
        'chars': sum(len(t) for i, t in enumerate(texts) if not (i and t == texts[i - 1])),
    }


def wilcoxon(d):
    # 부호 순위 검정 (정규 근사, 0은 뺀다). 표본 수가 작으면 참고만
    d = [x for x in d if abs(x) > 1e-12]
    n = len(d)
    if n < 6: return None
    ranks = sorted(range(n), key=lambda i: abs(d[i]))
    r = [0.0] * n; i = 0
    while i < n:
        j = i
        while j + 1 < n and abs(d[ranks[j + 1]]) == abs(d[ranks[i]]): j += 1
        for k in range(i, j + 1): r[ranks[k]] = (i + j) / 2 + 1
        i = j + 1
    w = sum(r[i] for i in range(n) if d[i] > 0)
    mu = n * (n + 1) / 4; sd = (n * (n + 1) * (2 * n + 1) / 24) ** 0.5
    z = (w - mu) / sd
    import math
    return 2 * (1 - 0.5 * (1 + math.erf(abs(z) / 2 ** 0.5)))


def boot(d, n=5000):
    rnd = random.Random(1)
    ms = sorted(sum(rnd.choice(d) for _ in d) / len(d) for _ in range(n))
    return ms[int(n * 0.025)], ms[int(n * 0.975)]


def stats(names):
    rows = {}
    for name in names:
        out = f'{OUT}/{name}'
        for f in sorted(os.listdir(out)):
            if not f.endswith('.json'): continue
            d = json.load(open(f'{out}/{f}'))
            rows.setdefault(d['variant'], []).extend(win_metrics(w) for w in d['windows'])
    n = len(rows['wav'])
    print(f'구간 {n}개 (5분)\n')
    # 낱말 지표: 확인 필요에서 사람이 고친 항목(고친 말 = 맞는 표기, 들린 말 = 처음 받아쓰기의 잘못된 표기)과 사전 단어가 몇 번 나오나.
    # 들린 말은 처음(원본 WAV) 받아쓰기에서 나온 것이라 원본 계열에 조금 유리할 수 있다
    vocab = [w.strip() for w in json.load(open(SETTINGS)).get('vocabulary', '').split(',') if len(w.strip()) >= 2]
    print('| 변형 | 고친 말(맞는 표기) 나온 수 | 들린 말(잘못된 표기) 나온 수 | 사전 단어 나온 수 |')
    print('|---|---|---|---|')
    for v in ('wav', 'wav+1', 'wav+2', 'aac', 'aac+1'):
        right = wrong = voc = 0
        for name in names:
            out = f'{OUT}/{name}'
            text = ' '.join(s['text'] for w in json.load(open(f'{out}/{v}.json'))['windows'] for s in w)
            flat = norm(text)
            try: items = json.load(open(f"{open(f'{out}/meeting.txt').read()}/review.json"))['items']
            except Exception: items = []
            for it in items:
                if it.get('status') != 'applied' or it.get('kind') not in ('word', 'name') or not it.get('heard') or not it.get('applied'): continue
                right += flat.count(norm(it['applied'])); wrong += flat.count(norm(it['heard']))
            voc += sum(flat.count(norm(w)) for w in vocab)
        print(f'| {v} | {right} | {wrong} | {voc} |')
    print()
    keys = [('p', '단어 평균 확률', 1), ('low', '확률 0.5 미만 단어 비율', -1), ('lp', '구간 평균 로그확률', 1), ('rep', '반복 줄 수', -1), ('chars', '글자 수', 0)]
    print('| 변형 | ' + ' | '.join(k[1] for k in keys) + ' |')
    print('|---|' + '---|' * len(keys))
    for v in ('wav', 'wav+1', 'wav+2', 'aac', 'aac+1'):
        vals = []
        for k, _, _ in keys:
            xs = [r[k] for r in rows[v] if r[k] is not None]
            m = sum(xs) / len(xs)
            vals.append(f'{m * 100:.2f}%' if k in ('p', 'low') else f'{m:.4f}' if k == 'lp' else f'{sum(xs)}')
        print(f'| {v} | ' + ' | '.join(vals) + ' |')
    print('\n짝 비교 (구간마다 차이, 평균 [95% 부트스트랩 구간], 부호 순위 검정 p)\n')
    fam = lambda r, vs, k: [sum(rows[v][i][k] for v in vs) / len(vs) if all(rows[v][i][k] is not None for v in vs) else None for i in range(n)]
    print('| 지표 | 압축 계열 − 원본 계열 | p | (흔들림) 원본+1샘플 − 원본 | p |')
    print('|---|---|---|---|---|')
    for k, label, _ in keys:
        a = fam(rows, ('aac', 'aac+1'), k); w = fam(rows, ('wav', 'wav+1', 'wav+2'), k)
        d = [x - y for x, y in zip(a, w) if x is not None and y is not None]
        e = [rows['wav+1'][i][k] - rows['wav'][i][k] for i in range(n) if rows['wav+1'][i][k] is not None and rows['wav'][i][k] is not None]
        sc = 100 if k in ('p', 'low') else 1
        f = lambda xs: f'{sum(xs) / len(xs) * sc:+.3f} [{boot(xs)[0] * sc:+.3f}, {boot(xs)[1] * sc:+.3f}]'
        pw = wilcoxon(d); pe = wilcoxon(e)
        fp = lambda x: '-' if x is None else f'{x:.3f}'
        print(f'| {label}{" (%p)" if sc == 100 else ""} | {f(d)} | {fp(pw)} | {f(e)} | {fp(pe)} |')


if __name__ == '__main__':
    if sys.argv[1] == 'run': run(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 96000)
    else: stats(sys.argv[2:])
