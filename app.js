(function () {
  'use strict';
  const root = document.getElementById('app');
  let CASES, GUIDES, FLOW;
  const rememberButton = document.getElementById('forget-device');
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const valid = id => Boolean(FLOW) && (id === 'index' || Boolean(FLOW[id]) || (id.startsWith('case:') && Boolean(CASES[id.slice(5)])) || (id.startsWith('guide:') && Boolean(GUIDES[id.slice(6)])));
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
    if (Object.keys(data.CASES || {}).length !== 19 || !data.FLOW?.home || !data.GUIDES?.fallback) throw Error('Invalid content');
    return data;
  }
  async function decrypt(passphrase) {
    const content = await payload();
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:bytes(content.salt),iterations:content.iterations},material,{name:'AES-GCM',length:256},false,['decrypt']);
    return {data:await decryptWithKey(key, content),key,salt:content.salt};
  }
  function openGuide(data, remembered) {
    CASES = data.CASES; GUIDES = data.GUIDES; FLOW = data.FLOW;
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
  }
  function render() {
    const id = route();
    if (id === 'index') {
      root.innerHTML = `<button class="back" type="button" data-back>← Volver</button><p class="eyebrow">Consulta rápida</p><h1>Todos los casos</h1><p class="lead">También puedes iniciar desde la situación del turno para llegar al caso adecuado.</p><div class="case-grid">${Object.entries(CASES).map(([n,item]) => button(`${n}. ${item.title}`,`case:${n}`)).join('')}${button('Solo contar o acomodar efectivo','guide:count')}${button('Tengo una duda','guide:fallback')}${button('Cierre final del día','guide:final')}</div>`;
    } else if (id.startsWith('case:') || id.startsWith('guide:')) {
      result(id, id.startsWith('case:') ? CASES[id.slice(5)] : GUIDES[id.slice(6)]);
    } else {
      const node = FLOW[id];
      root.innerHTML = `${id === 'home' ? '' : '<button class="back" type="button" data-back>← Volver</button>'}<p class="eyebrow">Guía de caja</p><h1>${escape(node.title)}</h1>${node.description ? `<p class="lead">${escape(node.description)}</p>` : '<p class="lead">Selecciona la situación que corresponde.</p>'}<div class="choice-list">${node.choices.map(([label,next,hint]) => button(label,next,hint)).join('')}</div>${id === 'home' ? '<p class="source">Esta guía orienta; registra las operaciones en el sistema de caja.</p>' : ''}`;
    }
    document.title = (id === 'home' ? 'Guía de caja' : `${root.querySelector('h1').textContent} · Guía de caja`);
    root.focus({preventScroll:true});
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-go], [data-back]');
    if (!target) return;
    if (target.hasAttribute('data-back')) back();
    else navigate(target.dataset.go);
  });
  document.getElementById('all-cases').addEventListener('click', () => { if (FLOW) navigate('index'); });
  rememberButton.addEventListener('click', async () => {
    try { await savedKey('delete'); } catch (_) { return; }
    CASES = GUIDES = FLOW = undefined;
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
