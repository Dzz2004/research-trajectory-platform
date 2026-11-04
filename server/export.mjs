import { SCHEMA_VERSION } from '../shared/schema.mjs';

const origins = { source_explicit: '原文明述', inferred: '推断', user_added: '人工补充', synthetic: '模拟' };
const occurrence = { reported: '原稿报告已发生', planned: '计划', unknown: '发生情况未知' };
const kinds = { precedes: '时序先后', supports: '论证依据', parallel: '明确并行' };
const outputTypes = { scheme: '方案', hypothesis_conclusion: '假设结论', negative_finding: '否定性发现', open_question: '新问题', other: '其他' };
const statuses = { proposed: '提出／待验证', reported_supported: '作者报告支持', reported_refuted: '作者报告否定', unresolved: '未解决', unknown: '未知' };

export function exportPackage(record) {
  return { schema_version: SCHEMA_VERSION, submission_id: record.id, revision: record.selected_revision, review_status: record.review_status,
    source: record.source, trajectory: record.trajectory };
}
export function exportMarkdown(record) {
  const t = record.trajectory;
  if (!t) return `# ${record.title}\n\n尚未生成轨迹。\n\n## 原稿\n\n${record.source.content}\n`;
  const out = [`# ${t.title}`, '', `契约版本：${SCHEMA_VERSION}；修订：${record.selected_revision}；核对状态：${record.review_status === 'confirmed' ? '贡献者已核对' : '草稿'}。`, '',
    `文稿来源：${record.source.narrative_origin}。该说明和人工核对均不代表平台验证科学结论。`, '', '## 输入', ''];
  const provenance = p => {
    const refs = p.source_refs.map(r => `L${r.start_line}–${r.end_line}「${r.quote.replaceAll('\n', ' / ')}」`).join('；');
    return `${origins[p.origin]}${refs ? '；' + refs : ''}${p.note ? '；' + p.note : ''}`;
  };
  for (const [key,label] of Object.entries({ goals:'目标',constraints:'约束',background:'已有信息',human_choices:'人为条件' })) {
    out.push(`### ${label}`, '');
    if (!t.inputs[key].length) out.push('未记录。', '');
    for (const i of t.inputs[key]) out.push(`- **${i.id}** ${i.content}（${provenance(i.provenance)}）`);
    out.push('');
  }
  out.push('## 过程节点', '', '以下按原稿位置列出；实际先后以关系清单为准，不因展示顺序认定时序。', '');
  for (const n of t.nodes) {
    out.push(`### ${n.id} · ${n.title}`, '', `类型：${n.kind === 'reasoning' ? '思考／决策' : '动作'}；${occurrence[n.occurrence]}；主体：${n.actor || '未记录'}。`, '', n.content, '', `来源：${provenance(n.provenance)}`, '');
    if (n.reasoning) {
      for (const [k,label] of Object.entries({ question:'问题',decision:'判断／选择',basis:'依据' })) if (n.reasoning[k] !== null) out.push(`**${label}：** ${n.reasoning[k]}`, '');
      if (n.reasoning.alternatives.length) { out.push('**候选与取舍：**', ''); for (const a of n.reasoning.alternatives) out.push(`- ${a.option}：${a.tradeoff ?? '取舍依据未记录'}`); out.push(''); }
    }
    if (n.action) for (const [k,label] of Object.entries({ category:'动作类别',operation:'操作',target:'对象',parameters:'条件',result:'结果',interpretation:'作者解释' })) out.push(`**${label}：** ${n.action[k] ?? '未记录'}`, '');
    out.push(`决策前已知信息：${n.known_before_ids === null ? '无法由原稿确定' : n.known_before_ids.join('、') || '未记录额外信息'}。`, '');
  }
  out.push('## 关系', '');
  if (!t.relations.length) out.push('原稿未提供可确定的关系。', '');
  for (const r of t.relations) out.push(`- ${r.from} ${r.kind === 'parallel' ? '↔' : '→'} ${r.to}：${kinds[r.kind]}；${r.scope}（${provenance(r.provenance)}）`);
  out.push('', '## 输出', '');
  if (!t.outputs.length) out.push('最终产出未记录。', '');
  for (const o of t.outputs) out.push(`### ${o.id} · ${outputTypes[o.type]}`, '', o.content, '', `状态：${statuses[o.status]}；来源：${provenance(o.provenance)}`, '');
  out.push('## 待补充问题', '');
  if (!t.gaps.length) out.push('暂无已标记问题。', '');
  for (const g of t.gaps) out.push(`- ${g.question}${g.related_ids.length ? '（关联：' + g.related_ids.join('、') + '）' : ''}`);
  out.push('', '## 原始文稿', '', record.source.content, '');
  return out.join('\n');
}
