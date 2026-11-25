/*
  Runs before first paint (loaded as a classic script in <head>; the CSP forbids inline scripts).
  Sets <html data-theme> and <html data-surface> from localStorage so the page never flashes the wrong theme,
  and removes the start-up splash once the app has drawn. Keep in step with src/lib/appearance.ts.
*/
(function () {
  var BG = { light: '#F1F1ED', dark: '#26282C', blue: '#EEF2F7', green: '#EDF1EC', neon: '#14121F' };
  var root = document.documentElement;
  var theme = null, surface = null;
  try { theme = localStorage.getItem('theme'); surface = localStorage.getItem('surface'); } catch (e) { /* storage blocked */ }
  if (!BG[theme]) {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-surface', surface === 'solid' ? 'solid' : 'glass');
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', BG[theme]);

  // Splash: shown for at least a second the first time in a browser session (half that with reduced motion),
  // and only until the app has rendered on later loads. Never longer than 8 seconds.
  var start = Date.now();
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var first = true;
  try { first = !sessionStorage.getItem('splash'); sessionStorage.setItem('splash', '1'); } catch (e) { /* ignore */ }
  var minimum = first ? (reduced ? 500 : 1000) : 0;

  function hide() {
    var el = document.getElementById('splash');
    if (!el) return;
    el.className = 'out';
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 450);
  }
  function check() {
    var app = document.getElementById('root');
    var ready = app && app.firstChild;
    if (Date.now() - start > 8000) return hide();
    if (ready && Date.now() - start >= minimum) return hide();
    setTimeout(check, 60);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check);
  else check();
})();
