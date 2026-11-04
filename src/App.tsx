import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, BookOpen, Check, CheckCheck, ChevronRight, CircleHelp, Clock3, FileCode2, FileText, GitBranch, History, Layers3, LayoutGrid, LoaderCircle, Menu, Plus, RefreshCw, Search, Settings2, Sparkles, Upload, Waypoints, X } from 'lucide-react';
import { api, ApiError, send } from './api';
import { Markdown, NodeInspector, SourceView, TrajectoryView } from './components';
import { validateTrajectory, allItems } from '../shared/schema.mjs';
import type { Example, ProcessNode, Provenance, Provider, RecordData, Summary, Trajectory } from './types';
import { dateLabel, narrativeLabels, statusLabels } from './types';

type Route = { page:'new'|'library'|'record'; id?:string; revision?:number };
function routeFromHash(): Route {
  const value=window.location.hash.slice(1) || '/new';
  const [path,query]=value.split('?');
  if(path.startsWith('/records/'))return {page:'record',id:path.split('/')[2],revision:new URLSearchParams(query).has('revision')?Number(new URLSearchParams(query).get('revision')):undefined};
  return {page:path==='/records'?'library':'new'};
}

export default function App() {
  const [route,setRoute]=useState<Route>(routeFromHash);
  const [provider,setProvider]=useState<Provider|null>(null),[examples,setExamples]=useState<Example[]>([]),[records,setRecords]=useState<Summary[]>([]);
  const [record,setRecord]=useState<RecordData|null>(null),[draft,setDraft]=useState<Trajectory|null>(null),[selected,setSelected]=useState<ProcessNode|null>(null);
  const [tab,setTab]=useState('overview'),[focus,setFocus]=useState<Provenance['source_refs']>([]),[keepSource,setKeepSource]=useState<string[]>([]);
  const [jsonText,setJsonText]=useState(''),[retainJsonSources,setRetainJsonSources]=useState(false);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState<{message:string;details:string[]}|null>(null),[notice,setNotice]=useState('');
  const [settings,setSettings]=useState(false),[sidebar,setSidebar]=useState(false),[filter,setFilter]=useState('');
  const [title,setTitle]=useState(''),[content,setContent]=useState(''),[origin,setOrigin]=useState('unknown'),[inputKind,setInputKind]=useState('pasted_text'),[filename,setFilename]=useState<string|null>(null),[inputTab,setInputTab]=useState('paste'),[inputPreview,setInputPreview]=useState(false);
  const upload=useRef<HTMLInputElement>(null);
  const inProgress=record && ['pending','running'].includes(record.extraction_status);
  const current=record?.selected_revision===record?.latest_revision;
  const editable=!!record && !!draft && current && !inProgress && !busy;
  const draftDirty=!!record && !!draft && JSON.stringify(record.trajectory)!==JSON.stringify(draft);
  const jsonDirty=tab==='edit' && !!draft && jsonText!==JSON.stringify(draft,null,2);
  const dirty=draftDirty || jsonDirty;
  const showError=(e:unknown)=>setError({message:e instanceof Error?e.message:'处理失败，请重试。',details:e instanceof ApiError?e.details:[]});
  const refreshList=useCallback(async()=>{try{setRecords(await api<Summary[]>('/trajectories'));}catch(e){showError(e);}},[]);
  const acceptRecord=(r:RecordData)=>{setRecord(r);setDraft(r.trajectory);setJsonText(r.trajectory?JSON.stringify(r.trajectory,null,2):'');setKeepSource([]);setSelected(null);};
  const navigate=(hash:string,force=false)=>{
    if(!force && dirty && !window.confirm('有未保存的修改，离开后将丢弃这些修改。继续吗？'))return;
    setSidebar(false);setError(null);setNotice('');window.location.hash=hash;
  };
  useEffect(()=>{const change=()=>setRoute(routeFromHash());window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  useEffect(()=>{
    api<{provider:Provider}>('/health').then(r=>setProvider(r.provider)).catch(showError);
    api<Example[]>('/examples').then(setExamples).catch(showError);void refreshList();
  },[refreshList]);
  useEffect(()=>{
    if(route.page!=='record' || !route.id){setRecord(null);setDraft(null);setSelected(null);return;}
    let cancelled=false;setLoading(true);setTab('overview');setFocus([]);
    api<RecordData>(`/trajectories/${route.id}${route.revision?`?revision=${route.revision}`:''}`).then(r=>{if(!cancelled)acceptRecord(r);}).catch(e=>{if(!cancelled)showError(e);}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[route.id,route.page,route.revision]);
  useEffect(()=>{
    if(!inProgress || !record)return;
    let cancelled=false;
    const timer=window.setInterval(()=>{
      api<RecordData>(`/trajectories/${record.id}${route.revision?`?revision=${route.revision}`:''}`).then(r=>{if(cancelled)return;acceptRecord(r);if(!['pending','running'].includes(r.extraction_status))void refreshList();}).catch(e=>{if(!cancelled)showError(e);});
    },1800);
    return()=>{cancelled=true;window.clearInterval(timer);};
  },[record?.id,inProgress,route.revision,refreshList]);
  useEffect(()=>{
    const unload=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);
  },[dirty]);
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),5000);return()=>clearTimeout(t);},[notice]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setSelected(null);setSettings(false);setSidebar(false);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);

  async function openExample(id:string){setBusy(true);setError(null);try{const r=await api<RecordData>('/examples/'+id,send({}));await refreshList();navigate('/records/'+r.id,true);}catch(e){showError(e);}finally{setBusy(false);}}
  async function readFile(file:File){
    setError(null);
    if(!/\.(md|markdown)$/i.test(file.name)){showError(new Error('请选择 .md 或 .markdown 文件。'));return;}
    if(file.size>(provider?.max_input_bytes || 262144)){showError(new Error('文件超过 256 KiB，请缩短后再导入。'));return;}
    try{const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()).replace(/^\uFEFF/,'');if(Array.from(text).length>(provider?.max_input_characters || 30000))throw new Error('文稿超过字符上限，请缩短后再导入。');setContent(text);setFilename(file.name);setInputKind('markdown_file');setInputTab('paste');setInputPreview(false);}catch(e){showError(new Error((e as Error).message.includes('字符')?(e as Error).message:'文件不是有效的 UTF-8 文本，请转换编码后重试。'));}
  }
  async function submit(){
    setBusy(true);setError(null);
    try{const r=await api<RecordData>('/trajectories',send({title,input_kind:inputKind,filename,narrative_origin:origin,content,extract:provider?.configured || false}));await refreshList();navigate('/records/'+r.id,true);setTitle('');setContent('');setFilename(null);setInputKind('pasted_text');}
    catch(e){showError(e);}finally{setBusy(false);}
  }
  function changeTab(next:string){
    if(tab==='edit' && jsonDirty && next!=='edit'){
      try{const value=JSON.parse(jsonText);const check=validateTrajectory(value,record!.source.content);if(!check.ok)throw new ApiError('结构未通过校验。',check.errors);setDraft(value);}
      catch(e){showError(e);return;}
    }
    if(next==='edit' && draft)setJsonText(JSON.stringify(draft,null,2));
    setTab(next);
  }
  async function saveDraft(){
    if(!record || !draft)return;
    setBusy(true);setError(null);
    try{
      const value=jsonDirty?JSON.parse(jsonText):draft;
      const check=validateTrajectory(value,record.source.content);
      if(!check.ok)throw new ApiError('修改未通过校验。',check.errors);
      const ids=retainJsonSources && tab==='edit'?allItems(value).map(o=>o.id):keepSource;
      const r=await api<RecordData>(`/trajectories/${record.id}/draft`,{method:'PUT',body:JSON.stringify({base_revision:record.latest_revision,trajectory:value,keep_source_ids:ids})});
      acceptRecord(r);setRetainJsonSources(false);setNotice('新草稿已保存，旧版本已保留。');void refreshList();
    }catch(e){showError(e);}finally{setBusy(false);}
  }
  async function confirm(){if(!record)return;setBusy(true);setError(null);try{const r=await api<RecordData>(`/trajectories/${record.id}/confirm`,send({revision:record.selected_revision}));acceptRecord(r);setNotice('此版本已标记为贡献者核对。');void refreshList();}catch(e){showError(e);}finally{setBusy(false);}}
  async function reextract(){if(!record)return;setBusy(true);setError(null);try{await api(`/trajectories/${record.id}/extractions`,send({}));acceptRecord(await api<RecordData>(`/trajectories/${record.id}`));void refreshList();}catch(e){showError(e);}finally{setBusy(false);}}
  function locate(p:Provenance){if(tab==='edit' && jsonDirty){showError(new Error('请先保存或应用结构修改，再定位原文。'));return;}setFocus(p.source_refs);setTab('compare');}
  function addNode(kind:'reasoning'|'action'){
    if(!draft)return;
    const n:ProcessNode={id:'N'+crypto.randomUUID().slice(0,8),kind,title:kind==='reasoning'?'新增思考／决策':'新增动作',content:'请补充这一步的内容。',actor:null,occurrence:'unknown',known_before_ids:null,provenance:{origin:'user_added',source_refs:[],note:'贡献者补充，原始文稿中未记录。'},reasoning:kind==='reasoning'?{question:null,alternatives:[],decision:null,basis:null}:null,action:kind==='action'?{category:'other',operation:'请补充具体操作',target:null,parameters:null,result:null,interpretation:null}:null};
    setDraft({...draft,nodes:[...draft.nodes,n]});setSelected(n);
  }
  function updateNode(node:ProcessNode,keep:boolean){
    if(!draft)return;
    const next={...draft,nodes:draft.nodes.map(n=>n.id===node.id?node:n)};
    const check=validateTrajectory(next,record!.source.content);if(!check.ok)throw new ApiError('节点未通过校验：'+check.errors.join('；'));
    setDraft(next);setKeepSource(ids=>keep?[...new Set([...ids,node.id])]:ids.filter(id=>id!==node.id));setSelected(null);
  }
  function deleteNode(){
    if(!draft || !selected)return;
    const id=selected.id;setDraft({...draft,nodes:draft.nodes.filter(n=>n.id!==id).map(n=>({...n,known_before_ids:n.known_before_ids?.filter(k=>k!==id) ?? null})),relations:draft.relations.filter(r=>r.from!==id && r.to!==id),gaps:draft.gaps.map(g=>({...g,related_ids:g.related_ids.filter(k=>k!==id)}))});setSelected(null);
  }
  const count=Array.from(content).length;
  const matching=records.filter(r=>r.title.toLowerCase().includes(filter.toLowerCase()));

  return <div className="app-shell">
    {sidebar && <div className="sidebar-scrim" onClick={()=>setSidebar(false)}/>}
    <aside className={'sidebar '+(sidebar?'is-open':'')}>
      <a className="brand" href="#/new" onClick={e=>{e.preventDefault();navigate('/new');}}><span className="brand-symbol"><Waypoints size={23}/></span><span><strong>研迹</strong><small>RESEARCH TRACE</small></span></a>
      <button className="new-record-button" onClick={()=>navigate('/new')}><Plus size={17}/> 新建研究记录 <span>↗</span></button>
      <div className="nav-label">工作空间</div>
      <button className={'nav-item '+(route.page==='library'?'active':'')} onClick={()=>navigate('/records')}><LayoutGrid size={17}/> 全部记录 <span>{records.length}</span></button>
      <div className="nav-label recent-label">最近记录</div>
      <nav className="recent-records">{records.slice(0,9).map(r=><button key={r.id} className={'recent-item '+(record?.id===r.id?'active':'')} onClick={()=>navigate('/records/'+r.id)}><FileText size={15}/><span>{r.title}</span>{r.review_status==='confirmed' && <Check size={12}/>}</button>)}{!records.length && <div className="sidebar-empty">保存第一篇文稿后，<br/>会在这里看到研究记录。</div>}</nav>
      <div className="sidebar-bottom"><button className="nav-item" onClick={()=>setSettings(true)}><Settings2 size={16}/> 模型设置 <span className={'status-dot '+(provider?.configured?'ready':'')}/></button><div className="workspace-label"><span className="workspace-avatar">研</span><span>本地工作区<small>科研轨迹 · v0.1</small></span><span className="workspace-dot"/></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={()=>setSidebar(true)} aria-label="打开导航"><Menu size={20}/></button><span>工作台</span><ChevronRight size={13}/><strong>{route.page==='new'?'新建记录':route.page==='library'?'全部记录':'研究记录'}</strong></div><button className="provider-status" onClick={()=>setSettings(true)}><span className={'status-dot '+(provider?.configured?'ready':'')}/>{provider?.configured?'模型已配置':'模型待配置'}<CircleHelp size={13}/></button></header>
      {error && <div className="global-message error-message" role="alert"><div><strong>{error.message}</strong>{error.details.length>0 && <ul>{error.details.slice(0,12).map((d,i)=><li key={i}>{d}</li>)}</ul>}</div><button className="icon-button" onClick={()=>setError(null)} aria-label="关闭错误"><X size={16}/></button></div>}
      {notice && <div className="toast" role="status"><Check size={15}/>{notice}</div>}

      {route.page==='new' && <main className="new-page page">
        <div className="page-intro"><div className="overline"><span/> 让研究过程有迹可循</div><h1>从一篇文稿，<br className="small-break"/>开始记录科研轨迹。</h1><p>留下目标、判断和行动，将自然语言整理成可核对、可复用的研究记录。</p></div>
        <div className="workflow-strip"><div className="is-current"><span>01</span> 导入文稿</div><span className="step-line"/><div><span>02</span> 整理轨迹</div><span className="step-line"/><div><span>03</span> 核对与保存</div></div>
        <div className="composer-layout"><section className="composer panel"><div className="panel-heading"><span><FileText size={17}/> 研究文稿</span><span className="subtle-caption">支持 Markdown</span></div>
          <div className="composer-fields"><label className="field-label" htmlFor="document-title">记录标题 <span>选填</span></label><input id="document-title" value={title} maxLength={200} onChange={e=>setTitle(e.target.value)} placeholder="为这段研究过程起一个名字"/>
            <div className="composer-toolbar"><div className="composer-tabs"><button className={inputTab==='paste'?'active':''} onClick={()=>setInputTab('paste')}><PencilIcon/> 粘贴文稿</button><button className={inputTab==='upload'?'active':''} onClick={()=>setInputTab('upload')}><Upload size={14}/> 上传文件</button></div>{inputTab==='paste' && <button className="text-button" onClick={()=>setInputPreview(v=>!v)}>{inputPreview?'编辑':'预览'}</button>}</div>
            <input ref={upload} type="file" accept=".md,.markdown,text/markdown" className="visually-hidden" onChange={e=>{const file=e.target.files?.[0];if(file)void readFile(file);e.target.value='';}}/>
            {inputTab==='upload'?<button className="upload-area" onClick={()=>upload.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)void readFile(f);}}><span className="upload-icon"><Upload size={23}/></span><strong>选择或拖入 Markdown 文件</strong><span>.md、.markdown · UTF-8 · 最大 256 KiB</span></button>:inputPreview?<div className="composer-preview"><Markdown content={content || '*填写文稿后可在这里预览。*'}/></div>:<textarea className="source-input" value={content} onChange={e=>{setContent(e.target.value);setInputKind(filename?'markdown_file':'pasted_text');}} placeholder={'可以写下研究目标、约束、考虑过的方案，\n以及查阅资料、计算或实验如何改变了判断。\n\n一段不完整的研究总结也可以，\n系统会保留原文没有说明的未知。'} spellCheck={false} aria-label="研究文稿正文"/>}
            <div className="editor-footer"><span>{filename?<><FileCode2 size={12}/> {filename}</>:<><span className="md-mark">M↓</span> Markdown</>}</span><span className={count>(provider?.max_input_characters || 30000)?'over-limit':''}>{count.toLocaleString()} / {(provider?.max_input_characters || 30000).toLocaleString()}</span></div>
            <div className="origin-field"><label htmlFor="narrative-origin">文稿来源</label><select id="narrative-origin" value={origin} onChange={e=>setOrigin(e.target.value)}>{Object.entries(narrativeLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><span>保留来源，方便后续核对</span></div>
          </div>
          <div className="composer-submit"><p><BookOpen size={14}/> 保留原稿与出处，生成后由你核对。</p><button className="primary-button" disabled={busy || !content.trim() || count>(provider?.max_input_characters || 30000)} onClick={()=>void submit()}>{busy?<LoaderCircle size={16} className="spin"/>:<Sparkles size={16}/>} {provider?.configured?'生成科研轨迹':'保存原稿'} {!busy && <ArrowRight size={15}/>}</button></div>
        </section>
        <aside className="composer-guide"><div className="guide-block"><span className="eyebrow">你将得到</span><h2>研究过程，清晰展开</h2><div className="guide-step"><span className="guide-icon input"><Layers3 size={17}/></span><div><strong>输入与边界</strong><p>目标、约束和人为条件</p></div></div><div className="guide-connector"/><div className="guide-step"><span className="guide-icon process"><GitBranch size={17}/></span><div><strong>思考与行动</strong><p>判断依据、具体操作和结果</p></div></div><div className="guide-connector"/><div className="guide-step"><span className="guide-icon output"><CheckCheck size={17}/></span><div><strong>研究产出</strong><p>方案、假设结论或新问题</p></div></div><div className="guide-note">只整理文稿表达的内容。<br/>时序不明和信息缺失会保留下来。</div></div>
          <div className="examples-block"><div className="example-heading"><span className="eyebrow">先看看它的样子</span><span className="badge neutral">模拟示例</span></div>{examples.map((e,i)=><button className="example-card" key={e.id} disabled={busy} onClick={()=>void openExample(e.id)}><span className="example-index">0{i+1}</span><span><strong>{e.name}</strong><small>{e.description}</small></span><ArrowRight size={15}/></button>)}</div>
        </aside></div>
        <div className="page-footnote">为科研 agent 的设计与评估，积累可追溯的过程记录。</div>
      </main>}

      {route.page==='library' && <main className="page library-page"><div className="library-heading"><div><span className="overline">研究工作区</span><h1>全部记录 <span>{records.length}</span></h1><p>从原稿到轨迹，保留每一次核对与修订。</p></div><button className="primary-button" onClick={()=>navigate('/new')}><Plus size={16}/> 新建记录</button></div><div className="search-field"><Search size={16}/><input aria-label="搜索研究记录" placeholder="搜索记录标题" value={filter} onChange={e=>setFilter(e.target.value)}/></div>
        {matching.length?<div className="record-list">{matching.map(r=><button className="record-list-item" key={r.id} onClick={()=>navigate('/records/'+r.id)}><span className="document-icon"><FileText size={23}/></span><div><h3>{r.title}</h3><p>{narrativeLabels[r.narrative_origin]}<span>·</span>{r.node_count} 个节点<span>·</span>{dateLabel(r.created_at)}</p></div><span className={'badge '+(r.review_status==='confirmed'?'green':'neutral')}>{r.review_status==='confirmed'?'已核对':statusLabels[r.extraction_status]}</span><ChevronRight size={17}/></button>)}</div>:<div className="library-empty"><BookOpen size={34}/><h2>{filter?'没有匹配的记录':'从第一篇研究文稿开始'}</h2><p>{filter?'试试其他关键词。':'粘贴总结或上传 Markdown，建立你的第一条科研轨迹。'}</p>{!filter && <button className="secondary-button" onClick={()=>navigate('/new')}>新建研究记录 <ArrowRight size={14}/></button>}</div>}
      </main>}

      {route.page==='record' && (loading?<div className="loading-page"><LoaderCircle className="spin" size={24}/> 正在读取研究记录…</div>:record && <main className="page record-page">
        <div className="record-heading"><div><div className="record-meta"><span className={'badge '+(record.source.narrative_origin==='synthetic_example'?'amber':'neutral')}>{narrativeLabels[record.source.narrative_origin]}</span><span>{dateLabel(record.created_at)}</span>{record.source.filename && <span>{record.source.filename}</span>}</div><h1>{draft?.title || record.title}</h1><div className="record-subtitle"><span>{record.trajectory?`${record.trajectory.nodes.length} 个过程节点 · ${record.trajectory.relations.length} 条关系`:'原稿已保存'}</span><span className={'review-status '+(record.review_status==='confirmed'?'confirmed':'')}>{record.review_status==='confirmed'?<CheckCheck size={13}/>:<Clock3 size={13}/>} {record.review_status==='confirmed'?'贡献者已核对':'待核对草稿'}</span>{dirty && <span className="unsaved">有未保存修改</span>}</div></div>
          <div className="record-actions"><button className="secondary-button" disabled={busy || !!inProgress || dirty || !provider?.configured || !current} onClick={()=>void reextract()} title={!provider?.configured?'请先配置模型':'重新提取会保留现有版本'}><RefreshCw size={14} className={inProgress?'spin':''}/> 重新提取</button>{draft && <details className="export-menu"><summary className="secondary-button"><ArrowDownToLine size={14}/> 导出</summary><div><a href={`/api/trajectories/${record.id}/export?format=json&revision=${record.selected_revision}`} download>结构化 JSON</a><a href={`/api/trajectories/${record.id}/export?format=markdown&revision=${record.selected_revision}`} download>Markdown 文档</a>{dirty && <small>导出的是最近保存版本</small>}</div></details>}{dirty && <button className="primary-button" disabled={busy || !!inProgress || !current} onClick={()=>void saveDraft()}>{busy?<LoaderCircle className="spin" size={14}/>:<Check size={14}/>} 保存修改</button>}{draft && !dirty && current && record.review_status!=='confirmed' && <button className="primary-button" disabled={busy || !!inProgress} onClick={()=>void confirm()}><CheckCheck size={15}/> 确认此版本</button>}</div></div>
        {record.source.narrative_origin==='synthetic_example' && <div className="info-banner amber"><Sparkles size={16}/><span>这是模拟示例。提取自示例文稿的内容不代表真实科研结果；人工核对后仍保留模拟标记。</span></div>}
        {!current && <div className="info-banner"><History size={16}/><span>正在查看 v{record.selected_revision} 历史版本，内容只读。</span><button className="text-button" onClick={()=>navigate('/records/'+record.id)}>查看最新版本</button></div>}
        {inProgress && <div className="processing-banner"><LoaderCircle className="spin" size={19}/><div><strong>正在整理并校验科研轨迹</strong><p>原稿已保存，可以刷新页面后继续查看。</p></div></div>}
        {record.extraction_status==='failed' && <div className="info-banner failure"><CircleHelp size={17}/><div><strong>{record.attempts[0]?.error || '提取失败，原稿已保留。'}</strong>{record.attempts[0]?.details.length>0 && <details><summary>查看校验问题</summary><ul>{record.attempts[0].details.map((d,i)=><li key={i}>{d}</li>)}</ul></details>}</div></div>}
        <div className="record-tabs"><button className={tab==='overview'?'active':''} onClick={()=>changeTab('overview')}><GitBranch size={15}/> 轨迹概览</button><button className={tab==='compare'?'active':''} onClick={()=>changeTab('compare')}><BookOpen size={15}/> 原稿对照</button><button className={tab==='edit'?'active':''} onClick={()=>changeTab('edit')} disabled={!draft}><FileCode2 size={15}/> 结构编辑</button><button className={tab==='history'?'active':''} onClick={()=>changeTab('history')}><History size={15}/> 版本记录</button><span className="revision-label">{record.selected_revision?'v'+record.selected_revision:'原稿'}</span></div>
        {(tab==='overview' || tab==='compare') && <div className={tab==='compare'?'comparison-layout':'overview-layout'}>{tab==='compare' && <SourceView content={record.source.content} focus={focus}/>}<div>{draft?<TrajectoryView trajectory={draft} onSelect={setSelected} onLocate={locate} onAdd={addNode} editable={editable}/>:!inProgress?<div className="no-trajectory"><GitBranch size={33}/><h2>原稿已保存</h2><p>{provider?.configured?'准备好后，点击“重新提取”生成结构化轨迹。':'配置模型后即可生成轨迹，也可以返回新建页查看内置示例。'}</p>{provider?.configured?<button className="primary-button" disabled={busy} onClick={()=>void reextract()}><Sparkles size={16}/> 生成科研轨迹</button>:<button className="secondary-button" onClick={()=>setSettings(true)}>查看模型设置</button>}</div>:null}</div></div>}
        {tab==='edit' && draft && <section className="structure-editor panel"><div className="panel-heading"><span><FileCode2 size={16}/> 完整轨迹结构</span><span className="subtle-caption">输入、节点、关系、输出与缺口均可编辑</span></div><div className="structure-editor-body"><p className="field-hint">修改后点击“保存修改”。服务端会校验原文引用和关系，并保留旧版本。新增或改义内容默认标为人工补充。</p><textarea className="json-editor" aria-label="完整轨迹 JSON" value={jsonText} onChange={e=>setJsonText(e.target.value)} readOnly={!editable} spellCheck={false}/>{editable && <label className="checkbox-label"><input type="checkbox" checked={retainJsonSources} onChange={e=>setRetainJsonSources(e.target.checked)}/> 本次仅调整措辞，原义未变，保留仍有效的原文引用</label>}</div></section>}
        {tab==='history' && <section className="history-panel panel"><div className="panel-heading"><span><History size={16}/> 修订版本</span><span className="subtle-caption">原稿保持不变，每次保存生成新版本</span></div>{record.revisions.length?record.revisions.map(v=><button className="version-row" key={v.revision} onClick={()=>navigate(`/records/${record.id}?revision=${v.revision}`)}><span className="version-icon"><History size={17}/></span><div><strong>v{v.revision}{v.revision===record.latest_revision?' · 最新版本':''}</strong><p>{v.origin==='model'?'模型提取':v.origin==='fixture'?'内置模拟示例':'人工修订'} · {dateLabel(v.created_at)}</p></div><span className={'badge '+(v.confirmed_at?'green':'neutral')}>{v.confirmed_at?'贡献者已核对':'草稿'}</span><ChevronRight size={16}/></button>):<div className="empty-block">还没有生成轨迹版本。</div>}<div className="attempt-list"><h3>提取记录</h3>{record.attempts.map(a=><div key={a.id}><span>{statusLabels[a.status]}</span><span>{a.mode==='fixture'?'固定模拟示例':a.model || '模型未配置'}</span><span>{dateLabel(a.created_at)}</span></div>)}</div></section>}
      </main>)}
    </div>
    {selected && <NodeInspector key={selected.id} node={selected} editable={editable} onClose={()=>setSelected(null)} onSave={updateNode} onDelete={deleteNode} onLocate={locate}/>}
    {settings && <div className="modal-backdrop" onMouseDown={()=>setSettings(false)}><section className="settings-modal" role="dialog" aria-modal="true" aria-label="模型设置" onMouseDown={e=>e.stopPropagation()}><div className="drawer-heading"><span className="eyebrow">模型设置</span><button className="icon-button" onClick={()=>setSettings(false)} aria-label="关闭模型设置"><X size={18}/></button></div><h2>{provider?.configured?'模型配置已读取':'连接你的模型服务'}</h2><p>真实提取由本地后端调用模型，访问密钥保留在服务端。</p>{provider?.model && <div className="model-name"><span className={'status-dot '+(provider.configured?'ready':'')}/>{provider.model}</div>}{provider?.config_error && <div className="error-box">{provider.config_error}</div>}<div className="detail-section"><strong>使用已有配置</strong><p>在项目 .env 中指定本地配置文件路径，支持包含 URL、KEY、model 的 JSON 文件。</p><pre>LLM_CONFIG_FILE=/absolute/path/to/api.json</pre></div><div className="detail-section"><strong>或直接配置环境变量</strong><pre>{'LLM_BASE_URL=服务地址\nLLM_API_KEY=访问密钥\nLLM_MODEL=模型名称'}</pre><p className="field-hint">修改配置后重启本地服务。配置就绪不代表接口已验证，真实提取状态以记录为准。</p></div><button className="primary-button" onClick={()=>setSettings(false)}>知道了</button></section></div>}
  </div>;
}

function PencilIcon(){return <FileText size={14}/>;}
