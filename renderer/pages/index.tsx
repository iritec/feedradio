import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type {
  ProgressEvent,
  SegmentChangeEvent,
} from '../../src/types/ipc';
import type { Program, Segment } from '../../src/types/program';

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const STORAGE_VOLUME = 'radio.volume';
const STORAGE_RATE = 'radio.rate';
// 記事間の無音（最後の記事のあとは挿入しない）
const INTER_SEGMENT_SILENCE_MS = 2500;
// 「番組ができました」通知を自動で閉じるまでの時間
const READY_AUTO_CLOSE_MS = 3000;
// オープニングの裏に流すジングル。
// 絶対 `/xxx` だと Electron の file:// 配信でルートへ解決されてしまうため、
// Next.js exports が同階層に置くファイルを相対パスで参照する。
const OPENING_JINGLE_SRC = './opening-jingle.mp3';
// オープニング本体の音量を 1 としたときのジングルの相対音量
const JINGLE_VOLUME_RATIO = 0.08;
// フェードアウトにかける時間（ms）と更新ステップ（ms）
const JINGLE_FADE_MS = 1500;
const JINGLE_FADE_STEP_MS = 50;

function SpeakerIcon({ level }: { level: number }): JSX.Element {
  // 0: ミュート / 0<x<0.5: 低 / 0.5<=x<0.9: 中 / 0.9<=: 高
  const showWave1 = level > 0.01;
  const showWave2 = level >= 0.5;
  const showWave3 = level >= 0.9;
  const muted = level <= 0.01;
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 9h3.5L13 4.5v15L7.5 15H4z" fill="currentColor" stroke="currentColor" />
      {muted ? (
        <>
          <line x1="17" y1="9" x2="22" y2="14" />
          <line x1="22" y1="9" x2="17" y2="14" />
        </>
      ) : (
        <>
          {showWave1 ? <path d="M16 9.5a4 4 0 0 1 0 5" /> : null}
          {showWave2 ? <path d="M18.5 7a7 7 0 0 1 0 10" /> : null}
          {showWave3 ? <path d="M21 4.5a10.5 10.5 0 0 1 0 15" /> : null}
        </>
      )}
    </svg>
  );
}

function formatCreatedAt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm} 作成`;
}

export default function Home() {
  const router = useRouter();
  const fromTimeline = router.query.from === 'timeline';
  const [program, setProgram] = useState<Program | null>(null);
  const [autoFetchNextAt, setAutoFetchNextAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [generating, setGenerating] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTitle, setCurrentTitle] = useState<string>('番組なし');
  const [currentSegment, setCurrentSegment] = useState<Segment | null>(null);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [totalSegments, setTotalSegments] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [audioWarning, setAudioWarning] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const [ready, setReady] = useState(false);
  const [volume, setVolume] = useState(1);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // オープニング裏のジングル用 audio（React 外で管理）
  const jingleRef = useRef<HTMLAudioElement | null>(null);
  const jingleFadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 記事間の無音タイマー（切替やUnmount時に必ずクリア）
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ready 通知の自動クローズタイマー
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // src を設定した直後に playbackRate をもう一度適用するためのラッチ
  const lastRateRef = useRef<number>(1);
  // handleSegmentChange から最新値を参照するためのラッチ（再購読を避ける）
  const volumeRef = useRef<number>(1);

  const playableSegments = useMemo(
    () => program?.segments.filter((s) => !!s.audioPath).length ?? 0,
    [program],
  );
  const hasProgram = !!program;
  const allMuted = hasProgram && playableSegments === 0;
  const someMuted =
    hasProgram &&
    playableSegments > 0 &&
    playableSegments < (program?.segments.length ?? 0);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const clearJingleFadeTimer = useCallback(() => {
    if (jingleFadeTimerRef.current) {
      clearInterval(jingleFadeTimerRef.current);
      jingleFadeTimerRef.current = null;
    }
  }, []);

  const getJingleEl = useCallback((): HTMLAudioElement | null => {
    if (typeof window === 'undefined') return null;
    if (!jingleRef.current) {
      const el = new Audio(OPENING_JINGLE_SRC);
      el.loop = true;
      el.preload = 'auto';
      jingleRef.current = el;
    }
    return jingleRef.current;
  }, []);

  const startJingle = useCallback(() => {
    const el = getJingleEl();
    if (!el) return;
    clearJingleFadeTimer();
    const target = Math.max(0, Math.min(1, volumeRef.current)) * JINGLE_VOLUME_RATIO;
    el.volume = target;
    if (el.paused) {
      try {
        el.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
    el.play().catch((err) => {
      console.warn('jingle play failed', err);
    });
  }, [clearJingleFadeTimer, getJingleEl]);

  const fadeOutJingle = useCallback(() => {
    const el = jingleRef.current;
    if (!el) return;
    if (el.paused && el.volume === 0) return;
    clearJingleFadeTimer();
    const startVol = el.volume;
    if (startVol <= 0) {
      el.pause();
      return;
    }
    const steps = Math.max(1, Math.floor(JINGLE_FADE_MS / JINGLE_FADE_STEP_MS));
    let n = 0;
    jingleFadeTimerRef.current = setInterval(() => {
      n += 1;
      const ratio = Math.max(0, 1 - n / steps);
      if (!jingleRef.current) {
        clearJingleFadeTimer();
        return;
      }
      jingleRef.current.volume = startVol * ratio;
      if (n >= steps) {
        clearJingleFadeTimer();
        jingleRef.current.pause();
        try {
          jingleRef.current.currentTime = 0;
        } catch {
          /* ignore */
        }
      }
    }, JINGLE_FADE_STEP_MS);
  }, [clearJingleFadeTimer]);

  const stopJingleImmediate = useCallback(() => {
    clearJingleFadeTimer();
    const el = jingleRef.current;
    if (!el) return;
    el.pause();
    el.volume = 0;
    try {
      el.currentTime = 0;
    } catch {
      /* ignore */
    }
  }, [clearJingleFadeTimer]);

  // localStorage から音量・速度を復元
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedVol = window.localStorage.getItem(STORAGE_VOLUME);
    if (savedVol !== null) {
      const n = Number(savedVol);
      if (Number.isFinite(n)) setVolume(Math.min(1, Math.max(0, n)));
    }
    const savedRate = window.localStorage.getItem(STORAGE_RATE);
    if (savedRate !== null) {
      const n = Number(savedRate);
      if (Number.isFinite(n) && n > 0) {
        setPlaybackRate(n);
        lastRateRef.current = n;
      }
    }
  }, []);

  // audio 要素への反映
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    volumeRef.current = volume;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_VOLUME, String(volume));
    }
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackRate;
    lastRateRef.current = playbackRate;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_RATE, String(playbackRate));
    }
  }, [playbackRate]);

  // 本体音量が変わったら、再生中のジングルにも比率を反映
  useEffect(() => {
    const el = jingleRef.current;
    if (!el || el.paused) return;
    el.volume = Math.max(0, Math.min(1, volume)) * JINGLE_VOLUME_RATIO;
  }, [volume]);

  // オープニング中だけジングルを流し、抜けたらフェードアウト
  useEffect(() => {
    const isOpening = currentSegment?.kind === 'opening';
    if (isOpening && playing) {
      startJingle();
    } else {
      fadeOutJingle();
    }
  }, [currentSegment, playing, startJingle, fadeOutJingle]);

  // unmount 時はジングルを確実に止める
  useEffect(() => {
    return () => {
      stopJingleImmediate();
    };
  }, [stopJingleImmediate]);

  const handleSegmentChange = useCallback(
    (evt: SegmentChangeEvent) => {
      clearSilenceTimer();
      setPlaying(evt.playing);
      setCurrentTitle(evt.title);
      setCurrentSegment(evt.segment ?? null);
      setSegmentIndex(evt.segmentIndex);
      setTotalSegments(evt.totalSegments);
      setHasNext(evt.hasNext);
      setHasPrev(evt.hasPrev);
      setCreatedAt(evt.createdAt);

      const audio = audioRef.current;
      if (!audio) return;

      // 一時停止: 再生位置を保持するため src は消さない
      if (!evt.playing) {
        audio.pause();
        if (evt.audioUrl && audio.src !== evt.audioUrl) {
          audio.src = evt.audioUrl;
        } else if (!evt.audioUrl) {
          audio.removeAttribute('src');
          audio.load();
        }
        return;
      }

      if (!evt.audioUrl) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        return;
      }
      if (!evt.segment?.audioPath) {
        // 自動で次へ（警告は上部バナーで常時表示するのでここでは出さない）
        window.radioAPI.nextSegment();
        return;
      }
      setAudioWarning(null);
      if (audio.src !== evt.audioUrl) {
        audio.src = evt.audioUrl;
      }
      // src 変更で playbackRate がリセットされるケースがあるため、
      // 明示的に直前の選択値を再適用する。
      audio.playbackRate = lastRateRef.current;
      audio.volume = volumeRef.current;
      audio.play().catch((err) => {
        console.error('audio.play failed', err);
        setAudioWarning(`再生に失敗しました: ${String(err)}`);
      });
    },
    [clearSilenceTimer],
  );

  // 初期ロード: 既存番組とリスナー登録
  useEffect(() => {
    if (typeof window === 'undefined' || !window.radioAPI) return;
    setReady(true);

    let mounted = true;
    window.radioAPI.getCurrentProgram().then((p) => {
      if (!mounted) return;
      if (p) {
        setProgram(p);
        setCurrentTitle(p.title);
        setTotalSegments(p.segments.length);
        setCreatedAt(p.createdAt);
      }
    });
    // 直前のセグメント状態を能動的に取り込み、audio.src を設定する
    // （過去のラジオ画面などから遷移してきた直後は、emit された
    //  segment-change イベントをリスナー登録前に取りこぼしているため）
    window.radioAPI.getSegmentState().then((evt) => {
      if (!mounted) return;
      handleSegmentChange(evt);
    });

    const offProgress = window.radioAPI.onProgress((evt) => {
      setProgress(evt);
      if (evt.phase === 'ready' || evt.phase === 'error') {
        setGenerating(false);
      }
      // 通知は短く、ready は 3秒で自動クローズ
      if (readyTimerRef.current) {
        clearTimeout(readyTimerRef.current);
        readyTimerRef.current = null;
      }
      if (evt.phase === 'ready') {
        readyTimerRef.current = setTimeout(() => {
          setProgress(null);
          readyTimerRef.current = null;
        }, READY_AUTO_CLOSE_MS);
      }
    });

    const offSegment = window.radioAPI.onSegmentChange((evt) => {
      handleSegmentChange(evt);
    });

    return () => {
      mounted = false;
      offProgress();
      offSegment();
      if (readyTimerRef.current) {
        clearTimeout(readyTimerRef.current);
        readyTimerRef.current = null;
      }
    };
  }, [handleSegmentChange]);

  const handleGenerate = useCallback(async () => {
    if (!window.radioAPI) return;
    setGenerating(true);
    setProgress({ phase: 'fetching', message: '開始しています…' });
    const p = await window.radioAPI.generateProgram();
    if (p) {
      setProgram(p);
      setCurrentTitle(p.title);
      setTotalSegments(p.segments.length);
      setCreatedAt(p.createdAt);
    }
  }, []);

  const handlePlay = useCallback(async () => {
    if (!window.radioAPI) return;
    await window.radioAPI.play();
  }, []);

  const handlePause = useCallback(async () => {
    if (!window.radioAPI) return;
    await window.radioAPI.stop();
  }, []);

  const handleNext = useCallback(async () => {
    if (!window.radioAPI) return;
    clearSilenceTimer();
    await window.radioAPI.nextSegment();
  }, [clearSilenceTimer]);

  const handlePrev = useCallback(async () => {
    if (!window.radioAPI) return;
    clearSilenceTimer();
    await window.radioAPI.prevSegment();
  }, [clearSilenceTimer]);

  const handleAudioEnded = useCallback(() => {
    if (!window.radioAPI) return;
    clearSilenceTimer();
    // 記事間に 2〜3秒の間を入れる。最後の記事の後は遅延なし。
    if (hasNext) {
      silenceTimerRef.current = setTimeout(() => {
        silenceTimerRef.current = null;
        window.radioAPI?.nextSegment();
      }, INTER_SEGMENT_SILENCE_MS);
    } else {
      window.radioAPI.nextSegment();
    }
  }, [hasNext, clearSilenceTimer]);

  const handleOpenArticle = useCallback(async () => {
    const url = currentSegment?.article?.url ?? currentSegment?.sourceLinks?.[0];
    if (!url || !window.radioAPI) return;
    await window.radioAPI.openExternal(url);
  }, [currentSegment]);

  // キーボードショートカット: ← → で前後移動
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!hasProgram) return;
      const target = e.target as HTMLElement | null;
      // 入力系にフォーカスがある時は無視
      if (target && /^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName)) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasProgram, handleNext, handlePrev]);

  useEffect(() => () => clearSilenceTimer(), [clearSilenceTimer]);

  // 次回自動取得予定を 30 秒おきに更新
  useEffect(() => {
    if (typeof window === 'undefined' || !window.radioAPI) return;
    let mounted = true;
    const refreshStatus = async () => {
      try {
        const s = await window.radioAPI.getAutoFetchStatus();
        if (!mounted) return;
        setAutoFetchNextAt(s.nextAt);
      } catch {
        /* ignore */
      }
    };
    void refreshStatus();
    const statusTimer = setInterval(refreshStatus, 30 * 1000);
    const nowTimer = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => {
      mounted = false;
      clearInterval(statusTimer);
      clearInterval(nowTimer);
    };
  }, []);

  // 生成完了後に次回予定を再取得
  useEffect(() => {
    if (!window.radioAPI) return;
    if (generating) return;
    window.radioAPI.getAutoFetchStatus().then((s) => {
      setAutoFetchNextAt(s.nextAt);
    });
  }, [generating]);

  const nextAutoFetchLabel = useMemo(() => {
    if (!autoFetchNextAt) return null;
    const diffMs = autoFetchNextAt - now;
    if (diffMs <= 0) return 'まもなく';
    const totalMin = Math.round(diffMs / 60000);
    if (totalMin < 1) return 'まもなく';
    if (totalMin < 60) return `約${totalMin}分後`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m === 0 ? `約${h}時間後` : `約${h}時間${m}分後`;
  }, [autoFetchNextAt, now]);

  const phaseLabel = progress
    ? {
        fetching: '取得中',
        scripting: '原稿生成中',
        synthesizing: '音声合成中',
        ready: '準備OK',
        error: 'エラー',
      }[progress.phase]
    : null;

  const article = currentSegment?.article;
  const articleUrl = article?.url ?? currentSegment?.sourceLinks?.[0] ?? null;
  const imageOk =
    !!article?.ogImage && !failedImages.has(article.ogImage);
  const humanCreatedAt = formatCreatedAt(createdAt);
  const pageLabel =
    totalSegments > 0 ? `${Math.min(segmentIndex + 1, totalSegments)} / ${totalSegments}` : null;

  return (
    <>
      <Head>
        <title>作業用ラジオ</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main className="app">
        <header className="app__drag app__drag--with-back">
          {fromTimeline ? (
            <button
              type="button"
              className="app__back"
              onClick={() => router.push('/timeline')}
              aria-label="過去のラジオに戻る"
              title="過去のラジオに戻る"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
              <span>過去のラジオ</span>
            </button>
          ) : null}
          <span className="app__title">作業用ラジオ</span>
        </header>

        <section className="player">
          <p className="player__label">Now Playing</p>
          <h1 className="player__title">{currentTitle}</h1>
          {humanCreatedAt ? (
            <p className="player__meta">{humanCreatedAt}</p>
          ) : null}

          {article || currentSegment ? (
            <div className="article">
              {imageOk && article?.ogImage ? (
                <div
                  className="article__thumb"
                  role={articleUrl ? 'button' : undefined}
                  tabIndex={articleUrl ? 0 : -1}
                  onClick={articleUrl ? handleOpenArticle : undefined}
                  onKeyDown={(e) => {
                    if (!articleUrl) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleOpenArticle();
                    }
                  }}
                  aria-label={articleUrl ? '元記事をブラウザで開く' : undefined}
                >
                  <img
                    src={article.ogImage}
                    alt=""
                    onError={() => {
                      const src = article.ogImage;
                      if (!src) return;
                      setFailedImages((prev) => {
                        if (prev.has(src)) return prev;
                        const next = new Set(prev);
                        next.add(src);
                        return next;
                      });
                    }}
                  />
                </div>
              ) : null}
              <div className="article__body">
                {articleUrl ? (
                  <button
                    type="button"
                    className="article__title article__title--link"
                    onClick={handleOpenArticle}
                    title="元記事をブラウザで開く"
                  >
                    {article?.title ?? currentSegment?.title ?? ''}
                  </button>
                ) : (
                  <span className="article__title">
                    {article?.title ?? currentSegment?.title ?? ''}
                  </span>
                )}
                {article?.summary ? (
                  <p className="article__summary">{article.summary}</p>
                ) : null}
                {articleUrl ? (
                  <button
                    type="button"
                    className="article__link"
                    onClick={handleOpenArticle}
                  >
                    元記事を開く
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {progress ? (
            <div className={`progress progress--${progress.phase}`}>
              <span className="progress__label">{phaseLabel}</span>
              <span className="progress__msg">{progress.message}</span>
            </div>
          ) : null}
          {allMuted ? (
            <p className="warning">
              音声合成に失敗しているため再生できません。ターミナルで `say` が動くか、VoxCPM の設定を確認してください。
            </p>
          ) : someMuted ? (
            <p className="warning">
              音声NG {(program?.segments.length ?? 0) - playableSegments}/{program?.segments.length}・該当セグメントは自動でスキップします。
            </p>
          ) : null}
          {audioWarning ? <p className="warning">{audioWarning}</p> : null}
        </section>

        <section className="controls">
          <div className="controls__generate">
            <button
              type="button"
              className="controls__secondary"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? '生成中…' : '番組を作る'}
            </button>
            {!generating && nextAutoFetchLabel ? (
              <span className="controls__next">
                次の自動取得: {nextAutoFetchLabel}
              </span>
            ) : null}
          </div>
          <div className="controls__main">
            <button
              type="button"
              className="controls__skip"
              onClick={handlePrev}
              disabled={!hasProgram || !hasPrev}
              aria-label="前の記事へ"
              title="前の記事へ（←）"
            >
              ⏮
            </button>
            {playing ? (
              <button
                type="button"
                className="controls__btn controls__btn--pause"
                onClick={handlePause}
                aria-label="一時停止"
              >
                ⏸
              </button>
            ) : (
              <button
                type="button"
                className="controls__btn controls__btn--play"
                onClick={handlePlay}
                aria-label="再生"
                disabled={!program || allMuted}
                title={
                  allMuted ? '音声合成が失敗しているため再生できません' : undefined
                }
              >
                ▶
              </button>
            )}
            <button
              type="button"
              className="controls__skip"
              onClick={handleNext}
              disabled={!hasProgram || !hasNext}
              aria-label="次の記事へ"
              title="次の記事へ（→）"
            >
              ⏭
            </button>
          </div>
          {pageLabel ? <p className="controls__page">{pageLabel}</p> : null}
          <div className="controls__extras">
            <label className="controls__extras-item">
              <span className="controls__extras-icon" aria-hidden>
                <SpeakerIcon level={volume} />
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="音量"
              />
            </label>
            <label className="controls__extras-item">
              <span className="controls__extras-label">速度</span>
              <select
                value={playbackRate}
                onChange={(e) => setPlaybackRate(Number(e.target.value))}
                aria-label="再生速度"
              >
                {PLAYBACK_RATES.map((r) => (
                  <option key={r} value={r}>
                    {r.toFixed(2).replace(/\.?0+$/, '')}×
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <footer className="app__footer">
          <span
            className={`status-dot ${ready ? 'status-dot--on' : 'status-dot--off'}`}
          />
          <span>{ready ? 'ready' : 'bridge未接続'}</span>
          <Link href="/timeline" className="app__link">
            過去のラジオ
          </Link>
          <Link href="/settings" className="app__link">
            設定
          </Link>
          <Link href="/feeds" className="app__link">
            フィード管理
          </Link>
        </footer>

        <audio
          ref={audioRef}
          onEnded={handleAudioEnded}
          onLoadedMetadata={() => {
            // src を読み込んだ直後も速度がリセットされることがあるため、
            // メタデータ到着のタイミングでも再適用する。
            const audio = audioRef.current;
            if (audio) audio.playbackRate = lastRateRef.current;
          }}
          style={{ display: 'none' }}
        />
      </main>
    </>
  );
}
