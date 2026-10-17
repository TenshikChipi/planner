'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const LOCAL = location.protocol === 'file:';
  const storage = (()=>{try{const s=window.localStorage,k='__po_planu_test';s.setItem(k,'1');s.removeItem(k);return s;}catch{const m={};return {getItem:k=>m[k]??null,setItem:(k,v)=>{m[k]=String(v);},removeItem:k=>{delete m[k];}};}})();
  const LOCAL_KEY = 'po-planu-local-tasks-v1';
  const DONE_KEY = 'po-planu-completed-v1';
  const NAME_KEY = 'po-planu-comment-name';
  const PALETTE = ['#8D79D9','#5AAEAB','#E79A5B','#759CCF','#D77B9C','#86A65D','#AF83BE','#D8A94F'];
  const today = () => dateKey(new Date());
  const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const parseDate = (s) => { const p=String(s).split('-').map(Number); return new Date(p[0],p[1]-1,p[2]); };
  const addDays = (d,n) => { const x=new Date(d);x.setDate(x.getDate()+n);return x;};
  const startWeek = (d) => addDays(d,-(d.getDay()+6)%7);
  const h = (text) => String(text??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ruDate = (d,opt) => d.toLocaleDateString('ru-RU',opt);
  const monthLabel = (date) => ruDate(date,{month:'long',year:'numeric'});
  const shortDate = (s) => ruDate(parseDate(s),{day:'numeric',month:'short'});
  const relative = (s) => `${shortDate(s)} · ${s===today()?'сегодня':s<today()?'прошедший срок':'дедлайн'}`;
  const closeClick = (id) => `<button type="button" class="modal-close" data-action="close" title="Закрыть" aria-label="Закрыть">×</button>`;
  const cssColor = (color) => /^#[a-fA-F0-9]{6}$/.test(color)?color:PALETTE[0];
  let savedDone;try{savedDone=JSON.parse(storage.getItem(DONE_KEY)||'[]')}catch{savedDone=[]}
  const done = new Set(Array.isArray(savedDone)?savedDone:[]);
  const state = { tasks:[],isAdmin:LOCAL,groupName:'Планер нашей группы',selectedDate:today(),cursor:new Date(new Date().getFullYear(),new Date().getMonth(),1),weekCursor:startWeek(new Date()),page:'calendar',mode:'month',subject:null,search:'',status:'all',modalTaskId:null,newFiles:[],keepIds:[],pickerColor:PALETTE[0] };
  let toastTimeout;
  function toast(text,isError=false){const el=$('toast');el.textContent=text;el.style.background=isError?'#ac5268':'#2e2a52';el.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.classList.remove('show'),3500);}
  function sortTasks(tasks){return tasks.slice().sort((a,b)=>(a.dueDate+a.dueTime).localeCompare(b.dueDate+b.dueTime));}
  function demoTasks(){const b=[['Веб-дизайн','Сверстать страницу по макету',2,'#8D79D9'],['Программирование на C#','Практика по классам и методам',4,'#E79A5B'],['Разработка игр','Описать игровые механики',6,'#5AAEAB'],['Дискретная математика','Задачи по графам',11,'#759CCF']];return b.map(([subject,title,offset,color],i)=>({id:cryptoId(),title,subject,dueDate:dateKey(addDays(new Date(),offset)),dueTime:i===1?'18:00':'23:59',description:'Пример домашнего задания. Нажмите «Редактировать» и замените этот текст настоящими требованиями преподавателя.',format:i===1?'ZIP-архив':'Файл или ссылка',submitTo:'Здесь будет место сдачи',submitUrl:'',note:'',priority:'normal',color,attachments:[],comments:[],demo:true,createdAt:new Date().toISOString()}));}
  function cryptoId(){return (typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():`id${Math.random().toString(36).slice(2)}${Date.now()}`;}
  function localRead(){try{const d=JSON.parse(storage.getItem(LOCAL_KEY));if(Array.isArray(d))return d;}catch{}const d=demoTasks();storage.setItem(LOCAL_KEY,JSON.stringify(d));return d;}
  function localWrite(tasks){try{storage.setItem(LOCAL_KEY,JSON.stringify(tasks));}catch{throw new Error('В браузере не хватает места. Уменьшите вложения или используйте серверную версию.');}}
  async function localApi(method,url,body){
    let tasks=localRead();
    if(method==='GET'&&url==='/api/state')return {tasks,isAdmin:true,groupName:'Демо · моя группа'};
    if(method==='GET'&&url==='/api/export')return {groupName:'Демо · моя группа',tasks,exportedAt:new Date().toISOString()};
    if(url==='/api/demos'&&method==='DELETE'){tasks=tasks.filter(x=>!x.demo);localWrite(tasks);return {ok:true};}
    if(url==='/api/tasks'&&method==='POST'){const task={...body,id:cryptoId(),demo:false,comments:[],createdAt:new Date().toISOString()};task.attachments=(body.newFiles||[]).map(x=>({...x,id:cryptoId(),size:Math.floor(x.data.length*.75)}));delete task.newFiles;localWrite([...tasks,task]);return {task};}
    const tm=url.match(/^\/api\/tasks\/([^/]+)$/);
    if(tm){const index=tasks.findIndex(x=>x.id===tm[1]);if(index<0)throw Error('Задание не найдено.');if(method==='DELETE'){tasks.splice(index,1);localWrite(tasks);return{ok:true};}
      const prev=tasks[index];const retained=(prev.attachments||[]).filter(a=>body.keepAttachmentIds.includes(a.id));const added=(body.newFiles||[]).map(x=>({...x,id:cryptoId(),size:Math.floor(x.data.length*.75)}));const task={...prev,...body,attachments:[...retained,...added],demo:false};delete task.newFiles;delete task.keepAttachmentIds;tasks[index]=task;localWrite(tasks);return{task};}
    const cm=url.match(/^\/api\/tasks\/([^/]+)\/comments(?:\/([^/]+))?$/);
    if(cm){const t=tasks.find(x=>x.id===cm[1]);if(!t)throw Error('Задание не найдено.');if(method==='POST'){const comment={id:cryptoId(),name:body.name,message:body.message,at:new Date().toISOString()};t.comments.push(comment);localWrite(tasks);return{comment};}if(method==='DELETE'){t.comments=t.comments.filter(x=>x.id!==cm[2]);localWrite(tasks);return{ok:true};}}
    if(url==='/api/login')return {ok:true};if(url==='/api/logout')return {ok:true};throw Error('Неизвестное действие');
  }
  async function api(method,url,body){
    if(LOCAL)return localApi(method,url,body);
    let response;
    try{response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin'});}catch{throw Error('Не удалось связаться с сервером. Проверьте интернет и попробуйте снова.');}
    const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||`Ошибка ${response.status}`);return data;
  }
  function subjColor(s){const example=state.tasks.find(t=>t.subject===s);return example?cssColor(example.color):PALETTE[0];}
  function subjects(){const result=new Map();state.tasks.forEach(t=>result.set(t.subject,(result.get(t.subject)||0)+1));return [...result.entries()].sort((a,b)=>a[0].localeCompare(b[0],'ru'));}
  function visibleTasks(){return state.tasks.filter(x=>!state.subject||x.subject===state.subject);}
  function upcoming(){return sortTasks(visibleTasks().filter(t=>!done.has(t.id)&&t.dueDate>=today()));}
  function doneSave(){storage.setItem(DONE_KEY,JSON.stringify([...done]));}
  function stamp(t){return `${t.dueDate}T${t.dueTime||'23:59'}`;}
  function taskCountForDay(day){return visibleTasks().filter(t=>t.dueDate===day);}
  function subjStyle(color){const c=cssColor(color);return `--subject-color:${c};--subject-bg:${c}19`}
  function render(){
    $('groupTitle').textContent=state.groupName;
    $('navTaskCount').textContent=state.tasks.length;
    $('todaySmall').textContent=ruDate(new Date(),{day:'numeric',month:'long',year:'numeric'});
    $('adminBtn').textContent=state.isAdmin?'⚙  Выйти из режима старосты':'Войти как староста';
    $('newTaskBtn').hidden=!state.isAdmin;
    $('modeNotice').textContent=LOCAL?'Локальное демо · данные только в этом браузере':'Сохраняется для всей группы ✨';
    $('progressLabel').textContent=`${state.tasks.filter(t=>done.has(t.id)).length} из ${state.tasks.length} готово`;
    $('progressFill').style.width=`${state.tasks.length?state.tasks.filter(t=>done.has(t.id)).length/state.tasks.length*100:0}%`;
    $('statAll').textContent=state.tasks.length;
    const wk=startWeek(new Date());const nextWk=dateKey(addDays(wk,7));
    $('statWeek').textContent=state.tasks.filter(t=>t.dueDate>=dateKey(wk)&&t.dueDate<nextWk).length;
    const next=upcoming()[0];$('statNext').textContent=next?shortDate(next.dueDate):'нет 🎉';
    $('statDone').textContent=state.tasks.filter(t=>done.has(t.id)).length;
    document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===state.page));
    $('calendarScreen').hidden=state.page!=='calendar';$('tasksScreen').hidden=state.page!=='tasks';$('subjectsScreen').hidden=state.page!=='subjects';
    const titles={calendar:'Домашка под контролем',tasks:'Все задания в одном месте',subjects:'Предметы нашей группы'};
    const subs={calendar:'Задания, дедлайны и материалы — ничего не потеряется.',tasks:'Лови дедлайны вовремя и отслеживай свой прогресс.',subjects:'Выбери дисциплину и посмотри всю домашку по ней.'};
    $('pageTitle').innerHTML=`${h(titles[state.page])}<span class="accent-dot">.</span>`;$('pageSubtitle').textContent=subs[state.page];$('crumb').textContent={calendar:'КАЛЕНДАРЬ',tasks:'ЗАДАНИЯ',subjects:'ПРЕДМЕТЫ'}[state.page];
    renderSidebar();renderCalendar();renderRight();renderList();renderSubjects();
  }
  function renderSidebar(){const list=subjects();$('subjectSidebar').innerHTML=list.length?list.map(([s,count])=>`<button class="subject-nav ${state.subject===s?'active':''}" data-action="subject" data-subject="${h(s)}"><span class="swatch" style="background:${subjColor(s)}"></span><span>${h(s)}</span><span class="count">${count}</span></button>`).join(''):'<span style="font-size:11px;color:#aaa;padding:10px">Предметы появятся с первой домашкой</span>';
    const options=['<option value="">Все предметы</option>',...list.map(([s])=>`<option value="${h(s)}">${h(s)}</option>`)];$('subjectFilter').innerHTML=options.join('');$('subjectFilter').value=state.subject||'';
  }
  function renderCalendar(){
    $('monthTab').classList.toggle('selected',state.mode==='month');$('weeksTab').classList.toggle('selected',state.mode==='weeks');
    let first,n;
    if(state.mode==='month'){
      $('calPeriod').textContent=monthLabel(state.cursor);
      const firstOfMonth=new Date(state.cursor.getFullYear(),state.cursor.getMonth(),1);
      first=startWeek(firstOfMonth);const last=new Date(state.cursor.getFullYear(),state.cursor.getMonth()+1,0);
      n=Math.ceil((Math.round((last-first)/86400000)+1)/7)*7;
    }else{first=state.weekCursor;n=28;const last=addDays(first,27);$('calPeriod').textContent=`${ruDate(first,{day:'numeric',month:'short'})} — ${ruDate(last,{day:'numeric',month:'short',year:'numeric'})}`;}
    const cells=[];for(let i=0;i<n;i++){
      const d=addDays(first,i),id=dateKey(d),tasks=sortTasks(taskCountForDay(id));const outside=state.mode==='month' && d.getMonth()!==state.cursor.getMonth();
      const chips=tasks.slice(0,2).map(t=>{const c=cssColor(t.color);return `<span class="date-chip ${done.has(t.id)?'done':''}" style="--chip-color:${c};--chip-bg:${c}1a" title="${h(t.title)}">${h(t.title)}</span>`;}).join('');
      cells.push(`<button type="button" class="day-cell ${outside?'outside':''} ${id===today()?'today':''} ${id===state.selectedDate?'selected':''}" data-action="date" data-date="${id}" aria-label="${h(ruDate(d,{day:'numeric',month:'long',year:'numeric'}))}, заданий: ${tasks.length}"><span class="day-num">${d.getDate()}</span>${tasks.length>0?`<div class="date-chips">${chips}${tasks.length>2?`<span class="chip-overflow">+ ещё ${tasks.length-2}</span>`:''}</div>`:''}</button>`);
    }
    $('calendarGrid').classList.toggle('four-weeks',state.mode==='weeks');$('calendarGrid').innerHTML=cells.join('');
  }
  function renderRight(){const date=parseDate(state.selectedDate),dayTasks=sortTasks(taskCountForDay(state.selectedDate));
    $('selectedDateNum').textContent=date.getDate();$('selectedDayName').textContent=ruDate(date,{weekday:'long'});$('selectedMonthName').textContent=ruDate(date,{month:'long',year:'numeric'});$('dayTaskCount').textContent=dayTasks.length;
    $('selectedTasks').innerHTML=dayTasks.length?dayTasks.map(t=>`<button class="selected-item" data-action="open" data-id="${t.id}" style="--task-color:${cssColor(t.color)}"><div class="task-subject">${h(t.subject)} ${done.has(t.id)?'· ✓ готово':''}</div><strong>${h(t.title)}</strong><span class="task-time">◷ До ${h(t.dueTime)}</span></button>`).join(''):`<div class="tiny-empty"><div class="empty-emoji">☕</div>На этот день дедлайнов нет.<br>Можно выдохнуть!</div>`;
    const nearest=upcoming().slice(0,5);
    $('upcomingTasks').innerHTML=nearest.length?nearest.map(t=>`<button class="upcoming-item" data-action="open" data-id="${t.id}"><span class="upcoming-date"><strong>${parseDate(t.dueDate).getDate()}</strong><small>${h(ruDate(parseDate(t.dueDate),{month:'short'}))}</small></span><span class="upcoming-text"><strong>${h(t.title)}</strong><small>${h(t.subject)} · ${h(t.dueTime)}</small></span></button>`).join(''):'<div class="tiny-empty">Впереди пока нет заданий ✨</div>';
  }
  function renderList(){const filtered=sortTasks(visibleTasks()).filter(t=>{
    if(state.search&&!`${t.title} ${t.subject} ${t.description} ${t.submitTo}`.toLowerCase().includes(state.search))return false;
    if(state.status==='todo'&&done.has(t.id))return false;if(state.status==='done'&&!done.has(t.id))return false;return true;});
    $('taskList').innerHTML=filtered.length?filtered.map(t=>{
      const finished=done.has(t.id),expired=!finished&&stamp(t)<`${today()}T${new Date().toTimeString().slice(0,5)}`;
      return `<article class="list-task ${finished?'done':''}" data-action="open" data-id="${t.id}" tabindex="0" role="button" aria-label="Открыть: ${h(t.title)}"><button class="list-check ${finished?'checked':''}" data-action="done" data-id="${t.id}" aria-label="${finished?'Отменить выполнение':'Отметить выполненным'}">${finished?'✓':''}</button><div class="list-task-main"><div class="list-topline"><span class="subject-pill" style="${subjStyle(t.color)}">${h(t.subject)}</span>${t.demo?'<span class="demo-pill">ПРИМЕР</span>':''}${t.priority==='high'?'<span class="urgency-pill">ВАЖНОЕ</span>':''}</div><h3>${h(t.title)}</h3>${t.description?`<p>${h(t.description.slice(0,180))}${t.description.length>180?'…':''}</p>`:''}<div class="list-meta"><span class="${expired?'overdue':''}">◷ ${h(shortDate(t.dueDate))}, ${h(t.dueTime)}${expired?' · просрочено':''}</span><span>⇧ ${h(t.format||'Формат не указан')}</span>${(t.attachments||[]).length?`<span>♧ ${(t.attachments||[]).length} файл(ов)</span>`:''}</div></div><span style="font-size:22px;color:#c9c6da">›</span></article>`;
    }).join(''):`<div class="empty-state"><span class="empty-illustration">✳</span><strong>Пока тут пусто</strong><p>Заданий по выбранным фильтрам нет. Попробуй изменить условия поиска.</p></div>`;
  }
  function renderSubjects(){const list=subjects();$('subjectCards').innerHTML=list.length?list.map(([s,count])=>{
    const color=subjColor(s),top=sortTasks(state.tasks.filter(t=>t.subject===s&&!done.has(t.id)))[0];
    return `<button class="subject-card" data-action="subject-open" data-subject="${h(s)}" style="${subjStyle(color)}"><span class="subject-card-icon">◈</span><strong>${h(s)}</strong><p>${count} ${count===1?'задание':'заданий'}${top?' · ближайшее '+h(shortDate(top.dueDate)):''}</p><div class="subject-card-link">Все задания →</div></button>`;
  }).join(''):`<div class="empty-state"><span class="empty-illustration">✳</span><strong>Предметов пока нет</strong><p>Они автоматически появятся после добавления заданий.</p></div>`;}
  async function refresh(){const data=await api('GET','/api/state');state.tasks=data.tasks||[];state.isAdmin=!!data.isAdmin;state.groupName=data.groupName||state.groupName;render();}
  function navigate(page){state.page=page;render();window.scrollTo({top:0,behavior:'smooth'});}
  function chooseDate(day){state.selectedDate=day;if(state.mode==='month'){const d=parseDate(day);state.cursor=new Date(d.getFullYear(),d.getMonth(),1);}renderCalendar();renderRight();}
  function modalTemplate(eyebrow,title,body,footer='',small=false){$('modalRoot').hidden=false;document.body.style.overflow='hidden';$('modalRoot').innerHTML=`<div class="modal ${small?'small-modal':''}" role="dialog" aria-modal="true" aria-label="${h(title)}"><div class="modal-header"><div><div class="modal-eyebrow">${eyebrow}</div><h2>${h(title)}</h2></div>${closeClick()}</div><div class="modal-scroll">${body}</div>${footer?`<div class="modal-footer ${footer.includes('data-action="delete"')?'split':''}">${footer}</div>`:''}</div>`;}
  function closeModal(){$('modalRoot').hidden=true;$('modalRoot').innerHTML='';document.body.style.overflow='';state.modalTaskId=null;state.newFiles=[];state.keepIds=[];}
  function field(id,label,value='',required=false,kind='text',placeholder='') {return `<div class="field"><label for="${id}">${label}${required?' <span class="required">*</span>':''}</label><input id="${id}" name="${id}" type="${kind}" value="${h(value)}" placeholder="${h(placeholder)}" ${required?'required':''}></div>`;}
  function openEditor(id){if(!state.isAdmin)return openLogin();const t=id?state.tasks.find(x=>x.id===id):null;state.modalTaskId=t?.id||null;state.newFiles=[];state.keepIds=(t?.attachments||[]).map(x=>x.id);state.pickerColor=cssColor(t?.color||PALETTE[0]);
    const body=`<form id="taskForm" class="form-grid" novalidate>
      ${field('subject','Предмет',t?.subject,true,'text','Например, Веб-дизайн')}
      ${field('title','Название задания',t?.title,true,'text','Что нужно сделать?')}
      <div class="field span-2"><label for="description">Суть домашнего задания <span class="required">*</span></label><textarea id="description" name="description" placeholder="Что задали? Список пунктов, требования, полезные пояснения..." required>${h(t?.description||'')}</textarea></div>
      ${field('dueDate','Дедлайн · дата',t?.dueDate||state.selectedDate,true,'date')}
      ${field('dueTime','Дедлайн · время',t?.dueTime||'23:59',true,'time')}
      ${field('format','Формат сдачи',t?.format,false,'text','PDF, ZIP, ссылка на GitHub...')}
      ${field('submitTo','Куда сдавать',t?.submitTo,false,'text','LMS, Яндекс Форма, почта...')}
      <div class="field span-2">${field('submitUrl','Ссылка для сдачи',t?.submitUrl,false,'url','https://...')}</div>
      <div class="field span-2"><label for="note">Дополнительная информация</label><textarea id="note" name="note" style="min-height:70px" placeholder="Комментарии преподавателя, особые требования...">${h(t?.note||'')}</textarea></div>
      <div class="field"><label for="priority">Приоритет</label><select id="priority" name="priority"><option value="normal" ${t?.priority==='high'?'':'selected'}>Обычное задание</option><option value="high" ${t?.priority==='high'?'selected':''}>Важное!</option></select></div>
      <div class="field"><label>Цвет на календаре</label><div class="color-picker" id="colorPicker">${PALETTE.map(c=>`<button type="button" class="color-pick ${state.pickerColor===c?'active':''}" style="--swatch:${c}" data-action="color" data-color="${c}" title="${c}"></button>`).join('')}</div></div>
      <div class="field span-2"><label for="fileInput">Прикрепить материалы</label><div class="file-drop"><input type="file" id="fileInput" multiple aria-label="Прикрепить файлы"><strong>↥ Нажми здесь или перетащи файлы</strong><span>${LOCAL?'В демоверсии лучше прикреплять небольшие файлы (ограничение памяти браузера).':'PDF, изображения, документы, архивы — до 6 файлов, 8 МБ каждый.'}</span></div><div id="filesPreview" class="attached-preview"></div><p class="helper">Одногруппники смогут скачать материалы из карточки домашки.</p></div>
      <button type="submit" hidden aria-hidden="true"></button>
    </form>`;
    modalTemplate(t?'РЕДАКТИРОВАНИЕ':'НОВОЕ ЗАДАНИЕ',t?'Редактировать домашку':'Добавить домашку',body,`<button type="button" class="btn btn-outline" data-action="close">Отмена</button><button class="btn btn-primary" data-action="save" id="saveTaskBtn">${t?'Сохранить изменения':'Опубликовать ДЗ'}</button>`);
    $('fileInput').addEventListener('change',(e)=>{const files=Array.from(e.target.files||[]);const rejected=files.find(f=>f.size>8*1024*1024||f.size===0);if(rejected)return toast('Файл пустой или больше 8 МБ.',true);if(state.keepIds.length+state.newFiles.length+files.length>6)return toast('Можно добавить максимум 6 файлов.',true);state.newFiles.push(...files);renderFilePreview();e.target.value='';});
    $('taskForm').addEventListener('submit',e=>{e.preventDefault();saveTask();});
    renderFilePreview();$('subject').focus();
  }
  function renderFilePreview(){const task=state.tasks.find(t=>t.id===state.modalTaskId);const existing=(task?.attachments||[]).filter(a=>state.keepIds.includes(a.id));$('filesPreview').innerHTML=[...existing.map(a=>`<span class="file-preview-pill">▣ ${h(a.name)} <button type="button" data-action="remove-existing" data-id="${a.id}" title="Удалить">×</button></span>`),...state.newFiles.map((f,i)=>`<span class="file-preview-pill">▣ ${h(f.name)} <button type="button" data-action="remove-new" data-index="${i}" title="Убрать">×</button></span>`)].join('');}
  async function readBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Не удалось прочитать файл'));reader.readAsDataURL(file);});}
  async function saveTask(){
    const form=$('taskForm');if(!form)return;
    for(const id of ['subject','title','description','dueDate']){if(!$(id).value.trim()){toast('Заполните обязательные поля.',true);$(id).focus();return;}}
    const saveBtn=$('saveTaskBtn');saveBtn.disabled=true;saveBtn.textContent='Сохраняем...';
    try{
      const body={};['subject','title','description','dueDate','dueTime','format','submitTo','submitUrl','note','priority'].forEach(x=>body[x]=$(x).value.trim());body.color=state.pickerColor;body.keepAttachmentIds=state.keepIds;
      if(body.submitUrl && !/^https?:\/\//i.test(body.submitUrl))throw Error('Введите ссылку с https://');
      body.newFiles=await Promise.all(state.newFiles.map(async f=>({name:f.name,mime:f.type||'application/octet-stream',data:await readBase64(f)})));
      await api(state.modalTaskId?'PUT':'POST',state.modalTaskId?`/api/tasks/${state.modalTaskId}`:'/api/tasks',body);
      const newDate=body.dueDate;closeModal();await refresh();state.selectedDate=newDate;state.cursor=new Date(parseDate(newDate).getFullYear(),parseDate(newDate).getMonth(),1);state.weekCursor=startWeek(parseDate(newDate));render();toast('Задание опубликовано ✨');
    }catch(e){toast(e.message,true);if(saveBtn){saveBtn.disabled=false;saveBtn.textContent=state.modalTaskId?'Сохранить изменения':'Опубликовать ДЗ';}}
  }
  function safeLink(s){return /^https?:\/\//i.test(s)?s:null;}
  function taskDetail(id){const t=state.tasks.find(x=>x.id===id);if(!t)return toast('Задание не найдено.',true);state.modalTaskId=id;const complete=done.has(id);
    const comments=(t.comments||[]).map(c=>`<div class="comment"><div class="comment-head"><strong>${h(c.name)}</strong><small>${h(ruDate(new Date(c.at),{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}</small>${state.isAdmin?`<button class="comment-delete" data-action="delete-comment" data-id="${c.id}">Удалить</button>`:''}</div><div class="comment-body">${h(c.message)}</div></div>`).join('');
    const files=(t.attachments||[]).map(a=>`<a class="file-link" href="${LOCAL?'#':'/api/attachments/'+encodeURIComponent(a.id)}" ${LOCAL?`data-action="file" data-id="${a.id}"`:''} download="${h(a.name)}">▤ ${h(a.name)}<span>${h((a.size/1024/1024).toFixed(2))} МБ ↧</span></a>`).join('');
    const body=`<div class="detail-content"><span class="detail-subject" style="${subjStyle(t.color)}">${h(t.subject)}</span>${t.demo?'<span class="demo-pill" style="width:max-content">ДЕМОНСТРАЦИОННОЕ ЗАДАНИЕ</span>':''}
      <p class="detail-description">${h(t.description||'Подробности задания пока не указаны.')}</p>
      <div class="detail-tiles"><div class="detail-tile"><small>◷ ДЕДЛАЙН</small><strong>${h(ruDate(parseDate(t.dueDate),{day:'numeric',month:'long',year:'numeric'}))} · ${h(t.dueTime)}</strong></div><div class="detail-tile"><small>⇧ ФОРМАТ СДАЧИ</small><strong>${h(t.format||'Не указан')}</strong></div><div class="detail-tile"><small>↗ КУДА СДАВАТЬ</small><strong>${h(t.submitTo||'Не указано')}</strong></div><div class="detail-tile"><small>✦ ПРИОРИТЕТ</small><strong>${t.priority==='high'?'Важное задание':'Обычный'}</strong></div></div>
      ${t.submitUrl&&safeLink(t.submitUrl)?`<div><div class="detail-section-title">Ссылка для сдачи</div><a class="file-link" href="${h(t.submitUrl)}" target="_blank" rel="noopener noreferrer">↗ Открыть форму или платформу <span>↗</span></a></div>`:''}
      ${t.note?`<div><div class="detail-section-title">Дополнительная информация</div><div class="detail-note">${h(t.note)}</div></div>`:''}
      ${files?`<div><div class="detail-section-title">Материалы и вложения (${t.attachments.length})</div><div class="file-links">${files}</div></div>`:''}
      <div><div class="detail-section-title">Вопросы и комментарии (${(t.comments||[]).length})</div><div class="comments" id="commentsList">${comments||'<div class="detail-note">Комментариев пока нет. Можешь задать вопрос по заданию.</div>'}</div>
      <form class="comment-form" id="commentForm" style="margin-top:13px"><input id="commentName" placeholder="Твоё имя" aria-label="Твоё имя" maxlength="55" value="${h(storage.getItem(NAME_KEY)||'')}" required><textarea id="commentMessage" placeholder="Написать вопрос или уточнение..." aria-label="Комментарий" maxlength="650" required></textarea><button class="btn btn-outline" type="submit">Отправить комментарий ↗</button></form></div>
      </div>`;
    modalTemplate('КАРТОЧКА ЗАДАНИЯ',t.title,body,`${state.isAdmin?`<button class="btn btn-danger" data-action="delete" data-id="${id}">Удалить</button>`:''}<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${state.isAdmin?`<button class="btn btn-outline" data-action="edit" data-id="${id}">Редактировать</button>`:''}<button class="btn ${complete?'btn-outline':'btn-primary'}" data-action="done" data-id="${id}">${complete?'✓ Выполнено · отменить':'✓ Отметить выполненным'}</button></div>`);
    $('commentForm').addEventListener('submit',async e=>{e.preventDefault();const name=$('commentName').value.trim(),message=$('commentMessage').value.trim();if(!name||!message)return;const button=$('commentForm').querySelector('button');button.disabled=true;try{await api('POST',`/api/tasks/${id}/comments`,{name,message});storage.setItem(NAME_KEY,name);await refresh();taskDetail(id);toast('Комментарий опубликован.');}catch(err){toast(err.message,true);button.disabled=false;}});
  }
  function openLogin(){if(LOCAL)return toast('В локальном демо режим старосты уже включён.');modalTemplate('ДОСТУП СТАРОСТЫ','Войти в управление',`<p class="modal-login-text">Только староста может создавать, редактировать и удалять домашние задания. Одногруппники могут смотреть, скачивать материалы и оставлять комментарии.</p><form id="loginForm" class="form-grid"><div class="field span-2"><label for="password">Пароль старосты</label><input type="password" id="password" placeholder="Введите пароль" required autocomplete="current-password"></div><button type="submit" hidden></button></form>`,`<button class="btn btn-outline" data-action="close">Отмена</button><button class="btn btn-primary" data-action="login">Войти</button>`,true);$('loginForm').addEventListener('submit',e=>{e.preventDefault();login();});$('password').focus();}
  async function login(){const password=$('password')?.value||'';if(!password)return toast('Введите пароль.',true);try{await api('POST','/api/login',{password});closeModal();await refresh();toast('Режим старосты включён ✨');}catch(e){toast(e.message,true);}}
  async function logout(){if(LOCAL)return toast('В локальном демо режим старосты включён постоянно.');try{await api('POST','/api/logout');closeModal();await refresh();toast('Вы вышли из режима старосты.');}catch(e){toast(e.message,true);}}
  async function deleteTask(id){const t=state.tasks.find(t=>t.id===id);if(!t)return;if(!confirm(`Удалить «${t.title}»? Это действие нельзя отменить.`))return;try{await api('DELETE',`/api/tasks/${id}`);done.delete(id);doneSave();closeModal();await refresh();toast('Задание удалено.');}catch(e){toast(e.message,true);}}
  async function deleteComment(commentId){const taskId=state.modalTaskId;if(!taskId)return;if(!confirm('Удалить этот комментарий?'))return;try{await api('DELETE',`/api/tasks/${taskId}/comments/${commentId}`);await refresh();taskDetail(taskId);toast('Комментарий удалён.');}catch(e){toast(e.message,true);}}
  function toggleDone(id){done.has(id)?done.delete(id):done.add(id);doneSave();const detailIsOpen=!$('modalRoot').hidden&&!!$('commentForm');render();if(detailIsOpen)taskDetail(id);toast(done.has(id)?'Отлично, задание отмечено выполненным ✓':'Отметка выполнения снята');}
  function saveFileLocally(file){if(!file?.data)return toast('Не удалось найти данные файла.',true);const bytes=atob(file.data),array=new Uint8Array(bytes.length);for(let i=0;i<bytes.length;i++)array[i]=bytes.charCodeAt(i);const blob=new Blob([array],{type:'application/octet-stream'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function exportData(){try{const data=await api('GET','/api/export');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`homework-${today()}.json`;document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);toast('Список заданий сохранён (JSON).');}catch(e){toast(e.message,true);}}
  function openSettings(){if(!state.isAdmin)return openLogin();modalTemplate('УПРАВЛЕНИЕ','Настройки старосты',`<div class="detail-content"><div><div class="detail-section-title">Управление заданиями</div><p class="detail-note">Можно создать новую домашку, удалить демонстрационные записи и выгрузить список заданий в JSON. Файлы автоматически сохраняются на сервере (в локальном режиме — в браузере).</p></div><div class="warning">${LOCAL?'Локальная версия подходит для тестирования на одном устройстве. Для совместной работы группы запусти сервер из архива.':'Экспорт содержит карточки заданий и сведения о вложениях, но не их содержимое. Полная резервная копия — папки data/ и uploads/.'}</div></div>`,`<button class="btn btn-danger" data-action="clear-demos">Убрать примеры</button><div style="display:flex;gap:7px"><button class="btn btn-outline" data-action="export">Экспорт JSON</button><button class="btn btn-primary" data-action="logout">Выйти</button></div>`);}
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-action]');if(!b)return;
    const action=b.dataset.action,id=b.dataset.id;
    if(action==='close')return closeModal();
    if(action==='date')return chooseDate(b.dataset.date);
    if(action==='open')return taskDetail(id);
    if(action==='done'){e.stopPropagation();return toggleDone(id);}
    if(action==='subject'){state.subject=state.subject===b.dataset.subject?null:b.dataset.subject;render();return;}
    if(action==='subject-open'){state.subject=b.dataset.subject;navigate('tasks');return;}
    if(action==='color'){state.pickerColor=b.dataset.color;document.querySelectorAll('.color-pick').forEach(c=>c.classList.toggle('active',c.dataset.color===state.pickerColor));return;}
    if(action==='save')return saveTask();
    if(action==='edit')return openEditor(id);
    if(action==='delete')return deleteTask(id);
    if(action==='delete-comment')return deleteComment(id);
    if(action==='login')return login();
    if(action==='logout'){closeModal();return logout();}
    if(action==='export')return exportData();
    if(action==='clear-demos'){if(!confirm('Удалить все демонстрационные задания? Реальные задания останутся.'))return;try{await api('DELETE','/api/demos');closeModal();await refresh();toast('Примеры удалены.');}catch(err){toast(err.message,true);}return;}
    if(action==='remove-existing'){state.keepIds=state.keepIds.filter(x=>x!==id);renderFilePreview();return;}
    if(action==='remove-new'){state.newFiles.splice(Number(b.dataset.index),1);renderFilePreview();return;}
    if(action==='file'){e.preventDefault();const task=state.tasks.find(x=>x.id===state.modalTaskId);saveFileLocally(task?.attachments.find(a=>a.id===id));}
  });
  document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.nav)));
  $('clearFilter').addEventListener('click',()=>{state.subject=null;render();});
  $('adminBtn').addEventListener('click',()=>state.isAdmin?openSettings():openLogin());
  $('newTaskBtn').addEventListener('click',()=>openEditor());
  $('monthTab').addEventListener('click',()=>{state.mode='month';renderCalendar();});
  $('weeksTab').addEventListener('click',()=>{state.mode='weeks';state.weekCursor=startWeek(parseDate(state.selectedDate));renderCalendar();});
  $('prevPeriod').addEventListener('click',()=>{if(state.mode==='month')state.cursor=new Date(state.cursor.getFullYear(),state.cursor.getMonth()-1,1);else state.weekCursor=addDays(state.weekCursor,-28);renderCalendar();});
  $('nextPeriod').addEventListener('click',()=>{if(state.mode==='month')state.cursor=new Date(state.cursor.getFullYear(),state.cursor.getMonth()+1,1);else state.weekCursor=addDays(state.weekCursor,28);renderCalendar();});
  $('todayBtn').addEventListener('click',()=>{state.selectedDate=today();state.cursor=new Date(new Date().getFullYear(),new Date().getMonth(),1);state.weekCursor=startWeek(new Date());renderCalendar();renderRight();});
  $('searchInput').addEventListener('input',e=>{state.search=e.target.value.toLowerCase().trim();renderList();});
  $('subjectFilter').addEventListener('change',e=>{state.subject=e.target.value||null;render();});
  $('statusFilter').addEventListener('change',e=>{state.status=e.target.value;renderList();});
  $('modalRoot').addEventListener('click',e=>{if(e.target===$('modalRoot'))closeModal();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('modalRoot').hidden)closeModal();if((e.key==='Enter'||e.key===' ')&&e.target.classList?.contains('list-task')){e.preventDefault();taskDetail(e.target.dataset.id);}});
  (async()=>{try{await refresh();if(LOCAL)toast('Локальное демо: изменения сохраняются только в этом браузере.');}catch(e){console.error(e);$('calendarGrid').innerHTML=`<div class="empty-state" style="grid-column:span 7"><strong>Не получилось загрузить задания</strong><p>${h(e.message)}</p></div>`;toast(e.message,true);}})();
})();
