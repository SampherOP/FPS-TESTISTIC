# LATEST SNAPSHOT — V29 NEW GLB CHARACTERS

16 September 2026. Three supplied skinned GLBs were added as FPS COMMANDO, PLAYER SOLDIER and PLAYER HEAVY. All six operators are selectable in Quick Play and Characters, with portraits generated from the real models. New skeleton naming is mapped into the existing weapon-hand IK and animation controller. Bots rotate through all six characters. Complete validation: **113 tests passed, 0 failed**. See `NEW-GLB-CHARACTERS-V29.txt` for details.

# PREVIOUS SNAPSHOT — stopped at owner's request

14 September 2026. This is the latest edited project, NOT a claim of finished rigging. Read this before older reports in this ZIP.

## Windows startup
1. Stop the old server with Ctrl+C. Back up using `npm run data:backup -- before-upgrade` in the old project.
2. Extract this ZIP into a separate folder. Keep the same Windows user / `HAMU_DATA_DIR`; do not delete or replace `%APPDATA%\HamuMaster`.
3. Install Node.js 20 or newer. In this folder run `npm install`, then `npm start`.
4. Open http://localhost:3000 and hard-refresh. For lock problems follow `LOCK-FIX.txt`; never delete account JSON files.

**PRIVATE ZIP:** supplied account data is retained. Do not publish this archive.

## Latest owner-requested menu pass — 14 September 2026
- Quick Play lobby redesigned to a cinematic tactical layout inspired by the supplied reference image.
- The center character remains the real selected imported GLB rendered by the existing WebGL menu stage; no replacement character artwork was introduced.
- Profile name/level/XP are account-driven (`d.profile.name` / authenticated account) and no sample username is hard-coded into the menu.
- Existing mode, matchmaking, character, loadout, weapons, friends, history and settings actions remain wired to their existing handlers.
- Account/auth/profile/persistence/server code and the supplied `data/*.json` files were compared against the WIP input and are byte-for-byte unchanged.
- New targeted menu tests pass; the non-WebSocket regression selection is 63/63. Full `npm test` remains blocked in this workspace because `node_modules/ws` is absent and package download is unavailable.

## Implemented in this snapshot
- Original three GLBs retained; identity game wrappers preserve normalization.
- SWAT skeleton/embedded clips reused, independent clones and in-place locomotion.
- Generated weighted skeletons for the two static models, anatomical weighting, individually articulated finger/thumb chains, leg/crouch poses and arm IK.
- Gameplay crouch/slide/vertical velocity/direction forwarded; breathing, movement, aim, recoil, reload and airborne poses.
- Per-weapon grips, palm/wrist offsets, reach-limit projection, magazine/support-hand coordination, first-person skinned arms and open sights.
- Renderer weapon swapping, menu scaling, ADS sizing and model-load error notice updated.

## Validation and remaining work
Latest pre-edit checkpoint was **87 tests passed, 0 failed**. After these edits, the targeted character/weapon suite is **14/14 passed** and the broader non-WebSocket regression selection is **61/61 passed**; `npm run check` is **48/48 modules passed**. A complete `npm test` rerun was attempted but the supplied workspace has an empty `node_modules/ws` directory and the environment could not fetch the package, so WebSocket-dependent auth/multiplayer/save-account tests could not execute in this validation run.

Visually inspected: original appearances, idle/crouch side views, all three in the gameplay renderer aiming, and first-person hip/ADS checkpoints. An account-free review lab uses the actual Renderer and World: `/client/model-lab.html`.

**NOT fully visually validated:** physical Windows startup, live multiplayer/email ownership, and a full browser capture pass for every weapon/animation sequence. Static rigs have now been improved with separate digit chains and more conservative deformation, and shotgun reload now has seven staged shell objects, but shoulder/armpit deformation and exact hand/finger silhouette still require final human visual sign-off. Do not call the rigging fully release-validated until that browser/Windows pass is completed.

Persistence/login/backup/lock code was not intentionally modified. Automated tests use isolated data. Physical Windows startup and live email ownership verification were not tested; existing email linking is unverified game-login contact information.
