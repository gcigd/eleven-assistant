(function () {
  'use strict';
  const root = document.getElementById('app');
  let CASES, GUIDES, FLOW, LESSONS;
  let lessonState;
  const PROGRESS_KEY = 'cash-guide-learning-v2';
  const rememberButton = document.getElementById('forget-device');
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const valid = id => Boolean(FLOW) && (id === 'index' || id === 'learn' || Boolean(FLOW[id]) || (id.startsWith('case:') && Boolean(CASES[id.slice(5)])) || (id.startsWith('guide:') && Boolean(GUIDES[id.slice(6)])) || (id.startsWith('learn:') && Boolean(LESSONS?.items[id.slice(6)])));
  const progress = () => {
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; }
    catch (_) { return {}; }
  };
  const saveProgress = data => { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(data)); } catch (_) { /* Progress is optional. */ } };
  const lessonProgress = id => progress()[id] || {count:0,status:'Pendiente'};
  function recordProgress(id, changes) {
    const all = progress();
    all[id] = {...lessonProgress(id),...changes};
    saveProgress(all);
  }
  const bytes = base64 => Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  function savedKey(action, value) {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(Error('Storage unavailable'));
      const opening = indexedDB.open('cash-guide-key-v1', 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore('keys');
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result;
        const transaction = db.transaction('keys', action === 'get' ? 'readonly' : 'readwrite');
        const store = transaction.objectStore('keys');
        let result;
        const request = action === 'get' ? store.get('guide') : action === 'put' ? store.put(value, 'guide') : store.delete('guide');
        request.onsuccess = () => { result = request.result; };
        transaction.oncomplete = () => { db.close(); resolve(result); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
  }
  async function payload() {
    const response = await fetch('./content.enc.json');
    if (!response.ok) throw Error('Content unavailable');
    const content = await response.json();
    if (content.version !== 1 || content.kdf !== 'PBKDF2-SHA256' || content.cipher !== 'AES-256-GCM') throw Error('Unsupported content');
    return content;
  }
  async function decryptWithKey(key, content) {
    const plaintext = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(content.iv)},key,bytes(content.data));
    const data = JSON.parse(new TextDecoder().decode(plaintext));
    if (Object.keys(data.CASES || {}).length !== 19 || !data.FLOW?.home || !data.GUIDES?.fallback || Object.keys(data.LESSONS?.items || {}).length !== 6) throw Error('Invalid content');
    return data;
  }
  async function decrypt(passphrase) {
    const content = await payload();
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:bytes(content.salt),iterations:content.iterations},material,{name:'AES-GCM',length:256},false,['decrypt']);
    return {data:await decryptWithKey(key, content),key,salt:content.salt};
  }
  function openGuide(data, remembered) {
    CASES = data.CASES; GUIDES = data.GUIDES; FLOW = data.FLOW; LESSONS = data.LESSONS;
    document.getElementById('all-cases').hidden = false;
    rememberButton.hidden = !remembered;
    render();
  }
  function showUnlock() {
    document.getElementById('all-cases').hidden = true;
    rememberButton.hidden = true;
    root.innerHTML = '<p class="eyebrow">Acceso local</p><h1>Desbloquear guía</h1><p class="lead">Introduce la frase de acceso para consultar los casos. Después de cargar la guía por completo, podrás usarla sin internet.</p><form id="unlock-form" class="panel unlock"><label for="passphrase">Frase de acceso</label><input id="passphrase" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required><div class="remember"><input id="remember" type="checkbox"><label for="remember">Recordar en este dispositivo</label></div><p class="small remember-note">Si lo activas, quien tenga acceso a este dispositivo podrá abrir la guía. Puedes borrar la llave con «Olvidar dispositivo».</p><button class="button" type="submit">Desbloquear</button><p id="unlock-error" class="error" role="alert" aria-live="polite"></p></form>';
    document.getElementById('unlock-form').addEventListener('submit', async event => {
      event.preventDefault();
      const input = document.getElementById('passphrase');
      const error = document.getElementById('unlock-error');
      const button = event.currentTarget.querySelector('button');
      button.disabled = true;
      error.textContent = '';
      try {
        const unlocked = await decrypt(input.value);
        const wantedRemember = document.getElementById('remember').checked;
        let remembered = false;
        if (wantedRemember) {
          try { await savedKey('put', {key:unlocked.key,salt:unlocked.salt}); remembered = true; }
          catch (_) { /* Storage can be unavailable; unlocking still works. */ }
        }
        input.value = '';
        openGuide(unlocked.data, remembered);
        if (wantedRemember && !remembered) {
          const notice = document.createElement('p');
          notice.className = 'source';
          notice.textContent = 'Si marcaste «Recordar», el navegador no pudo guardar la llave. Tendrás que introducir la frase de nuevo.';
          root.prepend(notice);
        }
      } catch (_) {
        error.textContent = 'No se pudo desbloquear. Revisa la frase y la conexión si es la primera visita.';
      } finally { button.disabled = false; }
    });
    (async () => {
      try {
        const stored = await savedKey('get');
        if (!stored?.key) return;
        const content = await payload();
        if (stored.salt !== content.salt) throw Error('Changed key');
        openGuide(await decryptWithKey(stored.key, content), true);
      } catch (_) {
        try { await savedKey('delete'); } catch (_) { /* Can retry manually. */ }
      }
    })();
  }
  const route = () => {
    const id = decodeURIComponent(location.hash.slice(1) || 'home');
    return valid(id) ? id : 'home';
  };
  function navigate(id) {
    if (!valid(id)) return;
    if (route() === id) return;
    history.pushState({fromApp:true}, '', '#' + encodeURIComponent(id));
    lessonState = undefined;
    render();
  }
  function back() {
    if (history.state && history.state.fromApp) history.back();
    else navigate('home');
  }
  function button(label, id, hint='') {
    return `<button class="choice" type="button" data-go="${escape(id)}"><span>${escape(label)}${hint ? `<small>${escape(hint)}</small>` : ''}</span><span class="arrow" aria-hidden="true">›</span></button>`;
  }
  function formattedStep(step) {
    return escape(step).replace(/\b(F7|F8)\b/g, '<strong>$1</strong>').replace(/«([^»]+)»/g, '<strong class="entry-text">«$1»</strong>');
  }
  function result(id, item) {
    root.innerHTML = `<button class="back" type="button" data-back>← Volver</button><p class="eyebrow">${escape(item.stage)}${id.startsWith('case:') ? ` · Caso ${escape(id.slice(5))}` : ''}</p><h1>${escape(item.title)}</h1><p class="lead">${escape(item.summary || 'Sigue estos pasos en orden y comprueba el resultado.')}</p><div class="panel"><h2>Qué hacer</h2><ol class="steps">${item.steps.map(step => `<li>${formattedStep(step)}</li>`).join('')}</ol>${item.warning ? `<div class="notice danger"><strong>Atención</strong><br>${escape(item.warning)}</div>` : ''}<div class="result"><strong>Resultado esperado</strong>${escape(item.result)}</div></div><div class="actions"><button class="button" type="button" data-go="home">Empezar de nuevo</button><button class="button secondary" type="button" data-go="index">Ver todos los casos</button></div>`;
    if (item.next && valid(item.next[1])) {
      const action = document.createElement('button');
      action.className = 'button';
      action.type = 'button';
      action.dataset.go = item.next[1];
      action.textContent = item.next[0];
      const actions = root.querySelector('.actions');
      actions.firstElementChild.classList.add('secondary');
      actions.prepend(action);
    }
    if (item.lesson && valid(`learn:${item.lesson}`)) {
      const why = document.createElement('div');
      why.className = 'why-link';
      why.innerHTML = `<p>¿Quieres entender el motivo de este movimiento?</p>${button('¿Por qué se hace así?',`learn:${item.lesson}`,'Abre una lección y luego vuelve a este caso')}`;
      root.querySelector('.actions').before(why);
    }
  }
  const fundEmoji = { cash: '💵', vault: '🔒', fund: '🧾', reserve: '💰' };
  const vessel = key => `<span class="fund-name"><span class="fund-symbol" aria-hidden="true">${fundEmoji[key] || '💵'}</span><span>${escape(LESSONS.funds[key].name)}</span></span>`;
  const routeVisual = (from,to,amount,motive) => `<div class="money-route"><div class="route-end"><small>SALE DE</small>${LESSONS.funds[from]?vessel(from):`<span>${escape(LESSONS.people[from])}</span>`}</div><div class="route-middle"><span aria-label="hacia">→</span></div><div class="route-end"><small>LLEGA A</small>${LESSONS.funds[to]?vessel(to):`<span>${escape(LESSONS.people[to])}</span>`}</div></div>${amount?`<p class="route-amount">Importe: ${escape(amount)}</p>`:''}${motive?`<p class="route-motive">${escape(motive)}</p>`:''}`;
  function learningVisual(item) {
    const v = item.visual;
    if (v.type === 'funds') return `<div class="fund-grid">${Object.entries(LESSONS.funds).map(([key,f])=>`<details class="fund-card"><summary>${vessel(key)}<small>${escape(f.short)}</small></summary><p><strong>Para qué sirve:</strong> ${escape(f.serves)}</p><p><strong>Ejemplo:</strong> ${escape(f.example)}</p><p><strong>Otro ejemplo:</strong> ${escape(f.more)}</p><p><strong>Error común:</strong> ${escape(f.error)}</p></details>`).join('')}</div>`;
    if (v.type === 'movement') return `<div class="learning-visual"><h3>Así viaja el dinero</h3>${routeVisual(v.from,v.to,v.amount,v.motive)}<p class="visual-note">La punta de la flecha muestra a dónde llegó.</p><h3>Otros recorridos</h3><div class="route-list">${v.routes.map(r=>`<details class="route-card"><summary>${vessel(r.from)}<span aria-label="hacia">→</span>${vessel(r.to)}</summary><p>${escape(r.example)}</p></details>`).join('')}</div></div>`;
    if (v.type === 'meaning') return `<div class="learning-visual"><h3>${escape(v.inTitle)}</h3><div class="meaning-grid">${v.incoming.map(e=>`<div class="meaning-card">${routeVisual(e.from,e.to,e.amount,e.text)}<strong>${escape(e.meaning)}</strong></div>`).join('')}</div><h3>${escape(v.outTitle)}</h3><div class="meaning-grid">${v.outgoing.map(e=>`<div class="meaning-card">${routeVisual(e.from,e.to,e.amount,e.text)}<strong>${escape(e.meaning)}</strong></div>`).join('')}</div></div>`;
    if (v.type === 'cycle') return `<div class="learning-visual"><h3>${escape(v.title)}</h3>${routeVisual(v.start.from,v.start.to,v.start.amount,v.start.motive)}<p class="visual-note">${escape(v.split)}</p><div class="cycle-paths">${v.paths.map(p=>routeVisual(p.from,p.to,p.amount,p.motive)).join('')}</div><p class="visual-note">${escape(v.total)}</p><h3>${escape(v.compareTitle)}</h3><div class="meaning-grid">${v.comparisons.map(c=>`<div class="meaning-card">${routeVisual(c.from,c.to,c.amount,c.motive)}<strong>${escape(c.label)}</strong></div>`).join('')}</div></div>`;
    if (v.type === 'decision') return `<div class="learning-visual"><div class="decision-tree"><div class="decision-main">${escape(v.root)}</div><div class="decision-next">${escape(v.question)}</div><div class="decision-branches"><div><strong>${escape(v.yes.label)}</strong><p>${escape(v.yes.text)}</p></div><div><strong>${escape(v.no.label)}</strong><p>${escape(v.no.text)}</p></div></div><p class="visual-note">${escape(v.note)}</p></div></div>`;
    if (v.type === 'compare') return `<div class="learning-visual"><div class="meaning-grid">${v.sides.map(s=>`<div class="meaning-card"><strong>${escape(s.title)}</strong><p>${escape(s.text)}</p><span>${escape(s.symbol)}</span></div>`).join('')}</div><p class="visual-note">${escape(v.note)}</p><h3>${escape(v.compareTitle)}</h3><div class="meaning-grid">${v.paths.map(p=>`<div class="meaning-card"><strong>${escape(p.title)}</strong><p>${escape(p.text)}</p></div>`).join('')}</div><h3>${escape(v.inspectTitle)}</h3><p>${escape(v.inspectIntro)}</p><div class="inspect-grid">${v.checks.map(c=>`<details class="inspect-card"><summary>${escape(c.name)}</summary><p>${escape(c.detail)}</p></details>`).join('')}</div></div>`;
    return '';
  }
  function renderLearnList() {
    root.innerHTML = `<button class="back" type="button" data-back>← Volver</button><p class="eyebrow">Capacitación</p><h1>Entender el efectivo</h1><p class="lead">Seis lecciones breves para explicar qué ocurrió con el dinero antes de elegir una operación en Eleventa. Puedes volver a la guía en cualquier momento.</p><div class="lesson-list">${Object.entries(LESSONS.items).map(([id,item])=>button(`${id}. ${item.title}`,`learn:${id}`,lessonProgress(id).status)).join('')}</div><p class="source">El avance se guarda solo en este dispositivo, no por persona. «Comprendido» es una autoevaluación: debes poder explicar la respuesta con tus palabras.</p><button class="back reset-progress" type="button" data-reset-progress>Borrar avance de este dispositivo</button>`;
  }
  function renderLesson(id) {
    const item = LESSONS.items[id];
    const saved = lessonProgress(id);
    if (!lessonState || lessonState.id !== id) lessonState = {id,index:Math.min(saved.count || 0,item.scenarios.length),selected:null,practiceIndex:Math.min(saved.practice || 0,item.practice?.steps.length || 0),practiceSelected:null};
    const practiceStep = item.practice?.steps[lessonState.practiceIndex];
    const practiceAnswered = lessonState.practiceSelected !== null;
    const practiceCorrect = practiceAnswered && lessonState.practiceSelected === practiceStep?.correct;
    const practice = practiceStep ? `<div class="exercise practice" id="exercise"><p class="eyebrow">Arma la respuesta · Paso ${lessonState.practiceIndex+1} de ${item.practice.steps.length}</p><p>${escape(item.practice.context)}</p><h2>${escape(practiceStep.question)}</h2><div class="answer-list">${practiceStep.options.map((o,n)=>`<button class="answer${practiceAnswered&&n===lessonState.practiceSelected?(practiceCorrect?' is-correct':' is-wrong'):''}" type="button" data-practice-answer="${n}" ${practiceCorrect?'disabled':''}>${escape(o)}</button>`).join('')}</div>${practiceAnswered?`<div class="answer-feedback ${practiceCorrect?'good':'try-again'}" role="status"><strong>${practiceCorrect?'Así es.':'Revisa qué pasó.'}</strong> ${escape(practiceStep.feedback)}</div>${practiceCorrect?'<button class="button" type="button" data-next-practice>Continuar</button>':'<p class="source">Elige otra respuesta.</p>'}`:''}</div>` : '';
    const index = lessonState.index;
    const scenario = item.scenarios[index];
    const answered = lessonState.selected !== null;
    const correct = answered && lessonState.selected === scenario?.correct;
    const options = scenario?.options.map((option,n)=>`<button class="answer${answered && n===lessonState.selected ? (correct?' is-correct':' is-wrong') : ''}" type="button" data-answer="${n}" ${correct?'disabled':''}>${escape(option)}</button>`).join('') || '';
    const feedback = answered ? `<div class="answer-feedback ${correct?'good':'try-again'}" role="status"><strong>${correct?'Así es.':'Revisa la situación.'}</strong> ${escape(scenario.feedback)}</div>${correct?`<button class="button" type="button" data-next-question>${index+1===item.scenarios.length?'Terminar ejercicios':'Siguiente ejercicio'}</button>`:'<p class="source">Elige otra respuesta para continuar.</p>'}` : '';
    const exercise = scenario ? `<div class="exercise" id="exercise"><p class="eyebrow">Ejercicio ${index+1} de ${item.scenarios.length}</p><h2>${escape(scenario.question)}</h2><div class="answer-list">${options}</div>${feedback}</div>` : `<div class="exercise" id="exercise"><p class="eyebrow">Ejercicios terminados</p><h2>Explícalo con tus palabras</h2><p>${escape(item.reflection)}</p><p class="source">El sistema no puede comprobar una explicación verbal. Marca «Comprendido» solo cuando puedas explicarlo sin mirar la respuesta.</p>${saved.status==='Comprendido'?'<p class="answer-feedback good">Marcaste esta lección como comprendida.</p>':'<button class="button" type="button" data-understood>Ya puedo explicarlo</button>'}<button class="button secondary" type="button" data-repeat>Repetir ejercicios</button></div>`;
    root.innerHTML = `<button class="back" type="button" data-back>← Volver</button><p class="eyebrow">Capacitación · Lección ${escape(id)} de 6 · ${escape(saved.status)}</p><h1>${escape(item.title)}</h1><p class="lead">${escape(item.idea)}</p><div class="panel lesson-concept"><h2>La idea</h2><p>${escape(item.concept)}</p></div><p class="lesson-example">${escape(item.example)}</p>${learningVisual(item)}${practice || exercise}<div class="actions"><button class="button secondary" type="button" data-go="learn">Todas las lecciones</button>${Number(id)<6?`<button class="button secondary" type="button" data-go="learn:${Number(id)+1}">Siguiente lección</button>`:'<button class="button secondary" type="button" data-go="home">Ir a la guía</button>'}</div>`;
  }
  function render() {
    const id = route();
    if (id === 'index') {
      root.innerHTML = `<button class="back" type="button" data-back>← Volver</button><p class="eyebrow">Consulta rápida</p><h1>Todos los casos</h1><p class="lead">También puedes iniciar desde la situación del turno para llegar al caso adecuado.</p><div class="case-grid">${Object.entries(CASES).map(([n,item]) => button(`${n}. ${item.title}`,`case:${n}`)).join('')}${button('Solo contar o acomodar efectivo','guide:count')}${button('Tengo una duda','guide:fallback')}${button('Cierre final del día','guide:final')}</div>`;
    } else if (id === 'learn') {
      renderLearnList();
    } else if (id.startsWith('learn:')) {
      renderLesson(id.slice(6));
    } else if (id.startsWith('case:') || id.startsWith('guide:')) {
      result(id, id.startsWith('case:') ? CASES[id.slice(5)] : GUIDES[id.slice(6)]);
    } else {
      const node = FLOW[id];
      root.innerHTML = `${id === 'home' ? '' : '<button class="back" type="button" data-back>← Volver</button>'}<p class="eyebrow">Guía de caja</p><h1>${escape(node.title)}</h1>${node.description ? `<p class="lead">${escape(node.description)}</p>` : '<p class="lead">Selecciona la situación que corresponde.</p>'}<div class="choice-list">${node.choices.map(([label,next,hint]) => button(label,next,hint)).join('')}</div>${id === 'home' ? `<div class="learning-entry"><p class="eyebrow">Aprender</p>${button('Entender el efectivo','learn','Lecciones breves para comprender los fondos y movimientos')}</div><p class="source">Esta guía orienta; registra las operaciones en el sistema de caja.</p>` : ''}`;
    }
    document.title = (id === 'home' ? 'Guía de caja' : `${root.querySelector('h1').textContent} · Guía de caja`);
    root.focus({preventScroll:true});
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-go], [data-back], [data-answer], [data-next-question], [data-understood], [data-repeat], [data-reset-progress], [data-practice-answer], [data-next-practice]');
    if (!target) return;
    if (target.hasAttribute('data-practice-answer') && route().startsWith('learn:')) {
      const id=route().slice(6),step=LESSONS.items[id].practice?.steps[lessonState.practiceIndex];
      const n=Number(target.dataset.practiceAnswer);
      if(!step||!Number.isInteger(n)||!step.options[n]||lessonState.practiceSelected===step.correct)return;
      lessonState.practiceSelected=n;
      if(n===step.correct)recordProgress(id,{practice:Math.max(lessonProgress(id).practice||0,lessonState.practiceIndex+1),status:'Practicando'});
      renderLesson(id);
      root.querySelector('.practice .answer-feedback')?.scrollIntoView({block:'nearest'});
    } else if (target.hasAttribute('data-next-practice') && route().startsWith('learn:')) {
      const id=route().slice(6),step=LESSONS.items[id].practice?.steps[lessonState.practiceIndex];
      if(!step||lessonState.practiceSelected!==step.correct)return;
      lessonState.practiceIndex+=1;lessonState.practiceSelected=null;renderLesson(id);
      root.querySelector('#exercise')?.scrollIntoView({block:'start'});
    } else if (target.hasAttribute('data-answer') && route().startsWith('learn:')) {
      const id = route().slice(6), item = LESSONS.items[id];
      const n = Number(target.dataset.answer);
      if (!Number.isInteger(n) || !item.scenarios[lessonState.index]?.options[n] || lessonState.selected === item.scenarios[lessonState.index].correct) return;
      lessonState.selected = n;
      if (n === item.scenarios[lessonState.index].correct) recordProgress(id,{count:Math.max(lessonProgress(id).count || 0,lessonState.index+1),status:lessonProgress(id).status==='Comprendido'?'Comprendido':'Practicando'});
      renderLesson(id);
      root.querySelector('.answer-feedback')?.scrollIntoView({block:'nearest'});
    } else if (target.hasAttribute('data-next-question') && route().startsWith('learn:')) {
      lessonState.index += 1; lessonState.selected = null;
      renderLesson(route().slice(6));
      root.querySelector('#exercise')?.scrollIntoView({block:'start'});
    } else if (target.hasAttribute('data-understood') && route().startsWith('learn:')) {
      const id = route().slice(6);
      const item=LESSONS.items[id];
      if (lessonState.index >= item.scenarios.length && lessonState.practiceIndex >= (item.practice?.steps.length||0)) { recordProgress(id,{count:lessonState.index,status:'Comprendido'}); renderLesson(id); }
    } else if (target.hasAttribute('data-repeat') && route().startsWith('learn:')) {
      lessonState.index = 0; lessonState.selected = null; renderLesson(route().slice(6));
      root.querySelector('#exercise')?.scrollIntoView({block:'start'});
    } else if (target.hasAttribute('data-reset-progress') && route()==='learn') {
      if (window.confirm('¿Borrar el avance de capacitación guardado en este dispositivo?')) {
        try { localStorage.removeItem(PROGRESS_KEY); } catch (_) { /* Storage may be unavailable. */ }
        renderLearnList();
      }
    } else if (target.hasAttribute('data-back')) back();
    else navigate(target.dataset.go);
  });
  document.getElementById('all-cases').addEventListener('click', () => { if (FLOW) navigate('index'); });
  rememberButton.addEventListener('click', async () => {
    try { await savedKey('delete'); } catch (_) { return; }
    try { localStorage.removeItem(PROGRESS_KEY); } catch (_) { /* Storage may be unavailable. */ }
    CASES = GUIDES = FLOW = LESSONS = undefined;
    history.replaceState(null, '', location.pathname + location.search);
    showUnlock();
  });
  addEventListener('popstate', () => { if (FLOW) render(); });
  addEventListener('hashchange', () => { if (FLOW) render(); });
  showUnlock();
  if ('serviceWorker' in navigator) {
    let refreshing = false;
    let registration;
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !refreshing) {
        refreshing = true;
        location.reload();
      }
    });
    const checkForUpdate = () => {
      if (registration && navigator.onLine) registration.update().catch(() => {});
    };
    addEventListener('load', async () => {
      try {
        registration = await navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'});
        checkForUpdate();
      } catch (_) { /* Offline access still uses the current page. */ }
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkForUpdate();
    });
    addEventListener('online', checkForUpdate);
  }
})();
