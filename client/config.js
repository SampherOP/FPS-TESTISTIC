// Public deployment configuration. This file may be safely committed to Vercel:
// it contains only public URLs, never passwords, database keys or signing secrets.
const raw=globalThis.HAMU_PUBLIC_CONFIG||{};
export const API_BASE_URL=String(raw.apiBaseUrl||'').replace(/\/$/,'');
export const WS_URL=String(raw.wsUrl||'');
export function apiURL(path){return `${API_BASE_URL}${path.startsWith('/')?path:`/${path}`}`;}
export function wsURL(){
  if(WS_URL)return WS_URL;
  if(API_BASE_URL){const u=new URL(API_BASE_URL);u.protocol=u.protocol==='https:'?'wss:':'ws:';u.pathname='/ws';u.search='';u.hash='';return u.href;}
  return `${location.protocol==='https:'?'wss':'ws'}://${location.host||'localhost:3000'}/ws`;
}
export const crossOrigin=Boolean(API_BASE_URL && new URL(API_BASE_URL,location.href).origin!==location.origin);
