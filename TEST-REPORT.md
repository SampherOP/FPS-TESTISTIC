# HAMU MASTER — Tactical Upgrade and Lock-Fix Test Report

## 1.2.4 lock-fix scope and data safety

- Changed only private-store startup/ownership cleanup, server startup shutdown cleanup, and portable backup-path containment; account, social, session and profile JSON formats/data are untouched.
- Added synthetic isolated temporary-store tests for live and failed contenders, duplicate close, legacy Windows CRLF recovery, a SIGKILL-stopped child holding a new-format lock, concurrent stale contenders, malformed/EPERM/foreign-host refusal, port-conflict cleanup and repeated restarts. No supplied private player data was read, printed or used as a fixture.
- Recovery trusts only `ESRCH` from Node's non-terminating PID probe as dead. It does not kill processes and intentionally refuses foreign-host/ambiguous locks. Physical Windows hardware was not tested; the CRLF/PID API behavior is covered in Node tests. Distributed/NFS locking is not claimed.

## Scope and data safety

- Visual-only client upgrade: original procedural Three.js tactical operators, weapon silhouettes, and visual animation controller.
- Other than the bounded persistence lock safety fixes above, server authority, shared simulation, protocol fields, authentication, persistence formats, and supplied `data/` contents were not changed.
- Tests use existing synthetic temporary-store fixtures; supplied private player data was not read, printed, or used as a fixture. No live deployment was performed.

## Commands run

```text
npm run check
```

**PASS** — `44 JavaScript modules parse; local imports and HTML assets exist.`

```text
npm test
```

**PASS — 77 passed / 0 failed / 77 total.** The prior 69 tests remain present and passed; 8 focused lock-recovery/startup-safety tests are included.

## Added visual coverage

`tests/tactical-visual.test.js` constructs every existing operator and all nine existing weapon IDs without a DOM requirement, checks finite transforms across repeated idle/run/crouch/slide/airborne/reload poses, verifies animated components and stable muzzle metadata, and checks that both third-person hands remain within 2.6 cm of their authored grips. The reload regression verifies that the support hand tracks the animated magazine rather than a detached handguard position.

Static parts are merged by material; animated joints and mechanisms intentionally remain separate. Materials and source geometries are cached, and removed remote models / swapped remote weapons dispose only their merge-owned buffers.

## Browser / visual evidence

Parent inspected actual models via bundled local browser presentation; live gameplay not tested.

## Limitations

This is an original procedural mid-poly visual upgrade, not copied Combat Master content, photorealistic character scanning, motion capture, or a full skeletal rig. Remote firing uses the authoritative serialized `firedAt` field for a one-frame visual mechanism response; no gameplay, hitbox, network, account, or saved-loadout logic changed.
