// 메인 창의 TypeScript·React 진입점. 모듈 평가 때 화면을 엮고 비동기 시작 순서를 실행한다.
import './style.css';
import { startRenderer } from './app/index.ts';
void startRenderer();
