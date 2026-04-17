import { app, BrowserWindow, ipcMain, protocol, net, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { createTray } from './tray';
import {
  IPC_CHANNELS,
  RadioStatus,
  SegmentChangeEvent,
} from '../src/types/ipc';
import type {
  ArchivedArticle,
  AutoFetchSettings,
  Feed,
  Program,
  Segment,
  TtsSettings,
  VoicevoxSpeaker,
  ElevenLabsVoice,
} from '../src/types/program';
import {
  generateProgram,
  getCurrentProgram,
  programAudioDir,
  resynthesizeProgram,
} from '../src/core/program';
import {
  addFeed as storageAddFeed,
  cleanupExpiredItems,
  getAutoFetchSettings,
  setAutoFetchSettings,
  listFeeds as storageListFeeds,
  removeFeed as storageRemoveFeed,
  getArticleHistory,
  getProgramHistory,
  findProgramById,
  getTtsSettings,
  setTtsSettings,
} from '../src/core/storage';
import { RECOMMENDED_FEEDS } from '../src/core/feeds';
import { synthesizeOnly } from '../src/core/tts';
import { randomUUID } from 'crypto';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

interface PlaybackState {
  program: Program | null;
  segmentIndex: number;
  playing: boolean;
}

const playback: PlaybackState = {
  program: null,
  segmentIndex: 0,
  playing: false,
};

let autoFetchTimer: NodeJS.Timeout | null = null;
let autoFetchIntervalMs = 0;
let autoFetchNextAt: number | null = null;
let isGenerating = false;

function stopAutoFetch(): void {
  if (autoFetchTimer) {
    clearInterval(autoFetchTimer);
    autoFetchTimer = null;
  }
  autoFetchIntervalMs = 0;
  autoFetchNextAt = null;
}

async function runAutoFetchOnce(): Promise<void> {
  if (isGenerating) {
    console.log('[auto-fetch] skip: another generation is in progress');
    // 次の tick までに間隔ぶん待機する形で予定を更新
    if (autoFetchIntervalMs > 0) {
      autoFetchNextAt = Date.now() + autoFetchIntervalMs;
    }
    return;
  }
  isGenerating = true;
  try {
    console.log('[auto-fetch] generating program…');
    const program = await generateProgram(mainWindow, { silent: true });
    if (program) {
      playback.program = program;
      playback.segmentIndex = 0;
      // 自動取得で番組ができたらそのまま流す
      playback.playing = true;
      emitSegmentChange();
    }
  } catch (err) {
    console.error('[auto-fetch] failed:', err);
  } finally {
    isGenerating = false;
    if (autoFetchIntervalMs > 0) {
      autoFetchNextAt = Date.now() + autoFetchIntervalMs;
    }
  }
}

function startAutoFetch(intervalMinutes: number): void {
  stopAutoFetch();
  const ms = Math.max(5, Math.floor(intervalMinutes)) * 60 * 1000;
  autoFetchIntervalMs = ms;
  autoFetchNextAt = Date.now() + ms;
  autoFetchTimer = setInterval(() => {
    void runAutoFetchOnce();
  }, ms);
  console.log(`[auto-fetch] started: every ${intervalMinutes} min`);
}

function refreshAutoFetch(): void {
  const s = getAutoFetchSettings();
  if (s.enabled) {
    startAutoFetch(s.intervalMinutes);
  } else {
    stopAutoFetch();
  }
}

// custom protocol を privileged として登録（app.ready 前に必要）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'radio-audio',
    privileges: {
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
      bypassCSP: true,
    },
  },
]);

function buildAudioUrl(filePath: string): string {
  // radio-audio://local/<encoded-path>
  return `radio-audio://local/${encodeURIComponent(filePath)}`;
}

function decodeAudioUrl(reqUrl: string): string | null {
  // 受け取る形: radio-audio://local/<encoded>
  const prefix = 'radio-audio://local/';
  if (!reqUrl.startsWith(prefix)) return null;
  return decodeURIComponent(reqUrl.slice(prefix.length));
}

function isInsideAllowedDir(filePath: string): boolean {
  const allowedRoot = path.resolve(app.getPath('temp'), 'sagyo-radio');
  const resolved = path.resolve(filePath);
  return (
    resolved === allowedRoot ||
    resolved.startsWith(allowedRoot + path.sep)
  );
}

function registerAudioProtocol(): void {
  protocol.handle('radio-audio', async (req) => {
    const filePath = decodeAudioUrl(req.url);
    if (!filePath) {
      return new Response('Bad request', { status: 400 });
    }
    if (!isInsideAllowedDir(filePath)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!fs.existsSync(filePath)) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 640,
    frame: false,
    transparent: false,
    resizable: true,
    show: false,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:3000');
  } else {
    win.loadFile(path.join(__dirname, '../../../renderer/out/index.html'));
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  return win;
}

function showOrCreateWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow.show();
    }
    return;
  }
  mainWindow = createWindow();
}

function toggleWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
    return;
  }
  showOrCreateWindow();
}

function buildSegmentChangeEvent(): SegmentChangeEvent {
  const program = playback.program;
  if (!program) {
    return {
      segmentIndex: 0,
      segment: null,
      audioUrl: null,
      playing: false,
      title: '番組なし',
      totalSegments: 0,
      createdAt: null,
      hasNext: false,
      hasPrev: false,
    };
  }
  const total = program.segments.length;
  const seg: Segment | null =
    program.segments[playback.segmentIndex] ?? null;
  const hasNext = playback.segmentIndex < total - 1;
  const hasPrev = playback.segmentIndex > 0;
  if (!seg) {
    return {
      segmentIndex: playback.segmentIndex,
      segment: null,
      audioUrl: null,
      playing: false,
      title: '番組終了',
      totalSegments: total,
      createdAt: program.createdAt,
      hasNext: false,
      hasPrev,
    };
  }
  const audioUrl = seg.audioPath ? buildAudioUrl(seg.audioPath) : null;
  return {
    segmentIndex: playback.segmentIndex,
    segment: seg,
    audioUrl,
    playing: playback.playing,
    title: program.title,
    totalSegments: total,
    createdAt: program.createdAt,
    hasNext,
    hasPrev,
  };
}

function emitSegmentChange(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(
    IPC_CHANNELS.ON_SEGMENT_CHANGE,
    buildSegmentChangeEvent(),
  );
}

function buildStatus(): RadioStatus {
  const program = playback.program;
  if (!program) return { playing: false, title: '番組なし' };
  const seg = program.segments[playback.segmentIndex];
  return {
    playing: playback.playing,
    title: program.title,
    currentTopic: seg?.title,
  };
}

function ensureFeedFromUrl(url: string): Feed {
  return {
    id: randomUUID(),
    url,
    title: url,
    enabled: true,
  };
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.GET_STATUS, async (): Promise<RadioStatus> => {
    return buildStatus();
  });

  ipcMain.handle(
    IPC_CHANNELS.GET_SEGMENT_STATE,
    async (): Promise<SegmentChangeEvent> => {
      if (!playback.program) {
        const last = getCurrentProgram();
        if (last) playback.program = last;
      }
      return buildSegmentChangeEvent();
    },
  );

  ipcMain.handle(IPC_CHANNELS.PLAY, async (): Promise<void> => {
    if (!playback.program) {
      playback.program = getCurrentProgram();
      playback.segmentIndex = 0;
    }
    if (!playback.program) {
      // 何もない場合は無音で終わり
      playback.playing = false;
      emitSegmentChange();
      return;
    }
    playback.playing = true;
    if (playback.segmentIndex >= playback.program.segments.length) {
      playback.segmentIndex = 0;
    }
    emitSegmentChange();
  });

  ipcMain.handle(IPC_CHANNELS.STOP, async (): Promise<void> => {
    playback.playing = false;
    emitSegmentChange();
  });

  ipcMain.handle(
    IPC_CHANNELS.GENERATE_PROGRAM,
    async (): Promise<Program | null> => {
      if (isGenerating) {
        console.log('[main] generate-program: already in progress');
        return playback.program;
      }
      isGenerating = true;
      try {
        const program = await generateProgram(mainWindow);
        if (program) {
          playback.program = program;
          playback.segmentIndex = 0;
          playback.playing = false;
          emitSegmentChange();
        }
        return program;
      } finally {
        isGenerating = false;
        // 手動生成直後にすぐ自動取得が走らないよう、タイマーごと再スタート
        if (autoFetchTimer) {
          refreshAutoFetch();
        }
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.RESYNTHESIZE_PROGRAM,
    async (): Promise<Program | null> => {
      // 再生中に音声ファイルを差し替えると問題になるので一旦停止
      playback.playing = false;
      emitSegmentChange();

      const program = await resynthesizeProgram(mainWindow);
      if (program) {
        playback.program = program;
        playback.segmentIndex = 0;
        playback.playing = false;
        emitSegmentChange();
      }
      return program;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.GET_CURRENT_PROGRAM,
    async (): Promise<Program | null> => {
      if (playback.program) return playback.program;
      const last = getCurrentProgram();
      if (last) playback.program = last;
      return playback.program;
    },
  );

  ipcMain.handle(IPC_CHANNELS.NEXT_SEGMENT, async (): Promise<void> => {
    if (!playback.program) return;
    const next = playback.segmentIndex + 1;
    if (next >= playback.program.segments.length) {
      playback.playing = false;
      playback.segmentIndex = playback.program.segments.length;
      emitSegmentChange();
      return;
    }
    playback.segmentIndex = next;
    emitSegmentChange();
  });

  ipcMain.handle(IPC_CHANNELS.PREV_SEGMENT, async (): Promise<void> => {
    if (!playback.program) return;
    const prev = Math.max(0, playback.segmentIndex - 1);
    if (prev === playback.segmentIndex) return;
    playback.segmentIndex = prev;
    emitSegmentChange();
  });

  ipcMain.handle(
    IPC_CHANNELS.GO_TO_SEGMENT,
    async (_evt, index: number): Promise<void> => {
      if (!playback.program) return;
      const safe = Math.max(
        0,
        Math.min(playback.program.segments.length - 1, Math.floor(index)),
      );
      playback.segmentIndex = safe;
      emitSegmentChange();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.OPEN_EXTERNAL,
    async (_evt, url: string): Promise<boolean> => {
      try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
        await shell.openExternal(u.toString());
        return true;
      } catch (err) {
        console.error('[main] openExternal failed:', err);
        return false;
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.LIST_FEEDS, async (): Promise<Feed[]> => {
    return storageListFeeds();
  });

  ipcMain.handle(
    IPC_CHANNELS.ADD_FEED,
    async (_evt, url: string): Promise<Feed[]> => {
      const trimmed = (url ?? '').trim();
      if (!trimmed) return storageListFeeds();
      let normalized: string;
      try {
        normalized = new URL(trimmed).toString();
      } catch (err) {
        console.error('[main] invalid feed URL:', err);
        throw new Error('URL の形式が正しくありません');
      }
      return storageAddFeed(ensureFeedFromUrl(normalized));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.REMOVE_FEED,
    async (_evt, id: string): Promise<Feed[]> => {
      return storageRemoveFeed(id);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.GET_TTS_SETTINGS,
    async (): Promise<TtsSettings> => {
      return getTtsSettings();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.SET_TTS_SETTINGS,
    async (_evt, settings: TtsSettings): Promise<TtsSettings> => {
      return setTtsSettings(settings);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.LIST_VOICEVOX_SPEAKERS,
    async (_evt, baseUrl: string): Promise<VoicevoxSpeaker[]> => {
      const base = (baseUrl || 'http://127.0.0.1:50021').replace(/\/+$/, '');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch(`${base}/speakers`, { signal: ctrl.signal });
        if (!res.ok) {
          throw new Error(`voicevox /speakers ${res.status}`);
        }
        const json = (await res.json()) as Array<{
          name: string;
          styles: Array<{ id: number; name: string }>;
        }>;
        const flat: VoicevoxSpeaker[] = [];
        for (const sp of json) {
          for (const st of sp.styles) {
            flat.push({ id: st.id, name: sp.name, style: st.name });
          }
        }
        return flat;
      } finally {
        clearTimeout(timer);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.LIST_ELEVENLABS_VOICES,
    async (_evt, apiKey: string): Promise<ElevenLabsVoice[]> => {
      if (!apiKey) return [];
      const collected: ElevenLabsVoice[] = [];
      let nextPageToken: string | null = null;
      // 最大5ページまで辿る（500音声で十分）
      for (let i = 0; i < 5; i++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
          const url = new URL('https://api.elevenlabs.io/v2/voices');
          url.searchParams.set('page_size', '100');
          if (nextPageToken) url.searchParams.set('next_page_token', nextPageToken);
          const res = await fetch(url.toString(), {
            headers: { 'xi-api-key': apiKey },
            signal: ctrl.signal,
          });
          if (res.status === 401) {
            throw new Error(
              'APIキーが無効か、voices の権限（Read）がありません。ElevenLabsでキーのスコープに Voices を含めて再発行してください。',
            );
          }
          if (!res.ok) {
            throw new Error(
              `elevenlabs /v2/voices ${res.status}: ${await res.text()}`,
            );
          }
          const json = (await res.json()) as {
            voices?: Array<{ voice_id: string; name: string }>;
            has_more?: boolean;
            next_page_token?: string | null;
          };
          for (const v of json.voices ?? []) {
            collected.push({ id: v.voice_id, name: v.name });
          }
          if (!json.has_more || !json.next_page_token) break;
          nextPageToken = json.next_page_token;
        } finally {
          clearTimeout(timer);
        }
      }
      return collected;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.GET_AUTO_FETCH_SETTINGS,
    async (): Promise<AutoFetchSettings> => {
      return getAutoFetchSettings();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.SET_AUTO_FETCH_SETTINGS,
    async (_evt, settings: AutoFetchSettings): Promise<AutoFetchSettings> => {
      const saved = setAutoFetchSettings(settings);
      refreshAutoFetch();
      return saved;
    },
  );

  ipcMain.handle(IPC_CHANNELS.GET_AUTO_FETCH_STATUS, async () => {
    return {
      nextAt: autoFetchNextAt,
      intervalMinutes: Math.round(autoFetchIntervalMs / 60000),
    };
  });

  ipcMain.handle(
    IPC_CHANNELS.LIST_ARTICLE_HISTORY,
    async (): Promise<ArchivedArticle[]> => {
      const list = getArticleHistory();
      return [...list].sort((a, b) => b.savedAt - a.savedAt);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.LIST_PROGRAM_HISTORY,
    async (): Promise<Program[]> => {
      return getProgramHistory();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.LOAD_PROGRAM,
    async (_evt, id: string): Promise<Program | null> => {
      const program = findProgramById(id);
      if (!program) return null;
      playback.program = program;
      playback.segmentIndex = 0;
      playback.playing = false;
      emitSegmentChange();
      return program;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.LIST_RECOMMENDED_FEEDS,
    async (_evt, locale: string): Promise<Feed[]> => {
      const key = (locale || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
      return RECOMMENDED_FEEDS[key];
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TEST_TTS,
    async (_evt, settings: TtsSettings) => {
      const outPath = path.join(
        app.getPath('temp'),
        'sagyo-radio',
        'test',
        `${randomUUID()}.wav`,
      );
      try {
        await synthesizeOnly(settings, {
          text: 'こんにちは、作業用ラジオのテスト音声です。',
          outPath,
        });
        return {
          ok: true,
          backend: settings.provider,
          audioPath: outPath,
          audioUrl: buildAudioUrl(outPath),
        };
      } catch (err) {
        return {
          ok: false,
          backend: settings.provider,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}

// 将来 cleanup 用 (現状は temp 自動掃除に任せる)
void programAudioDir;

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  try {
    const removed = cleanupExpiredItems();
    if (removed > 0) {
      console.log(`[main] cleaned up ${removed} expired seen records`);
    }
  } catch (err) {
    console.error('[main] cleanupExpiredItems failed:', err);
  }

  registerAudioProtocol();
  registerIpcHandlers();
  mainWindow = createWindow();

  createTray({
    onToggleWindow: toggleWindow,
    onShowWindow: showOrCreateWindow,
  });

  refreshAutoFetch();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      showOrCreateWindow();
    } else {
      showOrCreateWindow();
    }
  });
});

app.on('before-quit', () => {
  stopAutoFetch();
});

app.on('window-all-closed', () => {
  // トレイから再表示できるように、ウィンドウを閉じてもアプリは終了しない
});
