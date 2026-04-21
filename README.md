<div align="center">
  <img src="build/icon-source.png" alt="sagyo_rajio app icon" width="160" />
  <h1>sagyo_rajio</h1>
  <p><strong>Your personal working radio, generated locally on macOS.</strong></p>
  <p>RSS feeds become a DJ-style program — scripted by a local LLM and voiced on your Mac.</p>
  <p>
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License" />
    <img src="https://img.shields.io/badge/Platform-macOS-lightgrey" alt="macOS" />
    <img src="https://img.shields.io/badge/Node-%3E%3D20-brightgreen" alt="Node 20+" />
    <img src="https://img.shields.io/badge/Ollama-local%20only-111827" alt="Local Ollama" />
  </p>
</div>

## Overview

sagyo_rajio is a local-first "working radio" app for macOS.
It pulls fresh items from your RSS feeds, writes a DJ script with a local LLM (Ollama), and synthesizes the audio with VOICEVOX or ElevenLabs — so your background radio keeps flowing while you focus on work.

<img width="1432" alt="sagyo_rajio screenshot" src="https://github.com/user-attachments/assets/7f96d4c8-d526-4fe8-971c-8f50b4dab58e" />

Demo: https://youtube.com/watch?v=3poyPWz1Bd4

## Features

- Aggregates new items from your RSS feeds and builds a time-of-day-aware program
- Local DJ scripting via Ollama, plus a fresh piece of trivia on every opening
- Pick between VOICEVOX (free, local) and ElevenLabs (cloud) for TTS
- Background auto-refresh at a configurable interval (10 min – 2 h)
- Self-made opening jingle that fades out behind the opening narration
- Dedup for seen articles, history of past programs, and per-segment seek
- Settings, history, and audio stay in your local user directory

## Requirements

- macOS
- Node.js `20.19+` or `22.12+`
- [Ollama](https://ollama.com/) with a local model for script generation
  Example: `ollama pull gemma4:26b`
- One of the following TTS backends
  - [VOICEVOX](https://voicevox.hiroshiba.jp/) (free, runs locally on `http://127.0.0.1:50021`)
  - An [ElevenLabs](https://elevenlabs.io/) API key

## Quick start

```bash
git clone https://github.com/iritec/sagyo_rajio.git
cd sagyo_rajio
npm install
npm run dev
```

After the first launch, open **Settings** to pick a TTS provider and voice, then go to **Feeds** to register RSS URLs. A curated preset list (NHK, Yahoo, Hatena Bookmark, BBC, NPR, and more) lets you add common feeds with a single tap.

## Download

Prebuilt macOS binaries are available on [GitHub Releases](https://github.com/iritec/sagyo_rajio/releases).

## Storage

Settings and history live under Electron's `userData` directory (on macOS: `~/Library/Application Support/sagyo-radio/`). Generated audio files are written to the system temp directory.

## License

The application source is released under the [MIT License](LICENSE). The bundled opening jingle (`renderer/public/opening-jingle.mp3`) was created by the author with [Suno](https://suno.com/) and is distributed under the same MIT terms.
