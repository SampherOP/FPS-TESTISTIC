# HAMU MASTER — tested vs pending

## Static/code checks completed in this build

- Node syntax check across all non-vendor JavaScript files: **PASS**.
- `server/server.js` syntax check: **PASS**.
- `client/network.js` syntax check: **PASS**.
- `scripts/load-test.js` syntax check: **PASS**.
- `tests/public-play-foundation.test.js` syntax check: **PASS**.
- Vercel public configuration file present: **PASS**.
- Dockerfile for persistent Node backend present: **PASS**.
- Render deployment manifest present: **PASS**.
- Managed PostgreSQL schema present: **PASS**.
- `.vercelignore` excludes backend/runtime/private data from the Vercel deployment: **PASS**.

## Tests that could not honestly be executed in this environment

`npm ci` / the WebSocket integration suite was blocked because the execution environment has no cached copy of the `ws` package and cannot download it from npm. Therefore the following are **PENDING**, not claimed as passed:

- Two distinct browser accounts joining the same live match.
- Real WebSocket party/invite flow after the deployment changes.
- Live firing/damage through two client sockets.
- Disconnect/reconnect restoration through the browser transport.
- Saved progression across a real process restart with managed PostgreSQL.
- Render HTTPS/WSS deployment smoke test.
- Supabase Postgres hydration/seed test against a real project.
- Production Internet load-test results.

The project includes `tests/public-play-foundation.test.js` covering the intended two-account party, authoritative damage, saved profile and reconnect behavior once dependencies are installed.

## What is deliberately not claimed

- No claim of free-forever hosting.
- No claim of worldwide production readiness.
- No claim that Render Free is always-on.
- No claim of a completed production load test.
- No claim that Vercel is the authoritative game server.
