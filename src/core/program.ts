import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { ArchivedArticle, Program, Segment } from '../types/program';
import { IPC_CHANNELS, ProgressEvent } from '../types/ipc';
import {
  getArticleHistory,
  listFeeds,
  saveArticleHistory,
  setLastProgram,
  getLastProgram,
} from './storage';
import { fetchAllFeeds } from './rss';
import { commitSeen, pickNewItems } from './dedupe';
import { findSimilarArticles, generateProgramScript } from './script';
import { synthesize } from './tts';

function emit(window: BrowserWindow | null, event: ProgressEvent): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(IPC_CHANNELS.ON_PROGRESS, event);
  }
  // eslint-disable-next-line no-console
  console.log(`[program] ${event.phase}: ${event.message}`);
}

export interface GenerateOptions {
  /** true の場合、進捗・エラー通知をUIに送らない（自動取得などの静かな失敗用） */
  silent?: boolean;
}

export function programAudioDir(programId: string): string {
  return path.join(app.getPath('temp'), 'sagyo-radio', programId);
}

export async function generateProgram(
  window: BrowserWindow | null,
  options: GenerateOptions = {},
): Promise<Program | null> {
  const target = options.silent ? null : window;
  try {
    emit(target, { phase: 'fetching', message: 'RSS を取得中…', progress: 0 });
    const feeds = listFeeds();
    if (feeds.length === 0) {
      emit(target, { phase: 'error', message: 'フィードが登録されていません' });
      return null;
    }
    const all = await fetchAllFeeds(feeds);
    const fresh = pickNewItems(all);
    if (fresh.length === 0) {
      emit(target, { phase: 'error', message: '新着がありません' });
      return null;
    }

    emit(target, {
      phase: 'scripting',
      message: `Ollama で原稿生成中…（新着 ${fresh.length} 件）`,
      progress: 0.2,
    });
    const history = getArticleHistory();
    const similar = findSimilarArticles(fresh, history);
    const newArchives: ArchivedArticle[] = fresh.map((it) => ({
      id: it.id,
      title: it.title,
      url: it.link,
      summary: it.description,
      savedAt: Date.now(),
    }));
    saveArticleHistory(newArchives);
    const scriptResult = await generateProgramScript(fresh, similar);
    const program = scriptResult.program;
    if (scriptResult.fallback) {
      emit(target, {
        phase: 'scripting',
        message:
          scriptResult.warning ??
          'Ollama 利用不可のため簡易原稿で続行します（`ollama serve` を起動すると DJ 原稿になります）',
        progress: 0.35,
      });
    }

    const outDir = programAudioDir(program.id);
    fs.mkdirSync(outDir, { recursive: true });

    const total = program.segments.length;
    let failedCount = 0;
    let lastTtsError: string | null = null;
    for (let i = 0; i < total; i++) {
      const seg = program.segments[i];
      emit(target, {
        phase: 'synthesizing',
        message: `音声合成中 (${i + 1}/${total}): ${seg.title}`,
        progress: 0.4 + (0.6 * i) / total,
      });
      const outPath = path.join(outDir, `${seg.id}.wav`);
      try {
        const result = await synthesize({ text: seg.text, outPath });
        seg.audioPath = result.outPath;
      } catch (err) {
        console.error(`[program] TTS failed for segment ${seg.id}:`, err);
        seg.audioPath = undefined;
        failedCount += 1;
        lastTtsError = err instanceof Error ? err.message : String(err);
      }
    }

    // 採用したフィードアイテムを既読化
    commitSeen(fresh);
    setLastProgram(program);

    if (failedCount === total) {
      emit(target, {
        phase: 'error',
        message: `音声合成に全て失敗しました（${total}/${total}）${
          lastTtsError ? `: ${lastTtsError}` : ''
        }`,
      });
      return program;
    }

    emit(target, {
      phase: 'ready',
      message: '番組ができました',
      progress: 1,
    });
    return program;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[program] generation failed:', err);
    emit(target, { phase: 'error', message: `生成失敗: ${msg}` });
    return null;
  }
}

export async function resynthesizeProgram(
  window: BrowserWindow | null,
): Promise<Program | null> {
  const program = getCurrentProgram();
  if (!program) {
    emit(window, {
      phase: 'error',
      message: '番組がまだありません。先に「番組を作る」を押してください。',
    });
    return null;
  }

  try {
    const outDir = programAudioDir(program.id);
    fs.mkdirSync(outDir, { recursive: true });

    const total = program.segments.length;
    let failedCount = 0;
    let lastTtsError: string | null = null;
    const stamp = Date.now();

    for (let i = 0; i < total; i++) {
      const seg = program.segments[i];
      emit(window, {
        phase: 'synthesizing',
        message: `音声を作り直し中 (${i + 1}/${total}): ${seg.title}`,
        progress: i / total,
      });

      // 旧ファイルは消して、ファイル名を変えることでHTMLAudio側のキャッシュも避ける
      if (seg.audioPath) {
        try {
          fs.unlinkSync(seg.audioPath);
        } catch {
          /* ignore */
        }
      }
      const outPath = path.join(outDir, `${seg.id}-${stamp}.wav`);
      try {
        const result = await synthesize({ text: seg.text, outPath });
        seg.audioPath = result.outPath;
      } catch (err) {
        console.error(`[program] TTS failed for segment ${seg.id}:`, err);
        seg.audioPath = undefined;
        failedCount += 1;
        lastTtsError = err instanceof Error ? err.message : String(err);
      }
    }

    setLastProgram(program);

    if (failedCount === total) {
      emit(window, {
        phase: 'error',
        message: `音声合成に全て失敗しました（${total}/${total}）${
          lastTtsError ? `: ${lastTtsError}` : ''
        }`,
      });
      return program;
    }

    emit(window, {
      phase: 'ready',
      message: '番組ができました',
      progress: 1,
    });
    return program;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[program] resynthesize failed:', err);
    emit(window, { phase: 'error', message: `作り直し失敗: ${msg}` });
    return null;
  }
}

export function getCurrentProgram(): Program | null {
  return getLastProgram() ?? null;
}

export function getSegmentAt(program: Program, index: number): Segment | null {
  if (index < 0 || index >= program.segments.length) return null;
  return program.segments[index];
}
