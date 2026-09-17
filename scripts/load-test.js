import WebSocket from 'ws';
import { performance } from 'node:perf_hooks';

const base=process.env.HAMU_WS_URL||'ws://127.0.0.1:3000/ws';
const n=Math.max(1,Math.min(128,Number(process.env.LOAD_CLIENTS)||16));
const durationMs=Math.max(1000,Math.min(120000,Number(process.env.LOAD_DURATION_MS)||30000));
const cookie=process.env.HAMU_SESSION_COOKIE||'';
const latencies=[];let opened=0,closed=0,errors=0,messages=0;
const sockets=[];
const start=performance.now();
function one(){return new Promise(resolve=>{const ws=new WebSocket(base,{headers:cookie?{Cookie:cookie}:{}});sockets.push(ws);let pingAt=0,done=false;const finish=()=>{if(done)return;done=true;resolve();};ws.on('open',()=>{opened++;pingAt=performance.now();ws.send(JSON.stringify({t:'ping',at:pingAt}));});ws.on('message',raw=>{messages++;try{const d=JSON.parse(raw);if(d.t==='pong'&&Number.isFinite(d.at)){latencies.push(performance.now()-d.at);if(performance.now()-start<durationMs){setTimeout(()=>{if(ws.readyState===WebSocket.OPEN){pingAt=performance.now();ws.send(JSON.stringify({t:'ping',at:pingAt}));}},100);}}}catch{errors++;}});ws.on('error',()=>{errors++;});ws.on('close',()=>{closed++;finish();});setTimeout(()=>{if(ws.readyState===WebSocket.OPEN)ws.close(1000,'load-test');else finish();},durationMs);});}
await Promise.all(Array.from({length:n},one));
latencies.sort((a,b)=>a-b);const pct=p=>latencies.length?latencies[Math.min(latencies.length-1,Math.floor(latencies.length*p))]:null;
const elapsed=(performance.now()-start)/1000;
console.log(JSON.stringify({clients:n,durationSeconds:elapsed,opened,closed,errors,messages,rps:Number((messages/elapsed).toFixed(2)),p50Ms:pct(.50)&&Number(pct(.50).toFixed(2)),p95Ms:pct(.95)&&Number(pct(.95).toFixed(2)),p99Ms:pct(.99)&&Number(pct(.99).toFixed(2))},null,2));
