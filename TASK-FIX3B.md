# TASK-FIX3B — Make withLock_ re-entrant (safe nested locking) + harden admin-sim lock mock

Project dir: `C:/Users/PAB-ACDM-NB3299/Documents/kerjaan/seven-retail/appscript-zuki/sis-sparks-math`

Read first: this file; `src/Db.gs` (`withLock_` at the bottom, `update`/`updateWhere`/`softDeleteWhere`),
`src/Admin.gs` (saveUser / saveCenter / saveProgramLevel / deleteHoliday — all wrap `withLock_` and then call
Db methods that take the lock AGAIN), `admin-sim.js` (LockService mock ~line 135).

**Allowed to edit:** `src/Db.gs`, `admin-sim.js`. **Do NOT touch:** anything else (no Scripts.html, no Views.html,
no Admin.gs, no Config.gs, no verify.js, no login-sim.js, no ui-sim.js). Do NOT run clasp/git.

## Change 1 — `src/Db.gs`: re-entrant `withLock_`

Current `withLock_` acquires the script lock on EVERY call. Server functions like `saveUser` call
`withLock_(() => { ... Db.update(...) ... })` where `Db.update()` internally calls `withLock_` again →
nested acquisition of the same lock within one execution. Let's make nesting safe and well-defined:

```js
let lockDepth_ = 0;

function withLock_(fn) {
  if (lockDepth_ > 0) return fn(); // lock already held by this execution
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  lockDepth_++;
  try {
    return fn();
  } finally {
    lockDepth_--;
    lock.releaseLock();
  }
}
```

(Keep the function name, keep the 30000ms timeout, keep the exact placement/formatting style of the file.
The first line may be the very first assignment; verify `lockDepth_` doesn't collide with an existing global.)

## Change 2 — `admin-sim.js`: strict LockService mock

Make the mock simulate the WORST-CASE (non-re-entrant) platform behavior so a regression that removes the
guard fails the suite:

```js
LockService: {
  getScriptLock: () => ({
    waitLock: () => {
      if (mockLockHeld) throw new Error('LockService: nested/contended acquire in same execution');
      mockLockHeld = true;
      return true;
    },
    releaseLock: () => { mockLockHeld = false; }
  })
}
```

(`mockLockHeld` = per-context boolean inside your context factory, reset between scenarios.) With the guard in
place, nested paths (`saveUser` update → `Db.update`, `saveProgramLevel` → `updateWhere`, `deleteHoliday` →
`softDeleteWhere`) never re-acquire → suites pass. Without the guard they must fail — prove this (see below).

## Acceptance

1. Prove teeth: in a scratch copy OUTSIDE the repo (e.g. `$TMPDIR/fix3bneg`), remove the guard
   (`if (lockDepth_ > 0) return fn();`) and run `node admin-sim.js` there → MUST fail (`RESULT: FAIL`).
2. In the real repo, run ALL FOUR in the foreground and paste tails:
   ```bash
   node admin-sim.js   # RESULT: PASS (5 scenarios)
   node ui-sim.js      # RESULT: PASS
   node login-sim.js   # RESULT: PASS (7 scenarios)
   node verify.js      # RESULT: PASS — 0 failure(s)
   ```

## Report format (end your run with exactly this)

```
STATUS: done | partial
FILES:    <path — what changed>
GUARD-OFF-TEST: <raw 2-4 lines showing the scratch copy without the guard fails admin-sim>
ADMIN-SIM: <tail, last 3 lines>
UI-SIM:  <tail, last 3 lines>
LOGIN:   <tail, last 2 lines>
VERIFY:  <tail, last 3 lines>
NOTES:   <anything skipped + why>
```
