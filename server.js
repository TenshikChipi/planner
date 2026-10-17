'use strict';
// Учебный планер: Node.js 20+, без npm-зависимостей.
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(ROOT, 'uploads');
const DB = path.join(DATA, 'tasks.json');
const SECRET_FILE = path.join(DATA, '.secret');
const PASS_FILE = path.join(DATA, '.admin-password');
const PORT = Number(process.env.PORT) || 3000;
const GROUP_NAME = process.env.GROUP_NAME || 'Планер нашей группы';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 6;
const MAX_BODY_BYTES = 70 * 1024 * 1024;
const MAX_COMMENTS = 120;
let secret, adminPassword, store;
let queue = Promise.resolve();
const commentThrottle = new Map();
const loginThrottle = new Map();

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function demoEntries() {
  const subjects = ['Веб-дизайн', 'Программирование на C#', 'Разработка игр', 'Дискретная математика'];
  const entries = [
    { offset: 2, title: 'Сверстать страницу по макету', description: 'Это пример задания. Здесь можно подробно написать условия, требования преподавателя и что именно нужно сделать.', format: 'Ссылка на репозиторий', subject: subjects[0], time:'23:59', submitTo: 'Ссылка на форму для сдачи или LMS', color:'#8D79D9' },
    { offset: 4, title: 'Практика по классам и методам', description: 'Пример: выполнить упражнения и приложить файлы .cs. Староста может отредактировать или удалить это задание.', format: 'Один ZIP-архив', subject: subjects[1], time:'18:00', submitTo: 'Форма домашнего задания', color:'#E79A5B' },
    { offset: 6, title: 'Описать игровые механики', description: 'Это демонстрационная запись для просмотра календаря. Замените её настоящим домашним заданием.', format: 'PDF-презентация', subject: subjects[2], time:'23:59', submitTo: 'Папка группы', color:'#5AAEAB' },
    { offset: 11, title: 'Разобрать задачи по графам', description: 'Демонстрационный дедлайн. Можно добавить ссылки, файлы с условиями и подробное описание.', format: 'Фото/скан в PDF', subject: subjects[3], time:'20:00', submitTo: 'В LMS', color:'#759CCF' }
  ];
  return entries.map((a) => { const d=new Date(); d.setDate(d.getDate()+a.offset); return { id:crypto.randomUUID(), title:a.title, subject:a.subject, dueDate:isoDate(d), dueTime:a.time, description:a.description, format:a.format, submitTo:a.submitTo, submitUrl:'', note:'', color:a.color, priority:'normal', attachments:[], comments:[], demo:true, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() }; });
}
async function setup() {
  await fsp.mkdir(DATA, {recursive:true}); await fsp.mkdir(UPLOADS, {recursive:true});
  try { secret=await fsp.readFile(SECRET_FILE,'utf8'); } catch { secret=crypto.randomBytes(48).toString('hex'); await fsp.writeFile(SECRET_FILE,secret,{mode:0o600}); }
  if (process.env.ADMIN_PASSWORD) adminPassword=process.env.ADMIN_PASSWORD;
  else { try { adminPassword=(await fsp.readFile(PASS_FILE,'utf8')).trim(); } catch { adminPassword=crypto.randomBytes(9).toString('base64url'); await fsp.writeFile(PASS_FILE,adminPassword+'\n',{mode:0o600}); } }
  try { store=JSON.parse(await fsp.readFile(DB,'utf8')); if (!Array.isArray(store.tasks)) throw Error('bad data'); }
  catch { store={tasks:demoEntries()}; await persist(); }
}
async function persist(){ const tmp=DB+'.tmp'; await fsp.writeFile(tmp,JSON.stringify(store,null,2),'utf8'); await fsp.rename(tmp,DB); }
function mutate(fn) { const action=queue.then(async()=>{ const result=await fn(); await persist(); return result; }); queue=action.catch(()=>{}); return action; }
function send(res,status,body,headers={}) { const data=JSON.stringify(body); res.writeHead(status,{ 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers }); res.end(data); }
function fail(res,status,message){send(res,status,{error:message});}
function clientIP(req){return (req.socket.remoteAddress||'').slice(0,80);}
function makeToken(){ const expiry=Date.now()+7*24*60*60*1000; const payload=`admin.${expiry}`; return `${payload}.${crypto.createHmac('sha256',secret).update(payload).digest('hex')}`; }
function isAdmin(req){ const match=(req.headers.cookie||'').match(/(?:^|;\s*)planer_session=([^;]+)/); if (!match) return false; const v=decodeURIComponent(match[1]); const m=v.match(/^(admin\.\d+)\.([a-f0-9]{64})$/); if(!m) return false; if(Number(m[1].split('.')[1])<Date.now()) return false; const expected=crypto.createHmac('sha256',secret).update(m[1]).digest('hex'); return crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(m[2],'hex')); }
function requireAdmin(req,res){ if(!isAdmin(req)){fail(res,403,'Войдите как староста, чтобы изменить задания.');return false;}return true; }
function readJson(req){ return new Promise((resolve,reject)=>{ let size=0; const chunks=[]; req.on('data',(chunk)=>{size+=chunk.length; if(size>MAX_BODY_BYTES){reject(Object.assign(new Error('Слишком большой запрос'),{status:413})); req.destroy();return;} chunks.push(chunk);}); req.on('end',()=>{try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')); } catch {reject(Object.assign(new Error('Некорректные данные'),{status:400}));}});req.on('error',reject); }); }
function str(v,max=500){return typeof v==='string'?v.trim().slice(0,max):'';}
function validDate(s){if(!/^\d{4}-\d\d-\d\d$/.test(s)) return false; const d=new Date(s+'T12:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;}
function cleanseTask(raw,old={}) {
  const title=str(raw.title,150), subject=str(raw.subject,90), dueDate=str(raw.dueDate,12);
  if(!title||!subject||!validDate(dueDate)) throw Object.assign(new Error('Укажите предмет, название и корректную дату.'),{status:400});
  let dueTime=str(raw.dueTime,5)||'23:59'; if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime)) dueTime='23:59';
  const url=str(raw.submitUrl,1500);
  if(url && !/^https?:\/\//i.test(url)) throw Object.assign(new Error('Ссылка должна начинаться с http:// или https://'),{status:400});
  return {...old, title,subject,dueDate,dueTime,description:str(raw.description,7000),format:str(raw.format,200),submitTo:str(raw.submitTo,600),submitUrl:url,note:str(raw.note,700),color:/^#[0-9a-fA-F]{6}$/.test(raw.color)?raw.color:'#8D79D9',priority:raw.priority==='high'?'high':'normal',updatedAt:new Date().toISOString()};
}
function safeAttachment(a){return {id:a.id,name:a.name,size:a.size,mime:a.mime};}
async function saveNewFiles(items){
  if(!Array.isArray(items)) throw Object.assign(new Error('Некорректные вложения'),{status:400});
  if(items.length>MAX_FILES) throw Object.assign(new Error('Можно прикрепить до 6 файлов.'),{status:400});
  const created=[];
  try{
    for(const file of items){
      const name=str(file.name,180).replace(/[\\/\x00-\x1F]/g,'_')||'file';
      if(typeof file.data!=='string'|| !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)||file.data.length>Math.ceil(MAX_FILE_BYTES*4/3)+8) throw Object.assign(new Error('Ошибка вложения'),{status:400});
      const bytes=Buffer.from(file.data,'base64');
      if(bytes.length>MAX_FILE_BYTES||!bytes.length) throw Object.assign(new Error('Файл слишком большой или пустой (максимум 8 МБ).'),{status:400});
      const id=crypto.randomUUID();
      await fsp.writeFile(path.join(UPLOADS,id),bytes,{flag:'wx'});
      created.push({id,name,size:bytes.length,mime:str(file.mime,100)||'application/octet-stream'});
    }
    return created;
  }catch(e){ await Promise.all(created.map(a=>fsp.unlink(path.join(UPLOADS,a.id)).catch(()=>{}))); throw e; }
}
function compactTask(t){return {...t, attachments:(t.attachments||[]).map(safeAttachment)};}
async function serveFile(req,res,id){
  const t=store.tasks.find(x=>(x.attachments||[]).some(a=>a.id===id));
  if(!t)return fail(res,404,'Файл не найден.');
  const f=t.attachments.find(a=>a.id===id);
  const safeName=f.name.replace(/["\\\r\n]/g,'_');
  const encoded=encodeURIComponent(f.name);
  const filePath=path.join(UPLOADS,id);
  try{ await fsp.access(filePath); }catch{return fail(res,404,'Файл удалён.');}
  res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${safeName.replace(/[^\x20-\x7e]/g,'_')}"; filename*=UTF-8''${encoded}`,'Content-Length':f.size,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'});
  fs.createReadStream(filePath).pipe(res);
}
async function route(req,res){
  const url=new URL(req.url,'http://localhost'); const pathname=decodeURIComponent(url.pathname);
  if(pathname==='/api/state' && req.method==='GET') return send(res,200,{tasks:store.tasks.map(compactTask),isAdmin:isAdmin(req),groupName:GROUP_NAME});
  if(pathname==='/api/login' && req.method==='POST'){
    const ip=clientIP(req), now=Date.now(), rate=loginThrottle.get(ip)||{count:0,since:now};
    if(now-rate.since>15*60*1000){rate.count=0;rate.since=now;}
    if(rate.count>=18) return fail(res,429,'Слишком много попыток. Попробуйте позже.');
    const body=await readJson(req);
    const supplied=Buffer.from(str(body.password,256)), correct=Buffer.from(adminPassword);
    if(supplied.length!==correct.length || !crypto.timingSafeEqual(supplied,correct)){rate.count++;loginThrottle.set(ip,rate);return fail(res,401,'Неверный пароль.');}
    loginThrottle.delete(ip);
    return send(res,200,{ok:true},{'Set-Cookie':`planer_session=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${req.headers['x-forwarded-proto']==='https'?'\; Secure':''}`});
  }
  if(pathname==='/api/logout' && req.method==='POST') return send(res,200,{ok:true},{'Set-Cookie':'planer_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
  const attachmentMatch=pathname.match(/^\/api\/attachments\/([0-9a-f-]{36})$/i);
  if(attachmentMatch && req.method==='GET') return serveFile(req,res,attachmentMatch[1]);
  if(pathname==='/api/tasks' && req.method==='POST'){
    if(!requireAdmin(req,res))return;
    const body=await readJson(req);
    const task=cleanseTask(body); task.id=crypto.randomUUID();task.createdAt=new Date().toISOString();task.comments=[]; task.demo=false;
    const files=await saveNewFiles(body.newFiles||[]); task.attachments=files;
    await mutate(()=>{store.tasks.push(task);});
    return send(res,201,{task:compactTask(task)});
  }
  if(pathname==='/api/demos' && req.method==='DELETE'){
    if(!requireAdmin(req,res))return;
    await mutate(()=>{store.tasks=store.tasks.filter(t=>!t.demo);});
    return send(res,200,{ok:true});
  }
  if(pathname==='/api/export' && req.method==='GET'){
    if(!requireAdmin(req,res))return;
    return send(res,200,{groupName:GROUP_NAME,exportedAt:new Date().toISOString(),tasks:store.tasks.map(compactTask)});
  }
  const taskMatch=pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})$/i);
  if(taskMatch && ['PUT','DELETE'].includes(req.method)){
    if(!requireAdmin(req,res))return;
    const idx=store.tasks.findIndex(t=>t.id===taskMatch[1]); if(idx<0) return fail(res,404,'Задание не найдено.');
    const old=store.tasks[idx];
    if(req.method==='DELETE'){
      await mutate(()=>{store.tasks.splice(idx,1);});
      await Promise.all((old.attachments||[]).map(a=>fsp.unlink(path.join(UPLOADS,a.id)).catch(()=>{})));
      return send(res,200,{ok:true});
    }
    const body=await readJson(req);
    const patch=cleanseTask(body,old);patch.demo=false;
    const keep=Array.isArray(body.keepAttachmentIds)?body.keepAttachmentIds:[];
    const retained=(old.attachments||[]).filter(a=>keep.includes(a.id));
    if(retained.length+(body.newFiles||[]).length>MAX_FILES) return fail(res,400,'Не более 6 вложений на задание.');
    const added=await saveNewFiles(body.newFiles||[]);
    patch.attachments=[...retained,...added];
    await mutate(()=>{store.tasks[idx]=patch;});
    await Promise.all((old.attachments||[]).filter(a=>!keep.includes(a.id)).map(a=>fsp.unlink(path.join(UPLOADS,a.id)).catch(()=>{})));
    return send(res,200,{task:compactTask(patch)});
  }
  const commentsMatch=pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})\/comments$/i);
  if(commentsMatch && req.method==='POST'){
    const ip=clientIP(req), now=Date.now(), prev=commentThrottle.get(ip)||0;
    if(now-prev<12000)return fail(res,429,'Немного подождите перед следующим сообщением.');
    const body=await readJson(req);const name=str(body.name,55);const message=str(body.message,650);
    if(!name||!message) return fail(res,400,'Укажите имя и текст сообщения.');
    const comment={id:crypto.randomUUID(),name,message,at:new Date().toISOString()};
    await mutate(()=>{ const task=store.tasks.find(t=>t.id===commentsMatch[1]); if(!task)throw Object.assign(new Error('Задание не найдено.'),{status:404}); task.comments ||= [];if(task.comments.length>=MAX_COMMENTS) throw Object.assign(new Error('Достигнут лимит комментариев.'),{status:400});task.comments.push(comment);});
    commentThrottle.set(ip,now);return send(res,201,{comment});
  }
  const commentDelete=pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})\/comments\/([0-9a-f-]{36})$/i);
  if(commentDelete&&req.method==='DELETE'){
    if(!requireAdmin(req,res))return;
    await mutate(()=>{const task=store.tasks.find(t=>t.id===commentDelete[1]);if(!task)throw Object.assign(new Error('Задание не найдено.'),{status:404});task.comments=(task.comments||[]).filter(c=>c.id!==commentDelete[2]);});
    return send(res,200,{ok:true});
  }
  if(pathname.startsWith('/api/')) return fail(res,404,'Такого действия нет.');
  if(req.method!=='GET'&&req.method!=='HEAD')return fail(res,405,'Метод не поддерживается.');
  const requested=pathname==='/'?'/index.html':pathname;
  const file=path.resolve(PUBLIC,'.'+requested);
  if(!file.startsWith(PUBLIC+path.sep))return fail(res,403,'Доступ запрещён.');
  let info;
  try{info=await fsp.stat(file);if(!info.isFile())throw Error('folder');}catch{return fail(res,404,'Страница не найдена.');}
  const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'}[path.extname(file)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':mime,'Content-Length':info.size,'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});
  if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
}
(async()=>{await setup();http.createServer((req,res)=>{route(req,res).catch(e=>{console.error('Ошибка:',e); if(!res.headersSent)fail(res,e.status||500,e.status?e.message:'Ошибка сервера. Попробуйте ещё раз.');else res.destroy();});}).listen(PORT,'0.0.0.0',()=>{
  console.log(`\n📚 Планер группы: http://localhost:${PORT}`);
  console.log(`🔐 Пароль старосты: ${adminPassword}`);
  console.log(`   Данные хранятся в data/, вложения — в uploads/.\n`);
});})().catch(e=>{console.error(e);process.exit(1);});
