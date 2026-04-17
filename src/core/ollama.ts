const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'gemma4:26b';
const DEFAULT_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const TIMEOUT_MS = 600_000;

export class OllamaError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'OllamaError';
  }
}

interface OllamaGenerateResponse {
  response?: string;
  done?: boolean;
  error?: string;
}

export interface OllamaConfig {
  model?: string;
  host?: string;
}

export async function generate(
  prompt: string,
  config: OllamaConfig = {},
): Promise<string> {
  const model = config.model || DEFAULT_MODEL;
  const host = config.host || DEFAULT_HOST;
  const url = `${host.replace(/\/$/, '')}/api/generate`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
        options: { temperature: 0.7 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new OllamaError(
        `Ollama HTTP ${res.status}: ${text || res.statusText}`,
      );
    }
    if (!res.body) {
      throw new OllamaError('Ollama returned empty body');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';
    let finished = false;
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nlIndex = buffer.indexOf('\n');
      while (nlIndex !== -1) {
        const line = buffer.slice(0, nlIndex).trim();
        buffer = buffer.slice(nlIndex + 1);
        if (line) {
          const parsed = JSON.parse(line) as OllamaGenerateResponse;
          if (parsed.error) throw new OllamaError(parsed.error);
          if (parsed.response) full += parsed.response;
          if (parsed.done) {
            finished = true;
            break;
          }
        }
        nlIndex = buffer.indexOf('\n');
      }
    }
    const tail = buffer.trim();
    if (tail) {
      const parsed = JSON.parse(tail) as OllamaGenerateResponse;
      if (parsed.error) throw new OllamaError(parsed.error);
      if (parsed.response) full += parsed.response;
    }
    if (!full) {
      throw new OllamaError('Ollama returned no response');
    }
    return full;
  } catch (err) {
    if (err instanceof OllamaError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new OllamaError(`Ollama timeout after ${TIMEOUT_MS}ms`);
    }
    throw new OllamaError(
      'Ollama (localhost:11434) に接続できません。`ollama serve` を起動してください。',
      err,
    );
  } finally {
    clearTimeout(timer);
  }
}
