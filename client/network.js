import { packInput } from '../shared/protocol.js';
import { wsURL } from './config.js';
export class Network {
  constructor(){this.ws=null;this.status='offline';this.reconnectEnabled=true;this.reconnectTimer=null;this.reconnectAttempt=0;this.id=null;this.region=null;this.room=null;this.rooms=[];this.ping=0;this.kbps=0;this.bytes=0;this.callbacks={};this.pending=null;this.requests=new Map();this.serial=0;this.party=null;this.queue=null;this.social={friends:[],incoming:[],outgoing:[],invites:[]};this.fireSeq=0;}
  on(event,callback){(this.callbacks[event]??=new Set()).add(callback);return()=>this.callbacks[event]?.delete(callback);}
  emit(event,data){for(const callback of this.callbacks[event]||[])callback(data);}
  rejectRequests(message){for(const pending of this.requests.values()){clearTimeout(pending.timer);pending.reject(new Error(message));}this.requests.clear();}
  connect(url=defaultServerURL()){this.reconnectEnabled=true;clearTimeout(this.reconnectTimer);
    if(this.status==='connected'&&this.url===url)return Promise.resolve();
    if(this.pending&&this.url===url)return this.pending;
    let u;try{u=new URL(url);}catch(error){return Promise.reject(error);}
    this.disconnect();this.url=url;this.status='connecting';this.emit('status',this.status);
    const promise=new Promise((resolve,reject)=>{
      const ws=new WebSocket(u.href);let settled=false;this.ws=ws;
      const timeout=setTimeout(()=>{if(!settled){settled=true;ws.close();reject(new Error('The multiplayer backend did not respond. Check the public backend URL and try again.'));}},8000);
      ws.addEventListener('message',event=>{
        if(this.ws!==ws)return;this.bytes+=event.data.length;let data;try{data=JSON.parse(event.data);}catch{return;}
        if(data.t==='reply'){const request=this.requests.get(data.requestId);if(request){clearTimeout(request.timer);this.requests.delete(data.requestId);if(data.ok)request.resolve(data.result);else request.reject(new Error(data.error||'Request failed.'));}return;}
        if(data.t==='hello'){clearTimeout(timeout);settled=true;this.id=data.id;this.accountId=data.accountId;this.rooms=data.rooms;this.region=data.region||null;this.status='connected';this.reconnectAttempt=0;this.pending=null;resolve();this.emit('status',this.status);this.emit('rooms',this.rooms);this.interval=setInterval(()=>{this.send({t:'ping',at:performance.now()});this.kbps=Math.round(this.bytes/2000);this.bytes=0;},2000);}
        else if(data.t==='pong'){this.ping=Math.round(performance.now()-data.at);this.emit('ping',this.ping);}
        else if(data.t==='rooms'){this.rooms=data.rooms;this.emit('rooms',this.rooms);}
        else if(data.t==='joined'){this.id=data.id;this.room=data.room;this.queue=null;this.emit('joined',data);}
        else if(data.t==='party_return'){this.room=null;this.queue=null;this.emit('party-return',data.message);}
        else if(data.t==='state')this.emit('state',data);
        else if(data.t==='left'){this.room=null;this.emit('left');}
        else if(data.t==='error')this.emit('error',data.message);
        else if(data.t==='ui_config'){this.emit('ui-config',data.config);}
        else if(data.t==='social_state'){this.social={friends:data.friends||[],incoming:data.incoming||[],outgoing:data.outgoing||[],invites:data.invites||[]};this.emit('social',this.social);}
        else if(data.t==='party_state'){this.party=data.party;this.emit('party',this.party);}
        else if(data.t==='queue_state'){this.queue=data.queue;this.emit('queue',this.queue);}
        else if(data.t==='social_notice')this.emit('notice',data.message);
        else if(data.t==='party_event')this.emit('party-event',data);
      });
      ws.addEventListener('close',event=>{
        clearTimeout(timeout);if(this.ws!==ws)return;clearInterval(this.interval);const was=this.status;this.status='offline';this.pending=null;this.party=null;this.queue=null;this.room=null;this.social={friends:[],incoming:[],outgoing:[],invites:[]};this.region=null;this.rejectRequests('Connection closed. Reconnect in Multiplayer.');this.emit('status',this.status);this.emit('party',null);this.emit('queue',null);this.emit('social',this.social);
        const message=event.code===4003?'This account was logged in on another browser or device. This device has been logged out.':event.code===4002?'This account connected in another window. This window has disconnected.':event.code===4001?'Your session ended. Reload and log in again.':'Connection lost. Reconnect in Multiplayer; your friends are saved, but the party must be reformed.';
        if(event.code===4003)this.emit('session-replaced',message);
        if(!settled){settled=true;reject(new Error(message));}else if(was==='connected')this.emit('disconnected',message);
      });
      ws.addEventListener('error',()=>{});
    });this.pending=promise;promise.catch(()=>{if(this.pending===promise)this.pending=null;});return promise;
  }
  scheduleReconnect(){clearTimeout(this.reconnectTimer);if(!this.reconnectEnabled||this.status==='connected')return;const delays=[1000,2000,4000,8000,15000];const delay=delays[Math.min(this.reconnectAttempt,delays.length-1)];this.reconnectAttempt++;this.reconnectTimer=setTimeout(()=>{this.connect(this.url||defaultServerURL()).then(()=>{this.reconnectAttempt=0;this.emit('reconnected');}).catch(()=>this.scheduleReconnect());},delay);this.emit('reconnect-wait',delay);}
  request(t,fields={}){if(this.status!=='connected')return Promise.reject(new Error('Connect to the game server first.'));const requestId=`r${++this.serial}`;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.requests.delete(requestId);reject(new Error('The server did not confirm this action. Refresh your social list before retrying.'));},10000);this.requests.set(requestId,{resolve,reject,timer});if(!this.send({...fields,t,requestId})){clearTimeout(timer);this.requests.delete(requestId);reject(new Error('Connection closed.'));}});}
  send(data){if(this.ws?.readyState===WebSocket.OPEN){this.ws.send(JSON.stringify(data));return true;}return false;}
  input(input){return this.send({t:'i',d:packInput(input)});}
  // Fire is an explicit intent so the first LMB press cannot be delayed/lost between the 30 Hz input snapshots.
  fire(input){const seq=++this.fireSeq;return this.send({t:'f',d:[Math.round(input.yaw*10000)/10000,Math.round(input.pitch*10000)/10000,input.slot,seq]});}
  refresh(){this.send({t:'list'});}
  leave(){this.send({t:'leave'});this.room=null;}
  disconnect(){this.reconnectEnabled=false;clearTimeout(this.reconnectTimer);clearInterval(this.interval);this.rejectRequests('Connection changed. Please retry.');if(this.ws){const old=this.ws;this.ws=null;old.close();}this.status='offline';this.pending=null;this.party=null;this.queue=null;this.room=null;this.region=null;}
}
export function defaultServerURL(){return wsURL();}
