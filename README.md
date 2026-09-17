# HAMU MASTER 1.2.4 — Quick Play, Friends, Matchmaking, Profiles & Lock Safety

An original browser-based arena FPS: a compact industrial map, responsive movement, nine weapons, local bots, and real-time Node.js/WebSocket multiplayer. All characters, weapon shapes, arena artwork, materials and synthesized sounds are original placeholders. No Combat Master assets, branding, maps, recordings or proprietary code are included.

## Upgrading / permanent account storage

**Read `UPGRADE-FIRST.txt` and `START-HERE.txt` before replacing an installation.** This owner upgrade ZIP contains the supplied private `data/` records; do **not** publish or share it. Before every upgrade, stop the server and create a private/off-host backup with `npm run data:backup -- before-upgrade`.

The default storage is a stable private OS user-data directory outside the extracted project (show it with `npm run data:location`). Alternatively set `HAMU_DATA_DIR` to one absolute private persistent directory/volume and preserve that setting across releases. On its first use of an empty stable target, this build copies the supplied project `data/` automatically, preserving IDs, hashes, sessions, social data and profiles. It refuses to merge/replace a non-empty target, to create accounts when other store files exist without `accounts.json`, or to start on corrupt store JSON. One process may hold a store lock at a time. Existing users log in with the same name and GAME password; hard refresh after upgrade.

## Start playing

Install **Node.js 20 or newer**, then extract this ZIP and open a terminal in the `hamu-master` folder:

```sh
npm install
npm start
```

Open **http://localhost:3000** in current desktop Chrome or Edge. First select **CREATE ACCOUNT → CHOOSE UNIQUE NAME → NEXT → PASSWORD → CREATE ACCOUNT**. Confirm your password on the same screen. After registration, the main menu opens automatically. Returning players can use **LOG IN**, and a valid saved session opens the menu directly. Use **QUICK PLAY** to select TDM/FFA/Domination and join the live server queue, or use **LOCAL PRACTICE** for bots. Enable hardware acceleration in your browser.

The single `npm start` command serves both the browser client and multiplayer server. Do **not** open `index.html` directly: browser modules require an HTTP server. All graphics libraries, UI styles, artwork and fonts are bundled locally; no CDN is needed at runtime. Installation downloads the `ws` server dependency.

### Alternate port (optional)

`npm run client` starts the complete account, game and multiplayer server at **http://localhost:5173** instead. It is no longer a static-only server. Use one command at a time: **do not run multiple processes against the same account directory**.

`PORT` changes the normal server port, `CLIENT_PORT` changes the alternate port, and `HOST` changes the bind address (default `0.0.0.0`). The default normal port is 3000. Always use the same web address for login and multiplayer.

## Accounts — new in 1.1

- **Unique name:** 3–18 ASCII letters, numbers or underscores. Uniqueness and login are case-insensitive: `HamuKing` and `hamuking` are the same account. Display capitalization is preserved. There is no rename feature.
- **Password:** 8–128 characters, with confirmation during registration. Passwords are salted and hashed with scrypt; plaintext passwords are not stored in the database or browser storage.
- **Session:** HttpOnly, SameSite=Strict cookie; random tokens are stored only as hashes on the server. Sessions expire after 30 days, survive normal server restarts, and are revoked on logout. Use **Profile → Log Out** to switch accounts. Tabs recheck identity on focus and periodically.
- **Player ID:** permanent UUID shown in Profile and attached by the server to multiplayer connections. Gameplay ignores any client-supplied callsign and uses the authenticated username.
- **Friends:** use permanent account IDs, never socket IDs or editable names. Player search, public profiles, pending friend requests, friend lists and live party invites are included. Email verification, password changes and password recovery are not included.
- **Persistent profile:** settings, loadout, selected character, XP, stats and the last 50 match-history entries are saved per permanent account ID in the server data directory (`profiles.json`). A browser-local cache remains as a fallback/migration layer. Existing anonymous saves are not automatically assigned to a new account.

### Account data, email and hosting

The server uses four private stores: `accounts.json`, `sessions.json`, `social.json` and `profiles.json`. The default is a stable private OS user-data directory outside this project; use `npm run data:location` to see it. `HAMU_DATA_DIR` overrides it for a private, absolute persistent volume. The web static allowlist does not expose either project `data/` or the private default location. Back up securely and off-host before upgrades with `npm run data:backup -- LABEL`; five manual backups are retained and `backups/previous-good` is a bounded pre-write snapshot. `npm run data:restore -- BACKUP-NAME` deliberately refuses to overwrite current data: stop the server and move all four JSON files aside first. **Never publish this owner ZIP, data or backups.** Disk/host loss or loss of every backup cannot be guaranteed against.

New registration requires a normalized, unique Gmail/other email before the unique name. The email is private and unverified; it only permits login with that email plus the GAME password. It is not Google sign-in, Gmail ownership proof, cloud storage, password reset or email-only authentication. Existing legacy accounts without email still use name + GAME password and can link one in Profile after confirming that GAME password. Social/search/public-user APIs never return email.

This is a **single-process server with atomic JSON file writes and an exclusive data-store lock**. Do not share one data directory between running processes or containers. It is suitable for this small game foundation, not a horizontally scaled account service. Migrate to a transactional database before large-scale production use. All players need the **same running server** for shared username uniqueness, accounts and multiplayer; separate installations have separate account registries.

Localhost HTTP is for development. For real players, serve the game and API through **HTTPS**, support **WSS /ws** upgrades, and set `COOKIE_SECURE=1` behind your trusted HTTPS reverse proxy. Do not set that flag for plain-HTTP local development, since browsers may then refuse the cookie. Rate limits use the direct peer IP (forwarded headers are not blindly trusted), so tune proxy-level limits for deployment. A static-only hosting site cannot run these accounts. No public hosting or domain is included.

## Friends, parties and multiplayer

The signed-in game connects automatically to its own multiplayer server so requests and invites can arrive while you are in the menu. If the connection drops, use **PLAY WITH FRIENDS → Reconnect**. QUICK PLAY uses the same authenticated server queue. Reconnection restores the friends list; it does not restore an interrupted match or party.

### Find friends

1. Open **Multiplayer**. The player search is beside **LIVE OPERATIONS**.
2. Type at least two characters of a registered player's unique name. Search is case-insensitive and returns up to 20 matching players, exact matches first.
3. Click a result to open the player's profile, then **Add Friend**.
4. The recipient opens **Pending** and selects **Accept** or **Decline**. Senders can cancel outstanding requests. Accepted relationships appear in both players' **Friends** tabs.
5. Profiles display the public unique name, account creation date and live presence. They never expose email or claim verified identity, and do not invent online ranks from untrusted local XP. Friends can be removed from their profile with confirmation.

Friendships and pending requests survive logout and server restart. Search and requests are server-authorized and bounded. Self requests, duplicates, and unauthorized acceptance/cancellation are rejected. Friends show Online, In Party, Searching, In Match, or Offline.

### Form a party

- Each connected player starts in a solo pre-match party as its leader.
- The leader uses **Friends → Invite** on an available online friend. The friend opens **Invites → Join Party**. Invitations expire after 60 seconds and are invalidated if the party/friend relationship is no longer eligible.
- Only the **leader** can invite, choose the mode, remove members and press **Find Match**.
- Other members use **Ready / Cancel Ready**. Everyone must be online and ready before the leader can start. Cancelling readiness while searching cancels the whole-party queue. Any member can cancel a search.
- A member's selected loadout is captured when they ready up; changing it returns them to not-ready. Loadouts cannot change during a search.
- Team Deathmatch and Domination parties allow **up to 4** people and stay on the **same team**. Free For All parties allow **up to 8**, but everyone is an opponent.
- Leaving or disconnecting during a search cancels the search. If the leader leaves, leadership transfers to the oldest remaining member and other members must ready up again.

### Queue and matches

The server matches intact parties and random solo players who queued for the same mode. Team assignment uses capacity-aware packing; parties are never split. There is no skill/rank/region matching in this build.

- **8 operators per match.** A full compatible set starts immediately.
- Otherwise the oldest compatible group waits up to the default **15-second** search window, then missing slots become actual server-simulated bots, not fake human players.
- New compatible queued players/parties can join a running same-mode match by replacing distinct bots. Team capacity and intact parties are preserved.
- Humans who leave are replaced by bots. Full, ended or incompatible rooms are not backfilled.
- The queue display shows people searching that mode, time elapsed and the bot-fill countdown. It does not claim to show a global population.
- A completed queued match shows results, then returns players to their **same party** after 12 seconds or **Return to Party**. Members ready up again and the leader starts the next search. Queued matches do not auto-start another round without the leader.
- Quitting an unfinished match removes that player from the party. Mid-match reconnect restoration is not included.

### Custom rooms and connection requirements

The expandable **Custom Rooms** section preserves the old room browser, host settings and six-character codes for solo operators. Custom rooms are separate from party matchmaking; queue rooms cannot be entered using codes. Existing custom-room round auto-restart remains unchanged.

All players must open the **same running server's web address** and sign in to separate accounts. For a LAN, share `http://YOUR-LAN-IP:3000`; allow that port through the host firewall. **Your friend's localhost is their computer, not yours.** To test two accounts locally, use separate browser profiles or a private window. One account has one active game socket; connecting it elsewhere disconnects its old socket with a clear message.

Internet play needs HTTPS, WSS upgrade support and persistent server storage. Set `COOKIE_SECURE=1` when serving behind your trusted HTTPS proxy. No hosting, public domain, global player network or third-party matchmaking service is bundled. A static hosting page alone cannot run this backend. Practice still uses local bots after account login; pause freezes practice only.

## Controls

| Action | Default |
| --- | --- |
| Move | WASD |
| Aim / shoot | Mouse / left mouse |
| Aim down sights | Right mouse |
| Sprint | Left Shift |
| Tactical sprint | Left Alt, or double-tap Shift |
| Crouch | Hold Left Ctrl |
| Prone | Z (toggle) |
| Jump | Space |
| Slide | C while moving fast, or crouch while sprinting |
| Reload | R |
| Primary / sidearm / knife | 1 / 2 / 3 |
| Switch primary and sidearm | Q |
| Cycle weapons | Mouse wheel |
| Quick melee | V |
| Throw frag | G |
| Scoreboard | Hold Tab |
| Pause / release capture | Escape |

Settings includes rebinding, sensitivity, inverted Y, FOV, graphics quality, reduced camera motion, master volume, effects and ambience. If mouse capture is restricted, move the cursor over the arena to aim; local fullscreen play is recommended.

## Match rules

- **Team Deathmatch:** first team to 40 eliminations, or the higher score at the time limit.
- **Free For All:** first operator to 25 eliminations, or the highest kill count at the time limit.
- **Domination:** capture A, B and C by standing inside their rings. Each held zone awards one team point per second; first to 150 wins. Opponents contest capture, and up to two teammates accelerate it.
- Ties at the time limit are draws. Custom rooms start another round after 12 seconds; queued matches return to the party lobby for a fresh leader-started search.
- Operators spawn with 100 health and 50 armor. Health regenerates after 4.5 seconds without damage. Respawns take three seconds, followed by 1.5 seconds of protection; attacking cancels protection.
- Green supply beacons refill reserve ammunition, armor and a frag, with a 20-second personal cooldown. Reloading is still required.
- Frag grenades have a 2.1-second fuse and 6.5-metre blast radius. Cover blocks the blast; your own grenade can hurt you. Friendly fire is disabled.

## Weapons, characters and progression

The armory contains two assault rifles, two SMGs, a shotgun, a sniper rifle, two pistols and a knife. Each has its own damage, range falloff, fire interval, spread, recoil, magazine, reserve, reload and movement multiplier. See `shared/weapons.js` for exact statistics. Semi-automatic weapons require separate clicks. The sniper gains a scope while aiming.

Equip a primary and sidearm in Loadout or Weapons before deploying. The three operator skins are cosmetic; hitboxes and stats are identical. Every weapon is available immediately.

Account identity and credentials are stored on the server. Completed-match history, XP, loadout, selected character, settings and profile stats are stored in the private server `profiles.json` under the permanent account ID, while a local cache provides offline/fallback continuity. Clearing site storage does not delete the server profile. History retains the last 50 completed matches and supports CSV export. Quitting early does not record a completed match.

## Project structure

```text
hamu-master/
├── index.html
├── client/
│   ├── social-ui.js     # Search, profiles, friends, invites and ready lobby
│   ├── social.css       # Social/party/queue responsive styling
│   ├── auth.js          # Registration wizard, login and session checks
│   ├── auth.css         # Responsive account access screens
│   ├── main.js          # Account-gated boot and component wiring
│   ├── ui.js            # Functional menus, lobby, settings, results
│   ├── styles.css       # Responsive menu and HUD styling
│   ├── game.js          # Client loop, practice, prediction/interpolation
│   ├── renderer.js      # WebGL scenes and first-person view
│   ├── geometry.js      # Original map, operator and weapon geometry
│   ├── effects.js       # Pooled tracers, impacts, blasts and grenades
│   ├── input.js         # Captured mouse and customizable keyboard controls
│   ├── audio.js         # Procedural Web Audio sounds
│   ├── hud.js           # HUD, minimap, kill feed and scoreboard
│   ├── network.js       # WebSocket transport and room connection
│   ├── storage.js       # Browser-local settings/profile/history
│   └── icons.js         # Original vector illustrations
├── shared/
│   ├── weapons.js       # Weapon catalog, loadout rules, modes, operators
│   ├── map.js           # Original Foundry map and collision geometry
│   ├── physics.js       # Shared movement, ray tests, navigation
│   ├── simulation.js    # Authority: combat, bots, objectives, respawns
│   └── protocol.js      # Packet schema and input validation
├── server/
│   ├── social.js        # Durable symmetric friends and pending requests
│   ├── matchmaking.js   # Party lifecycle, FIFO queue, team packing and bots
│   ├── auth.js          # Durable accounts, scrypt, cookies and API
│   ├── server.js        # HTTP + authenticated WebSocket room server
│   ├── static.js        # Public-file allowlist
│   └── client.js        # Complete server on alternate port
├── assets/              # Original SVGs and licensed local fonts
├── vendor/              # Local rendering/styles libraries and licenses
├── scripts/check.js     # Syntax and local dependency checks
├── tests/               # Automated simulation and WebSocket integration tests
├── package.json
└── package-lock.json
```

## Verification and performance

```sh
npm run check
npm test
```

The repository contains automated gameplay, account, social, authorization, matchmaking and WebSocket integration coverage. This 1.2.3 release adds the Quick Play server queue and persistent per-account game profiles, while retaining the non-greedy queue-packing regression fix. The historical browser-check count from earlier builds is not treated as current verification: browser/multi-client checks must be rerun after dependencies are installed. UI-focused multi-account browser tests are not an FPS benchmark. This remains a lightweight playable foundation, not a claim of exhaustive testing on every device.

This release (1.2.3) keeps the existing server architecture and runs fixed 60 Hz simulation, sends compact array snapshots at 20 Hz, and accepts client intentions at approximately 30 Hz. Clients predict local movement and interpolate remote movement. Static meshes are combined by material; short-lived visual effects use fixed pools. Rooms are bounded to eight operators.

Actual FPS depends on GPU, resolution and browser configuration. Use **Low** graphics on integrated GPUs or software rendering, then increase quality if smooth. No hardware-independent frame-rate guarantee is made. This build uses simple placeholder geometry and no physics-heavy destruction or expensive post-processing.

## Operational limits

This remains one Node.js process with durable atomic JSON storage for accounts and social relationships, and in-memory parties, invitations, queues and matches. Default room limit is 32, active socket limit 128 and per-direct-IP connection limit 16. These are safeguards, not a load-tested player-capacity guarantee. Server restarts preserve accounts/friends/requests but end parties, invites, queues and matches. No horizontal scaling, region selection, ranked matchmaking, messaging, block/report system, voice chat or reconnect-to-match restoration is included. Add database-backed storage, moderation, broader abuse controls and load testing before public-scale use.

Matchmaking defaults are configurable through `createGameServer({queueWaitMs, inviteTtlMs, matchmakingIntervalMs, maxRooms})`; gameplay and presence remain server-authorized.

## Security / scope

The server owns position updates, collision, damage, ammo, fire cadence, respawns and scoring. It checks finite values, flags, slots, monotonic sequence numbers, message sizes and message rates; clients cannot submit trusted hit, damage or teleport events. Static serving excludes server source and private files.

This is not industrial anti-cheat or a large-scale production account service. Authentication is included, but there is no full-disk/database encryption, ranked matchmaking, voice chat, lag-compensated historical hit rewind, reconnect restoration or horizontal server scaling. Password hashes are protected from HTTP access, but the host must secure the disk and backups. Shared snapshots include opponents' state, so a modified client could build a wallhack. Use HTTPS/WSS, an origin allowlist, a reverse proxy and stronger abuse controls before exposing a public server.

See `THIRD_PARTY_NOTICES.md` and `vendor/licenses/` for dependency licensing.

## Regional Multiplayer Foundation (V33.5)

V33.5 keeps the existing authoritative WebSocket multiplayer intact and adds a non-destructive regional-server foundation. Each deployment can now identify itself with `REGION_ID` and `SERVER_ID`, expose `/health`, `/ready`, and `/api/region`, and advertise its public HTTP/WebSocket address. `MAX_CLIENTS` is configurable per server.

This is intentionally a foundation rather than a fake claim of worldwide scale: true cross-region matchmaking and shared account state require a shared coordination/database layer (for example Redis + PostgreSQL) and deployment of multiple persistent game-server instances. The existing JSON stores remain unchanged in this update so current accounts/features are not migrated or risked.

For local multi-region simulation, use `docker-compose.regions.yml` to run two Asia instances and one Europe instance. The gameplay simulation remains authoritative inside each game-server process.

See `.env.example` for deployment variables.
