import test from 'node:test';
import assert from 'node:assert/strict';
import { probeProcess } from '../server/process-probe.js';

const win = { platform: 'win32', systemRoot: 'C:\\Windows', currentPid: 111 };
function killError(code) { return () => { const e = new Error(code); e.code = code; throw e; }; }
function csv(rows) { return rows.map(([name, pid, session = 'Console', no = '1', mem = '1 K']) => [name, pid, session, no, mem].map(String).map(v => `"${v.replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n'; }

 test('kill success and ESRCH do not query', async () => {
  let calls = 0;
  assert.equal(await probeProcess(22, { platform: 'win32', kill: () => {}, runCommand: () => { calls++; } }), 'alive');
  assert.equal(await probeProcess(22, { platform: 'win32', kill: killError('ESRCH'), runCommand: () => { calls++; } }), 'dead');
  assert.equal(calls, 0);
 });

test('Windows CIM sentinels and command safety options', async () => {
  const calls = [];
  const result = await probeProcess(222, { ...win, kill: killError('EPERM'), runCommand: async (file, args, options) => {
    calls.push({ file, args, options });
    return { stdout: 'HM_PROCESS_ALIVE\r\n', stderr: '' };
  } });
  assert.equal(result, 'alive');
  assert.match(calls[0].file, /WindowsPowerShell\\v1\.0\\powershell\.exe$/);
  assert.deepEqual(calls[0].args.slice(0, 3), ['-NoLogo', '-NoProfile', '-NonInteractive']);
  assert.equal(calls[0].options.timeout, 5000);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.maxBuffer, 16 * 1024 * 1024);
  assert.match(calls[0].args[4], /Get-CimInstance Win32_Process/);
});

test('CIM dead sentinel is returned', async () => {
  assert.equal(await probeProcess(222, { ...win, kill: killError('EINVAL'), runCommand: async () => ({ stdout: 'HM_PROCESS_DEAD\n', stderr: '' }) }), 'dead');
});

test('bad CIM falls back to strict tasklist and localized rows work', async () => {
  const calls = [];
  const result = await probeProcess(222, { ...win, kill: killError('EPERM'), runCommand: async (file) => {
    calls.push(file);
    if (file.endsWith('powershell.exe')) return { stdout: 'localized noise', stderr: '' };
    return { stdout: csv([['应用程序.exe', 111], ['目标.exe', 222]]), stderr: '' };
  } });
  assert.equal(result, 'alive');
  assert.equal(calls.length, 2);
  assert.match(calls[1], /System32\\tasklist\.exe$/);
});

test('tasklist requires current row and complete output', async () => {
  const base = { ...win, kill: killError('EPERM') };
  const noCurrent = await probeProcess(222, { ...base, runCommand: async file => file.endsWith('powershell.exe') ? Promise.reject(new Error('missing')) : ({ stdout: csv([['x', 222]]), stderr: '' }) });
  assert.equal(noCurrent, 'unknown');
  const absent = await probeProcess(222, { ...base, runCommand: async file => file.endsWith('powershell.exe') ? Promise.reject(new Error('missing')) : ({ stdout: csv([['x', 111]]), stderr: '' }) });
  assert.equal(absent, 'dead');
  const malformed = await probeProcess(222, { ...base, runCommand: async file => file.endsWith('powershell.exe') ? Promise.reject(new Error('missing')) : ({ stdout: '"x","111"\r\n', stderr: '' }) });
  assert.equal(malformed, 'unknown');
});

test('both Windows queries failing are unknown; Linux never falls back', async () => {
  let calls = 0;
  assert.equal(await probeProcess(222, { ...win, kill: killError('EPERM'), runCommand: async () => { calls++; throw new Error('no'); } }), 'unknown');
  assert.equal(await probeProcess(222, { platform: 'linux', kill: killError('EPERM'), runCommand: async () => { calls++; } }), 'unknown');
  assert.equal(calls, 2);
});

test('invalid PIDs are refused without kill or commands', async () => {
  let calls = 0;
  for (const pid of [0, -1, 1.5, 2147483648, '22', NaN]) {
    assert.equal(await probeProcess(pid, { platform: 'win32', kill: () => { calls++; }, runCommand: () => { calls++; } }), 'unknown');
  }
  assert.equal(calls, 0);
});
