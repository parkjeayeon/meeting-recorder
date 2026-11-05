// A·B를 번갈아 계속 바꿔 쓴다. 부모가 아무 때나 강제 종료(SIGKILL)한다
//   writer.mjs <atomic|plain> <파일> <A 길이> <B 길이> [횟수]
import fs from 'node:fs';
import { writeFileAtomic } from '../../../lib/core/write.mjs';

const [mode, file, lenA, lenB, times] = process.argv.slice(2);
const A = 'a'.repeat(Number(lenA));
const B = 'b'.repeat(Number(lenB));
const write = mode === 'atomic' ? writeFileAtomic : (f, d) => fs.writeFileSync(f, d);
process.stdout.write('ready\n');
for (let i = 0; times ? i < Number(times) : true; i++) write(file, i % 2 ? B : A);
