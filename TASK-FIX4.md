# TASK-FIX4 — Sidebar toggle (☰) does nothing on desktop: make it collapse/expand at all widths

Project dir: `C:/Users/PAB-ACDM-NB3299/Documents/kerjaan/seven-retail/appscript-zuki/sis-sparks-math`

Read first: `src/Scripts.html` (bottom: delegated click listener ~1539, `btnToggleSidebar` handler ~1549;
`navigateTo` ~142), `src/Styles.html` (`.app-sidebar` ~182; Responsive `@media (max-width: 900px)` ~623-636),
`src/Index.html` (markup: `#app-layout`, `#nav` = the `<aside class="app-sidebar">`, header button
`#btn-toggle-sidebar`), `ui-sim.js`.

**Allowed to edit:** `src/Scripts.html`, `src/Styles.html`, `ui-sim.js`.
**Do NOT touch:** `src/Config.gs`, `src/Index.html`, `src/Views.html`, any `.gs`, `verify.js`, `login-sim.js`,
`admin-sim.js`. Do NOT run clasp/git.

## Root cause (verified)

`#btn-toggle-sidebar` handler toggles class `open` on `#nav`. But `.app-sidebar.open` CSS exists ONLY inside
`@media (max-width: 900px)` (off-canvas mobile drawer). On desktop (>900px) the click changes nothing visually
→ user reports the button "is not triggering". Handler binding itself is fine.

## Fix spec

### 1. `src/Scripts.html` — width-aware toggle + close on navigate
Replace the `btnToggleSidebar` click handler with:

```js
btnToggleSidebar.addEventListener('click', () => {
  const nav = document.getElementById('nav');
  const layout = document.getElementById('app-layout');
  const isMobile = window.matchMedia('(max-width: 900px)').matches;
  if (isMobile) {
    if (nav) nav.classList.toggle('open');
  } else if (layout) {
    layout.classList.toggle('sidebar-collapsed');
  }
});
```

And in `navigateTo(hash)` (single place, covers nav links + programmatic navigation): after the route renders,
close the mobile drawer:
```js
const nav = document.getElementById('nav');
if (nav) nav.classList.remove('open');
```

### 2. `src/Styles.html` — desktop collapse rule
Add next to the existing Responsive block (keep existing `max-width: 900px` rules unchanged):

```css
@media (min-width: 901px) {
  .app-layout.sidebar-collapsed .app-sidebar {
    display: none;
  }
}
```

### 3. `ui-sim.js` — cover both modes (+ matchMedia polyfill, jsdom lacks it)
- In the jsdom `beforeParse` (or equivalent), add:
  ```js
  if (!window.matchMedia) {
    window.matchMedia = function (q) {
      const m = /max-width:\s*(\d+)px/.exec(q);
      return {
        matches: m ? window.innerWidth <= Number(m[1]) : false,
        addEventListener: function () {}, removeEventListener: function () {},
        addListener: function () {}, removeListener: function () {}
      };
    };
  }
  ```
  (If direct `window.innerWidth = 600` assignment doesn't take in jsdom, use
  `Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true })` or jsdom `reconfigure`.)
- Desktop (default width >900) assertions after login scenario, BEFORE/AFTER the nav-click checks:
  1. click `#btn-toggle-sidebar` → `#app-layout` has class `sidebar-collapsed`.
  2. click again → class removed. Then proceed with the existing nav clicks (make sure nav links still work while collapsed=off).
- NEW mobile sub-scenario (width 600): load a fresh sim window; click `#btn-toggle-sidebar` → `#nav` gets class
  `open`; then click a nav link (e.g. `#/murid`) → `#nav` class `open` is REMOVED (auto-close) and content renders.
- Keep all existing assertions (11 HQ nav clicks, 8 admin CRUD steps, 4 TEACHER clicks) and update the final
  summary counts accordingly. Keep `RESULT: PASS`/`FAIL` + exit codes.

## Acceptance (run in foreground, paste tails)

```bash
node ui-sim.js      # RESULT: PASS ... (includes sidebar toggle assertions)
node admin-sim.js   # RESULT: PASS (5 scenarios)
node login-sim.js   # RESULT: PASS (7 scenarios)
node verify.js      # RESULT: PASS — 0 failure(s)
```

## Report format (end exactly like this)

```
STATUS: done | partial
FILES:  <path — what changed>
UI-SIM: <tail, last 5 lines>
ADMIN-SIM: <tail, last 2 lines>
LOGIN:  <tail, last 2 lines>
VERIFY: <tail, last 4 lines>
NOTES:  <anything skipped + why>
```
