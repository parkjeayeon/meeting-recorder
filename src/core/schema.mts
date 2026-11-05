// 회의 폴더 파일과 명령줄 도구 출력의 모양 (TypeBox → JSON Schema + TypeScript 타입).
// 파일 쪽은 앱이 쓰는 필드만 느슨하게 본다(다른 필드가 더 있어도 된다). 맞지 않으면 그 파일은 없는 것으로 본다.
// 출력 쪽은 에이전트가 기대어 쓰는 약속이다: `mr schema`로 그대로 내보내고, 테스트가 실제 출력을 이걸로 검사한다.
import Type from 'typebox';

const Nullable = <T extends Type.TSchema>(t: T) => Type.Union([t, Type.Null()]);

// ── 회의 폴더 파일 ──────────────────────────────────────────────
export const MetaFile = Type.Object({
  mode: Type.Optional(Type.String()), // 'meeting' | 'memo'
  startedAt: Type.String(),
  endedAt: Type.Optional(Nullable(Type.String())),
  files: Type.Optional(Type.Record(Type.String(), Type.Object({ file: Type.Optional(Type.String()), durationSec: Type.Optional(Type.Number()) }))),
  speakers: Type.Optional(Nullable(Type.Union([Type.Number(), Type.String()]))), // 녹음할 때 정한 참석 인원
  speakerNames: Type.Optional(Type.Record(Type.String(), Type.String())),
});
export type MetaFile = Type.Static<typeof MetaFile>;

export const MinutesStateFile = Type.Object({
  status: Type.String(), // queued | transcribe | write | done | error | short
  speakers: Type.Optional(Nullable(Type.Number())),
  error: Type.Optional(Nullable(Type.String())),
});
export type MinutesStateFile = Type.Static<typeof MinutesStateFile>;

export const ReviewFile = Type.Object({
  items: Type.Array(Type.Object({ status: Type.String() })),
  finalizedAt: Type.Optional(Nullable(Type.String())),
});
export type ReviewFile = Type.Static<typeof ReviewFile>;

const ActionItem = Type.Object({
  id: Type.String(),
  owner: Nullable(Type.String()),
  task: Type.String(),
  due: Nullable(Type.String()),
  kind: Type.String({ description: 'promise(약속) | assigned(맡은 일) | resolution(다짐)' }),
  at: Nullable(Type.String({ description: '녹취 시각 mm:ss' })),
  quote: Type.Optional(Nullable(Type.String({ description: '근거가 된 녹취 문장' }))),
  done: Type.Boolean(),
});
const AdviceItem = Type.Object({
  id: Type.String(),
  group: Type.Optional(Nullable(Type.String())),
  key: Type.Optional(Type.Boolean({ description: '이 대화에서 가장 중요한 것' })),
  why: Type.Optional(Nullable(Type.String())),
  from: Type.Optional(Nullable(Type.String())),
  to: Type.Optional(Nullable(Type.String())),
  text: Type.String(),
  at: Type.Optional(Nullable(Type.String())),
  quote: Type.Optional(Nullable(Type.String())),
});
// 파일은 느슨하게 본다 (예전 형식·빠진 필드가 있어도 앱 화면처럼 보여 준다). 출력은 위 ActionItem·AdviceItem 모양으로 맞춘다
export const ActionsFile = Type.Object({
  kind: Type.Optional(Nullable(Type.String())),
  adviceTitle: Type.Optional(Nullable(Type.String())),
  actions: Type.Array(Type.Object({ task: Type.String() })),
  advice: Type.Optional(Type.Array(Type.Object({ text: Type.String() }))),
});
export type ActionsFile = Type.Static<typeof ActionsFile>;

// ── 명령줄 도구 출력 ────────────────────────────────────────────
const Review = Nullable(Type.Object({ open: Type.Integer(), total: Type.Integer(), finalized: Type.Boolean() }, { description: '확인 필요: 남은 항목·전체·확인 마침 여부' }));
const Status = Type.String({ description: '회의록 상태: none(없음) | queued | transcribe | write | done | error | short(너무 짧아 안 만듦). 앱이 꺼진 동안 끊긴 작업은 진행 중으로 남아 있을 수 있다' });

export const MeetingSummary = Type.Object({
  id: Type.String({ description: '회의 폴더 이름. 다른 명령에 그대로 넘긴다' }),
  startedAt: Type.String(),
  durationSec: Type.Number(),
  title: Nullable(Type.String()),
  summary: Nullable(Type.String({ description: '회의록의 요약 (화자 이름 반영)' })),
  status: Status,
  speakers: Nullable(Type.Integer({ description: '화자 구분이 찾은 화자 수' })),
  review: Review,
  has: Type.Object({ minutes: Type.Boolean(), actions: Type.Boolean(), script: Type.Boolean(), transcript: Type.Boolean() }),
});
export type MeetingSummary = Type.Static<typeof MeetingSummary>;

export const ListOutput = Type.Object({
  root: Type.String({ description: '녹음 폴더' }),
  meetings: Type.Array(MeetingSummary, { description: '최근 회의부터' }),
});
export type ListOutput = Type.Static<typeof ListOutput>;

export const MinutesOutput = Type.Object({
  id: Type.String(),
  title: Nullable(Type.String()),
  status: Status,
  review: Review,
  markdown: Type.String({ description: '회의록 전체 (화자 이름 반영)' }),
});
export type MinutesOutput = Type.Static<typeof MinutesOutput>;

export const ActionsOutput = Type.Object({
  id: Type.String(),
  kind: Nullable(Type.String({ description: 'work | counsel' })),
  adviceTitle: Nullable(Type.String({ description: "advice 묶음 이름 ('알아 둘 것' 또는 '받은 조언')" })),
  actions: Type.Array(ActionItem, { description: '할 일 (owner·task는 화자 이름 반영)' }),
  advice: Type.Array(AdviceItem),
});
export type ActionsOutput = Type.Static<typeof ActionsOutput>;

export const ScriptOutput = Type.Object({
  id: Type.String(),
  source: Type.Union([Type.Literal('clean'), Type.Literal('raw')], { description: 'clean: 가지치기한 정리본, raw: 원본 녹취' }),
  lines: Type.Array(Type.Object({
    at: Nullable(Type.Number({ description: '회의 시작부터 초' })),
    stamp: Type.String({ description: 'mm:ss 또는 h:mm:ss' }),
    speaker: Nullable(Type.String({ description: '화자 이름 반영' })),
    text: Type.String(),
  })),
});
export type ScriptOutput = Type.Static<typeof ScriptOutput>;

export const SpeakersOutput = Type.Object({
  id: Type.String(),
  speakers: Type.Array(Type.Object({
    label: Type.String({ description: "녹취 파일 안의 표시 ('화자 1' 등)" }),
    name: Type.String({ description: '앱에서 바꾼 이름 (없으면 label)' }),
    sec: Type.Number({ description: '말한 시간(초), 스크립트 줄 간격으로 어림' }),
    lines: Type.Integer(),
    first: Type.String({ description: '처음 말한 시각' }),
  }), { description: '많이 말한 순서' }),
});
export type SpeakersOutput = Type.Static<typeof SpeakersOutput>;

export const ErrorOutput = Type.Object({
  error: Type.Object({
    code: Type.String({ description: 'USAGE | NOT_FOUND | AMBIGUOUS | NOT_READY | NO_ACCESS' }),
    message: Type.String(),
    hint: Type.Optional(Type.String()),
  }),
});
export type ErrorOutput = Type.Static<typeof ErrorOutput>;
