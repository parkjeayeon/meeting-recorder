// mr 실행 시작점 (Contents/Resources/mr → 앱 안의 Node로 이 파일). 명령 처리는 mr.mts
import { main } from './mr.mjs';

process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0); // `mr script latest | head`처럼 읽는 쪽이 먼저 끝난 경우
  throw err;
});
process.exitCode = main(process.argv.slice(2));
