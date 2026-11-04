import express from 'express';
import { z } from 'zod';
import { Store, HttpError } from './store.mjs';
import { loadConfig, publicConfig, safeError } from './config.mjs';
import { createExtractor } from './extractor.mjs';
import { examples } from './examples.mjs';
import { validateTrajectory, normalizeManualEdit } from '../shared/schema.mjs';
import { exportPackage, exportMarkdown } from './export.mjs';

const submissionSchema = z.object({
  title: z.string().max(200).optional(), input_kind: z.enum(['pasted_text','markdown_file']).default('pasted_text'),
  filename: z.string().max(255).nullable().optional(),
  narrative_origin: z.enum(['researcher_summary','ai_summary','synthetic_example','unknown']).default('unknown'),
  content: z.string().min(1), extract: z.boolean().default(true),
}).strict();
const positiveRevision = z.number().int().positive();

export function createApp({ config = loadConfig(), store = new Store(config.dataDir), extractor = createExtractor(config) } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', (_req,res,next) => { res.setHeader('Cache-Control','no-store'); next(); });
  const jobs = new Map();
  const run = (id) => {
    const attempt = store.startAttempt(id, 'model', config.model || null);
    const task = (async () => {
      store.setRunning(attempt);
      const raw = [];
      try {
        const record = store.get(id);
        const result = await extractor(record.source.content, response => { raw.push(response); store.attemptRaw(attempt, JSON.stringify(raw)); });
        const check = validateTrajectory(result.trajectory, record.source.content, { automatic: true });
        if (!check.ok) throw new HttpError(422, '提取结果校验失败。', check.errors);
        store.writeRevision(id, check.data, 'model', check.warnings, attempt);
      } catch (e) { store.failAttempt(attempt, safeError(e,config), e.details || []); }
    })().finally(() => jobs.delete(attempt));
    jobs.set(attempt,task);
    return attempt;
  };
  app.get('/api/health', (_req,res) => res.json({ status:'ok', provider:publicConfig(config) }));
  app.get('/api/examples', (_req,res) => res.json(examples.map(({id,name,description,content}) => ({ id,name,description,content }))));
  app.post('/api/examples/:id', (req,res) => {
    const example = examples.find(x=>x.id===req.params.id);
    if (!example) throw new HttpError(404,'示例不存在。');
    const check = validateTrajectory(example.trajectory,example.content);
    if (!check.ok) throw new HttpError(500,'内置示例未通过校验。',check.errors);
    const id = store.create({ title:example.trajectory.title,input_kind:'pasted_text',filename:null,narrative_origin:'synthetic_example',content:example.content });
    const attempt = store.startAttempt(id,'fixture',null);
    store.writeRevision(id,check.data,'fixture',check.warnings,attempt);
    res.status(201).json(store.get(id));
  });
  app.get('/api/trajectories', (_req,res) => res.json(store.list()));
  app.post('/api/trajectories', (req,res) => {
    const body = submissionSchema.parse(req.body);
    body.content = body.content.replace(/^\uFEFF/,'');
    if (!body.content.trim()) throw new HttpError(400,'请先填写研究文稿。');
    if (Array.from(body.content).length>config.maxInputCharacters || Buffer.byteLength(body.content,'utf8')>config.maxInputBytes) throw new HttpError(413,`文稿过长，上限为 ${config.maxInputCharacters} 个字符、256 KiB。`);
    if (body.input_kind==='markdown_file' && (!body.filename || !/\.(md|markdown)$/i.test(body.filename))) throw new HttpError(400,'请选择 .md 或 .markdown 文件。');
    const id = store.create(body);
    if (body.extract) run(id);
    res.status(201).json(store.get(id));
  });
  app.get('/api/trajectories/:id', (req,res) => {
    let revision = null;
    if (req.query.revision !== undefined) revision = positiveRevision.parse(Number(req.query.revision));
    res.json(store.get(req.params.id,revision));
  });
  app.post('/api/trajectories/:id/extractions', (req,res) => {
    if (!config.configured) throw new HttpError(503,config.configError || '模型尚未配置，原稿已保留。');
    const attempt = run(req.params.id);
    res.status(202).json({ id:req.params.id,attempt_id:attempt,status:'pending' });
  });
  app.put('/api/trajectories/:id/draft', (req,res) => {
    const body = z.object({ base_revision:z.number().int().nonnegative(), trajectory:z.unknown(), keep_source_ids:z.array(z.string()).default([]) }).strict().parse(req.body);
    if (store.activeAttempt(req.params.id)) throw new HttpError(409,'正在提取，请完成后再保存修改。');
    const record = store.get(req.params.id);
    const structural = validateTrajectory(body.trajectory,record.source.content);
    if (!structural.ok) throw new HttpError(422,'修改未通过校验。',structural.errors);
    const previous = record.trajectory || { inputs:{goals:[],constraints:[],background:[],human_choices:[]},nodes:[],outputs:[],relations:[] };
    const next = normalizeManualEdit(structural.data,previous,body.keep_source_ids);
    const check = validateTrajectory(next,record.source.content);
    if (!check.ok) throw new HttpError(422,'修改未通过校验。',check.errors);
    store.writeRevision(req.params.id,check.data,'manual',check.warnings,null,body.base_revision);
    res.json(store.get(req.params.id));
  });
  app.post('/api/trajectories/:id/confirm', (req,res) => {
    const { revision } = z.object({ revision:positiveRevision }).strict().parse(req.body);
    if (store.activeAttempt(req.params.id)) throw new HttpError(409,'正在提取，请完成后再确认。');
    const record = store.get(req.params.id,revision);
    const check = validateTrajectory(record.trajectory,record.source.content);
    if (!check.ok) throw new HttpError(422,'此版本尚未通过校验。',check.errors);
    store.confirm(req.params.id,revision);
    res.json(store.get(req.params.id));
  });
  app.get('/api/trajectories/:id/export', (req,res) => {
    const format = z.enum(['json','markdown']).parse(req.query.format || 'json');
    const revision = req.query.revision === undefined ? null : positiveRevision.parse(Number(req.query.revision));
    const record = store.get(req.params.id,revision);
    res.setHeader('Content-Disposition',`attachment; filename="trajectory-${record.id.slice(0,8)}-v${record.selected_revision}.${format==='json'?'json':'md'}"`);
    if (format==='json') res.type('application/json').send(JSON.stringify(exportPackage(record),null,2)+'\n');
    else res.type('text/markdown').send(exportMarkdown(record));
  });
  app.use('/api',(_req,_res,next)=>next(new HttpError(404,'API 不存在。')));
  app.use((err,_req,res,_next)=> {
    if (err instanceof z.ZodError) return res.status(400).json({ error:'请求格式不正确。',details:err.issues.map(i=>`${i.path.join('.')}：${i.message}`) });
    const status = err.status || 500;
    res.status(status).json({ error:status===500?'服务处理失败，请稍后重试。':safeError(err,config),details:err.details || [] });
  });
  return { app,store,jobs,config };
}
