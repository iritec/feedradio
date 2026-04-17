import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { addFeed, listFeeds, removeFeed } from '../src/core/storage';
import { generateProgram, programAudioDir } from '../src/core/program';
import { randomUUID } from 'crypto';

async function main() {
  await app.whenReady();
  console.log('[mvp-test] app ready');

  const testFeedUrl = 'https://feeds.bbci.co.uk/japanese/rss.xml';

  const existing = listFeeds();
  for (const f of existing) removeFeed(f.id);

  addFeed({
    id: randomUUID(),
    url: testFeedUrl,
    title: testFeedUrl,
    enabled: true,
  });
  console.log('[mvp-test] feeds after add:', listFeeds().length);

  const program = await generateProgram(null);
  if (!program) {
    console.error('[mvp-test] FAIL: program generation returned null');
    app.quit();
    process.exitCode = 2;
    return;
  }

  console.log('[mvp-test] program id:', program.id);
  console.log('[mvp-test] program title:', program.title);
  console.log('[mvp-test] segment count:', program.segments.length);

  let withAudio = 0;
  let totalBytes = 0;
  for (const seg of program.segments) {
    console.log(
      `  - ${seg.kind} "${seg.title}" audio=${seg.audioPath ? 'yes' : 'no'}`,
    );
    if (seg.audioPath && fs.existsSync(seg.audioPath)) {
      withAudio++;
      totalBytes += fs.statSync(seg.audioPath).size;
    }
  }
  console.log(
    `[mvp-test] segments_with_audio=${withAudio}/${program.segments.length}, total_wav_bytes=${totalBytes}`,
  );

  const dir = programAudioDir(program.id);
  console.log('[mvp-test] audio dir:', dir);
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir);
    console.log('[mvp-test] audio files:', files);
  }

  console.log(
    withAudio > 0
      ? '[mvp-test] PASS: generated program with audio'
      : '[mvp-test] FAIL: no audio produced',
  );
  process.exitCode = withAudio > 0 ? 0 : 1;

  setTimeout(() => app.quit(), 200);
}

main().catch((err) => {
  console.error('[mvp-test] unexpected error:', err);
  process.exitCode = 3;
  setTimeout(() => app.quit(), 200);
});
