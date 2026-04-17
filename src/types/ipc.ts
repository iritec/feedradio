import type {
  ArchivedArticle,
  AutoFetchSettings,
  Feed,
  Program,
  Segment,
  TtsSettings,
  TtsTestResult,
  VoicevoxSpeaker,
  ElevenLabsVoice,
} from './program';

export interface RadioStatus {
  playing: boolean;
  title: string;
  currentTopic?: string;
}

export interface AutoFetchStatus {
  nextAt: number | null;
  intervalMinutes: number;
}

export type ProgressPhase =
  | 'fetching'
  | 'scripting'
  | 'synthesizing'
  | 'ready'
  | 'error';

export interface ProgressEvent {
  phase: ProgressPhase;
  message: string;
  progress?: number;
}

export interface SegmentChangeEvent {
  segmentIndex: number;
  segment: Segment | null;
  audioUrl: string | null;
  playing: boolean;
  title: string;
  totalSegments: number;
  createdAt: string | null;
  hasNext: boolean;
  hasPrev: boolean;
}

export type ProgressListener = (event: ProgressEvent) => void;
export type SegmentChangeListener = (event: SegmentChangeEvent) => void;
export type Unsubscribe = () => void;

export interface RadioAPI {
  getStatus(): Promise<RadioStatus>;
  getSegmentState(): Promise<SegmentChangeEvent>;
  play(): Promise<void>;
  stop(): Promise<void>;
  generateProgram(): Promise<Program | null>;
  resynthesizeProgram(): Promise<Program | null>;
  getCurrentProgram(): Promise<Program | null>;
  nextSegment(): Promise<void>;
  prevSegment(): Promise<void>;
  goToSegment(index: number): Promise<void>;
  openExternal(url: string): Promise<boolean>;
  listFeeds(): Promise<Feed[]>;
  addFeed(url: string): Promise<Feed[]>;
  removeFeed(id: string): Promise<Feed[]>;
  getTtsSettings(): Promise<TtsSettings>;
  setTtsSettings(settings: TtsSettings): Promise<TtsSettings>;
  listVoicevoxSpeakers(baseUrl: string): Promise<VoicevoxSpeaker[]>;
  listElevenLabsVoices(apiKey: string): Promise<ElevenLabsVoice[]>;
  testTts(settings: TtsSettings): Promise<TtsTestResult>;
  getAutoFetchSettings(): Promise<AutoFetchSettings>;
  setAutoFetchSettings(settings: AutoFetchSettings): Promise<AutoFetchSettings>;
  getAutoFetchStatus(): Promise<AutoFetchStatus>;
  listArticleHistory(): Promise<ArchivedArticle[]>;
  listProgramHistory(): Promise<Program[]>;
  loadProgram(id: string): Promise<Program | null>;
  listRecommendedFeeds(locale: string): Promise<Feed[]>;
  onProgress(cb: ProgressListener): Unsubscribe;
  onSegmentChange(cb: SegmentChangeListener): Unsubscribe;
}

export const IPC_CHANNELS = {
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

declare global {
  interface Window {
    radioAPI: RadioAPI;
  }
}
