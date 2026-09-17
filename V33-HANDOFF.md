# HAMU MASTER V33 — weapon-update handoff

## Build status
This is the packaged weapon-update working build, NOT a fully release-validated build. The owner requested packaging before further final tests. This note supersedes older completion/WIP notes kept in the project.

## Scope
Replaces old weapon visuals with all 11 supplied GLBs; updates weapon selection/previews and adds procedural weapon-part, reload, grip and ADS behavior. Original uploaded archives remain unchanged. Unrelated performance/security/social changes were not authorized.

| Stable ID | Display name | GLB filename |
|---|---|---|
| ar4 | ASSAULT | assault.glb |
| hxr8 | BULLPUP | bullp.glb |
| mag83 | MAG-83 | mag-83.glb |
| volt9 | MP5 | mp5.glb |
| pincer | SUBMACHINE | submachine.glb |
| breach12 | SHOTGUN | shotgun.glb |
| lancer7 | SNIPER | sniper.glb |
| snipeRil | SNIPE-RIL | snipe-ril.glb |
| relay9 | PISTOL | pistol.glb |
| flick45 | GLOCK 19 | rigg-glock.glb |
| edge | KNIFE | knife.glb |

Stable IDs are retained for saved-loadout compatibility, not old visual models. GLBs have no embedded animation clips: movement is procedural. SNIPE-RIL uses an integral chamber-loading hand pose rather than a fabricated detachable mechanism.

## Start
Use Node.js 20+. In this directory run `npm ci`, then `npm start`, and open `http://localhost:3000` (unless configured otherwise). Dependencies are deliberately not bundled. For tests, use a separate copy and a fresh temporary `HAMU_DATA_DIR`; do not overwrite real account data.

## Actual validation state
- Last full suite before the final knife no-zoom correction: **174/176 passed**, two melee no-zoom failures.
- The knife aim blend was then corrected. The full suite and project check were **not rerun after this correction**.
- Expanded weapon-model regression checks: **9/9 passed**.
- Isolated Chromium rendering loaded all 11 models without captured page errors and generated previews/hip/ADS/reload snapshots. Mathematical firearm sight anchors centered; this is not proof of unobstructed visual aiming in production.
- Screenshot review, real production gameplay, two-client multiplayer checks and real-GPU performance remain pending.

Read `TEST-PROMPT-FOR-NEXT-AI.txt` for the complete test plan. Test and report first; ask the owner before editing source. Do not weaken tests or remove unrelated features.

## Known pre-existing issues, outside this update
Online semiautomatic held-fire repetition; plaintext admin launcher credential; client-authoritative progression; online admin FLY authorization; social friend-cap issues; FFA party-size documentation mismatch. Performance work was deferred.

**Keep this archive private.** Original account-related material and a plaintext launcher credential may be included. Do not publish credentials or account data in reports.
