# HAMU MASTER — MANUAL TEST CHECKLIST

Use only temporary fake accounts. Never use production/private account data.

## A. Install and upgrade

### A1 — clean install
- [ ] Extract ZIP to a new folder.
- [ ] Confirm Node 20+.
- [ ] Run `npm install`.
- [ ] Run `npm run check`.
- [ ] Run `npm test`.
- [ ] Run `npm start`.
- [ ] Open `http://localhost:3000`.
- Expected: registration gate appears; no console/server fatal errors.

### A2 — upgrade
1. Stop the old server.
2. Back up the old private `data/` directory.
3. Extract this release separately.
4. Copy the old `data/` directory into the new project, or point both releases at the same private `HAMU_DATA_DIR`.
5. Start only the new server.
- [ ] Existing account can log in.
- [ ] Existing friend relationship remains.
- [ ] Existing pending request remains if applicable.
- [ ] No account IDs are regenerated.
- [ ] Do not test with live/private accounts if this ZIP is being shared.

## B. Account flow

- [ ] First visit requires registration.
- [ ] Valid unique name → password → confirmation → account → menu.
- [ ] Empty/invalid name rejected.
- [ ] Name boundary below/above 3–18 rejected.
- [ ] Case-insensitive duplicate rejected.
- [ ] Password below 8 rejected.
- [ ] Confirmation mismatch rejected.
- [ ] Wrong password rejected.
- [ ] Repeated Create/Login submit does not create duplicates.
- [ ] Logout returns to access gate.
- [ ] Reload preserves a valid session.
- [ ] Invalid/expired session returns cleanly to login.
- [ ] Server restart preserves account and friendships.

## C. Player A/B social test

Use two separate browser profiles.

### C1 — search/profile
**Player A**
1. Log in.
2. Open Multiplayer.
3. Search Player B using at least two characters.
4. Test exact and partial case-insensitive search.
5. Open B's profile.

Expected:
- Correct B profile.
- No password/hash/token/private data.
- Local XP is not presented as a verified online rank.

### C2 — friend request
**A:** Add B.

**B:** Open Pending → Accept.

Expected:
- Both Friends lists update.
- Presence updates without refresh.

Repeat:
- Decline.
- Sender Cancel.
- Duplicate request.
- Self request.
- Already-friend request.
- Unauthorized/stale request action.

### C3 — offline recipient
**A:** Send request while B is logged out.

**B:** Log in later.

Expected: request appears and can be accepted.

### C4 — remove friend
Remove from A's profile.

Expected: friendship disappears for both; old party invite based on that relationship cannot be consumed.

## D. Party / leadership

**Player A = leader; Player B = member.**

1. A invites B.
2. B accepts.
3. Confirm one shared party.
4. B Ready.
5. A tries Find Match before B is ready → reject.
6. B Cancel Ready → queue cannot remain active.
7. B Ready again.
8. A changes loadout before search.
9. Confirm B's readiness resets when their loadout changes.
10. A starts matchmaking.

Expected:
- Only A can invite, change mode and start matchmaking.
- B can Ready/Cancel Ready.
- Server rejects forged/non-leader operations.

### D1 — leadership transfer
- Disconnect/leave A.
- Expected: oldest remaining member becomes leader.
- Expected: readiness resets for the new party as documented.
- New leader can manage the party.

### D2 — capacity
- TDM/DOM: attempt to exceed 4 party members → reject.
- FFA: allow up to 8.
- Create an FFA party of 5+ and try switching to TDM → reject atomically.

## E. Matchmaking matrix

Run each scenario with temporary accounts and the same server.

| Scenario | Expected |
|---|---|
| 8 compatible solos | Immediate match, 8 humans, 0 bots |
| 2+2+4 | One valid match, parties intact |
| 3+1+4 | One valid match, teams <=4 |
| 4+4 | One valid match |
| 3+3+2 | One valid match |
| TDM vs FFA queues | Never mixed |
| DOM vs TDM queues | Never mixed |
| Partial queue | Waits for configured window |
| Timeout | Missing slots become actual server bots |
| Repeat Find Match | No duplicate ticket |
| Cancel at timeout boundary | No ghost room/double assignment |
| Member leaves while searching | Whole party queue cancels |
| Member disconnects while searching | Whole party queue cancels |
| Human joins running match | Distinct bot is replaced |
| Two humans backfill | Two distinct bots replaced |
| Full room | No backfill |
| Ended room | No backfill |
| Incompatible party | Does not split |

For each match record:
- [ ] room ID
- [ ] human count
- [ ] bot count
- [ ] team counts
- [ ] queue timer
- [ ] party IDs
- [ ] player loadouts

## F. Actual match

- [ ] WASD movement.
- [ ] Mouse aim/shoot.
- [ ] ADS.
- [ ] Sprint.
- [ ] Crouch/slide.
- [ ] Reload.
- [ ] Damage/armor.
- [ ] Head/body hit behavior.
- [ ] Death and respawn.
- [ ] Scoreboard.
- [ ] TDM objective/end.
- [ ] DOM capture/contest/end.
- [ ] FFA score/end.
- [ ] Friendly fire remains disabled.
- [ ] Bots move, shoot, take damage, die and respawn.
- [ ] Bots are not presented as fake human accounts.

## G. Disconnect/reconnect

**Player A**
1. Join an active queued match.
2. Close the tab/network.
3. Reconnect/log in again.

Expected:
- No duplicate player/presence.
- No stuck queue state.
- Documented behavior is followed: interrupted queued match does not restore the old match.

**Player B**
- Disconnect while searching.
- Expected: party queue cancels for all members.

## H. Return flow

After a queued match ends:
- [ ] Results appear.
- [ ] Party returns together.
- [ ] Ready state is reset as documented.
- [ ] Leader must start a fresh search.
- [ ] No automatic unintended second match.

## I. Security/manual abuse checks

- [ ] Unauthenticated `/ws` rejected.
- [ ] Wrong browser origin rejected.
- [ ] Forged account ID rejected.
- [ ] Forged leader action rejected.
- [ ] Forged ready/team claims rejected.
- [ ] Malformed/oversized packets rejected.
- [ ] Input sequence replay rejected.
- [ ] HTML/script-like username is rendered as text.
- [ ] `/server/*` and `/data/*` are not publicly served.
- [ ] Passwords/tokens do not appear in API/profile/search responses.

## J. Responsive/device checks

Desktop:
- [ ] Chrome.
- [ ] Edge.
- [ ] Narrow window.
- [ ] Keyboard focus.
- [ ] Long names.
- [ ] Empty/loading/error states.

Phone/tablet:
- [ ] Login/registration.
- [ ] Scroll social panels.
- [ ] Search.
- [ ] Profile.
- [ ] Pending/friends/invites.
- [ ] Party controls.
- [ ] Touch gameplay buttons.
- [ ] Reconnect notice.

Record device/browser/OS and mark any failure. Do not claim these checks passed unless actually performed.

## K. LAN / same-server requirement

On host PC:
1. Start one server.
2. Find host LAN IP.
3. Allow port 3000 through the host firewall if necessary.
4. Give Player B `http://HOST-LAN-IP:3000`.

On Player B:
- [ ] Do NOT use `localhost`.
- [ ] Sign in with a separate account.
- [ ] Search/invite/party/match.

Expected: both clients share the same account registry and matchmaking server.

Internet deployment:
- HTTPS/WSS.
- Persistent private server data directory.
- `COOKIE_SECURE=1` behind trusted HTTPS.
- Reverse proxy/firewall configured.
- Never share `data/`.

## L. Soak test

Use synthetic accounts only.

- [ ] 4–16 temporary clients repeatedly join/cancel queues.
- [ ] Disconnect random clients.
- [ ] Reconnect.
- [ ] Start and finish matches.
- [ ] Observe queue ticket count, room count, client count and bot count.
- [ ] Confirm no unbounded growth over the test window.
- [ ] Record duration and client count.

This is a bounded local soak, not a production scalability/load-test claim.

## M. Quick Play live queue

**Player A only, signed into a temporary account.**

1. Open **QUICK PLAY**.
2. Select TDM, then press **FIND MATCH**.
3. Expected: the page changes to SEARCHING and shows elapsed time, same-mode searching population and the 15-second bot-fill countdown.
4. Open a second browser profile as Player B on the **same server URL** and queue TDM.
5. Expected: both clients report the same server queue population; they are eligible for the same TDM match.
6. Cancel from either applicable queue control.
7. Expected: the queue ticket disappears and the UI returns to FIND MATCH without a ghost ticket.
8. Repeat for FFA and Domination; confirm modes never mix.
9. With no other humans, wait through the configured 15-second window.
10. Expected: the server creates a match with real server-controlled bots filling missing slots.

**Do not call this a successful live queue test until the browser clients actually connect to the running server.**

## N. Persistent profile / upgrade test

Use a temporary account only.

1. On release N, choose a non-default character, primary weapon, sidearm and settings.
2. Complete at least one match so XP/history changes.
3. Stop the server and make a complete private `data/` backup.
4. Start the updated release using the copied data or the same `HAMU_DATA_DIR`.
5. Log into the same account.
6. Expected: same permanent Player ID/name, friends and pending requests remain; selected character, loadout, settings, XP/stats and history are restored.
7. Clear browser site storage without deleting server `data/`.
8. Log in again.
9. Expected: server profile restores the saved game state.
10. Inspect the private server data only on the host: `profiles.json` should contain account-keyed profile data but no password or session token.

Expected upgrade rule: **never delete or regenerate `accounts.json`, `social.json` or `profiles.json` during a normal upgrade.**
