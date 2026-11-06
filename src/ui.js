// Small DOM helpers and in-app dialogs (browser prompt()/confirm() are unreliable in installed web apps).

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

const toastEl = () => document.getElementById('toast');
export function toast(msg, ms = 2500) {
  const el = toastEl();
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), ms);
}

/** Shows a modal; resolves with whatever `finish(value)` is called with (undefined when dismissed). */
function modal(build) {
  return new Promise((resolve) => {
    const back = h('div', { class: 'modal-back' });
    const done = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(undefined); };
    document.addEventListener('keydown', onKey);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) done(undefined); });
    back.append(build(done));
    document.body.append(back);
    back.querySelector('[autofocus]')?.focus();
  });
}

/** Resolves true when the user confirms. */
export function confirmDialog({ title, message, confirmLabel = 'OK', danger = false }) {
  return modal((done) =>
    h('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true' },
      h('h2', {}, title),
      h('p', {}, message),
      h('div', { class: 'modal-actions' },
        h('button', { autofocus: true, onclick: () => done(false) }, 'Cancel'),
        h('button', { class: danger ? 'primary danger-fill' : 'primary', onclick: () => done(true) }, confirmLabel)))
  ).then((v) => v === true);
}

/** Resolves with the entered text, or undefined if cancelled. */
export function textDialog({ title, value = '', confirmLabel = 'Save' }) {
  return modal((done) => {
    const input = h('input', { type: 'text', value, autofocus: true });
    const ok = () => done(input.value);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    return h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      h('h2', {}, title), input,
      h('div', { class: 'modal-actions' },
        h('button', { onclick: () => done(undefined) }, 'Cancel'),
        h('button', { class: 'primary', onclick: ok }, confirmLabel)));
  });
}
