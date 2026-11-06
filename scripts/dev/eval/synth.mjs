// 검색 평가용 가짜 회의 (지어낸 내용). 회의마다 주제·표현 방식·곁다리 언급을 메타데이터로 남겨 정답을 계산한다.
// 같은 씨앗이면 같은 회의가 나온다.

export const TOPICS = {
  perf: {
    titles: ['성능 시험 결과 공유', '성능 평가 준비', '부하 테스트 리뷰', '응답 시간 개선 회의'],
    canon: ['성능 시험 결과 응답 시간이 목표보다 0.4초 늦었습니다', '부하 테스트에서 TPS가 1200까지 나왔어요', '성능 평가 항목을 다시 정리하죠', '성능 시험 일정은 다음 주 화요일입니다'],
    para: ['사람이 한꺼번에 몰려도 서버가 버티는지 돌려 봤는데 생각보다 괜찮았어요', '동시에 천 명 들어오면 화면이 느려지는지 확인해 봐야 해요', '속도 재 보니까 목표보다 조금 늦게 나오네요', '어제 밤에 일부러 요청을 왕창 보내 봤거든요'],
    summaryCanon: '성능 시험 결과와 응답 시간 목표 달성 여부를 확인했습니다.',
    summaryPara: '사용자가 몰릴 때 서버가 버티는지 직접 돌려 본 결과를 나눴습니다.',
  },
  hiring: {
    titles: ['채용 면접 정리', '백엔드 채용 논의', '면접 후보 검토'],
    canon: ['채용 공고는 이번 주에 올리겠습니다', '면접 본 지원자 두 명 중 한 명을 합격으로 하죠', '채용 일정이 밀리고 있어요'],
    para: ['새로 올 사람 뽑는 거 언제까지 끝낼까요', '이력서 세 개 봤는데 다음 주에 직접 만나 보기로 해요', '연봉 제안 범위를 정해야 해요'],
    summaryCanon: '채용 공고와 면접 결과를 정리하고 다음 단계를 정했습니다.',
    summaryPara: '새로 합류할 사람을 찾는 일정과 처우를 이야기했습니다.',
  },
  budget: {
    titles: ['예산 검토', '클라우드 비용 절감', '분기 비용 점검'],
    canon: ['클라우드 비용이 지난달보다 30% 늘었습니다', '예산 안에서 줄일 항목을 정하죠', '비용 절감 목표는 월 200만 원입니다'],
    para: ['이번 달 청구서가 너무 많이 나왔어요', '안 쓰는 서버 끄면 돈이 꽤 아껴질 거예요', '돈 새는 데를 막아야 해요'],
    summaryCanon: '클라우드 비용 증가 원인과 예산 절감 항목을 살폈습니다.',
    summaryPara: '지출이 늘어난 이유와 아낄 수 있는 부분을 짚었습니다.',
  },
  incident: {
    titles: ['장애 회고', '접속 장애 원인 분석', '재발 방지 회의'],
    canon: ['지난주 장애의 원인은 인증 서버 메모리 부족이었습니다', '장애 회고 문서를 금요일까지 쓰죠', '재발 방지 조치로 알림을 추가합니다'],
    para: ['어제 밤에 서비스가 한 시간 멈췄던 거 얘기해 봐요', '사람들이 접속을 못 했던 이유를 찾았어요', '다시는 이렇게 안 터지게 막아야죠'],
    summaryCanon: '장애 원인과 재발 방지 조치를 정리했습니다.',
    summaryPara: '서비스가 멈췄던 일의 원인과 앞으로의 대비를 이야기했습니다.',
  },
  handover: {
    titles: ['결제 모듈 인수인계', '담당 변경 인수인계', '운영 업무 인수인계'],
    canon: ['인수인계 문서는 위키에 올려 두었습니다', '담당 변경은 다음 주 월요일부터입니다', '인수인계 받을 때 주의할 점을 정리했어요'],
    para: ['이제부터 이 일은 네가 맡아 줘', '그동안 내가 하던 걸 정리해서 넘겨줄게', '넘겨받고 처음 한 주는 옆에서 같이 볼게요'],
    summaryCanon: '업무 인수인계 범위와 일정을 정리했습니다.',
    summaryPara: '맡던 일을 다른 사람에게 넘기는 방법과 일정을 이야기했습니다.',
  },
  career: {
    titles: ['커리어 상담', '진로 상담', '1:1 커리어 이야기'],
    canon: ['커리어 방향을 백엔드로 잡는 게 좋겠어요', '이직을 고민하고 있다고 했죠', '진로 상담 결과를 정리해 볼게요'],
    para: ['앞으로 뭘 해 먹고 살지 고민이에요', '개발을 계속해야 하나 싶어요', '회사를 옮길지 더 있을지 모르겠어요'],
    summaryCanon: '개발자 커리어 방향과 이직 고민을 상담했습니다.',
    summaryPara: '앞으로의 일과 회사를 옮길지에 대한 고민을 나눴습니다.',
  },
  deploy: {
    titles: ['배포 점검', '릴리스 준비', '배포 일정 회의'],
    canon: ['배포는 화요일 오전에 합니다', '릴리스 노트를 정리해 주세요', '문제가 생기면 바로 롤백합니다'],
    para: ['이번에 내보내는 건 범위를 줄이죠', '올렸다가 문제 생기면 바로 되돌리면 돼요', '사용자한테 나가기 전에 한 번 더 봐요'],
    summaryCanon: '배포 범위와 롤백 기준을 정했습니다.',
    summaryPara: '새 버전을 내보내는 범위와 되돌리는 기준을 이야기했습니다.',
  },
  design: {
    titles: ['디자인 리뷰', '화면 시안 검토', 'UI 개선 회의'],
    canon: ['디자인 시안 두 개 중 B안으로 가죠', '디자인 리뷰에서 버튼 위치를 고치기로 했어요'],
    para: ['버튼 위치가 좀 어색해 보여요', '색이 너무 튀어서 눈이 아파요'],
    summaryCanon: '화면 디자인 시안을 검토하고 수정 사항을 정했습니다.',
    summaryPara: '화면이 어색한 부분과 바꿀 점을 짚었습니다.',
  },
  security: {
    titles: ['보안 점검', '취약점 점검 결과', '권한 관리 회의'],
    canon: ['보안 점검에서 취약점 세 개가 나왔습니다', '관리자 권한을 다시 나눠야 해요'],
    para: ['비밀번호가 아무나 볼 수 있게 남아 있었어요', '바깥에서 들어올 수 있는 구멍을 막아야 해요'],
    summaryCanon: '보안 점검 결과와 취약점 조치를 정리했습니다.',
    summaryPara: '외부에서 들어올 수 있는 허점과 막을 방법을 이야기했습니다.',
  },
  planning: {
    titles: ['분기 계획', '로드맵 회의', '내년 계획 논의'],
    canon: ['다음 분기 목표는 세 가지입니다', '로드맵을 다시 그리죠'],
    para: ['다음 석 달 동안 뭘 할지 정해야 해요', '하고 싶은 걸 줄 세워 봐요'],
    summaryCanon: '다음 분기 목표와 로드맵을 정했습니다.',
    summaryPara: '앞으로 몇 달 동안 할 일의 순서를 정했습니다.',
  },
  customer: {
    titles: ['고객사 미팅', '계약 범위 협의', '고객 요구 사항 정리'],
    canon: ['고객사와 계약 범위를 다시 정하기로 했어요', '계약서 초안을 다음 주에 보냅니다'],
    para: ['거기서 원하는 게 처음이랑 달라졌어요', '견적을 다시 보내 달래요'],
    summaryCanon: '고객사 계약 범위와 요구 사항을 확인했습니다.',
    summaryPara: '상대 회사가 원하는 범위와 견적을 다시 이야기했습니다.',
  },
  onboarding: {
    titles: ['온보딩', '신규 입사자 교육', '첫 주 안내'],
    canon: ['신규 입사자 온보딩 문서를 보세요', '온보딩 첫 주에는 개발 환경을 맞춥니다'],
    para: ['처음 온 사람한테 개발 환경부터 맞춰 줘야 해요', '첫 주에 뭘 하면 되는지 알려 줄게요'],
    summaryCanon: '신규 입사자 온보딩 일정과 준비물을 안내했습니다.',
    summaryPara: '처음 온 사람이 첫 주에 할 일을 알려 줬습니다.',
  },
};
const FILLER = ['네 알겠습니다', '그건 다음에 다시 보죠', '오늘은 여기까지 할까요', '잠깐 화면 공유할게요', '음 그러니까요', '좋아요 그렇게 하죠', '자료는 채널에 올릴게요'];
const NEUTRAL_TITLES = ['주간 회의', '목요일 회의', '점심 후 회의', '팀 회의', '짧은 회의'];

function rng(seed) {
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
}

const p2 = (n) => String(n).padStart(2, '0');
const clockOf = (s) => `${p2(Math.floor(s / 60))}:${p2(s % 60)}`;

// 2024-01-02 ~ 2026-10-30 평일에 n개를 고르게 흩뿌린다
export function makeSynthetic(n, seed = 11) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const keys = Object.keys(TOPICS);
  const start = new Date(2024, 0, 2).getTime();
  const end = new Date(2026, 9, 30).getTime();
  const out = [];
  for (let i = 0; i < n; i++) {
    let at = new Date(start + ((end - start) * (i + r() * 0.8)) / n);
    while (at.getDay() === 0 || at.getDay() === 6) at = new Date(at.getTime() + 86400e3);
    at.setHours(9 + Math.floor(r() * 9), [0, 15, 30, 45][Math.floor(r() * 4)], 0, 0);
    const topic = keys[i % keys.length === 0 ? 0 : Math.floor(r() * keys.length)];
    const style = r() < 0.4 ? 'para' : 'canon';
    let mention = r() < 0.3 ? pick(keys.filter((k) => k !== topic)) : null;
    const mentionStyle = r() < 0.5 ? 'para' : 'canon';
    const x = r();
    const status = x < 0.05 ? 'fail' : x < 0.08 ? 'short' : x < 0.2 ? 'open' : x < 0.26 ? 'draft' : 'done';
    const t = TOPICS[topic];
    const lines = [];
    let sec = 5;
    const say = (text) => {
      lines.push(`[${clockOf(sec)}] [화자 ${1 + Math.floor(r() * 3)}] ${text}`);
      sec += 20 + Math.floor(r() * 90);
    };
    const body = style === 'para' ? t.para : t.canon;
    for (let k = 0; k < 14; k++) say(k % 3 === 1 ? pick(FILLER) : pick(body));
    if (mention) {
      const m = TOPICS[mention];
      lines.splice(4 + Math.floor(r() * 8), 0, `[${clockOf(sec + 7)}] [화자 2] 아 그리고 ${pick(mentionStyle === 'para' ? m.para : m.canon)}`);
    }
    if (status === 'short') {
      lines.length = 0;
      mention = null;
    }
    const title = status === 'fail' || status === 'short' ? null : style === 'para' ? pick(NEUTRAL_TITLES) : pick(t.titles);
    const summary = status === 'fail' || status === 'short' ? null : style === 'para' ? t.summaryPara : t.summaryCanon;
    out.push({
      id: `s${String(i).padStart(3, '0')}`, real: false, at: at.toISOString(), status, title, summary,
      minutes: summary ? `# ${title}\n\n## 요약\n${summary}\n\n## 결정 사항\n- 다음 회의에서 다시 확인\n` : '',
      transcript: lines.join('\n'),
      meta: { topic, style, mention: status === 'short' ? null : mention, mentionStyle },
    });
  }
  return out;
}
