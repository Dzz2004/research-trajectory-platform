import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function envFile(path) {
  const values = {};
  for (const raw of readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = raw.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[m[1]] = value;
  }
  return values;
}

export function loadConfig(overrides = {}) {
  const local = existsSync(resolve(PROJECT_ROOT, '.env')) ? envFile(resolve(PROJECT_ROOT, '.env')) : {};
  const env = { ...local, ...process.env, ...overrides };
  let provider = {}, configError = null;
  if (env.LLM_CONFIG_FILE) {
    try {
      const path = resolve(PROJECT_ROOT, env.LLM_CONFIG_FILE);
      const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
      provider = raw.trim().startsWith('{') ? JSON.parse(raw) : envFile(path);
    } catch { configError = '无法读取模型配置文件，请检查 LLM_CONFIG_FILE。'; }
  }
  const apiKey = env.LLM_API_KEY || provider.KEY || provider.key || provider.LLM_API_KEY || provider.DEEPSEEK_API_KEY || provider.OPENAI_API_KEY || '';
  const baseUrl = env.LLM_BASE_URL || provider.URL || provider.url || provider.base_url || provider.LLM_BASE_URL || provider.OPENAI_BASE_URL || '';
  const model = env.LLM_MODEL || provider.model || provider.MODEL || provider.LLM_MODEL || provider.OPENAI_MODEL || '';
  const positive = (value, fallback) => { const n = Number(value ?? fallback); if (!Number.isFinite(n) || n <= 0) throw new Error('数值配置必须大于0'); return Math.floor(n); };
  let endpoint = '';
  if (baseUrl) {
    try {
      const u = new URL(baseUrl);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error();
      endpoint = baseUrl.replace(/\/+$/, '');
      if (!endpoint.endsWith('/chat/completions')) endpoint += '/chat/completions';
    } catch { configError = '模型服务地址格式不正确。'; }
  }
  return {
    root: PROJECT_ROOT, port: positive(env.PORT, 8787), host: env.HOST || '127.0.0.1',
    dataDir: resolve(PROJECT_ROOT, env.DATA_DIR || 'data'),
    maxInputCharacters: positive(env.MAX_INPUT_CHARACTERS, 30000), maxInputBytes: 256 * 1024,
    apiKey, endpoint, model, configured: !!(apiKey && endpoint && model && !configError), configError,
    timeoutMs: positive(env.LLM_TIMEOUT_MS, 180000),
  };
}

export function publicConfig(config) {
  return { configured: config.configured, model: config.model || null, config_error: config.configError,
    max_input_characters: config.maxInputCharacters, max_input_bytes: config.maxInputBytes,
    schema_version: 'research-trajectory/0.1' };
}

export function safeError(error, config) {
  let message = error instanceof Error ? error.message : String(error);
  if (config.apiKey) message = message.split(config.apiKey).join('[REDACTED]');
  return message.slice(0, 2000);
}
