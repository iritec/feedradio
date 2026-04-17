import { randomUUID } from 'crypto';
import type {
  ArchivedArticle,
  FeedItem,
  Program,
  Segment,
  SegmentArticle,
} from '../types/program';
import { generate, OllamaError } from './ollama';
import { getLastGreetingSlot, setLastGreetingSlot } from './storage';

const BATCH_SIZE = 10;

// オープニングの「小ネタ」は毎回 Ollama に考えてもらう。
// 前置きやラベルを付けて返してくることがあるので、ゆるく整形する。
function sanitizeTrivia(raw: string): string | null {
  let t = raw.trim();
  // ```fence``` で囲まれていたら中身だけ取り出す
  const fence = t.match(/```(?:[a-zA-Z]+)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  // 先頭の記号・ラベルを外す
  t = t
    .replace(/^[「『"']+/, '')
    .replace(/[」』"']+$/, '')
    .replace(/^[・\-\*\d\.\)\s]+/, '')
    .replace(/^(小ネタ|豆知識|雑学|トリビア|今日の一本)[:：\-\s]+/i, '')
    .trim();
  // 改行は 1 行にまとめる
  const line = t
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
  if (!line) return null;
  // 長すぎる場合は 120 字で切る
  return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}

async function generateOpeningTrivia(tsLabel: string): Promise<string | null> {
  const prompt = [
    `あなたは${tsLabel}の作業用ラジオを回す日本語DJです。`,
    'オープニングで軽く挟む「小ネタ」を1つだけ考えてください。',
    '',
    '制約:',
    '- 日本語で 1〜2 文、合計 40〜90 字程度。',
    '- 雑学・豆知識・ライフハックなど、思わず誰かに話したくなる軽い話題。',
    '- 政治・宗教・災害・個人攻撃などセンシティブな話題は避ける。',
    '- 前置き、「小ネタ:」のようなラベル、括弧、記号、引用符、箇条書きは付けない。',
    '- URL・コードブロック・JSON は使わない。小ネタ本文だけを出力する。',
  ].join('\n');
  try {
    const raw = await generate(prompt);
    return sanitizeTrivia(raw);
  } catch (err) {
    console.warn('[script] trivia generation failed:', err);
    return null;
  }
}

export type TimeSlot =
  | 'early-morning'
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'evening'
  | 'night'
  | 'late-night';

interface TimeSlotInfo {
  slot: TimeSlot;
  label: string; // 原稿に差し込む時間帯表現
  greeting: string; // 挨拶のベース文
  title: string; // 画面表示用のタイトル（英語）
}

export function resolveTimeSlot(date: Date = new Date()): TimeSlotInfo {
  const h = date.getHours();
  if (h >= 5 && h < 9) {
    return {
      slot: 'early-morning',
      label: '早朝',
      greeting: 'おはようございます。早朝の作業用ラジオです。',
      title: 'Early Morning Flow',
    };
  }
  if (h >= 9 && h < 12) {
    return {
      slot: 'morning',
      label: '午前',
      greeting: 'こんにちは。午前の作業用ラジオです。',
      title: 'Morning Flow',
    };
  }
  if (h >= 12 && h < 14) {
    return {
      slot: 'noon',
      label: 'お昼',
      greeting: 'お昼の作業用ラジオです。ごはんのお供にどうぞ。',
      title: 'Noon Flow',
    };
  }
  if (h >= 14 && h < 17) {
    return {
      slot: 'afternoon',
      label: '午後',
      greeting: 'こんにちは。午後の作業用ラジオです。',
      title: 'Afternoon Flow',
    };
  }
  if (h >= 17 && h < 19) {
    return {
      slot: 'evening',
      label: '夕方',
      greeting: 'こんばんは。夕方の作業用ラジオです。',
      title: 'Evening Flow',
    };
  }
  if (h >= 19 && h < 24) {
    return {
      slot: 'night',
      label: '夜',
      greeting: 'こんばんは。今夜の作業用ラジオです。',
      title: 'Night Flow',
    };
  }
  return {
    slot: 'late-night',
    label: '深夜',
    greeting: 'こんばんは。深夜の作業用ラジオです。',
    title: 'Late Night Flow',
  };
}

// 日付 + 時間帯の複合キー。30分おきに番組を作る想定で、
// 同じ時間帯・同じ日なら opening の挨拶は省略し、
// 日付が変わるか時間帯が切り替わった時だけ挨拶を入れる。
function buildGreetingKey(date: Date, slot: TimeSlot): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}:${slot}`;
}

const SIMILARITY_MIN_TOKEN_HITS = 2;
const SIMILARITY_MAX_RESULTS = 5;
const NGRAM_SIZE = 3;
const NGRAM_MIN_HITS = 2;

function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[\s\p{P}\p{S}「」『』、。・／\\]+/u)
    .filter((t) => t.length >= 2);
}

function ngrams(text: string, size: number = NGRAM_SIZE): string[] {
  if (!text) return [];
  const clean = text.replace(/\s+/g, '');
  if (clean.length < size) return [];
  const out: string[] = [];
  for (let i = 0; i <= clean.length - size; i++) {
    out.push(clean.slice(i, i + size));
  }
  return out;
}

export function findSimilarArticles(
  currentItems: FeedItem[],
  history: ArchivedArticle[],
): ArchivedArticle[] {
  if (currentItems.length === 0 || history.length === 0) return [];

  const currentIds = new Set(currentItems.map((it) => it.id));
  const currentUrls = new Set(currentItems.map((it) => it.link));

  const currentTokenSets = currentItems.map((it) => new Set(tokenize(it.title)));
  const currentNgramSets = currentItems.map((it) => new Set(ngrams(it.title)));

  const scored: Array<{ article: ArchivedArticle; score: number }> = [];
  for (const art of history) {
    if (currentIds.has(art.id) || currentUrls.has(art.url)) continue;
    const tokens = tokenize(art.title);
    const grams = ngrams(art.title);
    let best = 0;
    for (let i = 0; i < currentItems.length; i++) {
      let tokenHits = 0;
      for (const t of tokens) if (currentTokenSets[i].has(t)) tokenHits++;
      let gramHits = 0;
      for (const g of grams) if (currentNgramSets[i].has(g)) gramHits++;
      const pass =
        tokenHits >= SIMILARITY_MIN_TOKEN_HITS || gramHits >= NGRAM_MIN_HITS;
      if (!pass) continue;
      const score = tokenHits * 10 + gramHits;
      if (score > best) best = score;
    }
    if (best > 0) scored.push({ article: art, score: best });
  }
  scored.sort((a, b) => b.score - a.score || b.article.savedAt - a.article.savedAt);
  return scored.slice(0, SIMILARITY_MAX_RESULTS).map((s) => s.article);
}

function buildBatchPrompt(
  items: FeedItem[],
  tsLabel: string,
  contextArticles: ArchivedArticle[] | undefined,
  batchIndex: number,
  batchCount: number,
): string {
  const topics = items.map((it, idx) => {
    const desc = (it.description ?? '').replace(/\s+/g, ' ').slice(0, 300);
    return `${idx + 1}. タイトル: ${it.title}\n   リンク: ${it.link}\n   概要: ${desc}`;
  });
  const positionNote =
    batchCount > 1
      ? `この一覧は全${batchCount}バッチ中の${batchIndex + 1}番目です。番組全体の一部として自然につながるように書いてください。`
      : '';
  const lines = [
    `あなたは${tsLabel}の作業用ラジオを回す日本語DJです。`,
    '以下のニュース記事それぞれについて、リスナーの作業BGMになるラジオ番組のトピック原稿を作ってください。',
    positionNote,
    '',
    '制約:',
    '- 日本語のみ。口語でDJらしく自然に。',
    '- **各記事につき 1 つのトピックセグメント**を必ず作成する。オープニング挨拶やエンディングは含めない。',
    '- 各トピックの text は 100〜180字。',
    '- URLは読み上げない。記事タイトルは自然に紹介する。',
    '- 出力は **JSON のみ**。前後に説明文や ```json フェンスを付けない。',
    '',
    'JSONスキーマ:',
    '{',
    '  "segments": [',
    '    { "kind": "topic", "title": string, "text": string, "sourceLinks": string[] }',
    '  ]',
    '}',
    '',
  ];
  if (contextArticles && contextArticles.length > 0 && batchIndex === 0) {
    lines.push(
      '## 参考: 過去の関連ニュース（コンテキストとして参照）',
      '※ このセクションは背景理解のためだけに使い、読み上げ内容(セグメントの text)には含めない。記事リストのニュースだけを本編として紹介すること。',
    );
    for (const art of contextArticles) {
      const sum = (art.summary ?? '').replace(/\s+/g, ' ').slice(0, 160);
      lines.push(`- ${art.title} (${art.url})${sum ? ` — ${sum}` : ''}`);
    }
    lines.push('');
  }
  lines.push('記事リスト:', ...topics);
  return lines.join('\n');
}

interface ParsedScriptSegment {
  kind?: string;
  title?: string;
  text?: string;
  sourceLinks?: unknown;
}

interface ParsedScript {
  title?: string;
  segments?: ParsedScriptSegment[];
}

function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return null;
}

function normalizeKind(kind: string | undefined): Segment['kind'] {
  const k = (kind ?? '').toLowerCase();
  if (k === 'opening') return 'opening';
  if (k === 'closing') return 'closing';
  return 'topic';
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return out.length > 0 ? out : undefined;
}

function buildArticleFromItem(item: FeedItem): SegmentArticle {
  const summary = (item.description ?? '').replace(/\s+/g, ' ').trim();
  return {
    url: item.link,
    title: item.title,
    summary: summary || undefined,
    ogImage: item.ogImage,
  };
}

function matchArticle(
  seg: ParsedScriptSegment,
  items: FeedItem[],
  remaining: Set<string>,
): SegmentArticle | undefined {
  // まず sourceLinks の先頭 URL でマッチ
  const links = toStringArray(seg.sourceLinks) ?? [];
  for (const link of links) {
    const hit = items.find((it) => it.link === link);
    if (hit) {
      remaining.delete(hit.id);
      return buildArticleFromItem(hit);
    }
  }
  // タイトル前方一致でフォールバック
  const t = (seg.title ?? '').toString().trim();
  if (t) {
    const hit = items.find(
      (it) => remaining.has(it.id) && (it.title === t || t.includes(it.title)),
    );
    if (hit) {
      remaining.delete(hit.id);
      return buildArticleFromItem(hit);
    }
  }
  // どれにも当たらなければ remaining の先頭から割り当てる
  const firstId = remaining.values().next().value as string | undefined;
  if (firstId) {
    remaining.delete(firstId);
    const hit = items.find((it) => it.id === firstId);
    if (hit) return buildArticleFromItem(hit);
  }
  return undefined;
}

function buildOpeningSegment(
  greeting: string,
  trivia: string | null,
  extra?: string,
): Segment {
  const lead = extra ? `${greeting} ${extra}` : greeting;
  const triviaPart = trivia ? ` 今日のひとネタ。${trivia}` : '';
  return {
    id: randomUUID(),
    kind: 'opening',
    title: 'オープニング',
    text: `${lead}${triviaPart} それでは、手を動かしながらゆるっと聴いてください。`.trim(),
  };
}

function buildFallbackTopicSegments(items: FeedItem[]): Segment[] {
  return items.map((it) => {
    const desc = (it.description ?? '').replace(/\s+/g, ' ').slice(0, 200);
    return {
      id: randomUUID(),
      kind: 'topic',
      title: it.title,
      text: `続いてのトピック。${it.title}。${desc}`.trim(),
      sourceLinks: [it.link],
      article: buildArticleFromItem(it),
    };
  });
}

function buildClosingSegment(): Segment {
  return {
    id: randomUUID(),
    kind: 'closing',
    title: 'エンディング',
    text: '以上、作業用ラジオでした。お疲れさまです。また新着がたまったら回しにきますね。',
  };
}

function buildFallbackProgram(
  items: FeedItem[],
  tsInfo: TimeSlotInfo,
  includeGreeting: boolean,
  trivia: string | null,
): Program {
  const id = randomUUID();
  const segments: Segment[] = [];
  if (includeGreeting) {
    segments.push(
      buildOpeningSegment(
        tsInfo.greeting,
        trivia,
        `今回は新着${items.length}本をお届けします。`,
      ),
    );
  }
  segments.push(...buildFallbackTopicSegments(items));
  segments.push(buildClosingSegment());
  return {
    id,
    createdAt: new Date().toISOString(),
    title: tsInfo.title,
    segments,
  };
}

export interface ScriptResult {
  program: Program;
  fallback: boolean;
  warning?: string;
}

interface BatchOutcome {
  segments: Segment[];
  fallback: boolean;
  warning?: string;
}

async function generateBatchSegments(
  batch: FeedItem[],
  tsLabel: string,
  contextArticles: ArchivedArticle[] | undefined,
  batchIndex: number,
  batchCount: number,
): Promise<BatchOutcome> {
  const prompt = buildBatchPrompt(
    batch,
    tsLabel,
    contextArticles,
    batchIndex,
    batchCount,
  );
  let raw = '';
  try {
    raw = await generate(prompt);
  } catch (err) {
    if (err instanceof OllamaError) {
      console.error(
        `[script] Ollama failed (batch ${batchIndex + 1}/${batchCount}):`,
        err.message,
      );
      return {
        segments: buildFallbackTopicSegments(batch),
        fallback: true,
        warning: err.message,
      };
    }
    throw err;
  }
  const jsonText = extractJson(raw);
  if (!jsonText) {
    return {
      segments: buildFallbackTopicSegments(batch),
      fallback: true,
      warning: 'Ollama の出力から JSON を抽出できませんでした。該当バッチは簡易原稿で補完します。',
    };
  }
  let parsed: ParsedScript;
  try {
    parsed = JSON.parse(jsonText) as ParsedScript;
  } catch (err) {
    console.warn(
      `[script] JSON parse failed (batch ${batchIndex + 1}/${batchCount}):`,
      err,
    );
    return {
      segments: buildFallbackTopicSegments(batch),
      fallback: true,
      warning: 'Ollama 応答の JSON パースに失敗。該当バッチは簡易原稿で補完します。',
    };
  }
  const rawSegs = Array.isArray(parsed.segments) ? parsed.segments : [];
  const segments: Segment[] = [];
  const remaining = new Set(batch.map((it) => it.id));
  for (const s of rawSegs) {
    const title = (s.title ?? '').toString().trim();
    const text = (s.text ?? '').toString().trim();
    if (!text) continue;
    const kind = normalizeKind(typeof s.kind === 'string' ? s.kind : undefined);
    // このバッチではトピックだけを受け取り、opening/closing は後段で付ける
    if (kind !== 'topic') continue;
    const seg: Segment = {
      id: randomUUID(),
      kind,
      title: title || '無題',
      text,
      sourceLinks: toStringArray(s.sourceLinks),
    };
    seg.article = matchArticle(s, batch, remaining);
    segments.push(seg);
  }
  if (segments.length === 0) {
    return {
      segments: buildFallbackTopicSegments(batch),
      fallback: true,
      warning: 'Ollama 応答にトピックが含まれていませんでした。該当バッチは簡易原稿で補完します。',
    };
  }
  return { segments, fallback: false };
}

export async function generateProgramScript(
  items: FeedItem[],
  contextArticles?: ArchivedArticle[],
): Promise<ScriptResult> {
  if (items.length === 0) {
    throw new Error('新着アイテムがありません');
  }
  const now = new Date();
  const tsInfo = resolveTimeSlot(now);
  const greetingKey = buildGreetingKey(now, tsInfo.slot);
  const lastKey = getLastGreetingSlot();
  const includeGreeting = lastKey !== greetingKey;

  const batches: FeedItem[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE));
  }

  // 小ネタはオープニング用にだけ必要で、無くても続行できるので
  // トピック生成と並列で動かし、失敗しても無視する。
  const triviaPromise = includeGreeting
    ? generateOpeningTrivia(tsInfo.label)
    : Promise.resolve<string | null>(null);

  const [triviaText, outcomes] = await Promise.all([
    triviaPromise,
    Promise.all(
      batches.map((b, idx) =>
        generateBatchSegments(
          b,
          tsInfo.label,
          contextArticles,
          idx,
          batches.length,
        ),
      ),
    ),
  ]);

  const topicSegments: Segment[] = [];
  let fallbackOccurred = false;
  let firstWarning: string | undefined;
  for (const o of outcomes) {
    topicSegments.push(...o.segments);
    if (o.fallback) {
      fallbackOccurred = true;
      if (!firstWarning && o.warning) firstWarning = o.warning;
    }
  }

  if (topicSegments.length === 0) {
    const program = buildFallbackProgram(items, tsInfo, includeGreeting, triviaText);
    setLastGreetingSlot(greetingKey);
    return {
      program,
      fallback: true,
      warning: firstWarning ?? '原稿を生成できませんでした。簡易原稿で続行します。',
    };
  }

  const segments: Segment[] = [];
  if (includeGreeting) {
    segments.push(buildOpeningSegment(tsInfo.greeting, triviaText));
  }
  segments.push(...topicSegments);
  segments.push(buildClosingSegment());

  setLastGreetingSlot(greetingKey);
  return {
    program: {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      title: tsInfo.title,
      segments,
    },
    fallback: fallbackOccurred,
    warning: fallbackOccurred ? firstWarning : undefined,
  };
}
