import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import type { Feed } from '../../src/types/program';

const MAX_FEEDS = 10;

export default function FeedsPage() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [presets, setPresets] = useState<Feed[]>([]);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [addingUrl, setAddingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.radioAPI) return;
    const lang =
      typeof navigator !== 'undefined' ? navigator.language || 'ja' : 'ja';
    window.radioAPI
      .listRecommendedFeeds(lang)
      .then(setPresets)
      .catch(() => setPresets([]));
  }, []);

  const registeredUrls = useMemo(
    () => new Set(feeds.map((f) => f.url)),
    [feeds],
  );
  const atLimit = feeds.length >= MAX_FEEDS;

  const refresh = useCallback(async () => {
    if (!window.radioAPI) {
      setError('Electron 連携の初期化に失敗しました。アプリを再起動してください。');
      return;
    }
    try {
      const next = await window.radioAPI.listFeeds();
      setFeeds(next);
    } catch (err) {
      setError(`フィード一覧の取得に失敗しました: ${String(err)}`);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    refresh();
  }, [refresh]);

  const handleAdd = useCallback(async () => {
    if (!window.radioAPI) {
      setError('Electron 連携の初期化に失敗しました。アプリを再起動してください。');
      return;
    }
    const trimmed = url.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      new URL(trimmed);
    } catch {
      setError('URL の形式が正しくありません');
      setBusy(false);
      return;
    }
    try {
      const next = await window.radioAPI.addFeed(trimmed);
      setFeeds(next);
      setUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : `追加に失敗しました: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [url]);

  const handleAddPreset = useCallback(async (presetUrl: string) => {
    if (!window.radioAPI) return;
    setAddingUrl(presetUrl);
    setError(null);
    try {
      const next = await window.radioAPI.addFeed(presetUrl);
      setFeeds(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : `追加に失敗しました: ${String(err)}`);
    } finally {
      setAddingUrl(null);
    }
  }, []);

  const handleRemove = useCallback(async (id: string) => {
    if (!window.radioAPI) {
      setError('Electron 連携の初期化に失敗しました。アプリを再起動してください。');
      return;
    }
    setBusy(true);
    try {
      const next = await window.radioAPI.removeFeed(id);
      setFeeds(next);
    } catch (err) {
      setError(`削除に失敗しました: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <>
      <Head>
        <title>フィード管理 - 作業用ラジオ</title>
      </Head>
      <main className="app">
        <header className="app__drag">
          <span className="app__title">フィード管理</span>
        </header>

        <section className="feeds">
          <div className="feeds__add">
            <input
              type="url"
              className="feeds__input"
              placeholder="https://example.com/feed.xml"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy || atLimit}
            />
            <button
              type="button"
              className="controls__secondary"
              onClick={handleAdd}
              disabled={busy || atLimit || !url.trim()}
            >
              追加
            </button>
          </div>
          <p className="feeds__limit">
            登録数 {feeds.length} / {MAX_FEEDS}
            {atLimit ? '（上限に達しました。削除してから追加してください）' : ''}
          </p>
          {error ? <p className="warning">{error}</p> : null}

          <h2 className="settings__heading">おすすめ</h2>
          <ul className="feeds__list">
            {presets.map((p) => {
              const added = registeredUrls.has(p.url);
              const adding = addingUrl === p.url;
              return (
                <li key={p.id} className="feeds__item feeds__preset">
                  <div className="feeds__item-main">
                    <span className="feeds__item-title">{p.title}</span>
                    <span className="feeds__item-url">{p.url}</span>
                  </div>
                  <button
                    type="button"
                    className="controls__secondary"
                    onClick={() => handleAddPreset(p.url)}
                    disabled={added || adding || (atLimit && !added)}
                  >
                    {added ? '追加済み' : adding ? '追加中…' : '追加'}
                  </button>
                </li>
              );
            })}
          </ul>

          <h2 className="settings__heading">登録中のフィード</h2>
          <ul className="feeds__list">
            {feeds.length === 0 ? (
              <li className="feeds__empty">フィードがありません</li>
            ) : null}
            {feeds.map((f) => (
              <li key={f.id} className="feeds__item">
                <div className="feeds__item-main">
                  <span className="feeds__item-title">{f.title}</span>
                  <span className="feeds__item-url">{f.url}</span>
                </div>
                <button
                  type="button"
                  className="feeds__remove"
                  onClick={() => handleRemove(f.id)}
                  disabled={busy}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
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
