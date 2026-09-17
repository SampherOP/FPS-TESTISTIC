// All-in-one browser/game server on port 5173. It serves the client and authenticated multiplayer API/WS.
import { createGameServer } from './server.js';

const app = createGameServer();
const port = Number(process.env.CLIENT_PORT) || 5173;
app.start({ port, host: process.env.HOST || '0.0.0.0' }).then(address => {
  console.log(`HAMU MASTER: http://localhost:${address.port}`);
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
