#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""VoxCPM runner.

stdin から渡されたテキストを VoxCPM で音声合成し、`--out` で指定された
WAV ファイルに書き出す。Node 側 (`src/core/tts.ts`) から
`python voxcpm_runner.py --out <path>` の形で呼び出される想定。

失敗した場合（VoxCPM 未インストール、モデル未設定、推論エラー等）は
exit 1 を返し、Node 側のフォールバック (`say`) に委ねる。

環境変数:
  VOXCPM_MODEL_PATH   ローカルの VoxCPM モデルディレクトリ、もしくは
                      HuggingFace のモデル ID (例: openbmb/VoxCPM-0.5B)
  VOXCPM_SAMPLE_RATE  出力 WAV のサンプリングレート (既定: 16000)
"""
from __future__ import annotations

import argparse
import os
import sys


def _log(msg: str) -> None:
    sys.stderr.write(f"[voxcpm_runner] {msg}\n")


def _read_text(cli_text: str | None) -> str:
    if cli_text is not None:
        return cli_text.strip()
    return sys.stdin.read().strip()


def _load_model(model_path: str):
    try:
        from voxcpm import VoxCPM  # type: ignore
    except Exception as e:  # noqa: BLE001
        _log(f"failed to import voxcpm: {e}")
        return None

    try:
        if os.path.isdir(model_path):
            return VoxCPM(voxcpm_model_path=model_path)
        return VoxCPM.from_pretrained(model_path)
    except Exception as e:  # noqa: BLE001
        _log(f"failed to load VoxCPM model ({model_path}): {e}")
        return None


def _to_numpy(wav):
    try:
        import numpy as np  # type: ignore
    except Exception as e:  # noqa: BLE001
        _log(f"failed to import numpy: {e}")
        return None

    if hasattr(wav, "detach"):
        wav = wav.detach()
    if hasattr(wav, "cpu"):
        wav = wav.cpu()
    if hasattr(wav, "numpy"):
        wav = wav.numpy()
    arr = np.asarray(wav)
    if arr.ndim > 1:
        arr = np.squeeze(arr)
    return arr


def main() -> int:
    parser = argparse.ArgumentParser(description="VoxCPM TTS runner")
    parser.add_argument("--out", required=True, help="output WAV path")
    parser.add_argument("--text", default=None, help="text to synthesize (default: stdin)")
    args = parser.parse_args()

    text = _read_text(args.text)
    if not text:
        _log("empty text")
        return 1

    model_path = os.environ.get("VOXCPM_MODEL_PATH", "").strip()
    if not model_path:
        _log("VOXCPM_MODEL_PATH is not set")
        return 1

    model = _load_model(model_path)
    if model is None:
        return 1

    try:
        wav = model.generate(text=text)
    except Exception as e:  # noqa: BLE001
        _log(f"synthesis failed: {e}")
        return 1

    wav_np = _to_numpy(wav)
    if wav_np is None or wav_np.size == 0:
        _log("empty waveform")
        return 1

    try:
        import soundfile as sf  # type: ignore
    except Exception as e:  # noqa: BLE001
        _log(f"failed to import soundfile: {e}")
        return 1

    try:
        sample_rate = int(os.environ.get("VOXCPM_SAMPLE_RATE", "16000"))
    except ValueError:
        sample_rate = 16000

    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    try:
        sf.write(args.out, wav_np, sample_rate)
    except Exception as e:  # noqa: BLE001
        _log(f"failed to write WAV ({args.out}): {e}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
