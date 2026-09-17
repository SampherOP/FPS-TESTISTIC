import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {shouldOpenBrowser} from '../server/server.js';

test('npm start opts into browser opening without install-time side effects',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(pkg.scripts.start,'node server/server.js --open-browser');
 for(const hook of ['preinstall','install','postinstall'])assert.equal(pkg.scripts[hook],undefined);
 assert.equal(pkg.scripts.server,'node server/server.js');
});

test('npm start opens browser on Windows; launcher still supported; opt-out works',()=>{
 assert.equal(shouldOpenBrowser({platform:'win32',args:['node','server/server.js','--open-browser'],env:{}}),true);
 assert.equal(shouldOpenBrowser({platform:'win32',args:[],env:{HM_OPEN_BROWSER:'1'}}),true);
 assert.equal(shouldOpenBrowser({platform:'win32',args:[],env:{}}),false);
 assert.equal(shouldOpenBrowser({platform:'win32',args:['--open-browser'],env:{HM_OPEN_BROWSER:'0'}}),false);
 assert.equal(shouldOpenBrowser({platform:'linux',args:['--open-browser'],env:{}}),false);
});
