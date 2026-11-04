import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.mjs';
import { Store } from '../server/store.mjs';
import { examples } from '../server/examples.mjs';
import { loadConfig } from '../server/config.mjs';

async function setup(extractor){
  const store=new Store(':memory:');
  const config={...loadConfig(),configured:true,apiKey:'test-key-not-real',endpoint:'http://unused',model:'test-model'};
  const service=createApp({store,config,extractor:extractor || (async()=>{const e=examples.find(x=>x.id==='history');return {trajectory:structuredClone(e.trajectory),warnings:[]};})});
  const server=service.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url='http://127.0.0.1:'+server.address().port;
  const request=async(path,method='GET',data)=>{const r=await fetch(url+path,{method,headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const text=await r.text();return{status:r.status,body:r.headers.get('content-type')?.includes('application/json')?JSON.parse(text):text};};
  return {...service,request,close:async()=>{await Promise.all([...service.jobs.values()]);await new Promise(r=>server.close(r));store.close();}};
}
test('提交、异步提取、编辑、确认、历史读取和导出保持同一原稿',async()=>{
  const s=await setup();try{
    const e=examples.find(x=>x.id==='history');
    const created=await s.request('/api/trajectories','POST',{title:'测试',content:e.content,narrative_origin:'synthetic_example'});
    assert.equal(created.status,201);const id=created.body.id;await Promise.all([...s.jobs.values()]);
    let r=(await s.request('/api/trajectories/'+id)).body;assert.equal(r.selected_revision,1);assert.equal(r.source.content,e.content);assert.equal(r.extraction_status,'succeeded');
    const original=structuredClone(r.trajectory);
    assert.equal((await s.request(`/api/trajectories/${id}/confirm`,'POST',{revision:1})).status,200);
    r.trajectory.nodes[0].content='贡献者补充的描述';
    const edited=await s.request(`/api/trajectories/${id}/draft`,'PUT',{base_revision:1,trajectory:r.trajectory});assert.equal(edited.status,200);assert.equal(edited.body.review_status,'draft');assert.equal(edited.body.confirmed_revision,1);assert.equal(edited.body.trajectory.nodes[0].provenance.origin,'user_added');
    assert.equal((await s.request(`/api/trajectories/${id}/draft`,'PUT',{base_revision:1,trajectory:r.trajectory})).status,409);
    const history=await s.request(`/api/trajectories/${id}?revision=1`);assert.deepEqual(history.body.trajectory,original);assert.equal(history.body.review_status,'confirmed');
    const json=await s.request(`/api/trajectories/${id}/export?format=json&revision=1`);assert.equal(json.body.revision,1);assert.equal(json.body.source.narrative_origin,'synthetic_example');assert.deepEqual(json.body.trajectory,original);
    const md=await s.request(`/api/trajectories/${id}/export?format=markdown&revision=1`);assert.ok(md.body.includes('修订：1'));assert.ok(md.body.includes(e.content));
    assert.equal((await s.request('/api/trajectories')).body.length,1);
  }finally{await s.close();}
});
test('提取中不接受重复调用或编辑；失败保留之前确认的版本',async()=>{
  let release;const gate=new Promise(r=>release=r);const s=await setup(async()=>{await gate;throw new Error('模拟连接中断');});
  try{
    const created=await s.request('/api/examples/history','POST',{});const id=created.body.id;
    await s.request(`/api/trajectories/${id}/confirm`,'POST',{revision:1});
    assert.equal((await s.request(`/api/trajectories/${id}/extractions`,'POST',{})).status,202);
    assert.equal((await s.request(`/api/trajectories/${id}/extractions`,'POST',{})).status,409);
    assert.equal((await s.request(`/api/trajectories/${id}/draft`,'PUT',{base_revision:1,trajectory:created.body.trajectory})).status,409);
    release();await Promise.all([...s.jobs.values()]);
    const r=(await s.request('/api/trajectories/'+id)).body;assert.equal(r.extraction_status,'failed');assert.equal(r.selected_revision,1);assert.equal(r.review_status,'confirmed');assert.ok(r.attempts[0].error.includes('模拟连接中断'));
  }finally{release();await s.close();}
});
test('健康检查不暴露密钥，非法上传和空稿不创建记录',async()=>{
  const s=await setup();try{
    const health=await s.request('/api/health');assert.ok(!JSON.stringify(health.body).includes('test-key-not-real'));
    assert.equal((await s.request('/api/trajectories','POST',{content:'   '})).status,400);
    assert.equal((await s.request('/api/trajectories','POST',{content:'数据',input_kind:'markdown_file',filename:'paper.pdf'})).status,400);
    assert.equal((await s.request('/api/trajectories','POST',{content:'字'.repeat(30001)})).status,413);
    assert.equal((await s.request('/api/trajectories')).body.length,0);
  }finally{await s.close();}
});
