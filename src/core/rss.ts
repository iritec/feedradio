import Parser from 'rss-parser';
import type { Feed, FeedItem } from '../types/program';

type ExtendedItem = Parser.Item & {
  enclosure?: { url?: string };
  'media:thumbnail'?: { $?: { url?: string } } | string;
  'media:content'?: { $?: { url?: string } } | string;
  content?: string;
  contentSnippet?: string;
  summary?: string;
  description?: string;
  'content:encoded'?: string;
  contentEncoded?: string;
};

const parser: Parser<unknown, ExtendedItem> = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'sagyo-radio/0.1 (+https://localhost)',
  },
  customFields: {
    item: [
      ['media:thumbnail', 'media:thumbnail'],
      ['media:content', 'media:content'],
      ['content:encoded', 'contentEncoded'],
      ['description', 'description'],
      ['summary', 'summary'],
    ],
  },
});

function stripHtml(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const DESCRIPTION_MAX_LEN = 400;

function extractDescription(item: ExtendedItem): string | undefined {
  const candidates: Array<string | undefined> = [
    item.contentSnippet,
    item.summary,
    item.description,
    item.contentEncoded,
    item['content:encoded'],
    item.content,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const cleaned = stripHtml(c.toString());
    if (cleaned) return cleaned.slice(0, DESCRIPTION_MAX_LEN);
  }
  return undefined;
}

const OGP_FETCH_TIMEOUT_MS = 6000;
const OGP_CONCURRENCY = 4;

function pickId(item: Parser.Item, fallback: string): string {
  const guid = (item.guid ?? '').toString().trim();
  const link = (item.link ?? '').toString().trim();
  return guid || link || fallback;
}

function pickImageFromRssItem(item: ExtendedItem): string | undefined {
  const enclosureUrl = item.enclosure?.url?.trim();
  if (enclosureUrl) return enclosureUrl;

  const mt = item['media:thumbnail'];
  if (typeof mt === 'string' && mt.trim()) return mt.trim();
  if (mt && typeof mt === 'object' && mt.$?.url) return mt.$.url;

  const mc = item['media:content'];
  if (typeof mc === 'string' && mc.trim()) return mc.trim();
  if (mc && typeof mc === 'object' && mc.$?.url) return mc.$.url;

  // content 内の最初の <img src="...">
  const html = item.content ?? '';
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (match && match[1]) return match[1];

  return undefined;
}

async function fetchOgImage(pageUrl: string): Promise<string | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OGP_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(pageUrl, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'sagyo-radio/0.1 (+https://localhost)' },
    });
    if (!res.ok) return undefined;
    const html = await res.text();
    // og:image / twitter:image の meta タグを拾う
    const ogMatch =
      html.match(
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      ) ??
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      ) ??
      html.match(
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      );
    if (!ogMatch) return undefined;
    const raw = ogMatch[1].trim();
    if (!raw) return undefined;
    try {
      return new URL(raw, pageUrl).toString();
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function enrichWithOgImages(items: FeedItem[]): Promise<void> {
  const needs = items.filter((it) => !it.ogImage && it.link);
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < needs.length) {
      const my = idx++;
      const target = needs[my];
      const img = await fetchOgImage(target.link);
      if (img) target.ogImage = img;
    }
  }
  const workers = Array.from(
    { length: Math.min(OGP_CONCURRENCY, needs.length) },
    () => worker(),
  );
  await Promise.all(workers);
}

export async function fetchFeed(feed: Feed): Promise<FeedItem[]> {
  try {
    const parsed = await parser.parseURL(feed.url);
    const items: FeedItem[] = [];
    for (let i = 0; i < (parsed.items ?? []).length; i++) {
      const it = parsed.items[i];
      const id = pickId(it, `${feed.id}:${i}`);
      const title = (it.title ?? '').toString().trim();
      const link = (it.link ?? '').toString().trim();
      if (!title || !link) continue;
      items.push({
        id,
        feedId: feed.id,
        title,
        link,
        description: extractDescription(it),
        pubDate: (it.isoDate ?? it.pubDate ?? '').toString() || undefined,
        ogImage: pickImageFromRssItem(it),
      });
    }
    return items;
  } catch (err) {
    console.error(`[rss] failed to fetch feed ${feed.url}:`, err);
    return [];
  }
}

export async function fetchAllFeeds(feeds: Feed[]): Promise<FeedItem[]> {
  const enabled = feeds.filter((f) => f.enabled);
  const results = await Promise.all(enabled.map((f) => fetchFeed(f)));
  const items = results.flat();
  // RSS から画像が取れなかったものは og:image を追加取得（並列上限あり）
  await enrichWithOgImages(items);
  return items;
}
