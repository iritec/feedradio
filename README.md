![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Platform: macOS](https://img.shields.io/badge/Platform-macOS-lightgrey)

# 作業用ラジオ

<img width="1432" height="844" alt="image" src="https://github.com/user-attachments/assets/7f96d4c8-d526-4fe8-971c-8f50b4dab58e" />

sagyo_rajio は、登録した RSS フィードの新着ニュースから DJ 原稿を自動生成して読み上げる、macOS 向けのローカル動作ラジオアプリです。原稿生成はローカル LLM（Ollama / gemma4）、音声合成はローカルの VOICEVOX もしくは ElevenLabs で行うため、番組生成は基本的に手元の Mac で完結します。

### 特徴

- RSS フィードから新着記事を自動収集し、時間帯に合わせた番組を生成
- 音声合成は VOICEVOX（無料・ローカル）または ElevenLabs（クラウド）から選択
- 自動取得間隔（10 分〜2 時間）でバックグラウンドで番組を更新
- 設定・履歴・音声は Mac 内に保存されるローカル完結型

### 必要なもの

- macOS
- Node.js `20.19+` または `22.12+`
- [Ollama](https://ollama.com/) と DJ 原稿生成に使うローカルモデル
  例: `ollama pull gemma4:26b`
- 音声合成に下記のいずれか
  - [VOICEVOX](https://voicevox.hiroshiba.jp/)（無料・ローカル。`http://127.0.0.1:50021` で起動）
  - [ElevenLabs](https://elevenlabs.io/) の API キー

### 使い方

```bash
git clone https://github.com/iritec/sagyo_rajio.git
cd sagyo_rajio
npm install
npm run dev
```

初回起動後は、設定画面から TTS プロバイダとボイスを選び、フィード管理画面で RSS を登録してください。プリセットのおすすめフィードからワンタップで追加できます。

### ライセンス

本体コードは [MIT License](LICENSE) の下で公開しています。同梱しているオープニングジングル（`renderer/public/opening-jingle.mp3`）は作者が [Suno](https://suno.com/) で作成したオリジナル音源で、同じく MIT 条件下で利用できます。

---

## English

sagyo_rajio is a local-first "working radio" app for macOS that turns your RSS feeds into an auto-generated DJ program. Scripts are written by a local LLM (Ollama / gemma4) and synthesized by either a local VOICEVOX engine or ElevenLabs, so program generation stays on your Mac.

### Features

- Aggregates new items from your RSS feeds and builds a time-of-day-aware program
- Pick between VOICEVOX (free / local) and ElevenLabs (cloud) for TTS
- Background auto-refresh at a configurable interval (10 min – 2 h)
- Dedup for seen articles, history of past programs, and per-segment seek
- Everything (settings, history, audio) stays in your local user directory

### Requirements

- macOS
- Node.js `20.19+` or `22.12+`
- [Ollama](https://ollama.com/) with a local model for script generation
  Example: `ollama pull gemma4:26b`
- One of the following TTS backends
  - [VOICEVOX](https://voicevox.hiroshiba.jp/) (free, runs locally on `http://127.0.0.1:50021`)
  - An [ElevenLabs](https://elevenlabs.io/) API key

### Quick Start

```bash
git clone https://github.com/iritec/sagyo_rajio.git
cd sagyo_rajio
npm install
npm run dev
```

After the first launch, open the Settings screen to pick a TTS provider and voice, then head to Feeds to register RSS URLs. A curated preset list lets you add common feeds with a single tap.

### License

The application source is released under the [MIT License](LICENSE). The bundled opening jingle (`renderer/public/opening-jingle.mp3`) was created by the author with [Suno](https://suno.com/) and is distributed under the same MIT terms.
