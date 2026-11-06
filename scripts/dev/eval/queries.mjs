// 평가 질문과 정답 규칙 (오늘 = 2026-11-06). 정답은 회의 메타데이터로 계산한다.
// 주제: 회의의 주 주제이거나 녹취에서 곁다리로 언급한 회의도 "관련 있음"으로 본다 (요약에 없는 언급까지 찾는지 보려고).
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
  { id: 'q05', cat: 'topic', q: '성능 시험이나 성능 평가 관련 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'perf') },
  { id: 'q06', cat: 'topic', q: '채용 면접 관련 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'hiring') },
  { id: 'q07', cat: 'topic', q: '클라우드 비용 줄이는 얘기한 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'budget') },
  { id: 'q08', cat: 'topic', q: '장애 회고 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'incident') },
  { id: 'q09', cat: 'topic', q: '인수인계한 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'handover') },
  // 주제 (돌려 말함)
  { id: 'q10', cat: 'paraphrase', q: '사람이 몰려도 서버가 버티는지 본 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'perf') },
  { id: 'q11', cat: 'paraphrase', q: '새 사람 뽑는 얘기 나눈 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'hiring') },
  { id: 'q12', cat: 'paraphrase', q: '서비스가 멈췄던 일 얘기한 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'incident') },
  { id: 'q13', cat: 'paraphrase', q: '개발자 진로 고민 상담한 대화', gold: (m) => ACTIVE(m) && hasTopic(m, 'career') },
  // 날짜 + 주제
  { id: 'q14', cat: 'combo', q: '2025년 하반기 채용 관련 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'hiring') && inRange(m, '2025-07-01', '2026-01-01') },
  { id: 'q15', cat: 'combo', q: '올해 장애 관련 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'incident') && inRange(m, '2026-01-01', '2027-01-01') },
  { id: 'q16', cat: 'combo', q: '작년 보안 점검 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'security') && inRange(m, '2025-01-01', '2026-01-01') },
  { id: 'q17', cat: 'combo', q: '이번 달 성능 시험 관련 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'perf') && inRange(m, '2026-11-01', '2026-12-01') },
  // 상태
  { id: 'q18', cat: 'status', q: '확인이 아직 안 끝난 배포 관련 회의', gold: (m) => hasTopic(m, 'deploy') && (m.status === 'open' || m.status === 'draft') },
  { id: 'q19', cat: 'status', q: '회의록 만들다 실패한 녹음', gold: (m) => m.status === 'fail' },
  // 곁다리 언급
  { id: 'q20', cat: 'topic', q: '고객사 계약 얘기가 나온 회의', gold: (m) => ACTIVE(m) && hasTopic(m, 'customer') },
];
