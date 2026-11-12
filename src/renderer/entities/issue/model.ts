/** 확인해야 할 문제 (권한·엔진·토큰·녹음 폴더). 홈 맨 위와 설정 점으로 보인다. sec: 설정의 어느 칸인지 */
export interface Issue {
  readonly title: string;
  readonly detail?: string | null;
  readonly action?: string | null;
  readonly onAction?: () => void;
  readonly dismiss?: boolean;
  readonly sec?: string;
}
