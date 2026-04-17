import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type { Program } from '../../src/types/program';

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diffMin = Math.floor((now - d.getTime()) / 60000);
  if (diffMin < 1) return 'たった今';
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

function countTopics(program: Program): number {
  return program.segments.filter((s) => s.kind === 'topic').length;
}

function firstTopicTitles(program: Program, n: number): string[] {
  return program.segments
    .filter((s) => s.kind === 'topic')
    .slice(0, n)
    .map((s) => s.title);
}

export default function TimelinePage() {
  const router = useRouter();
  const [items, setItems] = useState<Program[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.radioAPI) {
      setError('Electron 連携の初期化に失敗しました。アプリを再起動してください。');
      return;
    }
    let mounted = true;
    window.radioAPI
      .listProgramHistory()
      .then((list) => {
        if (!mounted) return;
        setItems(list);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(`履歴の取得に失敗しました: ${String(err)}`);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handlePlay = useCallback(
    async (id: string) => {
      if (!window.radioAPI) return;
      setLoadingId(id);
      try {
        const p = await window.radioAPI.loadProgram(id);
        if (!p) {
          setError('この番組は読み込めませんでした');
          return;
        }
        await window.radioAPI.play();
        router.push('/?from=timeline');
      } catch (err) {
        setError(`再生に失敗しました: ${String(err)}`);
      } finally {
        setLoadingId(null);
      }
    },
    [router],
  );

  return (
    <>
      <Head>
        <title>過去のラジオ - 作業用ラジオ</title>
      </Head>
      <main className="app">
        <header className="app__drag">
          <span className="app__title">過去のラジオ</span>
        </header>

        <section className="timeline">
          {error ? <p className="warning">{error}</p> : null}
          {items === null && !error ? (
            <p className="progress__msg">読み込み中…</p>
          ) : null}
          {items && items.length === 0 ? (
            <p className="timeline__empty">まだ番組がありません</p>
          ) : null}
          {items && items.length > 0 ? (
            <ul className="timeline__list">
              {items.map((p) => {
                const topics = countTopics(p);
                const sample = firstTopicTitles(p, 2);
                const loading = loadingId === p.id;
                return (
                  <li key={p.id} className="timeline__item timeline__item--program">
                    <div className="timeline__body">
                      <button
                        type="button"
                        className="timeline__title"
                        onClick={() => handlePlay(p.id)}
                        disabled={loading}
                        title="この番組を再生する"
                      >
                        {p.title}
                      </button>
                      <span className="timeline__meta">
                        {formatCreatedAt(p.createdAt)}
                        {topics > 0 ? ` ・ ${topics}本` : ''}
                      </span>
                      {sample.length > 0 ? (
                        <p className="timeline__summary">
                          {sample.join(' / ')}
                          {topics > sample.length ? ' ほか' : ''}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="controls__secondary timeline__play"
                      onClick={() => handlePlay(p.id)}
                      disabled={loading}
                    >
                      {loading ? '読込中…' : '再生'}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>

        <footer className="app__footer">
          <Link href="/" className="app__link">
            ← プレイヤーへ戻る
          </Link>
        </footer>
      </main>
    </>
  );
}
