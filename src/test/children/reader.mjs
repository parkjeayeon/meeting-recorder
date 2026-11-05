// 다른 프로세스에서 같은 파일을 계속 읽어, 이전 전체(A)·새 전체(B)가 아닌 내용(반쯤 쓰인 파일)을 몇 번 봤는지 센다
//   reader.mjs <파일> <A 길이> <B 길이> <밀리초>
import fs from 'node:fs';

const [file, lenA, lenB, ms] = process.argv.slice(2);
const ok = new Set([Number(lenA), Number(lenB)]);
let reads = 0;
let torn = 0;
const until = Date.now() + Number(ms);
while (Date.now() < until) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    torn++; // 파일이 잠깐 없어진 것도 실패로 센다
    continue;
  }
  reads++;
  // A는 'a'만, B는 'b'만으로 되어 있다: 길이가 맞고 한 글자로만 되어 있어야 온전한 것
  if (!ok.has(text.length) || (text[0] !== text[text.length - 1])) torn++;
}
process.stdout.write(JSON.stringify({ reads, torn }));
