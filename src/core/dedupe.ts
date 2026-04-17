import type { FeedItem } from '../types/program';
import { getSeenRecords, markItemsSeen } from './storage';

export function pickNewItems(items: FeedItem[]): FeedItem[] {
  const seen = new Set(getSeenRecords().map((r) => r.id));
  const seenInBatch = new Set<string>();
  const fresh: FeedItem[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    if (seenInBatch.has(it.id)) continue;
    seenInBatch.add(it.id);
    fresh.push(it);
  }
  return fresh;
}

export function commitSeen(items: FeedItem[]): void {
  markItemsSeen(items.map((i) => i.id));
}
