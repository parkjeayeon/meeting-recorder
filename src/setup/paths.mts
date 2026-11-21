// 엔진 설치가 쓰는 앱 데이터 폴더 안 자리와 모델 이름 (src/setup.js에서 옮김, 결정 70)
import path from 'node:path';

export type ModelId = 'turbo' | 'large';

export const MODELS: Record<ModelId, { file: string; approx: number }> = {
  turbo: { file: 'ggml-large-v3-turbo-q8_0.bin', approx: 874e6 },
  large: { file: 'ggml-large-v3.bin', approx: 3.1e9 },
};

export const DIARIZE_MODEL_DIR = 'models--pyannote--speaker-diarization-community-1';

// root: 앱 데이터 폴더(app.getPath('userData')) — 부를 때마다 읽는다
export function setupPaths(root: () => string) {
  return {
    models: () => path.join(root(), 'models'),
    model: (id: ModelId) => path.join(root(), 'models', MODELS[id].file),
    env: () => path.join(root(), 'diarize-env'),
    envPython: () => path.join(root(), 'diarize-env', 'bin', 'python'),
    marker: () => path.join(root(), 'diarize-env', '.installed'),
    uv: () => path.join(root(), 'bin', 'uv'),
    python: () => path.join(root(), 'python'),
    uvCache: () => path.join(root(), 'uv-cache'),
    hfCache: () => path.join(root(), 'hf-cache'),
  };
}

export type SetupPaths = ReturnType<typeof setupPaths>;
