"""회의 녹음의 화자 구분 (pyannote speaker-diarization-community-1).

사용: diarize.py <16kHz 모노 wav> [--speakers N]
출력(stdout): {"segments": [{"start": 0.0, "end": 3.2, "speaker": "SPEAKER_00"}, ...], "device": "mps", "seconds": 12.3}

겹쳐 말한 구간을 한 사람에게만 배정한 결과(exclusive)를 써서 녹취 문장과 시간으로 맞추기 쉽게 한다.
Hugging Face 토큰은 HF_TOKEN 환경 변수나 `hf auth login`으로 저장한 것을 쓴다.
"""
import argparse
import json
import os
import sys
import time
import wave

import numpy as np
import torch
from pyannote.audio import Pipeline

MODEL = "pyannote/speaker-diarization-community-1"


def load_wav(path):
    # torchcodec/ffmpeg 없이 읽으려고 표준 wave 모듈로 직접 읽는다 (앱이 만든 16bit PCM)
    with wave.open(path, "rb") as w:
        assert w.getsampwidth() == 2, "16bit PCM만 지원"
        rate = w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        if w.getnchannels() > 1:
            data = data.reshape(-1, w.getnchannels()).mean(axis=1)
    return torch.from_numpy(data.astype(np.float32) / 32768.0).unsqueeze(0), rate


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("wav")
    parser.add_argument("--speakers", type=int, default=None)
    args = parser.parse_args()

    started = time.time()
    pipeline = Pipeline.from_pretrained(MODEL, token=os.environ.get("HF_TOKEN") or None)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    pipeline.to(torch.device(device))

    waveform, rate = load_wav(args.wav)
    options = {"num_speakers": args.speakers} if args.speakers else {}
    output = pipeline({"waveform": waveform, "sample_rate": rate}, **options)

    annotation = getattr(output, "exclusive_speaker_diarization", None) or getattr(output, "speaker_diarization", output)
    segments = [
        {"start": round(turn.start, 2), "end": round(turn.end, 2), "speaker": speaker}
        for turn, _, speaker in annotation.itertracks(yield_label=True)
    ]
    json.dump({"segments": segments, "device": device, "seconds": round(time.time() - started, 1)}, sys.stdout)


if __name__ == "__main__":
    main()
