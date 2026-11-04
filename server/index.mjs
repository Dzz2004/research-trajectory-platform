import express from 'express';
import { resolve } from 'node:path';
import { createApp } from './app.mjs';
import { loadConfig } from './config.mjs';

const config = loadConfig();
const { app, store, jobs } = createApp({config});
let vite;
if (process.argv.includes('--production')) {
  app.use(express.static(resolve(config.root,'dist')));
  app.get('/{*path}',(_req,res)=>res.sendFile(resolve(config.root,'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  vite = await createServer({ root:config.root,server:{ middlewareMode:true },appType:'spa' });
  app.use(vite.middlewares);
}
const server = app.listen(config.port,config.host,()=> {
  console.log(`研迹 · 科研轨迹工作台 http://${config.host}:${config.port}`);
  console.log(`模型：${config.configured ? config.model : '待配置，可先打开内置示例'}`);
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close();
  await vite?.close();
  // Do not make in-flight requests disappear silently. On forced restart the store marks them failed.
  if (!jobs.size) { store.close(); process.exit(0); }
  setTimeout(()=>process.exit(0),1000).unref();
}
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);
