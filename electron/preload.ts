import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type {
  AutoFetchStatus,
  ProgressEvent,
  ProgressListener,
  RadioAPI,
  RadioStatus,
  SegmentChangeEvent,
  SegmentChangeListener,
  Unsubscribe,
} from '../src/types/ipc';
import type {
  ArchivedArticle,
  AutoFetchSettings,
  Feed,
  Program,
  TtsSettings,
  TtsTestResult,
  VoicevoxSpeaker,
  ElevenLabsVoice,
} from '../src/types/program';

// sandbox 有効な preload では相対パスの require が解決できないため、
// チャンネル名はここに直接書く。src/types/ipc.ts の IPC_CHANNELS と一致させること。
const CH = {
  GET_STATUS: 'radio:get-status',
  GET_SEGMENT_STATE: 'radio:get-segment-state',
  PLAY: 'radio:play',
  STOP: 'radio:stop',
  GENERATE_PROGRAM: 'radio:generate-program',
  RESYNTHESIZE_PROGRAM: 'radio:resynthesize-program',
  GET_CURRENT_PROGRAM: 'radio:get-current-program',
  NEXT_SEGMENT: 'radio:next-segment',
  PREV_SEGMENT: 'radio:prev-segment',
  GO_TO_SEGMENT: 'radio:go-to-segment',
  OPEN_EXTERNAL: 'radio:open-external',
  LIST_FEEDS: 'radio:list-feeds',
  ADD_FEED: 'radio:add-feed',
  REMOVE_FEED: 'radio:remove-feed',
  GET_TTS_SETTINGS: 'radio:get-tts-settings',
  SET_TTS_SETTINGS: 'radio:set-tts-settings',
  LIST_VOICEVOX_SPEAKERS: 'radio:list-voicevox-speakers',
  LIST_ELEVENLABS_VOICES: 'radio:list-elevenlabs-voices',
  TEST_TTS: 'radio:test-tts',
  GET_AUTO_FETCH_SETTINGS: 'radio:get-auto-fetch-settings',
  SET_AUTO_FETCH_SETTINGS: 'radio:set-auto-fetch-settings',
  GET_AUTO_FETCH_STATUS: 'radio:get-auto-fetch-status',
  LIST_ARTICLE_HISTORY: 'radio:list-article-history',
  LIST_PROGRAM_HISTORY: 'radio:list-program-history',
  LOAD_PROGRAM: 'radio:load-program',
  LIST_RECOMMENDED_FEEDS: 'radio:list-recommended-feeds',
  ON_PROGRESS: 'radio:on-progress',
  ON_SEGMENT_CHANGE: 'radio:on-segment-change',
} as const;

function subscribe<T>(
  channel: string,
  cb: (payload: T) => void,
): Unsubscribe {
  const handler = (_evt: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const radioAPI: RadioAPI = {
  getStatus: (): Promise<RadioStatus> => ipcRenderer.invoke(CH.GET_STATUS),
  getSegmentState: (): Promise<SegmentChangeEvent> =>
    ipcRenderer.invoke(CH.GET_SEGMENT_STATE),
  play: (): Promise<void> => ipcRenderer.invoke(CH.PLAY),
  stop: (): Promise<void> => ipcRenderer.invoke(CH.STOP),
  generateProgram: (): Promise<Program | null> =>
    ipcRenderer.invoke(CH.GENERATE_PROGRAM),
  resynthesizeProgram: (): Promise<Program | null> =>
    ipcRenderer.invoke(CH.RESYNTHESIZE_PROGRAM),
  getCurrentProgram: (): Promise<Program | null> =>
    ipcRenderer.invoke(CH.GET_CURRENT_PROGRAM),
  nextSegment: (): Promise<void> => ipcRenderer.invoke(CH.NEXT_SEGMENT),
  prevSegment: (): Promise<void> => ipcRenderer.invoke(CH.PREV_SEGMENT),
  goToSegment: (index: number): Promise<void> =>
    ipcRenderer.invoke(CH.GO_TO_SEGMENT, index),
  openExternal: (url: string): Promise<boolean> =>
    ipcRenderer.invoke(CH.OPEN_EXTERNAL, url),
  listFeeds: (): Promise<Feed[]> => ipcRenderer.invoke(CH.LIST_FEEDS),
  addFeed: (url: string): Promise<Feed[]> =>
    ipcRenderer.invoke(CH.ADD_FEED, url),
  removeFeed: (id: string): Promise<Feed[]> =>
    ipcRenderer.invoke(CH.REMOVE_FEED, id),
  getTtsSettings: (): Promise<TtsSettings> =>
    ipcRenderer.invoke(CH.GET_TTS_SETTINGS),
  setTtsSettings: (s: TtsSettings): Promise<TtsSettings> =>
    ipcRenderer.invoke(CH.SET_TTS_SETTINGS, s),
  listVoicevoxSpeakers: (baseUrl: string): Promise<VoicevoxSpeaker[]> =>
    ipcRenderer.invoke(CH.LIST_VOICEVOX_SPEAKERS, baseUrl),
  listElevenLabsVoices: (apiKey: string): Promise<ElevenLabsVoice[]> =>
    ipcRenderer.invoke(CH.LIST_ELEVENLABS_VOICES, apiKey),
  testTts: (s: TtsSettings): Promise<TtsTestResult> =>
    ipcRenderer.invoke(CH.TEST_TTS, s),
  getAutoFetchSettings: (): Promise<AutoFetchSettings> =>
    ipcRenderer.invoke(CH.GET_AUTO_FETCH_SETTINGS),
  setAutoFetchSettings: (s: AutoFetchSettings): Promise<AutoFetchSettings> =>
    ipcRenderer.invoke(CH.SET_AUTO_FETCH_SETTINGS, s),
  getAutoFetchStatus: (): Promise<AutoFetchStatus> =>
    ipcRenderer.invoke(CH.GET_AUTO_FETCH_STATUS),
  listArticleHistory: (): Promise<ArchivedArticle[]> =>
    ipcRenderer.invoke(CH.LIST_ARTICLE_HISTORY),
  listProgramHistory: (): Promise<Program[]> =>
    ipcRenderer.invoke(CH.LIST_PROGRAM_HISTORY),
  loadProgram: (id: string): Promise<Program | null> =>
    ipcRenderer.invoke(CH.LOAD_PROGRAM, id),
  listRecommendedFeeds: (locale: string): Promise<Feed[]> =>
    ipcRenderer.invoke(CH.LIST_RECOMMENDED_FEEDS, locale),
  onProgress: (cb: ProgressListener): Unsubscribe =>
    subscribe<ProgressEvent>(CH.ON_PROGRESS, cb),
  onSegmentChange: (cb: SegmentChangeListener): Unsubscribe =>
    subscribe<SegmentChangeEvent>(CH.ON_SEGMENT_CHANGE, cb),
};

contextBridge.exposeInMainWorld('radioAPI', radioAPI);
