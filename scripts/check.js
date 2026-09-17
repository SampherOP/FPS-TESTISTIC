import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let count=0;
for(const folder of ['client','shared','server','scripts','tests']) {
  for(const entry of await readdir(resolve(root,folder),{withFileTypes:true})) {
    if(!entry.isFile()||!entry.name.endsWith('.js'))continue;
    const file=resolve(root,folder,entry.name);
    const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
    if(result.status!==0){console.error(result.stderr||result.error);process.exit(1);}
    const source=await readFile(file,'utf8');
    for(const match of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      try{await access(resolve(dirname(file),match[1]));}catch{throw new Error(`Missing local module ${match[1]} in ${folder}/${entry.name}`);}
    }
    count++;
  }
}
const html=await readFile(resolve(root,'index.html'),'utf8');
for(const match of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g))await access(resolve(root,match[1]));
console.log(`PASS: ${count} JavaScript modules parse; local imports and HTML assets exist.`);
