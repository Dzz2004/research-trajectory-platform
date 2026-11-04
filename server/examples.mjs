import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from './config.mjs';

const history = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'examples/research-history.json'), 'utf8'));
const p = (line, quote, end = line) => ({ origin: 'source_explicit', source_refs: [{ start_line: line, end_line: end, quote }], note: null });
const baseNode = (id, kind, title, content, provenance) => ({ id, kind, title, content, actor: null, occurrence: 'unknown', provenance, known_before_ids: null, reasoning: null, action: null });
const logicText = '希望改善近红外利用，并保留连续保护与开放孔道。\n研究者固定 Au。其作用与距离有关，也需考虑固定分散。\n已有孔壁可能承担部分功能，因此提出 Au 均匀附着孔壁的构型。';
const logic = {
  id: 'reasoning', name: '只有论证，没有时序', description: '从一段设计构想出发，不补写查文献或实验。', content: logicText,
  trajectory: {
    title: '利用已有孔壁的 Au 构型构想',
    inputs: {
      goals: [{ id: 'I1', content: '改善近红外利用', provenance: p(1, '希望改善近红外利用') }],
      constraints: [{ id: 'I2', content: '保留连续保护与开放孔道', provenance: p(1, '保留连续保护与开放孔道') }],
      human_choices: [{ id: 'I3', content: 'Au 为研究者指定材料', provenance: p(2, '研究者固定 Au') }], background: [],
    },
    nodes: [
      { ...baseNode('N1', 'reasoning', '识别作用条件', '作者指出需要考虑距离及固定分散；信息来源未记录。', p(2, '其作用与距离有关，也需考虑固定分散。')), reasoning: { question: null, alternatives: [], decision: null, basis: '作用与距离有关，也需考虑固定分散' } },
      { ...baseNode('N2', 'reasoning', '考虑复用已有孔壁', '作者提出已有孔壁可能承担部分功能，尚未给出验证。', p(3, '已有孔壁可能承担部分功能')), reasoning: { question: null, alternatives: [], decision: null, basis: '已有孔壁可能承担部分功能' } },
    ],
    relations: [{ id: 'E1', from: 'N2', to: 'O1', kind: 'supports', scope: 'unknown', provenance: p(3, '已有孔壁可能承担部分功能，因此提出 Au 均匀附着孔壁的构型。') }],
    outputs: [{ id: 'O1', type: 'scheme', status: 'proposed', content: 'Au 均匀附着孔壁的构型', provenance: p(3, '提出 Au 均匀附着孔壁的构型') }],
    gaps: [{ id: 'G1', question: '这些认识来自文献、实验还是设计经验？', related_ids: ['N1','N2'] }, { id: 'G2', question: '实际是否发生过信息获取或比较行动，其先后是什么？', related_ids: ['N1','N2'] }],
  },
};
const parallelText = '目标是判断已有孔壁能否承担固定和距离控制功能。\n我们并行开展文献检索和结构记录整理，具体返回结果未写入本总结。\n两项工作完成后，我们比较复用已有结构与新增辅助组分，仍需补充样品参数。\n本轮产出是待补充的层厚和固定依据清单。';
const parallel = {
  id: 'parallel', name: '并行调查与汇总判断', description: '两个任务明确并行，汇总后保留信息缺口。', content: parallelText,
  trajectory: {
    title: '孔壁功能的并行调查',
    inputs: { goals: [{ id:'I1',content:'判断已有孔壁能否承担固定和距离控制功能',provenance:p(1,'目标是判断已有孔壁能否承担固定和距离控制功能。') }], constraints: [], background: [], human_choices: [] },
    nodes: [
      { ...baseNode('N1','action','文献检索','开展文献检索，返回结果未记录。',p(2,'我们并行开展文献检索和结构记录整理，具体返回结果未写入本总结。')), occurrence:'reported',actor:'我们',action:{ category:'literature_search',operation:'开展文献检索',target:null,parameters:null,result:null,interpretation:null } },
      { ...baseNode('N2','action','结构记录整理','整理结构记录，返回结果未记录。',p(2,'我们并行开展文献检索和结构记录整理，具体返回结果未写入本总结。')), occurrence:'reported',actor:'我们',action:{ category:'data_analysis',operation:'整理结构记录',target:'结构记录',parameters:null,result:null,interpretation:null } },
      { ...baseNode('N3','reasoning','汇总比较实现路线','两项工作完成后比较两条路线，样品参数仍待补充。',p(3,'两项工作完成后，我们比较复用已有结构与新增辅助组分，仍需补充样品参数。')), occurrence:'reported',actor:'我们',reasoning:{question:null,alternatives:[{option:'复用已有结构',tradeoff:null},{option:'新增辅助组分',tradeoff:null}],decision:null,basis:null} },
    ],
    relations: [
      {id:'E1',from:'N1',to:'N2',kind:'parallel',scope:'reported',provenance:p(2,'我们并行开展文献检索和结构记录整理')},
      {id:'E2',from:'N1',to:'N3',kind:'precedes',scope:'reported',provenance:p(3,'两项工作完成后，我们比较复用已有结构与新增辅助组分')},
      {id:'E3',from:'N2',to:'N3',kind:'precedes',scope:'reported',provenance:p(3,'两项工作完成后，我们比较复用已有结构与新增辅助组分')},
    ],
    outputs:[{id:'O1',type:'open_question',status:'unresolved',content:'待补充的层厚和固定依据清单',provenance:p(4,'本轮产出是待补充的层厚和固定依据清单。')}],
    gaps:[{id:'G1',question:'两项调查各自获得了哪些具体信息？',related_ids:['N1','N2']},{id:'G2',question:'层厚数据及固定依据是什么？',related_ids:['N3','O1']}],
  },
};

export const examples = [logic, history, parallel];
