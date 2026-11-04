import { z } from 'zod';

export const SCHEMA_VERSION = 'research-trajectory/0.1';
export const ID = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const text = z.string().min(1);
const nullable = z.string().nullable();
export const provenanceSchema = z.object({
  origin: z.enum(['source_explicit', 'inferred', 'user_added', 'synthetic']),
  source_refs: z.array(z.object({ start_line: z.number().int().positive(), end_line: z.number().int().positive(), quote: text }).strict()),
  note: nullable,
}).strict();
const item = z.object({ id: ID, content: text, provenance: provenanceSchema }).strict();
export const reasoningSchema = z.object({
  question: nullable,
  alternatives: z.array(z.object({ option: text, tradeoff: nullable }).strict()),
  decision: nullable,
  basis: nullable,
}).strict();
export const actionSchema = z.object({
  category: z.enum(['literature_search', 'experiment', 'characterization', 'computation', 'data_analysis', 'consultation', 'other']),
  operation: text, target: nullable, parameters: nullable, result: nullable, interpretation: nullable,
}).strict();
export const nodeSchema = z.object({
  id: ID, kind: z.enum(['reasoning', 'action']), title: text, content: text,
  actor: nullable, occurrence: z.enum(['reported', 'planned', 'unknown']),
  provenance: provenanceSchema, known_before_ids: z.array(ID).nullable(),
  reasoning: reasoningSchema.nullable(), action: actionSchema.nullable(),
}).strict();
export const trajectorySchema = z.object({
  title: text,
  inputs: z.object({ goals: z.array(item), constraints: z.array(item), background: z.array(item), human_choices: z.array(item) }).strict(),
  nodes: z.array(nodeSchema),
  relations: z.array(z.object({
    id: ID, from: ID, to: ID, kind: z.enum(['precedes', 'supports', 'parallel']),
    scope: z.enum(['reported', 'planned', 'unknown']), provenance: provenanceSchema,
  }).strict()),
  outputs: z.array(item.extend({
    type: z.enum(['scheme', 'hypothesis_conclusion', 'negative_finding', 'open_question', 'other']),
    status: z.enum(['proposed', 'reported_supported', 'reported_refuted', 'unresolved', 'unknown']),
  }).strict()),
  gaps: z.array(z.object({ id: ID, question: text, related_ids: z.array(ID) }).strict()),
}).strict();

export function allItems(t) {
  return [...Object.values(t.inputs).flat(), ...t.nodes, ...t.outputs, ...t.relations];
}

export function sourceLines(content) {
  return content.split(/\r\n|\r|\n/);
}

export function validateTrajectory(value, content, { automatic = false } = {}) {
  const parsed = trajectorySchema.safeParse(value);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(e => `${e.path.join('.') || 'trajectory'}：${e.message}`), warnings: [] };
  const t = parsed.data;
  const errors = [], warnings = [];
  const items = allItems(t);
  const seen = new Set();
  for (const o of [...items, ...t.gaps]) {
    if (seen.has(o.id)) errors.push(`ID ${o.id} 重复`);
    seen.add(o.id);
  }
  const endpoints = new Set([...Object.values(t.inputs).flat(), ...t.nodes, ...t.outputs].map(o => o.id));
  const information = new Set([...Object.values(t.inputs).flat(), ...t.nodes].map(o => o.id));
  const nodeIds = new Set(t.nodes.map(n => n.id));
  const lines = sourceLines(content);
  for (const o of items) {
    const p = o.provenance;
    if (automatic && ['user_added', 'synthetic'].includes(p.origin)) errors.push(`${o.id}：自动提取不能生成“人工补充”或“模拟”内容`);
    if (['source_explicit', 'inferred'].includes(p.origin) && !p.source_refs.length) errors.push(`${o.id}：缺少原文出处`);
    if (p.origin !== 'source_explicit' && !p.note?.trim()) errors.push(`${o.id}：请说明推断或补充的性质`);
    for (const ref of p.source_refs) {
      if (ref.start_line > ref.end_line || ref.end_line > lines.length) errors.push(`${o.id}：原文行号越界或顺序不正确`);
      else if (!lines.slice(ref.start_line - 1, ref.end_line).join('\n').includes(ref.quote.replace(/\r\n|\r/g, '\n'))) errors.push(`${o.id}：引用片段与指定原文行不匹配`);
    }
  }
  const adjacency = new Map(t.nodes.map(n => [n.id, []]));
  const parent = new Map(t.nodes.map(n => [n.id, n.id]));
  const find = (id) => { let k = id; while (parent.get(k) !== k) k = parent.get(k); return k; };
  const linkSet = new Set();
  for (const r of t.relations) {
    if (!endpoints.has(r.from) || !endpoints.has(r.to)) { errors.push(`${r.id}：关系端点不存在`); continue; }
    if (r.from === r.to) errors.push(`${r.id}：关系不能指向自身`);
    const pair = r.kind === 'parallel' ? [r.from, r.to].sort() : [r.from, r.to];
    const signature = [r.kind, r.scope, ...pair].join('|');
    if (linkSet.has(signature)) errors.push(`${r.id}：重复关系`);
    linkSet.add(signature);
    if (r.kind !== 'supports') {
      if (!nodeIds.has(r.from) || !nodeIds.has(r.to)) { errors.push(`${r.id}：时序和并行关系只能连接过程节点`); continue; }
      if (r.provenance.origin === 'inferred') errors.push(`${r.id}：不能从隐含理解推断时序或并行`);
      if (r.kind === 'precedes') adjacency.get(r.from).push(r.to);
      else parent.set(find(r.to), find(r.from));
    } else if (r.scope !== 'unknown') errors.push(`${r.id}：论证关系不声明历史时序，scope 应为 unknown`);
  }
  const reaches = (from, to, visiting = new Set()) => {
    if (from === to) return true;
    if (visiting.has(from)) return false;
    visiting.add(from);
    return (adjacency.get(from) || []).some(n => reaches(n, to, visiting));
  };
  for (const [from, targets] of adjacency) {
    for (const to of targets) {
      if (reaches(to, from)) errors.push(`时序关系存在循环：${from} → ${to}`);
    }
  }
  for (const a of t.nodes) for (const b of t.nodes) {
    if (a.id < b.id && find(a.id) === find(b.id) && (reaches(a.id, b.id) || reaches(b.id, a.id))) errors.push(`${a.id} 与 ${b.id} 的并行关系和时序冲突`);
  }
  // A quotient cycle can exist even when the uncollapsed graph has no cycle.
  const quotient = new Map();
  for (const id of nodeIds) quotient.set(find(id), new Set());
  for (const [from, targets] of adjacency) for (const to of targets) quotient.get(find(from)).add(find(to));
  const active = new Set(), done = new Set();
  const cycle = id => {
    if (active.has(id)) return true;
    if (done.has(id)) return false;
    active.add(id);
    for (const next of quotient.get(id) || []) if (cycle(next)) return true;
    active.delete(id); done.add(id); return false;
  };
  if ([...quotient.keys()].some(cycle)) errors.push('合并明确并行组后，时序关系存在循环');
  for (const n of t.nodes) {
    if ((n.kind === 'reasoning' && (!n.reasoning || n.action !== null)) || (n.kind === 'action' && (!n.action || n.reasoning !== null))) errors.push(`${n.id}：节点类型与专有字段不一致`);
    if (n.kind === 'action' && automatic && n.provenance.origin === 'inferred') errors.push(`${n.id}：动作必须有原文明确记录`);
    for (const id of n.known_before_ids || []) {
      if (!information.has(id)) errors.push(`${n.id}：已知信息引用 ${id} 不存在或不是输入／过程节点`);
      else if (id === n.id || (nodeIds.has(id) && reaches(n.id, id))) errors.push(`${n.id}：已知信息不能引用自身或明确未来节点 ${id}`);
    }
    if (n.kind === 'action' && n.action && n.action.result === null) warnings.push(`${n.id}：动作结果未记录`);
  }
  for (const gap of t.gaps) for (const id of gap.related_ids) if (!endpoints.has(id)) errors.push(`${gap.id}：关联对象 ${id} 不存在`);
  if (!t.inputs.goals.length) warnings.push('研究目标未记录');
  if (!t.outputs.length) warnings.push('最终产出未记录');
  if (t.nodes.length && !t.relations.some(r => r.kind === 'precedes')) warnings.push('时序未提供；节点排列仅用于阅读');
  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], data: t };
}

export function normalizeManualEdit(next, previous, keepSourceIds = []) {
  const result = structuredClone(next);
  const previousItems = new Map(allItems(previous).map(o => [o.id, o]));
  const keep = new Set(keepSourceIds);
  for (const item of allItems(result)) {
    const old = previousItems.get(item.id);
    const withoutProvenance = o => { const { provenance, ...other } = o; return JSON.stringify(other); };
    const changed = !old || withoutProvenance(old) !== withoutProvenance(item);
    if (changed && !keep.has(item.id) && ['source_explicit', 'inferred'].includes(item.provenance.origin)) {
      item.provenance = { origin: 'user_added', source_refs: [], note: '贡献者在核对时新增或修订；原始表述保留在历史版本中。' };
    }
  }
  return result;
}
