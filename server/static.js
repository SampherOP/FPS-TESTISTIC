import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.glb':'model/gltf-binary'};
const PUBLIC=/^\/(?:index\.html|client\/|shared\/|assets\/|vendor\/)/;
export function staticHandler(root) {
  const base=resolve(root);
  return async (req,res)=> {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
    let pathname;
    try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end('Bad URL');return;}
    if(pathname==='/')pathname='/index.html';
    if(!PUBLIC.test(pathname)||pathname.includes('\0')||pathname.includes('\\')){res.writeHead(404);res.end('Not found');return;}
    const file=resolve(base,'.'+pathname);
    if(!file.startsWith(base+sep)){res.writeHead(403);res.end('Forbidden');return;}
    try {
      const info=await stat(file);if(!info.isFile())throw new Error('Not a file');
      res.writeHead(200,{'Content-Type':MIME[extname(file)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache'});
      if(req.method==='HEAD')res.end();else createReadStream(file).on('error',()=>res.destroy()).pipe(res);
    }catch{res.writeHead(404);res.end('Not found');}
  };
}
