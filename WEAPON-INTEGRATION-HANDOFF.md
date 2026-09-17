# V32 supplied-weapon integration

## Start

Requires Node.js 20 or newer. Extract the ZIP, open `hamu-master`, run `npm ci`, then `npm start`, and open `http://localhost:3000`. The original Windows `start.bat` and server/client commands remain available. Keep the complete assets and vendor folders. Existing account/config storage behavior is unchanged; no test accounts or new test logs are included.

## Exact visual mapping

| Supplied asset | Existing IDs |
|---|---|
| mp5.glb | volt9, pincer |
| shotgun.glb | breach12 |
| sniper.glb | lancer7 |
| pistol.glb | relay9, flick45 |
| knife.glb | edge |

**ar4 and hxr8 retain their original procedural assault-rifle visuals**, because no assault-rifle model was supplied. Shared visuals do not merge gameplay identities. Weapon names, slots, unlocks, balance, ammunition, recoil values, fire modes and server hit detection were not edited.

## Implementation and changed files

- Added `client/weapon-models.js`: local GLTFLoader, per-model transforms/anchors, one-load/one-preparation cache, independent animated instances, safe shared GPU resources, static batching and latched loading failures.
- Updated `client/geometry.js`: the common weapon factory replaces the complete fallback body after successful loading; preserves/rebinds the original skinned first-person arms; cancels disposed instances’ pending installations.
- Updated `client/models.js`: compatible support-hand reload posing for the merged pistol.
- Updated `client/animation.js`: real-part animation and authored shell/hand presentation.
- Updated `client/renderer.js`: independent preload and barrel-aligned cosmetic tracer origins, including the different first-person/world camera projections.
- Updated `client/effects.js`: cosmetic tracer-start override only; authoritative endpoints remain unchanged.
- Added all five unchanged supplied GLBs under `assets/models/weapons/`.
- Added `tests/weapon-models.test.js` and `tests/weapon-effects.test.js`.

The shared factory covers first-person, remote players, NPCs, lobby characters and the existing `client/model-lab.html` preview. Original files, maps, character assets, menus, networking, authentication, account handling and gameplay data are retained. No second Three.js or CDN dependency was introduced. Existing GLB MIME handling already worked and was not changed.

## Validation actually completed

- Untouched V32 baseline: **159/159 tests passed**; **62-module check passed**.
- Final update: **170/170 tests passed** with `npm test`; **65-module check passed** with `npm run check`. No existing tests were modified or removed. An intermediate run hit the existing party-firing test’s exact-timestamp race; it passed alone and subsequent full runs passed unchanged.
- All five assets decoded/rendered in Chromium WebGL, with finite nonempty bounds. Side, first-person, ADS and all-five-operator renders inspected. New tests check metadata, real parts, shared resource ownership, independent transforms, grip IK and first-person arm continuity.
- Controlled browser gameplay: actual mouse/keyboard actions through shipped Game/Input/Renderer modules; automatic SMG hold, semi-auto pistol/shotgun/sniper, damage, ammunition, reload, ADS, sniper zoom, switching, sprint and knife swing. All three modes tested; mapped MP5 NPCs fired in TDM, FFA and Domination.
- Two authenticated browser clients with a local authoritative server: mapped remote guns, independent firing, damage, remote pistol/knife switches, independent magazine reload, and leave/rejoin with sniper. This used controlled fixture positions, a paced test loop and reduced rendering. Concurrent holds used dispatched DOM mouse events; browser focus-loss handling was suppressed in the harness to represent separate devices. Production input behavior was not altered.
- Real lobby/social UI checks: Friends search, requests/pending/acceptance, online/offline profiles, invitation acceptance, guest readiness/control, leader centering, leader-only permissions and cancellation prompts on both clients expiring around two seconds.
- Browser delayed-load/disposal and deliberate HTTP-404 tests: one MP5 request for both IDs, stale disposed instance not replaced, one active imported body, visible procedural failure fallback. Existing five-operator preview loaded mapped visuals. Normal successful harness runs had no JavaScript errors or missing assets; deliberate failure was expected.

## Measured cost and limitations

Same software-WebGL inspection setup, isolated weapon body draw calls (old → new): MP5 10→9; shotgun 11→4; sniper 9→18; pistol 13→3; knife 3→3. Supplied meshes have more triangles; especially the sniper is costlier.

Thirty warmed cycles through nine first-person weapons showed no geometry/texture growth: baseline 65/18→65/18, update 68/24→68/24. Ten third-person equip/dispose cycles were also flat: baseline 18/9→18/9, update 54/15→54/15. Updated counts intentionally retain shared cached assets. Median nine-switch harness cycle was 1.8 ms baseline vs 2.7 ms updated; this is **not gameplay FPS**, a hardware-GPU benchmark, or proof of zero lag.

None of the weapon GLBs contains animation clips. MP5 magazine/charging handle and sniper magazine/bolt are real separable nodes. The pistol slide/magazine and shotgun pump are merged with other body geometry by material, so they do **not** have fabricated detachable-part animations. They retain weapon recoil/reload poses, with pistol support-hand handling and shotgun shell insertion. No destructive splitting or old full gun is used to fake motion.

Continuous full-menu multiplayer play/resume was unreliable under this environment’s SwiftShader software graphics; GPU-stall warnings occurred. The controlled gameplay checks are not a replacement for extended real-device play. Native unrestricted pointer lock, audio listening, network-latency soak tests and every extreme hand/pose intersection were not exhaustively verified.

### Remaining manual checklist

On normal Chrome/Edge hardware acceleration: play all modes for several minutes with two devices; check native mouse capture/audio, sustained automatic fire, ADS/scope, reload and knife swing; inspect every operator at extreme pitch/crouch; rapidly switch and leave/rejoin; repeat Friends/invite/cancel flows. Compare high/medium/low graphics with a full lobby and bots, especially sniper-heavy matches. No additional integration code is knowingly unfinished.
