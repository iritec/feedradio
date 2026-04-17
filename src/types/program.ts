export interface Feed {
  id: string;
  url: string;
  title: string;
  genre?: string;
  enabled: boolean;
}

export interface FeedItem {
  id: string;
  feedId: string;
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  ogImage?: string;
}

export type SegmentKind = 'opening' | 'topic' | 'closing';

export interface SegmentArticle {
  url: string;
  title: string;
  summary?: string;
  ogImage?: string;
}

export interface Segment {
  id: string;
  kind: SegmentKind;
  title: string;
  text: string;
  audioPath?: string;
  sourceLinks?: string[];
  article?: SegmentArticle;
}

export interface Program {
  id: string;
  createdAt: string;
  title: string;
  segments: Segment[];
}

export type TtsProvider = 'voicevox' | 'elevenlabs';

export interface VoicevoxSettings {
  baseUrl: string;
  speakerId: number;
}

export interface ElevenLabsSettings {
  apiKey: string;
  voiceId: string;
  modelId: string;
}

export interface TtsSettings {
  provider: TtsProvider;
  voicevox: VoicevoxSettings;
  elevenlabs: ElevenLabsSettings;
}

export interface VoicevoxSpeaker {
  id: number;
  name: string;
  style: string;
}

export interface ElevenLabsVoice {
  id: string;
  name: string;
}

export interface TtsTestResult {
  ok: boolean;
  backend: TtsProvider | 'say';
  error?: string;
  audioPath?: string;
  audioUrl?: string;
}

export interface SeenItemRecord {
  id: string;
  seenAt: number;
}

export interface ArchivedArticle {
  id: string;
  title: string;
  url: string;
  summary?: string;
  savedAt: number;
}

export interface AutoFetchSettings {
  enabled: boolean;
  intervalMinutes: number;
}
