import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersistentDataStore } from '../server/data-store.js';
import { probeProcess } from '../server/process-probe.js';

for (const status of ['dead','alive','unknown']) {
  test(`Windows EPERM + OS status ${status}: recover only confirmed abandoned lock, preserve all data`, async t => {
    const base=await mkdtemp(join(tmpdir(),'hamu-win-start-'));
    const dir=join(base,'private'); await mkdir(dir);
    t.after(()=>rm(base,{recursive:true,force:true}));
    const saved={
      'accounts.json':'{"version":1,"users":[{"id":"permanent-player"}]}\n',
      'sessions.json':'{"version":1,"sessions":{}}\n',
      'profiles.json':'{"version":1,"profiles":{"permanent-player":{"xp":123}}}\n',
      'social.json':'{"version":1,"friends":{},"requests":{}}\n',
      'admin-secret.json':'{"version":1,"sentinel":"preserve-verifier"}\n'
    };
    for(const [file,contents] of Object.entries(saved))await writeFile(join(dir,file),contents);
    const lock='HAMU MASTER data-store lock\r\npid=11236\r\nhostname=windows-host\r\nowner='+ 'a'.repeat(32)+'\r\nstarted=2026-09-15T11:00:00.000Z\r\n';
    await writeFile(join(dir,'.hamu-store.lock'),lock);
    const store=new PersistentDataStore({root:join(base,'project'),dataDir:dir,migrateLegacy:false,hostname:'windows-host',pidProbe:pid=>probeProcess(pid,{
      platform:'win32',currentPid:9999,
      kill:()=>{throw Object.assign(new Error('EPERM'),{code:'EPERM'});},
      runCommand:async()=>{if(status==='unknown')throw new Error('Windows query unavailable');return {stdout:status==='dead'?'HM_PROCESS_DEAD\r\n':'HM_PROCESS_ALIVE\r\n',stderr:''};}
    })});
    t.after(()=>store.close());
    if(status==='dead') {
      await store.ready;
      assert.notEqual(await readFile(join(dir,'.hamu-store.lock'),'utf8'),lock);
    } else {
      await assert.rejects(store.ready,status==='alive'?/still running/:/could not be proven stopped/);
      await store.close();
      assert.equal(await readFile(join(dir,'.hamu-store.lock'),'utf8'),lock);
    }
    for(const [file,contents] of Object.entries(saved))assert.equal(await readFile(join(dir,file),'utf8'),contents,file);
    await store.close();
  });
}

test('default store probe recognizes current process', async()=>{
  assert.equal(await PersistentDataStore.defaultPidProbe(process.pid),'alive');
});

test('launcher does not kill processes or hide a failed startup', async()=>{
  const bat=await readFile(new URL('../start.bat',import.meta.url),'utf8');
  assert.doesNotMatch(bat,/taskkill|netstat|start\s+"HAMU MASTER SERVER"|\/b cmd/i);
  assert.match(bat,/set "HM_OPEN_BROWSER=1"/);
  assert.match(bat,/node server\\server\.js/);
  assert.match(bat,/Keep this window open/);
  assert.match(bat,/pause/);
});

test('Windows OS queries are read-only and fail closed on misleading output', async()=>{
  const options={platform:'win32',currentPid:100,kill:()=>{throw Object.assign(new Error('denied'),{code:'EPERM'});}};
  for(const output of [
    {stdout:'HM_PROCESS_DEAD',stderr:'Access denied'},
    {stdout:'HM_PROCESS_DEAD\nERROR',stderr:''},
    {stdout:'',stderr:''},
    {stdout:'INFO: No tasks are running which match the specified criteria.\n',stderr:''},
    {stdout:'"node.exe","100","Console","1","1 K"\n"truncated',stderr:''}
  ]){
    assert.equal(await probeProcess(11236,{...options,runCommand:async(file,args)=>{
      assert.doesNotMatch(args.join(' '),/Stop-Process|taskkill|Remove-Item|Invoke-Expression/i);
      return output;
    }}),'unknown');
  }
});
