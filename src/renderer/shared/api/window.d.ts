import type { RecorderApi } from './index.ts';

declare global {
  interface Window {
    readonly recorderApi: RecorderApi;
  }
}
export {};
