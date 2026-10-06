# TASK-FIX2 — Sidebar nav click → blank page (Apps Script sandbox: base target="_top" hijacks hash links)

Project dir: `C:/Users/PAB-ACDM-NB3299/Documents/kerjaan/seven-retail/appscript-zuki/sis-sparks-math`
Read first: this file, then `src/Scripts.html` (navigateTo ~line 141, handleRoute ~143-172, initApp tail
~1100-1105, render function callbacks), `src/Index.html` (line 7 `<base target="_top">`, footer-version
line 45), `src/Views.html` (templates).

**Do NOT touch:** `TASK.md`, `TASK-FIX.md`, `README.md`, `verify.js`, `login-sim.js`, `.clasp.json`, the doc,
`src/Config.gs`. Do NOT run clasp/git. New file allowed: `ui-sim.js` at project root.

## Verified evidence (root cause)

The web app runs inside the Apps Script IFRAME sandbox. `Index.html` has `<base target="_top">`.
Clicking a nav link (`<a href="#/murid">`) resolves the fragment against the document base and — because of
`target="_top"` — attempts the navigation in the **TOP frame**, loading the sandbox panel URL directly as
the top document → **blank page**. Every in-app hash link (sidebar nav + table row links like
`#/sesi-input?id=…`) is affected. `navigateTo()` also does `window.location.hash = hash` (line 141) which is
not sandbox-safe, and `handleRoute()` re-reads `window.location.hash` (fragments are host-managed in the
sandbox, so this must become internal state). Footer version is hardcoded `v0.1.0` and never updated at runtime.

## Fix 1 — sandbox-safe routing in `src/Scripts.html`

- **`navigateTo(hash)`** (new behavior): store `state.currentHash = hash`; render immediately via the router;
  then best-effort sync the sandbox URL: `try { google.script.history.pushState({ route: hash }, {}, hash); } catch (e) {}`.
  Never assign `location.hash`.
- **`handleRoute()`** refactor: keep the function (internal callers at ~line 448 and ~line 642 re-render the
  current screen); it must render from `state.currentHash || '#/beranda'` instead of `window.location.hash`.
  Extract the existing body into `renderRoute(hash)` (parses hash, sets `state.currentRoute`, toggles `.nav-item`
  active state, clears `#content`, dispatches to the render* functions). `handleRoute()` = `renderRoute(state.currentHash || '#/beranda')`.
- **Delegated click interception** (add near init): a document-level listener that catches every click on
  `a` elements whose `href` starts with `#`:
  ```js
  document.addEventListener('click', function (ev) {
    if (ev.defaultPrevented) return;
    const t = ev.target;
    const a = t && t.closest ? t.closest('a[href^="#"]') : null;
    if (!a) return;
    ev.preventDefault();
    const href = a.getAttribute('href') || '#/beranda';
    if (href.length > 1) navigateTo(href);
  });
  ```
  (External links keep their own `target="_blank"` / base behavior — do not intercept them.)
- **Init routing** (replaces `window.addEventListener('hashchange', handleRoute); handleRoute();` in initApp):
  ```js
  function initRouting() {
    let routed = false;
    const go = (h, replace) => {
      if (routed) return; routed = true;
      const hash = (h && h.charAt(0) === '#') ? h : '#/beranda';
      state.currentHash = hash;
      renderRoute(hash);
      try { (replace ? google.script.history.replaceState : google.script.history.pushState).call(null, { route: hash }, {}, hash); } catch (e) {}
    };
    try {
      google.script.url.getLocation(function (loc) {
        go(loc && loc.hash ? loc.hash : '#/beranda', true);
      });
    } catch (e) {}
    setTimeout(function () { go('#/beranda', true); }, 1500); // fallback if getLocation never fires
    try {
      google.script.history.setChangeHandler(function (e) {
        const h = (e && e.location && e.location.hash) ? e.location.hash : '#/beranda';
        state.currentHash = h;
        renderRoute(h);
      });
    } catch (e) {}
  }
  ```
  (`replace` for the first entry so the initial route doesn't pollute history; use `pushState` for user navigation.
  Adjust the `call(null, …)` shape to whatever works syntactically — keep it inside try/catch.)
- Remove the `window.addEventListener('hashchange', …)` registration. Keep `state` in-memory only.
- **Footer version runtime fill**: in initApp after bootstrap success:
  `const fv = document.getElementById('footer-version'); if (fv) fv.textContent = 'v' + b.version;`
- Also update the `api()` switch ONLY if you add new client api calls (expected: none).

## Fix 2 — NEW `ui-sim.js` at project root (click-through harness, Node, jsdom)

Purpose: prove that clicking every sidebar item renders content and prevents default; regression guard for
this blank-page bug.

- Try to install jsdom OUTSIDE the repo: `npm install jsdom --prefix "$TMPDIR/uidom"` (bash; if `$TMPDIR`
  unset try `$TEMP/uidom`). NEVER create node_modules/package.json inside the project.
- `ui-sim.js` must:
  1. Locate jsdom: `require('jsdom')`; if that fails, `require(path.join(process.env.TMPDIR || process.env.TEMP || '', 'uidom', 'node_modules', 'jsdom'))`.
     If unavailable after a genuine attempt: print `SKIPPED: jsdom not installed (<exact error>)` and **exit 0**
     (header comment documents the install command). Do not fake any passing test.
  2. Build the page: take `Index.html`, replace the `<?!= include('Styles') ?>` / `<?!= include('Views') ?>` /
     `<?!= include('Scripts') ?>` markers with the real contents of `Styles.html`, `Views.html`, (`Scripts.html`
     last). Pass it to jsdom with `runScripts: 'dangerously'` and a `beforeParse(window)` hook that installs mocks:
     - `window.google = { script: { run: <Proxy chainable mock>, history: { pushState, replaceState, setChangeHandler }, url: { getLocation: cb => cb({ hash: '' }) } } }`
     - The `run` mock must support `google.script.run.withSuccessHandler(s).withFailureHandler(f).<anyMethod>(...)`:
       store handlers on chain, then call `setTimeout(() => s(fixtureFor(methodName)), 0)`.
       `fixtureFor` returns per-method fixtures you build by READING the render* functions in Scripts.html
       (empty lists are fine where the UI has empty states; include the object fields the code dereferences).
       `getAppBootstrap` must return `{ state:'ok', notRegistered:false, dbReady:true, version:'0.1.2', title:'…',
       user:{email:'aulya.kustyawan@seven-retail.com', full_name:'Test', role:'HQ', centers:[]}, nav:[…all 11 ids/labels…] }`.
  3. Wait for init to finish (poll until `#nav-links` has children; fail after ~3s).
  4. For EVERY nav link: dispatch a bubbling `MouseEvent('click', {bubbles:true, cancelable:true})`; assert
     (a) `evt.defaultPrevented === true`, (b) `#content` innerHTML is non-empty after the (async) render settles
     (poll up to ~1.5s), (c) no uncaught exception was recorded (hook `window.onerror` + jsdom virtualConsole
     'jsdomError').
  5. Also assert the footer text becomes `v0.1.2` after bootstrap.
  Print `PASS click <id>` per screen; final `RESULT: PASS (11 clicks)` or `RESULT: FAIL (n failed)`; exit code 0/1.
- If a click reveals a REAL render crash (not a fixture shape problem), fix the render code in Scripts.html/Views.html.

## Fix 3 — keep every existing suite green (run in FOREGROUND, paste raw tails)

```bash
cd C:/Users/PAB-ACDM-NB3299/Documents/kerjaan/seven-retail/appscript-zuki/sis-sparks-math
node ui-sim.js      # EXPECTED: RESULT: PASS (11 clicks)  — or explicit SKIPPED line if jsdom unavailable
node login-sim.js   # EXPECTED: RESULT: PASS (7 scenarios)  [unchanged]
node verify.js      # EXPECTED: RESULT: PASS — 0 failure(s)  [read-only for you]
```

## Report format (end your run with exactly this)

```
STATUS: done | partial
FILES:   <path — what changed, one line each>
UI-SIM:  <raw tail of node ui-sim.js, last 12 lines>
HARNESS: <raw tail of node login-sim.js, last 4 lines>
VERIFY:  <raw tail of node verify.js, last 6 lines>
NOTES:   <anything not done + why; fixture caveats>
```
