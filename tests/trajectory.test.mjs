import test from 'node:test';
import assert from 'node:assert/strict';
import { examples } from '../server/examples.mjs';
import { validateTrajectory, normalizeManualEdit } from '../shared/schema.mjs';
import { layoutTimeline } from '../shared/layout.mjs';
import { exportMarkdown } from '../server/export.mjs';

const fixture = id => structuredClone(examples.find(e=>e.id===id));
test('规范中的三种材料都能忠实表达：论证、时序、并行',()=>{
  for(const e of examples)assert.deepEqual(validateTrajectory(e.trajectory,e.content).errors,[]);
});
test('只有论证时不生成时序行或动作',()=>{
  const {trajectory:t}=fixture('reasoning');const view=layoutTimeline(t);
  assert.equal(view.layers.length,0);assert.equal(view.unknown.length,2);assert.ok(t.nodes.every(n=>n.kind==='reasoning'));
});
test('明确并行的任务在同一组，汇总发生在下一层',()=>{
  const {trajectory:t}=fixture('parallel');const view=layoutTimeline(t);
  assert.equal(view.layers.length,2);assert.equal(view.layers[0][0].parallel,true);
  assert.deepEqual(view.layers[0][0].nodes.map(n=>n.id),['N1','N2']);assert.equal(view.layers[1][0].nodes[0].id,'N3');
});
test('无明确并行关系的同层节点保留为两个组',()=>{
  const {trajectory:t}=fixture('parallel');t.relations=t.relations.filter(e=>e.kind!=='parallel');
  const view=layoutTimeline(t);assert.equal(view.layers[0].length,2);assert.ok(view.layers[0].every(g=>!g.parallel));
});
test('伪造、越界及跨行不匹配的引用被拒绝，CRLF可正确定位',()=>{
  const e=fixture('history');assert.equal(validateTrajectory(e.trajectory,e.content.replaceAll('\n','\r\n')).ok,true);
  e.trajectory.nodes[0].provenance.source_refs[0].quote='原稿没有的科学事实';assert.equal(validateTrajectory(e.trajectory,e.content).ok,false);
  e.trajectory.nodes[0].provenance.source_refs[0].end_line=999;assert.equal(validateTrajectory(e.trajectory,e.content).ok,false);
});
test('拒绝悬空关系、重复ID及不一致的节点字段',()=>{
  const e=fixture('history');e.trajectory.relations[0].to='MISSING';e.trajectory.outputs[0].id='I1';e.trajectory.nodes[0].kind='reasoning';
  const r=validateTrajectory(e.trajectory,e.content);assert.equal(r.ok,false);assert.ok(r.errors.some(s=>s.includes('端点')));assert.ok(r.errors.some(s=>s.includes('重复')));assert.ok(r.errors.some(s=>s.includes('字段')));
});
test('自动提取不能以推断方式创造动作或时序',()=>{
  const e=fixture('history');e.trajectory.nodes[0].provenance.origin='inferred';e.trajectory.nodes[0].provenance.note='模型推断';e.trajectory.relations[0].provenance.origin='inferred';e.trajectory.relations[0].provenance.note='按段落顺序';
  const r=validateTrajectory(e.trajectory,e.content,{automatic:true});assert.equal(r.ok,false);assert.ok(r.errors.some(s=>s.includes('动作必须')));assert.ok(r.errors.some(s=>s.includes('推断时序')));
});
test('时序循环与并行冲突会阻止保存',()=>{
  const e=fixture('history');e.trajectory.relations.push({...e.trajectory.relations[0],id:'E3',from:'N2',to:'N1'});assert.equal(validateTrajectory(e.trajectory,e.content).ok,false);
  const p=fixture('parallel');p.trajectory.relations.push({...p.trajectory.relations[1],id:'E4',from:'N1',to:'N2'});assert.equal(validateTrajectory(p.trajectory,p.content).ok,false);
});
test('并行组压缩后的间接循环不能漏过',()=>{
  const e=fixture('parallel'),t=e.trajectory;
  t.nodes.push({...structuredClone(t.nodes[2]),id:'N4'});
  t.relations=[
    {...t.relations[0],id:'E1',from:'N1',to:'N2'},
    {...t.relations[0],id:'E2',from:'N3',to:'N4'},
    {...t.relations[1],id:'E3',from:'N1',to:'N3'},
    {...t.relations[1],id:'E4',from:'N4',to:'N2'},
  ];assert.equal(validateTrajectory(t,e.content).ok,false);
});
test('决策前信息不能引用自身或明确未来节点',()=>{
  const e=fixture('history');e.trajectory.nodes[0].known_before_ids=['N1','N2','O1'];assert.equal(validateTrajectory(e.trajectory,e.content).ok,false);
});
test('手动改义默认标人工补充，显式保留原义时保留有效出处',()=>{
  const e=fixture('history'),next=structuredClone(e.trajectory);next.nodes[0].content='贡献者新补充的信息';
  const normalized=normalizeManualEdit(next,e.trajectory);assert.equal(normalized.nodes[0].provenance.origin,'user_added');assert.deepEqual(normalized.nodes[0].provenance.source_refs,[]);
  assert.equal(normalizeManualEdit(next,e.trajectory,['N1']).nodes[0].provenance.origin,'source_explicit');
  assert.equal(normalized.nodes[1].provenance.origin,'source_explicit');
});
test('缺少动作结果和时序是有效草稿，导出保留未知及模拟性质',()=>{
  const e=fixture('history'),r=validateTrajectory(e.trajectory,e.content);assert.equal(r.ok,true);assert.ok(r.warnings.some(s=>s.includes('结果未记录')));
  const md=exportMarkdown({id:'test',title:e.name,selected_revision:1,review_status:'confirmed',source:{content:e.content,narrative_origin:'synthetic_example'},trajectory:e.trajectory});
  assert.ok(md.includes('synthetic_example'));assert.ok(md.includes('时序先后'));assert.ok(md.includes('论证依据'));assert.ok(md.includes('未记录'));assert.ok(md.includes('提出／待验证'));
});
