
## V22 — Friends Directory / Editor Drag / Lobby Spacing
- Friends page is now a clean player directory: one large search bar and player/friend IDs; the duplicate party lobby panel/tabs are removed from that page.
- Quick Play remains the only party lobby. Party invites and ready/mode controls stay there.
- Admin visual UI editor and FLY editor headers now use robust pointer-based dragging and stay inside the viewport.
- Quick Play lobby party characters are spaced farther apart for a clearer 4-player lineup; layered blue lobby circles remain under each operator.
- Startup port advanced to 3003 for this upgrade.


## V15 — Lobby Character Inspection
- Added horizontal mouse drag rotation for the selected lobby character for all players, including admins. Vertical camera/model movement is not exposed.
- Added layered blue gradient/glow footing under the lobby character.
- Character rotation is stored per selected operator in account-local profile data and restored when returning to the lobby.
- Preserved port 3000 and the existing admin/editor systems.
# CHANGELOG

## 1.2.4 — Conservative private-store lock recovery

- Fixed startup recovery for a stale `.hamu-store.lock` left by a crash. New locks record PID, hostname and an owner nonce; a stale lock is reclaimed only when its same-host PID is conclusively absent (`ESRCH` from Node's non-terminating `process.kill(pid, 0)` probe).
- Legacy text locks, including Windows CRLF files, remain compatible and can be recovered only after their PID is confirmed stopped. Live, foreign-host, malformed, permission-denied and ambiguous locks remain blocked rather than being deleted.
- Added a short-lived atomic recovery guard and atomic rename quarantine so cooperating new contenders cannot both reclaim one stale lock. Closing a failed contender, or closing twice, cannot unlink a winner's lock.
- Startup/listen failures now release only their own store lock. Shutdown waits for admitted auth, social and profile write chains before unlocking; closing an unstarted server is idempotent.
- Fixed backup containment validation to use portable `path.relative` / `path.isAbsolute` checks rather than a slash-specific prefix.
- See `LOCK-FIX.txt` for safe Windows recovery steps. This is local single-directory locking, not distributed/NFS locking.

### Verification

- `npm run check`: **PASS — 44 JavaScript modules parse; local imports and HTML assets exist.**
- `npm test`: **PASS — 77 passed / 0 failed / 77 total.**

## 1.2.3 — Quick Play queue status polish

### Confirmed UI issue fixed

- Quick Play's active queue panel previously presented the search state as a generic `FINDING <MODE>` block and did not give the requested prominent real-time found-player counter.
- Replaced that status heading with **FIND PLAYERS**.
- Added a small animated queue/loading indicator.
- Added a live **PLAYERS FOUND X / 8** counter driven by the server queue state.
- Kept the active status area non-clickable; the only queue action exposed there is **CANCEL SEARCH**. It does not navigate to **PLAY WITH FRIENDS**.
- Added UI regression tests covering the status text, live counter, non-navigation presentation and animation.

### Verification

- `npm run check`: run after this UI-only change.
- `npm test`: run after this UI-only change; WebSocket/integration availability remains environment-dependent as documented in `TEST-REPORT.md`.
- Real-device and physical multi-client tests remain manual/not tested here.


## 1.2.2 — Quick Play + persistent profile

### Requested UI changes

- Renamed the main **PLAY** navigation section to **QUICK PLAY**.
- Renamed **MULTIPLAYER** to **PLAY WITH FRIENDS**.
- Renamed **OPERATORS** to **CHARACTERS** while preserving the existing character/operator data and selection logic.
- Added the live server matchmaking queue to Quick Play.
  - TDM, FFA and Domination can be selected from Quick Play.
  - Quick Play uses the same authenticated `queue.join` / `queue.cancel` matchmaking path as the friends-party system.
  - Queue status, elapsed time, searching population and bot-fill countdown are shown in the Quick Play page.
  - Local Practice remains available separately.

### Confirmed persistence gap fixed

The existing build already protected account identity on the server, but game progression/loadout/settings were browser-local. That meant a cleared browser or another device could lose the local profile even though the permanent account still existed.

Fix:
- Added private server-side per-account profile storage in `data/profiles.json`.
- Profile records are keyed by permanent account ID, so upgrades do not generate a new player identity.
- Saved data includes selected character, loadout, settings, mode/practice preferences, XP, stats and the last 50 match-history entries.
- Profile writes use the same atomic private-file approach as account/social storage.
- Client localStorage remains as a fallback/migration cache; an existing server profile is preferred on login.
- Existing account data is not bundled or migrated from any private live installation by this ZIP.

### Security / reliability

- Profile API requires the authenticated HttpOnly session cookie.
- Profile payloads are server-sanitized and bounded; invalid weapons/operators/modes are normalized instead of trusted from the browser.
- Profile saves are rate-limited.
- Passwords, session tokens and account secrets are not stored in `profiles.json`.

### Regression coverage

- Added `tests/profile.test.js` covering server profile persistence across restart, account isolation, bounded history and sanitization of client-owned state.
- Existing matchmaking regression coverage remains unchanged.

### Verification

- `npm run check`: **PASS — 36 JavaScript modules/assets checked**.
- Targeted non-WebSocket suite including the new profile test: **41/41 PASS**.
- Full `npm test`: **3 test files remain blocked by the execution environment's missing/incomplete `ws` installation**; see `TEST-REPORT.md`.
- Real phones/tablets, second physical PCs, production HTTPS and real-network multi-client tests remain manual/not tested in this environment.

No unrelated gameplay feature or branding rewrite was added.

## 1.2.1 — matchmaking verification/polish pass

### Confirmed issue fixed

**Matchmaking greedy packing could leave compatible players waiting even when a fuller valid match existed.**

Root cause:
- Queue selection added tickets greedily in FIFO order.
- A party that fit the current partial assignment could consume capacity that prevented a later combination from filling all eight slots.

Fix:
- Added bounded capacity-aware selection search.
- Team modes search both team bins with a maximum of four per team.
- FFA searches the eight-player capacity without team constraints.
- Backfill uses the same packing logic.

Regression coverage:
- TDM starvation scenario.
- FFA capacity-selection scenario.
- Existing FIFO, backfill, team-balance and party-integrity tests.

### Dependency maintenance

- Updated `ws` from `8.18.3` to `8.21.3`.
- `node_modules` is intentionally not bundled.

## HEAVY IMAGE EDITOR FIX — PORT 3000
- Fixed a recursive MENU BACKGROUND control binder that prevented the Choose Image control from opening the file picker.
- Fixed MENU BACKGROUND drag-and-drop wiring and explicit file input handling.
- Fixed selected-element image Choose Image handling to work after inspector refreshes.
- Image type validation now also accepts valid PNG/JPG/WebP files when a browser supplies an empty MIME type, while the server still validates the actual file signature.
- MENU BACKGROUND SIZE/POSITION controls now persist automatically.
- Port remains fixed at 3000.

V18 - Fixed stale Node server on port 3000 causing admin initialization error.
