// E2E 検証: RSS → Ollama(stream) → TTS(say) を一気通貫で確認
import Parser from 'rss-parser';
import { spawn } from 'node:child_process';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FEED_URL = process.env.FEED_URL || 'https://zenn.dev/feed';
const MODEL = process.env.OLLAMA_MODEL || 'gemma4:26b';
const HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_TIMEOUT_MS = 600_000;

function log(...args) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}]`, ...args);
}

async function fetchFeed() {
  log(`RSS取得開始: ${FEED_URL}`);
  const parser = new Parser({
    timeout: 15000,
    headers: { 'User-Agent': 'sagyo-radio/0.1 (+https://localhost)' },
  });
  const parsed = await parser.parseURL(FEED_URL);
  const items = (parsed.items ?? []).slice(0, 5).map((it) => ({
    title: (it.title ?? '').toString().trim(),
    link: (it.link ?? '').toString().trim(),
    description: (it.contentSnippet ?? it.content ?? '').toString().trim().slice(0, 300),
  })).filter((x) => x.title && x.link);
  log(`RSS取得完了: ${items.length} 件`);
  return items;
}

function buildPrompt(items) {
  const topics = items.map((it, idx) =>
    `${idx + 1}. タイトル: ${it.title}\n   リンク: ${it.link}\n   概要: ${it.description}`
  );
  return [
    'あなたは深夜の作業用ラジオを回す日本語DJです。',
    '以下のニュース記事から、リスナーの作業BGMになるラジオ番組の原稿を作ってください。',
    '',
    '制約:',
    '- 日本語のみ。口語でDJらしく自然に。',
    '- オープニング1本 + 各トピック1本 + エンディング1本で構成。',
    '- 各トピックの text は 100〜180字。オープニング/エンディングは 80〜120字。',
    '- 出力は **JSON のみ**。前後に説明文や ```json フェンスを付けない。',
    '',
    'JSONスキーマ:',
    '{ "title": string, "segments": [ { "kind": "opening"|"topic"|"closing", "title": string, "text": string, "sourceLinks": string[] } ] }',
    '',
    '記事リスト:',
    ...topics,
  ].join('\n');
}

async function callOllama(prompt) {
  const url = `${HOST.replace(/\/$/, '')}/api/generate`;
  log(`Ollama 呼び出し開始: model=${MODEL}, prompt=${prompt.length}文字`);
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: true,
        options: { temperature: 0.7 },
      }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';
    let chunks = 0;
    let lastTick = Date.now();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          const parsed = JSON.parse(line);
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.response) {
            full += parsed.response;
            chunks++;
            if (Date.now() - lastTick > 5000) {
              log(`  ...受信中 chunks=${chunks} bytes=${full.length}`);
              lastTick = Date.now();
            }
          }
          if (parsed.done) {
            log(`Ollama 応答完了 (${Date.now() - t0}ms, chunks=${chunks}, ${full.length}文字)`);
            return full;
          }
        }
        nl = buffer.indexOf('\n');
      }
    }
    return full;
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(raw) {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return null;
}

function runSay(text, outPath) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'Kyoko', '-o', outPath, '--data-format=LEF32@22050', text];
    const p = spawn('say', args);
    let stderr = '';
    p.stderr.on('data', (b) => (stderr += b.toString()));
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`say exit ${code}: ${stderr}`));
    });
  });
}

async function main() {
  const items = await fetchFeed();
  if (items.length === 0) throw new Error('RSS が空');

  const prompt = buildPrompt(items);
  const raw = await callOllama(prompt);

  const json = extractJson(raw);
  if (!json) {
    log('JSON 抽出失敗、生応答先頭500文字:');
    console.log(raw.slice(0, 500));
    throw new Error('JSON が抽出できない');
  }
  const parsed = JSON.parse(json);
  const segs = parsed.segments ?? [];
  log(`原稿パース成功: title="${parsed.title}", segments=${segs.length}`);
  for (const s of segs.slice(0, 3)) {
    log(`  [${s.kind}] ${s.title} (${(s.text ?? '').length}字)`);
  }

  // TTS は最初の1セグメントのみ（時間節約）
  const first = segs.find((s) => s.text);
  if (!first) throw new Error('text を持つセグメントがない');
  const dir = mkdtempSync(join(tmpdir(), 'sagyo-radio-e2e-'));
  const outPath = join(dir, 'opening.wav');
  log(`TTS 開始: ${first.title} → ${outPath}`);
  await runSay(first.text, outPath);
  const size = statSync(outPath).size;
  log(`TTS 完了: ${size} bytes`);
  if (size < 1000) throw new Error(`音声ファイルが小さすぎる: ${size}`);

  log('✅ E2E 一気通貫 OK (RSS → Ollama streaming → TTS → wav 出力)');
}

main().catch((err) => {
  log('❌ FAIL:', err.message);
  process.exit(1);
});
