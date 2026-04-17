import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import type { TtsSettings, TtsProvider } from '../types/program';
import { getTtsSettings } from './storage';

export interface SynthesizeOptions {
  text: string;
  outPath: string;
}

export interface SynthesizeResult {
  outPath: string;
  backend: TtsProvider | 'say';
}

const SAY_TIMEOUT_MS = 60_000;
const VOICEVOX_TIMEOUT_MS = 90_000;
const ELEVENLABS_TIMEOUT_MS = 90_000;

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---- VOICEVOX ----

async function synthesizeWithVoicevox(
  settings: TtsSettings,
  opts: SynthesizeOptions,
): Promise<void> {
  const base = settings.voicevox.baseUrl.replace(/\/+$/, '');
  const speaker = settings.voicevox.speakerId;

  const q = await fetchWithTimeout(
    `${base}/audio_query?speaker=${encodeURIComponent(String(speaker))}&text=${encodeURIComponent(opts.text)}`,
    { method: 'POST' },
    VOICEVOX_TIMEOUT_MS,
  );
  if (!q.ok) {
    throw new Error(`voicevox audio_query ${q.status}: ${await q.text()}`);
  }
  const query = await q.json();

  const s = await fetchWithTimeout(
    `${base}/synthesis?speaker=${encodeURIComponent(String(speaker))}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(query),
    },
    VOICEVOX_TIMEOUT_MS,
  );
  if (!s.ok) {
    throw new Error(`voicevox synthesis ${s.status}: ${await s.text()}`);
  }
  const wavBuf = Buffer.from(await s.arrayBuffer());
  ensureDir(opts.outPath);
  fs.writeFileSync(opts.outPath, wavBuf);
}

// ---- ElevenLabs ----

const ELEVENLABS_SR = 22050;

function wrapPcmAsWav(pcm: Buffer, sampleRate: number): Buffer {
  // 16-bit mono PCM → RIFF/WAV
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format = PCM
  header.writeUInt16LE(1, 22); // channels = 1
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate = SR * blockAlign
  header.writeUInt16LE(2, 32); // block align = 2 (mono 16bit)
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

async function synthesizeWithElevenLabs(
  settings: TtsSettings,
  opts: SynthesizeOptions,
): Promise<void> {
  const { apiKey, voiceId, modelId } = settings.elevenlabs;
  if (!apiKey) throw new Error('ElevenLabs API key が未設定です');
  if (!voiceId) throw new Error('ElevenLabs の voice が未選択です');

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=pcm_${ELEVENLABS_SR}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        accept: 'audio/pcm',
      },
      body: JSON.stringify({
        text: opts.text,
        model_id: modelId || 'eleven_multilingual_v2',
      }),
    },
    ELEVENLABS_TIMEOUT_MS,
  );
  if (!res.ok) {
    throw new Error(`elevenlabs ${res.status}: ${await res.text()}`);
  }
  const pcm = Buffer.from(await res.arrayBuffer());
  const wav = wrapPcmAsWav(pcm, ELEVENLABS_SR);
  ensureDir(opts.outPath);
  fs.writeFileSync(opts.outPath, wav);
}

// ---- macOS say (fallback) ----

function runProcess(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${cmd} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

async function synthesizeWithSay(opts: SynthesizeOptions): Promise<void> {
  ensureDir(opts.outPath);
  const baseArgs = ['-o', opts.outPath, '--data-format=LEF32@22050', opts.text];
  try {
    await runProcess('say', ['-v', 'Kyoko', ...baseArgs], SAY_TIMEOUT_MS);
  } catch (err) {
    console.warn('[tts] `say -v Kyoko` failed, retrying with default voice:', err);
    await runProcess('say', baseArgs, SAY_TIMEOUT_MS);
  }
}

// ---- Public API ----

async function synthesizeWith(
  provider: TtsProvider,
  settings: TtsSettings,
  opts: SynthesizeOptions,
): Promise<void> {
  if (provider === 'voicevox') return synthesizeWithVoicevox(settings, opts);
  if (provider === 'elevenlabs') return synthesizeWithElevenLabs(settings, opts);
  throw new Error(`unknown provider: ${provider}`);
}

export async function synthesize(
  opts: SynthesizeOptions,
  overrideSettings?: TtsSettings,
): Promise<SynthesizeResult> {
  const settings = overrideSettings ?? getTtsSettings();
  try {
    await synthesizeWith(settings.provider, settings, opts);
    return { outPath: opts.outPath, backend: settings.provider };
  } catch (err) {
    console.warn(
      `[tts] ${settings.provider} failed, falling back to say:`,
      err instanceof Error ? err.message : err,
    );
  }
  await synthesizeWithSay(opts);
  return { outPath: opts.outPath, backend: 'say' };
}

// 選択中のプロバイダのみを試す（フォールバックしない）。設定画面のテスト用。
export async function synthesizeOnly(
  settings: TtsSettings,
  opts: SynthesizeOptions,
): Promise<void> {
  await synthesizeWith(settings.provider, settings, opts);
}
