// 녹음 폴더를 읽을 수 없을 때 빈 목록 대신 (옛 folderEmpty와 같은 마크업)
import type { Issue } from './model.ts';

export function FolderEmpty({ issue }: { readonly issue: Issue }) {
  return (
    <div className="empty">
      <b>{issue.title}</b>
      {issue.detail}
      {issue.action ? <br /> : null}
      {issue.action ? <button className="btn" onClick={issue.onAction}>{issue.action}</button> : null}
    </div>
  );
}
