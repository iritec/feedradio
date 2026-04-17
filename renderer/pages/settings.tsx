import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import type {
  AutoFetchSettings,
  ElevenLabsVoice,
  TtsSettings,
  TtsTestResult,
  VoicevoxSpeaker,
} from '../../src/types/program';

const ELEVENLABS_MODELS = [
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2（高品質・日本語◎）' },
  { id: 'eleven_turbo_v2_5', label: 'Turbo v2.5（低レイテンシ）' },
  { id: 'eleven_flash_v2_5', label: 'Flash v2.5（最速）' },
];

const AUTO_FETCH_INTERVALS = [
  { value: 10, label: '10分ごと' },
  { value: 15, label: '15分ごと' },
  { value: 30, label: '30分ごと' },
  { value: 60, label: '1時間ごと' },
  { value: 120, label: '2時間ごと' },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<TtsSettings | null>(null);
  const [speakers, setSpeakers] = useState<VoicevoxSpeaker[]>([]);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [voicevoxError, setVoicevoxError] = useState<string | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TtsTestResult | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [hasProgram, setHasProgram] = useState(false);
  const [resynthesizing, setResynthesizing] = useState(false);
  const [resynthMsg, setResynthMsg] = useState<string | null>(null);
  const [autoFetch, setAutoFetch] = useState<AutoFetchSettings | null>(null);
  const [autoFetchMsg, setAutoFetchMsg] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.radioAPI) return;
    window.radioAPI.getTtsSettings().then(setSettings);
    window.radioAPI.getCurrentProgram().then((p) => setHasProgram(!!p));
    window.radioAPI.getAutoFetchSettings().then(setAutoFetch);
  }, []);

  const saveAutoFetchInterval = useCallback(
    async (intervalMinutes: number) => {
      if (!window.radioAPI || !autoFetch) return;
      const saved = await window.radioAPI.setAutoFetchSettings({
        ...autoFetch,
        intervalMinutes,
      });
      setAutoFetch(saved);
      setAutoFetchMsg('保存しました');
      setTimeout(() => setAutoFetchMsg(null), 2000);
    },
    [autoFetch],
  );

  const fetchSpeakers = useCallback(async (baseUrl: string) => {
    if (!window.radioAPI) return;
    setVoicevoxError(null);
    try {
      const list = await window.radioAPI.listVoicevoxSpeakers(baseUrl);
      setSpeakers(list);
    } catch (err) {
      setSpeakers([]);
      setVoicevoxError(
        `VOICEVOXに接続できません。VOICEVOXアプリを起動してください。（${
          err instanceof Error ? err.message : String(err)
        }）`,
      );
    }
  }, []);

  const fetchVoices = useCallback(async (apiKey: string) => {
    if (!window.radioAPI) return;
    setVoicesError(null);
    if (!apiKey) {
      setVoices([]);
      return;
    }
    try {
      const list = await window.radioAPI.listElevenLabsVoices(apiKey);
      setVoices(list);
    } catch (err) {
      setVoices([]);
      setVoicesError(
        `ElevenLabsの音声取得に失敗しました。APIキーを確認してください。（${
          err instanceof Error ? err.message : String(err)
        }）`,
      );
    }
  }, []);

  const provider = settings?.provider;
  const voicevoxBase = settings?.voicevox.baseUrl;
  useEffect(() => {
    if (provider === 'voicevox' && voicevoxBase) {
      fetchSpeakers(voicevoxBase);
    }
  }, [provider, voicevoxBase, fetchSpeakers]);

  const handleSave = useCallback(async () => {
    if (!settings || !window.radioAPI) return;
    setSaveMsg(null);
    const saved = await window.radioAPI.setTtsSettings(settings);
    setSettings(saved);
    setSaveMsg('保存しました');
    setTimeout(() => setSaveMsg(null), 2000);
  }, [settings]);

  const handleResynthesize = useCallback(async () => {
    if (!settings || !window.radioAPI) return;
    setResynthMsg(null);
    setResynthesizing(true);
    try {
      // 現在の設定を保存してから作り直すことで、画面で選んだ音声が確実に使われる
      const saved = await window.radioAPI.setTtsSettings(settings);
      setSettings(saved);
      const p = await window.radioAPI.resynthesizeProgram();
      setResynthMsg(
        p ? '音声を作り直しました' : '番組がまだありません。先に「番組を作る」を押してください',
      );
      setTimeout(() => setResynthMsg(null), 3000);
    } finally {
      setResynthesizing(false);
    }
  }, [settings]);

  const handleTest = useCallback(async () => {
    if (!settings || !window.radioAPI) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await window.radioAPI.testTts(settings);
      setTestResult(result);
      if (result.ok && result.audioUrl && audioRef.current) {
        audioRef.current.src = result.audioUrl;
        audioRef.current.play().catch(() => {
          /* ignore */
        });
      }
    } finally {
      setTesting(false);
    }
  }, [settings]);

  if (!settings) {
    return (
      <main className="app">
        <header className="app__drag">
          <span className="app__title">設定</span>
        </header>
        <p className="progress__msg">読み込み中…</p>
      </main>
    );
  }

  const updateProvider = (provider: TtsSettings['provider']) =>
    setSettings({ ...settings, provider });

  const updateVoicevox = (patch: Partial<TtsSettings['voicevox']>) =>
    setSettings({
      ...settings,
      voicevox: { ...settings.voicevox, ...patch },
    });

  const updateElevenLabs = (patch: Partial<TtsSettings['elevenlabs']>) =>
    setSettings({
      ...settings,
      elevenlabs: { ...settings.elevenlabs, ...patch },
    });

  return (
    <>
      <Head>
        <title>設定 - 作業用ラジオ</title>
      </Head>
      <main className="app">
        <header className="app__drag">
          <span className="app__title">設定</span>
        </header>

        <section className="settings">
          <h2 className="settings__heading">音声合成</h2>

          <div className="settings__providers">
            <label
              className={`settings__provider ${
                settings.provider === 'voicevox' ? 'is-selected' : ''
              }`}
            >
              <input
                type="radio"
                name="provider"
                value="voicevox"
                checked={settings.provider === 'voicevox'}
                onChange={() => updateProvider('voicevox')}
              />
              <span className="settings__provider-name">VOICEVOX</span>
              <span className="settings__provider-note">ローカル・無料</span>
            </label>
            <label
              className={`settings__provider ${
                settings.provider === 'elevenlabs' ? 'is-selected' : ''
              }`}
            >
              <input
                type="radio"
                name="provider"
                value="elevenlabs"
                checked={settings.provider === 'elevenlabs'}
                onChange={() => updateProvider('elevenlabs')}
              />
              <span className="settings__provider-name">ElevenLabs</span>
              <span className="settings__provider-note">クラウド・高品質</span>
            </label>
          </div>

          {settings.provider === 'voicevox' ? (
            <div className="settings__block">
              <label className="settings__field">
                <span className="settings__label">Base URL</span>
                <input
                  type="text"
                  className="feeds__input"
                  value={settings.voicevox.baseUrl}
                  onChange={(e) => updateVoicevox({ baseUrl: e.target.value })}
                  onBlur={() => fetchSpeakers(settings.voicevox.baseUrl)}
                />
              </label>
              <label className="settings__field">
                <span className="settings__label">話者</span>
                <select
                  className="feeds__input"
                  value={settings.voicevox.speakerId}
                  onChange={(e) =>
                    updateVoicevox({ speakerId: Number(e.target.value) })
                  }
                >
                  {speakers.length === 0 ? (
                    <option value={settings.voicevox.speakerId}>
                      （未取得）現在: {settings.voicevox.speakerId}
                    </option>
                  ) : null}
                  {speakers.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}（{sp.style}）
                    </option>
                  ))}
                </select>
              </label>
              {voicevoxError ? (
                <p className="warning">{voicevoxError}</p>
              ) : (
                <p className="settings__hint">
                  VOICEVOXアプリを起動しておいてください（
                  <code>http://127.0.0.1:50021</code>）。
                </p>
              )}
            </div>
          ) : (
            <div className="settings__block">
              <label className="settings__field">
                <span className="settings__label">APIキー</span>
                <div className="settings__key-row">
                  <input
                    type={showKey ? 'text' : 'password'}
                    className="feeds__input"
                    placeholder="sk_..."
                    value={settings.elevenlabs.apiKey}
                    onChange={(e) =>
                      updateElevenLabs({ apiKey: e.target.value })
                    }
                    onBlur={() => fetchVoices(settings.elevenlabs.apiKey)}
                  />
                  <button
                    type="button"
                    className="settings__toggle"
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? '隠す' : '表示'}
                  </button>
                </div>
                <span className="settings__hint">
                  ローカルに暗号化なしで保存されます。キーはこの端末から送信されるのみです。
                </span>
              </label>

              <label className="settings__field">
                <span className="settings__label">音声（Voice）</span>
                <div className="settings__key-row">
                  <select
                    className="feeds__input"
                    value={settings.elevenlabs.voiceId}
                    onChange={(e) =>
                      updateElevenLabs({ voiceId: e.target.value })
                    }
                  >
                    <option value="">（未選択）</option>
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="settings__toggle"
                    onClick={() => fetchVoices(settings.elevenlabs.apiKey)}
                  >
                    再取得
                  </button>
                </div>
              </label>

              <label className="settings__field">
                <span className="settings__label">モデル</span>
                <select
                  className="feeds__input"
                  value={settings.elevenlabs.modelId}
                  onChange={(e) =>
                    updateElevenLabs({ modelId: e.target.value })
                  }
                >
                  {ELEVENLABS_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              {voicesError ? <p className="warning">{voicesError}</p> : null}
            </div>
          )}

          <div className="settings__actions">
            <button
              type="button"
              className="controls__secondary"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? 'テスト中…' : 'テスト再生'}
            </button>
            <button
              type="button"
              className="controls__secondary"
              onClick={handleSave}
            >
              保存
            </button>
          </div>

          {hasProgram ? (
            <div className="settings__resynth">
              <button
                type="button"
                className="controls__secondary"
                onClick={handleResynthesize}
                disabled={resynthesizing}
                title="いまの番組の原稿を、この音声で合成し直します"
              >
                {resynthesizing ? '作り直し中…' : 'この音声で作り直す'}
              </button>
              <span className="settings__hint">
                原稿はそのまま、選んだ音声で合成のみやり直します。
              </span>
            </div>
          ) : null}

          {saveMsg ? (
            <p className="settings__notice settings__notice--ok">{saveMsg}</p>
          ) : null}
          {resynthMsg ? (
            <p className="settings__notice settings__notice--ok">{resynthMsg}</p>
          ) : null}
          {testResult ? (
            testResult.ok ? (
              <p className="settings__notice settings__notice--ok">
                テスト成功（{testResult.backend}）
              </p>
            ) : (
              <p className="warning">
                テスト失敗（{testResult.backend}）: {testResult.error}
              </p>
            )
          ) : null}
        </section>

        <section className="settings">
          <h2 className="settings__heading">自動取得</h2>
          <div className="settings__block">
            <label className="settings__field">
              <span className="settings__label">間隔</span>
              <select
                className="feeds__input"
                value={autoFetch?.intervalMinutes ?? 30}
                onChange={(e) =>
                  saveAutoFetchInterval(Number(e.target.value))
                }
                disabled={!autoFetch}
              >
                {AUTO_FETCH_INTERVALS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="settings__hint">
              指定の間隔でバックグラウンドで新しい番組を作ります。
            </p>
            {autoFetchMsg ? (
              <p className="settings__notice settings__notice--ok">
                {autoFetchMsg}
              </p>
            ) : null}
          </div>
        </section>

        <footer className="app__footer">
          <Link href="/" className="app__link">
            ← プレイヤーへ戻る
          </Link>
        </footer>

        <audio ref={audioRef} style={{ display: 'none' }} />
      </main>
    </>
  );
}
