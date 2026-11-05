// 파일을 통째로 바꿔 쓴다: 같은 폴더의 임시 파일에 다 쓰고 디스크에 확실히 기록한 뒤 이름을 바꾼다.
// 중간에 실패(디스크 가득 참·강제 종료·전원)해도 원래 파일이 그대로 남고,
// 다른 프로세스(mr)는 언제 읽어도 이전 파일 전체나 새 파일 전체만 본다 (결정 45).
// 끊긴 작업을 이어 주지는 않는다 — 끊기면 그 쓰기는 없던 일이 된다.
import fs from 'node:fs';
import path from 'node:path';

export function writeFileAtomic(file: string, data: string | Uint8Array): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd); // macOS가 아직 디스크에 옮기지 않은 내용이 전원이 꺼지면 날아가지 않게
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file); // 같은 디스크 안에서는 한순간에 바뀐다
  } catch (err) {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

// space 0이면 한 줄로 (segments.json처럼 큰 파일)
export const writeJsonAtomic = (file: string, data: unknown, space = 2) =>
  writeFileAtomic(file, JSON.stringify(data, null, space));

// 보관본 만들기 같은 복사도 반쯤 복사된 파일이 남지 않게
export const copyFileAtomic = (from: string, to: string) => writeFileAtomic(to, fs.readFileSync(from));
