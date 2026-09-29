// Informazioni sull'ambiente (browser, modalità app, versioni).

export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// true se aperta dall'icona sulla schermata Home (web app a schermo intero)
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

export function browserInfo() {
  const ua = navigator.userAgent;
  const os = ua.match(/OS (\d+)[_.](\d+)(?:[_.](\d+))? like Mac OS X/);
  const safari = ua.match(/Version\/(\d+(?:\.\d+)*)/);
  return {
    ios: os ? `${os[1]}.${os[2]}${os[3] ? `.${os[3]}` : ''}` : null,
    safari: safari ? safari[1] : null,
    standalone: isStandalone(),
    ua,
  };
}

export async function appVersion() {
  try {
    const keys = await caches.keys();
    const k = keys.find((x) => x.startsWith('chiparla-'));
    return k ? k.slice('chiparla-'.length) : 'dev';
  } catch {
    return 'dev';
  }
}
