// 평가 질문과 정답 규칙 (오늘 = 2026-11-06). 정답은 회의 메타데이터로 계산한다.
// 주제: 회의의 주 주제이거나 녹취에서 곁다리로 언급한 회의도 "관련 있음"으로 본다 (요약에 없는 언급까지 찾는지 보려고).
// 질문이 "주로 다룬"처럼 정도를 밝히면(focus: 'main') 곁다리 언급은 정답이 아니다. levelOf로 정답 등급(main/mention)도 매긴다.
// 실제 회의(real)의 주제는 실행할 때 eval-runs/real-labels.json에서 읽는다 (회의 내용이 저장소에 올라가지 않게).

const inRange = (m, from, to) => m.at >= new Date(from).toISOString() && m.at < new Date(to).toISOString();
const hasTopic = (m, t) => m.meta.topic === t || m.meta.mention === t || (m.meta.topics ?? []).includes(t);
const ACTIVE = (m) => m.status !== 'short';

export const QUERIES = [
  // 날짜만
  { id: 'q01', cat: 'date', q: '2025년 2월에 한 회의', gold: (m) => inRange(m, '2025-02-01', '2025-03-01') },
  { id: 'q02', cat: 'date', q: '작년 여름에 한 회의들', gold: (m) => inRange(m, '2025-06-01', '2025-09-01') },
  { id: 'q03', cat: 'date', q: '올해 1분기 회의', gold: (m) => inRange(m, '2026-01-01', '2026-04-01') },
  { id: 'q04', cat: 'date', q: '2024년 마지막 달 회의', gold: (m) => inRange(m, '2024-12-01', '2025-01-01') },
  // 주제 (흔한 말)
  { id: 'q05', topic: 'perf', cat: 'topic', q: '성능 시험이나 성능 평가 관련 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'perf') },
  { id: 'q06', topic: 'hiring', cat: 'topic', q: '채용 면접 관련 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'hiring') },
  { id: 'q07', topic: 'budget', cat: 'topic', q: '클라우드 비용 줄이는 얘기한 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'budget') },
  { id: 'q08', topic: 'incident', cat: 'topic', q: '장애 회고 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'incident') },
  { id: 'q09', topic: 'handover', cat: 'topic', q: '인수인계한 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'handover') },
  // 주제 (돌려 말함)
  { id: 'q10', topic: 'perf', cat: 'paraphrase', q: '사람이 몰려도 서버가 버티는지 본 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'perf') },
  { id: 'q11', topic: 'hiring', cat: 'paraphrase', q: '새 사람 뽑는 얘기 나눈 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'hiring') },
  { id: 'q12', topic: 'incident', cat: 'paraphrase', q: '서비스가 멈췄던 일 얘기한 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'incident') },
  { id: 'q13', topic: 'career', cat: 'paraphrase', q: '개발자 진로 고민 상담한 대화', gold: (m) => ACTIVE(m) && hasTopic(m, 'career') },
  // 날짜 + 주제
  { id: 'q14', topic: 'hiring', cat: 'combo', q: '2025년 하반기 채용 관련 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'hiring') && inRange(m, '2025-07-01', '2026-01-01') },
  { id: 'q15', topic: 'incident', cat: 'combo', q: '올해 장애 관련 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'incident') && inRange(m, '2026-01-01', '2027-01-01') },
  { id: 'q16', topic: 'security', cat: 'combo', q: '작년 보안 점검 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'security') && inRange(m, '2025-01-01', '2026-01-01') },
  { id: 'q17', topic: 'perf', cat: 'combo', q: '이번 달 성능 시험 관련 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'perf') && inRange(m, '2026-11-01', '2026-12-01') },
  // 상태
  { id: 'q18', topic: 'deploy', cat: 'status', q: '확인이 아직 안 끝난 배포 관련 회의', gold: (m) => hasTopic(m, 'deploy') && (m.status === 'open' || m.status === 'draft') },
  { id: 'q19', cat: 'status', q: '회의록 만들다 실패한 녹음', gold: (m) => m.status === 'fail' },
  // 곁다리 언급
  { id: 'q20', topic: 'customer', cat: 'topic', q: '고객사 계약 얘기가 나온 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'customer') },
  // 정도를 밝힌 질문: '주로 다룬'이면 곁다리 언급은 정답이 아니다
  { id: 'q21', topic: 'perf', focus: 'main', cat: 'focus', q: '성능 시험을 주로 다룬 회의', gold: (m) => ACTIVE(m) && (m.meta.topic === 'perf' || (m.meta.topics ?? []).includes('perf')) },
  { id: 'q22', topic: 'hiring', cat: 'focus', q: '채용 얘기가 잠깐이라도 나온 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'hiring') },
];

// 정답 회의가 그 주제를 주로 다뤘는지(main), 잠깐 언급했는지(mention)
export function levelOf(m, topic) {
  if (!topic) return null;
  if (m.meta.topic === topic || (m.meta.topics ?? []).includes(topic)) return 'main';
  if (m.meta.mention === topic) return 'mention';
  return null;
}
