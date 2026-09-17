# HAMU MASTER — one public Vercel URL + one persistent Node backend

## Architecture

- **Vercel:** serves the existing browser FPS from one website URL.
- **Render Web Service:** runs the existing authoritative Node.js HTTP + WebSocket server continuously while the service is awake. Players never type this backend address; it is stored in the public `public-config.js` file.
- **Supabase Postgres:** durable managed PostgreSQL state for accounts, sessions, friends/social state and progression snapshots. The Supabase service-role key stays only on the backend.
- **Redis / multiple regions:** NOT required for the basic public game. The existing regional foundation remains optional.

Vercel is deliberately not used as the authoritative long-running game server. Vercel itself now has WebSocket support in beta, but persistent FPS simulation is kept on the dedicated Node service by design.

## 1. Create managed PostgreSQL

1. Create a Supabase project.
2. Open the SQL Editor.
3. Run `deployment/POSTGRES-SCHEMA.sql`.
4. In Project Settings, copy the project URL.
5. Create/copy the backend-only service-role key.
6. **Never put the service-role key into Vercel or `public-config.js`.**

Free Supabase currently includes a dedicated Postgres database with a **500 MB database-size quota**, **1 GB storage**, **5 GB egress**, and **2 free projects**. Free projects can be paused after 1 week of inactivity. Automatic database backups are not included on the Free plan. These limits are current as checked on 2026-09-17; they can change. See the current Supabase pricing page before launch.

## 2. Deploy the persistent Node backend on Render

1. Push this project to a private GitHub repository.
2. In Render, choose **New → Web Service** and connect the repository.
3. Choose the Docker deployment path. The included `Dockerfile` is the authoritative backend image.
4. Use the included `render.yaml` as the starting configuration, or set the same variables manually.
5. Set these backend variables:

```text
PORT=10000
HOST=0.0.0.0
COOKIE_SECURE=1
RECONNECT_GRACE_MS=30000
ALLOWED_ORIGINS=https://YOUR-GAME.vercel.app
PUBLIC_HTTP_URL=https://YOUR-BACKEND.onrender.com
PUBLIC_WS_URL=wss://YOUR-BACKEND.onrender.com/ws
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_PRIVATE_SERVICE_ROLE_KEY
HAMU_DB_TABLE=hamu_state
```

6. Deploy and open:

```text
https://YOUR-BACKEND.onrender.com/health
```

It should return JSON with `ok: true`.

### Render Free-tier reality

Render currently offers Free web services, but they are **not production/always-on guarantees**. A Free web service spins down after **15 minutes without inbound HTTP requests or inbound WebSocket messages** and takes about a minute to wake on the next request/connection. Free services receive **750 instance-hours per workspace per calendar month**; if those are exhausted, free services are suspended until the next month. Free services have ephemeral filesystems, so this build uses Supabase Postgres rather than trusting local disk for durable accounts. Render also says Free services may restart at any time and do not support scaling beyond one instance or persistent disks.

Render's current documentation says no credit card is required to deploy the Free service, but usage beyond included limits can be billed if a payment method is present; without a payment method, Render suspends affected free services instead. Limits can change, so re-check Render's Free documentation before publishing widely.

For real always-on public play, upgrade the backend to a paid persistent service.

## 3. Deploy the one Vercel game URL

1. Import the same GitHub repository into Vercel.
2. No backend/serverless WebSocket deployment is needed on Vercel.
3. Before deploying, edit `public-config.js`:

```js
window.HAMU_PUBLIC_CONFIG = {
  apiBaseUrl: 'https://YOUR-BACKEND.onrender.com',
  wsUrl: 'wss://YOUR-BACKEND.onrender.com/ws'
};
```

4. Deploy the project.
5. Vercel gives you one URL such as:

```text
https://hamu-master-xxxxx.vercel.app
```

6. Put that exact Vercel origin into the backend `ALLOWED_ORIGINS` variable.
7. Redeploy the Render backend after changing `ALLOWED_ORIGINS`.

Players only open the Vercel URL. They do **not** enter `wss://...`, a port, a LAN IP, or your PC address.

## 4. HTTPS / WSS / cookies

The browser uses HTTPS on Vercel and WSS to the backend. The backend sets `Secure` cookies and uses `SameSite=None` when the configured Vercel origin is cross-origin. HTTP API requests use `credentials: include` and the backend returns an exact allowed-origin CORS header. WebSocket upgrades are checked against the same allow-list.

## 5. Legacy account migration

The original private JSON store is still supported locally. If the deployment data directory is empty and the project contains the legacy `data/` store, the server copies the existing store instead of deleting or replacing it. When managed PostgreSQL is configured, the migrated JSON snapshot is then seeded into Postgres.

Do not commit private `data/`, backups, `.env` files or service-role keys. `.vercelignore` excludes private/runtime/backend material from the Vercel deployment without deleting it from your project ZIP.

## 6. Backups

The server still has its private local previous-good/manual backup mechanism. For the managed database, run:

```bash
SUPABASE_URL='https://YOUR-PROJECT.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='YOUR_PRIVATE_KEY' \
npm run data:managed-backup
```

The command writes JSON snapshots into a private local backup directory. Keep those backups outside the public Vercel project. The included Supabase Free plan does **not** provide automatic database backups, so manual backups are important.

## 7. Local smoke test

```bash
npm install
npm test
npm run check
```

For the included load tool:

```bash
HAMU_WS_URL='wss://YOUR-BACKEND.onrender.com/ws' \
LOAD_CLIENTS=16 \
LOAD_DURATION_MS=30000 \
npm run load:test
```

The load tool reports opened/closed sockets, errors, messages/sec and p50/p95/p99 ping latency. It is a test tool, not a production-capacity guarantee.

## 8. Final player flow

1. Friend A opens the Vercel URL.
2. Friend B opens the same Vercel URL from a different home/network.
3. Both create/log into their own accounts.
4. A adds/invites B through the existing Friends/Party UI.
5. The party leader starts Find Match.
6. Both clients connect directly to the configured persistent backend automatically.
7. The authoritative server runs the existing simulation, weapons, maps, bots and modes.
8. If a socket is interrupted, the browser retries automatically. When `RECONNECT_GRACE_MS` is active, the backend can restore the same player into the live room during the grace period.

## Important limits

This setup is a complete public-deployment path, not a promise of free forever, global low latency, zero downtime or production-scale capacity. The recommended free configuration is suitable for testing/hobby use and can sleep. Multi-region Redis coordination is optional and not required for basic play.
