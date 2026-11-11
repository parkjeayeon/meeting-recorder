// 메인 창 화면(src/renderer)을 묶는다. 이름이 vite.config.*가 아닌 이유: 그러면 vitest가 이 설정을 집어 src/core 시험을 놓친다.
//   npm run build:renderer  → lib/renderer/main.js, main.css (+ 글꼴 등 assets/)
// 화면 문서는 그대로 src/renderer/index.html이고, 이 두 파일을 정해진 이름으로 불러온다 — 앱·시험·설치본이 같은 문서·같은 묶음을 쓴다
// (주소가 같으니 localStorage·오디오 워크릿 상대 경로도 그대로). 개발 서버(HMR)는 쓰지 않는다: 빌드를 지켜보고 창을 새로 고친다.
// 결정: docs/react-migration.md, 결정 61
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./src/renderer', import.meta.url));

export default defineConfig(({ mode }) => ({
  root,
  base: './',
  plugins: [react()],
  logLevel: 'warn',
  build: {
    outDir: fileURLToPath(new URL('./lib/renderer', import.meta.url)),
    emptyOutDir: true,
    target: 'es2024', // 최상위 await (Electron 45)
    minify: false, // 오류 위치를 읽을 수 있게
    sourcemap: mode === 'development',
    assetsInlineLimit: 0, // CSP(font-src 'self')라 글꼴을 data: URL로 넣지 않는다
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/renderer/main.ts', import.meta.url)),
      output: {
        entryFileNames: 'main.js',
        assetFileNames: (a) => (a.names?.some((n) => n.endsWith('.css')) ? 'main.css' : 'assets/[name][extname]'),
      },
    },
  },
}));
