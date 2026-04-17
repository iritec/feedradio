import Store from 'electron-store';
import type {
  ArchivedArticle,
  AutoFetchSettings,
  Feed,
  Program,
  SeenItemRecord,
  TtsSettings,
} from '../types/program';
import { DEFAULT_FEEDS } from './feeds';

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  provider: 'voicevox',
  voicevox: {
    baseUrl: 'http://127.0.0.1:50021',
    speakerId: 3, // ずんだもん（ノーマル）
  },
  elevenlabs: {
    apiKey: '',
    voiceId: '',
    modelId: 'eleven_multilingual_v2',
  },
};

export const DEFAULT_AUTO_FETCH_SETTINGS: AutoFetchSettings = {
  enabled: true,
  intervalMinutes: 30,
};

const SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SEEN_MAX = 5000;
const ARTICLE_HISTORY_MAX = 300;
const PROGRAM_HISTORY_MAX = 30;
const INTERVAL_MIN = 5;
const INTERVAL_MAX = 360;
export const MAX_FEEDS = 10;

interface StoreSchema {
  feeds: Feed[];
  // 旧フォーマット互換のため string[] も許容
  seenItemIds?: string[] | SeenItemRecord[];
  seenItemRecord?: SeenItemRecord[];
  articleHistory?: ArchivedArticle[];
  lastProgram?: Program;
  programHistory?: Program[];
  tts?: TtsSettings;
  lastGreetingSlot?: string;
  autoFetch?: AutoFetchSettings;
}

let storeInstance: Store<StoreSchema> | null = null;

function getStore(): Store<StoreSchema> {
  if (storeInstance) return storeInstance;
  storeInstance = new Store<StoreSchema>({
    name: 'sagyo-radio',
    defaults: {
      feeds: DEFAULT_FEEDS,
      seenItemRecord: [],
    },
  });
  // 初回起動でフィード空なら初期値を注入
  const feeds = storeInstance.get('feeds');
  if (!feeds || feeds.length === 0) {
    storeInstance.set('feeds', DEFAULT_FEEDS);
  }
  // 既存ユーザーの lastProgram を履歴にも反映（一度だけ）
  const historyRaw = storeInstance.get('programHistory');
  if (!Array.isArray(historyRaw)) {
    const last = storeInstance.get('lastProgram');
    storeInstance.set('programHistory', last ? [last] : []);
  }
  return storeInstance;
}

export function listFeeds(): Feed[] {
  return getStore().get('feeds');
}

export function saveFeeds(feeds: Feed[]): void {
  getStore().set('feeds', feeds);
}

export function addFeed(feed: Feed): Feed[] {
  const current = listFeeds();
  const exists = current.find((f) => f.url === feed.url);
  if (exists) return current;
  if (current.length >= MAX_FEEDS) {
    throw new Error(`フィードは最大 ${MAX_FEEDS} 件まで登録できます`);
  }
  const next = [...current, feed];
  saveFeeds(next);
  return next;
}

export function removeFeed(id: string): Feed[] {
  const next = listFeeds().filter((f) => f.id !== id);
  saveFeeds(next);
  return next;
}

function loadSeenRecordsRaw(): SeenItemRecord[] {
  const store = getStore();
  const fresh = store.get('seenItemRecord') as SeenItemRecord[] | undefined;
  if (Array.isArray(fresh) && fresh.length > 0) return fresh;

  // 旧フォーマット (string[]) からの移行
  const legacy = store.get('seenItemIds') as
    | string[]
    | SeenItemRecord[]
    | undefined;
  if (!Array.isArray(legacy) || legacy.length === 0) return [];
  const migrated: SeenItemRecord[] = legacy.map((entry) => {
    if (typeof entry === 'string') return { id: entry, seenAt: 0 };
    if (entry && typeof entry === 'object' && 'id' in entry) {
      const seenAt =
        typeof (entry as SeenItemRecord).seenAt === 'number'
          ? (entry as SeenItemRecord).seenAt
          : 0;
      return { id: (entry as SeenItemRecord).id, seenAt };
    }
    return { id: String(entry), seenAt: 0 };
  });
  store.set('seenItemRecord', migrated);
  // 旧キーはクリア（後方互換は移行ロジックで担保）
  store.delete('seenItemIds');
  return migrated;
}

export function getSeenRecords(): SeenItemRecord[] {
  return loadSeenRecordsRaw();
}

export function getSeenItemIds(): string[] {
  return loadSeenRecordsRaw().map((r) => r.id);
}

export function markItemsSeen(ids: string[]): void {
  if (ids.length === 0) return;
  const store = getStore();
  const current = loadSeenRecordsRaw();
  const map = new Map<string, number>();
  for (const r of current) map.set(r.id, r.seenAt);
  const now = Date.now();
  for (const id of ids) map.set(id, now);
  let merged: SeenItemRecord[] = Array.from(map.entries()).map(
    ([id, seenAt]) => ({ id, seenAt }),
  );
  // 上限 5000 件。古い順に削除
  if (merged.length > SEEN_MAX) {
    merged.sort((a, b) => a.seenAt - b.seenAt);
    merged = merged.slice(merged.length - SEEN_MAX);
  }
  store.set('seenItemRecord', merged);
}

export function cleanupExpiredItems(now: number = Date.now()): number {
  const store = getStore();
  const records = loadSeenRecordsRaw();
  // seenAt === 0 は旧データ由来で寿命不明のため即時失効
  const kept = records.filter(
    (r) => r.seenAt > 0 && now - r.seenAt <= SEEN_TTL_MS,
  );
  const removed = records.length - kept.length;
  let trimmed = kept;
  if (trimmed.length > SEEN_MAX) {
    trimmed = [...trimmed]
      .sort((a, b) => a.seenAt - b.seenAt)
      .slice(trimmed.length - SEEN_MAX);
  }
  store.set('seenItemRecord', trimmed);

  // 記事履歴の期限切れも同じ契機で掃除
  const history = getArticleHistory();
  const keptHistory = history.filter((a) => now - a.savedAt <= SEEN_TTL_MS);
  if (keptHistory.length !== history.length) {
    store.set('articleHistory', keptHistory);
  }
  return removed;
}

export function getArticleHistory(): ArchivedArticle[] {
  const raw = getStore().get('articleHistory');
  return Array.isArray(raw) ? (raw as ArchivedArticle[]) : [];
}

export function saveArticleHistory(articles: ArchivedArticle[]): void {
  if (!Array.isArray(articles) || articles.length === 0) return;
  const store = getStore();
  const now = Date.now();
  const existing = getArticleHistory();
  const byId = new Map<string, ArchivedArticle>();
  for (const a of existing) byId.set(a.id, a);
  for (const a of articles) {
    byId.set(a.id, { ...a, savedAt: a.savedAt || now });
  }
  let merged = Array.from(byId.values())
    .filter((a) => now - a.savedAt <= SEEN_TTL_MS)
    .sort((a, b) => a.savedAt - b.savedAt);
  if (merged.length > ARTICLE_HISTORY_MAX) {
    merged = merged.slice(merged.length - ARTICLE_HISTORY_MAX);
  }
  store.set('articleHistory', merged);
}

export function getLastProgram(): Program | undefined {
  return getStore().get('lastProgram');
}

export function setLastProgram(program: Program): void {
  const store = getStore();
  store.set('lastProgram', program);

  // 過去番組として履歴に追加／更新
  const raw = store.get('programHistory');
  const existing = Array.isArray(raw) ? (raw as Program[]) : [];
  const filtered = existing.filter((p) => p.id !== program.id);
  const merged = [program, ...filtered]
    .sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return tb - ta;
    })
    .slice(0, PROGRAM_HISTORY_MAX);
  store.set('programHistory', merged);
}

export function getProgramHistory(): Program[] {
  const raw = getStore().get('programHistory');
  const list = Array.isArray(raw) ? (raw as Program[]) : [];
  return [...list].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return tb - ta;
  });
}

export function findProgramById(id: string): Program | null {
  const list = getProgramHistory();
  return list.find((p) => p.id === id) ?? null;
}

export function getLastGreetingSlot(): string | undefined {
  return getStore().get('lastGreetingSlot');
}

export function setLastGreetingSlot(key: string): void {
  getStore().set('lastGreetingSlot', key);
}

export function getTtsSettings(): TtsSettings {
  const raw = getStore().get('tts');
  if (!raw) return { ...DEFAULT_TTS_SETTINGS };
  // 欠けてるフィールドをデフォルトで補完
  return {
    provider: raw.provider ?? DEFAULT_TTS_SETTINGS.provider,
    voicevox: { ...DEFAULT_TTS_SETTINGS.voicevox, ...(raw.voicevox ?? {}) },
    elevenlabs: {
      ...DEFAULT_TTS_SETTINGS.elevenlabs,
      ...(raw.elevenlabs ?? {}),
    },
  };
}

export function setTtsSettings(settings: TtsSettings): TtsSettings {
  const normalized: TtsSettings = {
    provider: settings.provider === 'elevenlabs' ? 'elevenlabs' : 'voicevox',
    voicevox: {
      baseUrl:
        settings.voicevox.baseUrl?.trim() ||
        DEFAULT_TTS_SETTINGS.voicevox.baseUrl,
      speakerId: Number.isFinite(settings.voicevox.speakerId)
        ? settings.voicevox.speakerId
        : DEFAULT_TTS_SETTINGS.voicevox.speakerId,
    },
    elevenlabs: {
      apiKey: settings.elevenlabs.apiKey?.trim() ?? '',
      voiceId: settings.elevenlabs.voiceId?.trim() ?? '',
      modelId:
        settings.elevenlabs.modelId?.trim() ||
        DEFAULT_TTS_SETTINGS.elevenlabs.modelId,
    },
  };
  getStore().set('tts', normalized);
  return normalized;
}

export function getAutoFetchSettings(): AutoFetchSettings {
  const raw = getStore().get('autoFetch');
  if (!raw) return { ...DEFAULT_AUTO_FETCH_SETTINGS };
  const intervalMinutes = Number.isFinite(raw.intervalMinutes)
    ? Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, Math.floor(raw.intervalMinutes)))
    : DEFAULT_AUTO_FETCH_SETTINGS.intervalMinutes;
  // 自動取得は常に有効（UI から OFF にはできない）
  return {
    enabled: true,
    intervalMinutes,
  };
}

export function setAutoFetchSettings(
  settings: AutoFetchSettings,
): AutoFetchSettings {
  const normalized: AutoFetchSettings = {
    enabled: !!settings.enabled,
    intervalMinutes: Number.isFinite(settings.intervalMinutes)
      ? Math.min(
          INTERVAL_MAX,
          Math.max(INTERVAL_MIN, Math.floor(settings.intervalMinutes)),
        )
      : DEFAULT_AUTO_FETCH_SETTINGS.intervalMinutes,
  };
  getStore().set('autoFetch', normalized);
  return normalized;
}
