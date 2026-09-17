#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PersistentDataStore, resolveDataDir, restoreBackup } from '../server/data-store.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const command = process.argv[2] || 'help';
const dataDir = resolveDataDir({ root });
if (command === 'location') {
  console.log(dataDir);
} else if (command === 'backup') {
  const store = new PersistentDataStore({ root });
  try { console.log(await store.backup(process.argv[3])); } finally { await store.close(); }
} else if (command === 'list') {
  const entries = await readdir(resolve(dataDir, 'backups'), { withFileTypes: true }).catch(() => []);
  console.log(entries.filter(x => x.isDirectory()).map(x => x.name).sort().join('\n'));
} else if (command === 'restore') {
  const name = process.argv[3];
  if (!name || !/^(?:manual-[A-Za-z0-9_-]{1,80}|previous-good)$/.test(name)) throw new Error('Usage: npm run data:restore -- BACKUP-NAME');
  await restoreBackup({ dataDir, backupDir: resolve(dataDir, 'backups', name) });
  console.log(`Restored ${name} into empty store ${dataDir}`);
} else {
  console.log('Account-data tool:\n  npm run data:location\n  npm run data:backup -- before-upgrade\n  npm run data:list\n  npm run data:restore -- manual-before-upgrade\n\nStop the server first. Restore refuses to overwrite non-empty data; move all four current JSON files aside first.');
}
