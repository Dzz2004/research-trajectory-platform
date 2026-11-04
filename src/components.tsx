import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowDown, ArrowRight, BookOpen, Check, ChevronRight, FlaskConical, GitBranch, Lightbulb, Link2, Pencil, Plus, Quote, X } from 'lucide-react';
import { layoutTimeline } from '../shared/layout.mjs';
import type { ProcessNode, Provenance, Trajectory } from './types';
import { actionLabels, inputLabels, occurrenceLabels, originLabels, outputLabels, outputStatuses, relationLabels } from './types';

export function Markdown({ content }: { content:string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    img: ({alt})=><span className="image-reference">[图片引用：{alt || '未加载'}]</span>,
    a: ({children,href})=><a href={href} target="_blank" rel="noreferrer">{children}</a>,
  }}>{content}</ReactMarkdown></div>;
}

export function SourceView({ content, focus }: { content:string; focus: Provenance['source_refs'] }) {
  const [preview,setPreview] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const focused = focus.map(r=>`${r.start_line}-${r.end_line}`).join(',');
  useEffect(()=> {
    if (!focus.length) return;
    setPreview(false);
    requestAnimationFrame(()=>container.current?.querySelector('.source-line.is-highlighted')?.scrollIntoView({ block:'nearest',behavior:'smooth' }));
  },[focused]);
  return <section className="source-panel panel">
    <div className="panel-heading"><span><BookOpen size={16}/> 原始文稿</span><div className="segmented small"><button className={!preview?'active':''} onClick={()=>setPreview(false)}>行号</button><button className={preview?'active':''} onClick={()=>setPreview(true)}>预览</button></div></div>
    <div className="source-body" ref={container}>{preview ? <Markdown content={content}/> : <div className="source-code">{content.split(/\r\n|\r|\n/).map((line,i)=><div key={i} className={'source-line '+(focus.some(r=>i+1>=r.start_line && i+1<=r.end_line)?'is-highlighted':'')} data-line={i+1}><span className="line-number">{i+1}</span><span>{line || ' '}</span></div>)}</div>}</div>
  </section>;
}

export function ProvenanceTag({ value, onLocate }: { value: Provenance; onLocate?:(p:Provenance)=>void }) {
  return <button className={'provenance-tag '+value.origin} title={value.note || '查看原文出处'} onClick={()=>onLocate?.(value)}><Quote size={11}/>{originLabels[value.origin]}{value.source_refs.length>0 && <span> L{value.source_refs[0].start_line}</span>}</button>;
}

function NodeCard({ node,onSelect,onLocate }: { node:ProcessNode; onSelect:(n:ProcessNode)=>void; onLocate:(p:Provenance)=>void }) {
  const reasoning = node.kind==='reasoning';
  return <article className={'node-card '+(reasoning?'reasoning':'action')}>
    <button className="node-open" onClick={()=>onSelect(node)} aria-label={'查看节点 '+node.id+' '+node.title}>
      <span className="node-meta"><span className={'node-kind '+(reasoning?'reasoning':'action')}>{reasoning?<Lightbulb size={13}/>:<FlaskConical size={13}/>} {reasoning?'思考／决策':'动作'}</span><span className="mono">{node.id}</span><ChevronRight size={14}/></span>
      <h4>{node.title}</h4><p>{node.content}</p>
    </button>
    <div className="node-bottom"><ProvenanceTag value={node.provenance} onLocate={onLocate}/><span>{occurrenceLabels[node.occurrence]}</span></div>
  </article>;
}

export function TrajectoryView({ trajectory:t, onSelect,onLocate,onAdd,editable }: {
  trajectory:Trajectory;onSelect:(n:ProcessNode)=>void;onLocate:(p:Provenance)=>void;onAdd:(kind:'reasoning'|'action')=>void;editable:boolean;
}) {
  const [mode,setMode]=useState('graph');
  const layout=layoutTimeline(t);
  return <div className="trajectory-overview">
    <section className="summary-section"><div className="section-heading"><h3><span className="section-marker">IN</span> 研究输入</h3><span>目标与边界</span></div>
      <div className="input-grid">{Object.entries(inputLabels).map(([key,label])=><div className="input-group" key={key}><span className="eyebrow">{label}</span>{t.inputs[key as keyof typeof t.inputs].length ? t.inputs[key as keyof typeof t.inputs].map(i=><div className="input-item" key={i.id}><p>{i.content}</p><ProvenanceTag value={i.provenance} onLocate={onLocate}/></div>) : <p className="empty-inline">未记录</p>}</div>)}</div>
    </section>
    <section className="process-section"><div className="section-heading"><h3><GitBranch size={17}/> 研究过程 <span className="count-pill">{t.nodes.length}</span></h3><div className="segmented small"><button className={mode==='graph'?'active':''} onClick={()=>setMode('graph')}>过程图</button><button className={mode==='list'?'active':''} onClick={()=>setMode('list')}>节点列表</button></div></div>
      {mode==='list' ? <div className="node-list">{t.nodes.map(n=><NodeCard key={n.id} node={n} onSelect={onSelect} onLocate={onLocate}/>)}</div> : <>
        {layout.layers.length>0 && <div className="timeline"><div className="subtle-caption">明确时序 · 只有标为“并行”的同组任务表示并行</div>{layout.layers.map((groups:any[],index:number)=><div className="timeline-layer" key={index}>
          <div className="timeline-step"><span>{String(index+1).padStart(2,'0')}</span>{index<layout.layers.length-1 && <ArrowDown size={15}/>}</div>
          <div className="timeline-groups">{groups.length>1 && <div className="subtle-caption">本层各组相对先后未记录</div>}{groups.map(group=><div className="timeline-group" key={group.id}>{group.parallel && <div className="parallel-label"><GitBranch size={12}/> 原文明示并行</div>}<div className={group.parallel?'parallel-nodes':'single-node'}>{group.nodes.map((n:ProcessNode)=><NodeCard key={n.id} node={n} onSelect={onSelect} onLocate={onLocate}/>)}</div></div>)}</div>
        </div>)}</div>}
        {layout.unknown.length>0 && <div className="unknown-order"><div className="unknown-heading"><span>时序未提供</span><small>按原文位置阅读，不代表历史先后</small></div><div className="node-list">{layout.unknown.map((n:ProcessNode)=><NodeCard key={n.id} node={n} onSelect={onSelect} onLocate={onLocate}/>)}</div></div>}
      </>}
      {!t.nodes.length && <div className="empty-block">原稿未记录具体过程节点，可在结构编辑中补充。</div>}
      {editable && <div className="add-node-row"><button className="text-button" onClick={()=>onAdd('reasoning')}><Plus size={14}/> 思考／决策</button><button className="text-button" onClick={()=>onAdd('action')}><Plus size={14}/> 动作</button></div>}
      {t.relations.length>0 && <div className="relations"><div className="subtle-caption"><Link2 size={13}/> 节点关系</div>{t.relations.map(r=><div key={r.id} className={'relation-row '+r.kind}><span className="relation-type">{relationLabels[r.kind]}</span><code>{r.from}</code><span>{r.kind==='parallel'?'↔':<ArrowRight size={13}/>}</span><code>{r.to}</code>{r.kind!=='supports' && <small>{r.scope==='planned'?'计划':r.scope==='reported'?'原稿报告':'时间性质未知'}</small>}<ProvenanceTag value={r.provenance} onLocate={onLocate}/></div>)}</div>}
    </section>
    <section className="outputs-section"><div className="section-heading"><h3><span className="section-marker out">OUT</span> 研究产出</h3><span>方案本身也可以是产出</span></div>{t.outputs.length ? t.outputs.map(o=><article className="output-card" key={o.id}><div className="output-meta"><span>{outputLabels[o.type]}</span><span className="badge neutral">{outputStatuses[o.status]}</span></div><p>{o.content}</p><ProvenanceTag value={o.provenance} onLocate={onLocate}/></article>) : <div className="empty-block">最终产出未记录。</div>}</section>
    {t.gaps.length>0 && <section className="gaps-section"><div className="section-heading"><h3>待补充的问题 <span className="count-pill">{t.gaps.length}</span></h3><span>可以保留未知，再逐步完善</span></div>{t.gaps.map((g,i)=><div className="gap-row" key={g.id}><span>{i+1}</span><div>{g.question}<small>{g.related_ids.length ? '关联 '+g.related_ids.join('、') : '整体记录'}</small></div></div>)}</section>}
  </div>;
}

export function NodeInspector({ node,editable,onClose,onSave,onDelete,onLocate }: { node:ProcessNode; editable:boolean;onClose:()=>void;onSave:(n:ProcessNode,keep:boolean)=>void;onDelete:()=>void;onLocate:(p:Provenance)=>void }) {
  const [edit,setEdit]=useState(false),[value,setValue]=useState(JSON.stringify(node,null,2)),[error,setError]=useState(''),[keep,setKeep]=useState(false);
  useEffect(()=>{setValue(JSON.stringify(node,null,2));setEdit(false);setError('');setKeep(false);},[node.id]);
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="node-drawer" role="dialog" aria-modal="true" aria-label={'节点 '+node.id} onMouseDown={e=>e.stopPropagation()}>
    <div className="drawer-heading"><span className="eyebrow">节点详情 · {node.id}</span><button className="icon-button" onClick={onClose} aria-label="关闭详情"><X size={19}/></button></div>
    <h2>{node.title}</h2><div className="drawer-tags"><span className={'badge '+(node.kind==='reasoning'?'purple':'blue')}>{node.kind==='reasoning'?'思考／决策':'动作'}</span><span className="badge neutral">{occurrenceLabels[node.occurrence]}</span></div>
    {edit ? <><label className="field-label" htmlFor="node-json">节点内容</label><textarea id="node-json" className="json-editor node-json" value={value} onChange={e=>setValue(e.target.value)} spellCheck={false}/><label className="checkbox-label"><input type="checkbox" checked={keep} onChange={e=>setKeep(e.target.checked)}/> 仅改写措辞、原义未变，保留原文出处</label><p className="field-hint">默认将修订内容标为人工补充；完整结构在保存到服务端时校验。</p>{error && <div className="error-box">{error}</div>}<div className="button-row"><button className="primary-button" onClick={()=>{try{const n=JSON.parse(value);if(n.id!==node.id)throw new Error('节点ID请在结构编辑中修改，并同步关系。');onSave(n,keep);}catch(e){setError((e as Error).message);}}}><Check size={15}/> 应用修改</button><button className="secondary-button" onClick={()=>setEdit(false)}>取消</button></div></> : <>
      <div className="detail-section"><span className="eyebrow">内容</span><p>{node.content}</p></div>
      {node.actor && <div className="detail-section"><span className="eyebrow">主体</span><p>{node.actor}</p></div>}
      {node.reasoning && <>{Object.entries({question:'问题',decision:'判断／选择',basis:'依据'}).map(([key,label])=><div className="detail-section" key={key}><span className="eyebrow">{label}</span><p>{node.reasoning?.[key as keyof typeof node.reasoning] as string || '未记录'}</p></div>)}{node.reasoning.alternatives.length>0 && <div className="detail-section"><span className="eyebrow">候选与取舍</span>{node.reasoning.alternatives.map((a,i)=><div className="alternative" key={i}><strong>{a.option}</strong><p>{a.tradeoff || '取舍依据未记录'}</p></div>)}</div>}</>}
      {node.action && Object.entries({category:'动作类别',operation:'操作',target:'对象',parameters:'条件',result:'返回结果',interpretation:'作者解释'}).map(([key,label])=><div className="detail-section" key={key}><span className="eyebrow">{label}</span><p>{key==='category'?actionLabels[node.action!.category]:node.action?.[key as keyof typeof node.action] || '未记录'}</p></div>)}
      <div className="detail-section"><span className="eyebrow">决策前已知信息</span><p>{node.known_before_ids===null?'原稿不足以确定':node.known_before_ids.join('、') || '未记录额外信息'}</p></div>
      <div className="detail-section"><span className="eyebrow">原文出处</span><ProvenanceTag value={node.provenance} onLocate={p=>{onLocate(p);onClose();}}/>{node.provenance.source_refs.map((r,i)=><blockquote key={i}><span>L{r.start_line}{r.end_line!==r.start_line?'–'+r.end_line:''}</span>{r.quote}</blockquote>)}{node.provenance.note && <p>{node.provenance.note}</p>}</div>
      {editable && <div className="drawer-footer"><button className="secondary-button" onClick={()=>setEdit(true)}><Pencil size={14}/> 编辑节点</button><button className="danger-text" onClick={onDelete}>删除节点</button></div>}
    </>}
  </aside></div>;
}
