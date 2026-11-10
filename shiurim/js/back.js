// The phone's "back" button (Android). First it closes whatever is open (a window, a picture, a sub-page);
// on a main screen, one press only shows "לחיצה נוספת תצא מהאפליקציה", and a second press within a few
// seconds leaves. So one accidental press never closes the app.
//
// How: the page keeps one extra history entry (the "guard") on top of its own. Back removes the guard and
// fires popstate; the app handles the press and puts the guard back. Only when the app lets go (the second
// press) is the guard left off, so the next back press reaches the system and closes the app.

const GUARD = 'shiurimGuard';
const WINDOW_MS = 2500;

export function initBack({ onBack, onArm }) {
  if (!window.history || !history.pushState) return;
  const isGuard = () => !!(history.state && history.state[GUARD]);
  const guard = () => {
    if (!isGuard()) {
      try { history.pushState({ [GUARD]: true }, '', location.href); } catch { /* file:// */ }
    }
  };
  guard();

  let armedUntil = 0;
  let rearm = null;
  window.addEventListener('popstate', () => {
    if (isGuard()) return; // went forward onto the guard: nothing to do
    if (onBack()) { guard(); return; }
    if (Date.now() < armedUntil) {
      // Second press, but there are still entries of this app behind (e.g. after an update reload):
      // keep going back until the system closes the app.
      history.back();
      return;
    }
    armedUntil = Date.now() + WINDOW_MS;
    onArm();
    clearTimeout(rearm);
    rearm = setTimeout(() => { armedUntil = 0; guard(); }, WINDOW_MS);
  });
  // Any tap after the guard was taken away puts it back (so a single press never exits by surprise).
  document.addEventListener('pointerdown', () => {
    if (armedUntil && Date.now() >= armedUntil) { armedUntil = 0; guard(); }
  }, true);
}
