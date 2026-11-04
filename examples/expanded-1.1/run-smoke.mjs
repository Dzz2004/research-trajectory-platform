// Live integration check. Each invocation creates a record and may call the configured model twice.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { PROMPT_VERSION } from '../../server/extractor.mjs';
import { validateTrajectory } from '../../shared/schema.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(dir, process.env.TRAJECTORY_TEST_OUTPUT_DIR || 'result');
const source = readFileSync(resolve(dir, 'source.md'), 'utf8');
const config = loadConfig();
if (!config.configured) throw new Error('需要可用模型配置；本脚本不会用模拟输出替代模型结果。');
mkdirSync(outputDir, { recursive: true });
const save = (name, value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  writeFileSync(resolve(outputDir, name), config.apiKey ? text.split(config.apiKey).join('[REDACTED]') : text);
};
const extractorSource = readFileSync(resolve(config.root, 'server/extractor.mjs'), 'utf8');
save('extractor-source.snapshot.txt', extractorSource);
const started = Date.now();
save('request-info.json', {
  started_at: new Date(started).toISOString(),
  model: config.model, endpoint: config.endpoint, temperature: 0.2,
  max_tokens_sent: false, timeout_ms_per_request: config.timeoutMs,
  max_calls: 2, prompt_version: PROMPT_VERSION,
  extractor_sha256: createHash('sha256').update(extractorSource).digest('hex'),
  source_sha256: createHash('sha256').update(source).digest('hex'),
  note: '使用现有生产后端，没有为本样例调整提示词或修订模型结果；实际参数见本文件，可通过环境变量覆盖。',
});
const { app, store, jobs } = createApp({ config });
const server = await new Promise((resolveServer, reject) => {
  const listener = app.listen(0, '127.0.0.1', () => resolveServer(listener));
  listener.once('error', reject);
});
const base = `http://127.0.0.1:${server.address().port}`;
const progress = setInterval(() => console.log(`模型提取中，已用时 ${Math.round((Date.now() - started) / 1000)} 秒。`), 15000);
try {
  const response = await fetch(base + '/api/trajectories', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: '1.1 扩写实测 · 带回退的 Au 孔壁构型方案',
      input_kind: 'markdown_file', filename: 'source.md',
      narrative_origin: 'synthetic_example', content: source, extract: true,
    }),
  });
  const submitted = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(submitted));
  console.log(`原稿已提交，记录 ${submitted.id}；${Array.from(source).length} 个字符。`);
  await Promise.all([...jobs.values()]);
  const record = await (await fetch(base + '/api/trajectories/' + submitted.id)).json();
  const raw = store.db.prepare('SELECT raw_response FROM attempts WHERE submission_id=? ORDER BY created_at DESC LIMIT 1').get(submitted.id);
  const responses = JSON.parse(raw?.raw_response || '[]');
  save('actual.record.json', record);
  save('model-responses.json', responses);
  save('actual.trajectory.json', record.trajectory);
  const rounds = responses.map(r => {
    let meta = { round: r.round, http_status: r.status };
    try {
      const body = JSON.parse(r.body);
      meta = { ...meta, finish_reason: body.choices?.[0]?.finish_reason, usage: body.usage };
      const content = body.choices?.[0]?.message?.content;
      const parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
      const check = validateTrajectory(parsed, source, { automatic: true });
      return { ...meta, valid: check.ok, errors: check.errors, warnings: check.warnings };
    } catch (e) { return { ...meta, valid: false, error: e.message }; }
  });
  const report = {
    record_id: record.id, status: record.extraction_status,
    elapsed_seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
    call_count: responses.length, rounds,
    node_count: record.trajectory?.nodes.length ?? 0,
    relation_count: record.trajectory?.relations.length ?? 0,
    attempt_error: record.attempts[0]?.error,
  };
  save('validation.json', report);
  if (record.trajectory) {
    save('actual.export.md', await (await fetch(base + '/api/trajectories/' + record.id + '/export?format=markdown')).text());
    save('actual.export.json', await (await fetch(base + '/api/trajectories/' + record.id + '/export?format=json')).text());
  }
  console.log(JSON.stringify(report, null, 2));
  if (record.extraction_status !== 'succeeded') process.exitCode = 1;
} finally {
  clearInterval(progress);
  server.closeIdleConnections();
  await new Promise(resolveClose => server.close(resolveClose));
  store.close();
}
