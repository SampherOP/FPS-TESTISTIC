import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('replaced session shows warning with a five-second countdown before login reload', async () => {
  const [main, css, network, auth] = await Promise.all([
    readFile(new URL('../client/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../client/auth.css', import.meta.url), 'utf8'),
    readFile(new URL('../client/network.js', import.meta.url), 'utf8'),
    readFile(new URL('../client/auth.js', import.meta.url), 'utf8')
  ]);
  assert.match(network, /event\.code===4003/);
  assert.match(main, /sessionNotice','replaced/);
  assert.match(main, /location\.replace/);
  assert.match(css, /auth-session-timer 5s linear/);
  assert.match(css, /\.auth-session-notice/);
  assert.match(auth, /ANOTHER PLAYER HAS LOGGED IN TO YOUR ACCOUNT/);
  assert.match(auth, /let remaining=5/);
  assert.match(auth, /notice\.remove/);
});
