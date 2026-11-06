import { describe, expect, it } from 'vitest';
import { chooseLanguage } from './language.mjs';

describe('chooseLanguage', () => {
  it('Whisper가 후보 안 언어를 골랐으면 그대로', () => {
    expect(chooseLanguage({ ko: 0.9, ja: 0.05, en: 0.03, vi: 0.01 })).toEqual({ detected: 'ko', pick: 'ko', rerun: false });
    expect(chooseLanguage({ en: 0.7, ko: 0.2 })).toEqual({ detected: 'en', pick: 'en', rerun: false });
  });
  it('후보 밖 언어(베트남어)를 골랐으면 후보 중 가장 높은 언어로 다시', () => {
    // 실제 측정: 짧은 "네" → vi 0.27, ja 0.26, en 0.05, ko 0.05 (짧은 말은 앱이 감지 전에 첫 후보로 보낸다)
    expect(chooseLanguage({ vi: 0.2659, ja: 0.2575, es: 0.0617, en: 0.0539, ko: 0.0487 })).toEqual({ detected: 'vi', pick: 'ja', rerun: true });
    expect(chooseLanguage({ zh: 0.6, ko: 0.3, en: 0.1 }, ['ko', 'en'])).toEqual({ detected: 'zh', pick: 'ko', rerun: true });
  });
  it('확률이 없으면 손대지 않는다', () => {
    expect(chooseLanguage(null)).toEqual({ detected: null, pick: null, rerun: false });
    expect(chooseLanguage({})).toEqual({ detected: null, pick: null, rerun: false });
  });
});
