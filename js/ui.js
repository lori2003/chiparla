// Piccoli aiuti per costruire l'interfaccia senza framework.

// h('button', { class: 'btn', onclick: fn }, 'Testo', figlio, ...)
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (typeof v === 'boolean' || (k in el && typeof v !== 'string')) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// ---------- avvisi temporanei ----------

let toastTimer = null;
export function toast(message, { action, onAction, ms = 2600 } = {}) {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  el.replaceChildren(h('span', {}, message));
  if (action) {
    el.append(h('button', {
      type: 'button',
      class: 'toast-action',
      onclick: () => { hide(); onAction?.(); },
    }, action));
  }
  el.classList.add('show');
  const hide = () => el.classList.remove('show');
  toastTimer = setTimeout(hide, action ? Math.max(ms, 5000) : ms);
}

// ---------- finestre modali ----------

let closeCurrent = null;

// actions: [{ label, value, class, onClick }] — onClick può restituire false per non chiudere
export function openModal({ title, body, actions = [], onOpen }) {
  const dlg = document.getElementById('modal');
  closeCurrent?.(undefined); // una finestra alla volta
  return new Promise((resolve) => {
    const close = (v) => {
      if (closeCurrent !== close) return;
      closeCurrent = null;
      if (dlg.open) dlg.close();
      dlg.replaceChildren();
      resolve(v);
    };
    closeCurrent = close;
    const buttons = actions.map((a) => h('button', {
      type: 'button',
      class: `btn ${a.class ?? ''}`,
      onclick: async () => {
        const v = a.onClick ? await a.onClick() : a.value;
        if (v === false) return;
        close(v === undefined ? a.value : v);
      },
    }, a.label));
    dlg.replaceChildren(h('div', { class: 'modal-card' },
      title ? h('h2', {}, title) : null,
      body,
      h('div', { class: 'modal-actions' }, buttons)));
    dlg.oncancel = (e) => { e.preventDefault(); close(undefined); };
    dlg.showModal();
    onOpen?.(dlg);
  });
}

export async function confirmDialog(title, text, { ok = 'OK', cancel = 'Annulla', danger = false } = {}) {
  const v = await openModal({
    title,
    body: text ? h('p', {}, text) : null,
    actions: [
      { label: cancel, value: false, class: 'secondary' },
      { label: ok, value: true, class: danger ? 'danger' : 'primary' },
    ],
  });
  return v === true;
}

// Restituisce il testo inserito oppure null se annullato.
// Va chiamata nel gestore del tocco (senza await prima) perché iOS apra la tastiera.
export function promptDialog(title, { value = '', placeholder = '', multiline = false, ok = 'Salva', hint = '' } = {}) {
  const input = multiline
    ? h('textarea', { rows: 4, placeholder, autofocus: true })
    : h('input', { type: 'text', placeholder, autofocus: true, enterkeyhint: 'done' });
  input.value = value;
  const submit = () => input.value.trim();
  if (!multiline) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.closest('.modal-card').querySelector('.btn.primary')?.click(); }
    });
  }
  return openModal({
    title,
    body: h('div', { class: 'field' }, hint ? h('p', { class: 'muted small' }, hint) : null, input),
    actions: [
      { label: 'Annulla', value: null, class: 'secondary' },
      { label: ok, class: 'primary', onClick: submit },
    ],
    onOpen: () => input.focus(),
  }).then((v) => (typeof v === 'string' ? v : null));
}
