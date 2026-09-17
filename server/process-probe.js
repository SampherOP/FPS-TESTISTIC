import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import win32Path from 'node:path/win32';

const execFile = promisify(nodeExecFile);
const MAX_PID = 2147483647;
const COMMAND_OPTIONS = { timeout: 5000, maxBuffer: 16 * 1024 * 1024, windowsHide: true };

function validPid(pid) {
  return Number.isInteger(pid) && pid >= 1 && pid <= MAX_PID;
}

function outputOf(value) {
  return typeof value === 'string' ? value : value instanceof Buffer ? value.toString('utf8') : '';
}

function parseCsvRow(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; }
        else { quoted = false; afterQuote = true; }
      } else field += ch;
    } else if (afterQuote) {
      if (ch !== ',') return null;
      fields.push(field); field = ''; afterQuote = false;
    } else if (ch === '"') {
      if (field.length !== 0) return null;
      quoted = true;
    } else if (ch === ',') {
      fields.push(field); field = '';
    } else field += ch;
  }
  if (quoted) return null;
  fields.push(field);
  return fields.length === 5 ? fields : null;
}

function tasklistResult(stdout, targetPid, currentPid) {
  const text = outputOf(stdout);
  if (!text || /[^\r\n]$/.test(text) === false && text.trim() === '') return 'unknown';
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (!lines.length) return 'unknown';
  let currentFound = false;
  let targetFound = false;
  for (const line of lines) {
    if (!line) return 'unknown';
    const fields = parseCsvRow(line);
    if (!fields || !/^\d+$/.test(fields[1].trim())) return 'unknown';
    const pid = Number(fields[1].trim());
    if (!Number.isSafeInteger(pid)) return 'unknown';
    if (pid === currentPid) currentFound = true;
    if (pid === targetPid) targetFound = true;
  }
  return currentFound ? (targetFound ? 'alive' : 'dead') : 'unknown';
}

async function command(runCommand, file, args) {
  try {
    const result = await runCommand(file, args, { ...COMMAND_OPTIONS });
    if (!result || outputOf(result.stderr) !== '') return null;
    return { stdout: outputOf(result.stdout) };
  } catch (error) {
    return null;
  }
}

/** Probe a PID without ever terminating it; unknown is intentionally conservative. */
export async function probeProcess(pid, options = {}) {
  if (!validPid(pid)) return 'unknown';
  const platform = options.platform ?? process.platform;
  const kill = options.kill ?? ((value, signal) => process.kill(value, signal));
  try {
    kill(pid, 0);
    return 'alive';
  } catch (error) {
    if (error?.code === 'ESRCH') return 'dead';
    if (platform !== 'win32') return 'unknown';
  }

  const runCommand = options.runCommand ?? ((file, args, commandOptions) => execFile(file, args, commandOptions));
  const systemRoot = options.systemRoot ?? process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';
  const currentPid = options.currentPid ?? process.pid;
  if (!validPid(currentPid)) return 'unknown';
  const powershell = win32Path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = `try { $p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction Stop; if ($null -ne $p) { Write-Output HM_PROCESS_ALIVE } else { Write-Output HM_PROCESS_DEAD } } catch { exit 1 }`;
  const ps = await command(runCommand, powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script]);
  if (ps && (ps.stdout.trim() === 'HM_PROCESS_ALIVE' || ps.stdout.trim() === 'HM_PROCESS_DEAD')) return ps.stdout.trim() === 'HM_PROCESS_ALIVE' ? 'alive' : 'dead';

  const tasklist = win32Path.join(systemRoot, 'System32', 'tasklist.exe');
  const task = await command(runCommand, tasklist, ['/FO', 'CSV', '/NH']);
  if (!task) return 'unknown';
  return tasklistResult(task.stdout, pid, currentPid);
}

export default probeProcess;
