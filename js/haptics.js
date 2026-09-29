// Piccola vibrazione al tocco.
// - Android/Chrome: navigator.vibrate.
// - iOS: Safari NON supporta navigator.vibrate. Da iOS 18 un interruttore
//   <input type="checkbox" switch> dà un feedback aptico quando cambia stato:
//   lo attiviamo tramite la sua <label>. È un comportamento non documentato:
//   può non funzionare o smettere di funzionare con un aggiornamento di iOS.

import { getSettings } from './settings.js';

let label = null;

function ensureSwitch() {
  if (label) return label;
  const id = 'haptic-switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.id = id;
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  label = document.createElement('label');
  label.htmlFor = id;
  label.setAttribute('aria-hidden', 'true');
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
  wrap.append(input, label);
  document.body.append(wrap);
  return label;
}

// Da chiamare dentro il gestore del tocco (serve il gesto dell'utente)
export function haptic() {
  if (!getSettings().haptics) return;
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(20);
      return;
    }
    if (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      ensureSwitch().click();
    }
  } catch { /* nessun feedback: non è un problema */ }
}
