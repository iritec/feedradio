#!/bin/bash
set -e

# 他プロジェクト由来の Next.js 内部環境変数が混ざっていると設定が誤って上書きされるので除去
unset __NEXT_PRIVATE_STANDALONE_CONFIG
unset __NEXT_PRIVATE_RENDER_WORKER_CONFIG
unset __NEXT_PRIVATE_RENDER_WORKER

# 親環境に ELECTRON_RUN_AS_NODE=1 が残っていると Electron が Node プロセスとして起動し
# require('electron') が API ではなくバイナリパス文字列を返してしまうため除去
unset ELECTRON_RUN_AS_NODE

export NODE_ENV=development

# Electronメインプロセスをコンパイル
npx tsc -p tsconfig.electron.json

# Next.jsを起動してからElectronを起動
npx concurrently -k -n "next,electron" -c "magenta,cyan" \
  "next dev renderer --port 3000" \
  "wait-on http://localhost:3000 && electron ."
