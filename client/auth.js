import { escapeHTML as esc } from './storage.js';
import { apiURL, crossOrigin } from './config.js';

// Identity comes only from the server. Passwords and session tokens never enter localStorage.
export class Auth {
  constructor() { this.user=null; this.step='welcome'; this.username=''; this.email=''; this.busy=false; }
  async request(path, body) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try {
      const response=await fetch(apiURL(`/api/auth/${path}`),{method:body===undefined?'GET':'POST',credentials:'include',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
      const data=await response.json().catch(()=>({error:'Account server unavailable. Start this project with npm start, then open its address.'}));
      if(!response.ok||(!data.user&&!('available' in data)&&!data.ok)) { const error=new Error(data.error||'The account server returned an invalid response.');error.status=response.status;error.code=data.code;throw error; }
      return data;
    } catch(error) {
      if(error.name==='AbortError'||error instanceof TypeError)throw new Error(crossOrigin?'Cannot reach the public game backend. Check the configured HTTPS backend URL and its health endpoint.':'Cannot reach the account server. Check your connection and make sure npm start is running, then try again.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async requireAccount() {
    this.root=document.getElementById('account-gate');
    this.root.hidden=false;
    this.render('checking');
    try { this.user=(await this.request('me')).user;this.root.hidden=true;return this.user; }
    catch(error) { this.render('welcome');if(error.status!==401)this.message(error.message);this.showSessionReplacedNotice(); }
    document.getElementById('boot').classList.add('hidden');
    return new Promise(resolve=>{this.resolve=resolve;});
  }
  async verify() {
    try {
      const user=(await this.request('me')).user;
      if(user.id!==this.user?.id){location.reload();return false;}
      return true;
    }catch(error){if(error.status===401){location.reload();return false;}throw error;}
  }
  async getProfile() {
    const response=await fetch(apiURL('/api/profile'),{method:'GET',credentials:'include',cache:'no-store'});
    const data=await response.json().catch(()=>({error:'Profile server unavailable.'}));
    if(!response.ok) { const error=new Error(data.error||'The profile server returned an invalid response.');error.status=response.status;throw error; }
    return data.profile||null;
  }
  async saveProfile(profile) {
    const response=await fetch(apiURL('/api/profile'),{method:'PUT',credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile})});
    const data=await response.json().catch(()=>({error:'Profile server unavailable.'}));
    if(!response.ok||!data.profile) { const error=new Error(data.error||'The profile server returned an invalid response.');error.status=response.status;throw error; }
    return data.profile;
  }
  async linkEmail(email,password) { const data=await this.request('email',{email,password}); this.user=data.user; return data.user; }
  async logout() { await this.request('logout',{});this.user=null;location.reload(); }
  showSessionReplacedNotice() {
    let url;
    try { url=new URL(location.href); } catch { return; }
    if(url.searchParams.get('sessionNotice')!=='replaced')return;
    url.searchParams.delete('sessionNotice');
    history.replaceState(null,'',url.pathname+url.search+url.hash);
    const panel=this.root.querySelector('.auth-panel');
    if(!panel||panel.querySelector('.auth-session-notice'))return;
    const notice=document.createElement('div');
    notice.className='auth-session-notice';
    notice.setAttribute('role','alert');
    notice.setAttribute('aria-live','assertive');
    notice.innerHTML='<span class="auth-session-warning" aria-hidden="true">⚠️</span><div><strong>ANOTHER PLAYER HAS LOGGED IN TO YOUR ACCOUNT</strong><p>Your previous session was disconnected for account safety.</p><small>This warning will close in <b>5</b>s</small><i><em></em></i></div>';
    panel.prepend(notice);
    let remaining=5;
    const counter=notice.querySelector('small b');
    const timer=setInterval(()=>{
      remaining--;
      counter.textContent=String(Math.max(remaining,0));
      if(remaining<=0){clearInterval(timer);notice.classList.add('leaving');setTimeout(()=>notice.remove(),180);}
    },1000);
  }
  message(text) { const el=this.root.querySelector('#auth-message');if(el){el.textContent=text;el.hidden=!text;} }
  render(step) {
    this.step=step;
    const titles={checking:'CHECKING ACCESS',welcome:'YOUR NAME.\nYOUR LEGACY.',name:'ADD EMAIL &\nCHOOSE NAME',password:'SET YOUR\nGAME PASSWORD',login:'WELCOME\nBACK.',admin:'ADMIN ACCESS\nRESTRICTED.'};
    const description={checking:'Connecting securely to your account server…',welcome:'One identity for every match. Create your HAMU MASTER account to enter the Foundry.',name:'Enter your Gmail or other email first, then choose your permanent callsign. The email is unverified and is not Google sign-in.',password:`Your callsign is ${this.username}. Set a GAME password only you know — never enter your Gmail password.`,login:'Use your callsign or linked email, then your GAME password. No Gmail password is used.',admin:'Restricted operator access. Only the whitelisted admin account can enter this panel.'};
    let form='';
    if(step==='welcome')form='<button class="auth-primary" type="button" data-auth="name">CREATE ACCOUNT <span>↗</span></button><div class="auth-divider"><span>ALREADY AN OPERATOR?</span></div><button class="auth-secondary" type="button" data-auth="login">LOG IN</button><button class="auth-admin" type="button" data-auth="admin">LOGIN AS ADMIN <span>◆</span></button>'; 
    if(step==='name')form=`<label for="auth-email">GMAIL OR EMAIL</label><input id="auth-email" name="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" required value="${esc(this.email)}" placeholder="you@gmail.com" aria-describedby="email-help auth-message"><small id="email-help">Required, unique and stored as UNVERIFIED contact/login information. This is not Google sign-in.</small><label for="auth-name">UNIQUE NAME</label><input id="auth-name" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" minlength="3" maxlength="18" pattern="[A-Za-z0-9_]{3,18}" required value="${esc(this.username)}" placeholder="e.g. HamuLegend" aria-describedby="name-help auth-message"><small id="name-help">3–18 letters, numbers or underscores. Names are not case-sensitive.</small><button class="auth-primary" type="submit">NEXT <span>→</span></button><button class="auth-back" type="button" data-auth="login">ALREADY REGISTERED? LOG IN</button><button class="auth-back" type="button" data-auth="welcome">← BACK</button>`;
    if(step==='password')form=`<div class="auth-callsign"><span>YOUR UNIQUE NAME</span><strong>${esc(this.username)}</strong><button type="button" data-auth="name">EDIT</button></div><label for="auth-password">PASSWORD</label><div class="auth-password-wrap"><input id="auth-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="At least 8 characters" aria-describedby="password-help auth-message"><button type="button" data-auth="reveal" aria-label="Show password" aria-pressed="false">SHOW</button></div><small id="password-help">8–128 characters. Use a long, unique password and save it safely.</small><label for="auth-confirm">CONFIRM PASSWORD</label><input id="auth-confirm" name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="Enter your password again"><button class="auth-primary" type="submit">CREATE ACCOUNT <span>↗</span></button><button class="auth-back" type="button" data-auth="name">← BACK TO NAME</button>`;
    if(step==='admin')form=`<label for="auth-name">ADMIN NAME</label><input id="auth-name" name="identity" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="18" required value="${esc(this.username||'Samphor')}" placeholder="Admin name"><label for="auth-password">ADMIN PASSWORD</label><div class="auth-password-wrap"><input id="auth-password" name="password" type="password" autocomplete="current-password" maxlength="128" required placeholder="Admin password"><button type="button" data-auth="reveal">SHOW</button></div><button class="auth-primary" type="submit">ENTER ADMIN PANEL <span>→</span></button><small>This credential is separate from normal player login. The admin editor is hidden from non-admin accounts.</small><button class="auth-back" type="button" data-auth="welcome">← BACK</button>`;
    if(step==='login')form=`<label for="auth-name">UNIQUE NAME OR LINKED EMAIL</label><input id="auth-name" name="identity" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" required value="${esc(this.username)}" placeholder="Your callsign or you@gmail.com"><label for="auth-password">GAME PASSWORD</label><div class="auth-password-wrap"><input id="auth-password" name="password" type="password" autocomplete="current-password" maxlength="128" required placeholder="Your HAMU MASTER password"><button type="button" data-auth="reveal" aria-label="Show password" aria-pressed="false">SHOW</button></div><button class="auth-primary" type="submit">LOG IN <span>→</span></button><small>Use your GAME password, never your Gmail password. No password reset is available.</small><button class="auth-back" type="button" data-auth="name">NEW HERE? CREATE ACCOUNT</button>`;
    this.root.innerHTML=`<div class="auth-shell"><aside class="auth-art" aria-label="Foundry arena artwork"><div class="auth-brand"><img src="./assets/emblem.svg" alt=""><span>HAMU<b>MASTER /</b></span></div><div class="auth-art-copy"><span>FOUNDRY / OPERATOR ENROLLMENT</span><h2>EVERY LEGEND<br>STARTS WITH<br><em>A NAME.</em></h2><p>Claim yours. Enter the arena.</p></div><div class="auth-art-footer"><i></i> ONE ACCOUNT. YOUR IDENTITY.</div></aside><main class="auth-panel"><div class="auth-mobile-brand">HAMU MASTER /</div><div class="auth-topline"><span>PLAYER ACCESS</span><span>${step==='name'?'01 / 02':step==='password'?'02 / 02':step==='admin'?'ADMIN / 01':'HM — 01'}</span></div>${['name','password'].includes(step)?`<div class="auth-steps" aria-label="Step ${step==='name'?1:2} of 2"><i class="active"></i><i class="${step==='password'?'active':''}"></i></div>`:''}<h1>${titles[step].split('\n').join('<br>')}</h1><p class="auth-description">${esc(description[step])}</p><form id="auth-form"><fieldset ${step==='checking'?'disabled':''}>${form}<p id="auth-message" role="alert" aria-live="polite" hidden></p></fieldset></form><div class="auth-note"><span>◈</span><p>Account identity is saved on this game server.<br>Your email is unverified; use only your GAME password here.</p></div></main></div>`;
    this.root.querySelector('form').onsubmit=event=>{event.preventDefault();this.submit();};
    this.root.onclick=event=>{
      const button=event.target.closest('[data-auth]');if(!button||this.busy)return;
      const action=button.dataset.auth;
      if(action==='reveal'){const input=this.root.querySelector('#auth-password'),show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'HIDE':'SHOW';button.setAttribute('aria-label',show?'Hide password':'Show password');button.setAttribute('aria-pressed',String(show));return;}
      if(this.step==='name'||this.step==='login'||this.step==='admin')this.username=this.root.querySelector('#auth-name')?.value.trim()||'';
      if(this.step==='name')this.email=this.root.querySelector('#auth-email')?.value.trim()||'';
      this.render(action);
    };
    requestAnimationFrame(()=>this.root.querySelector('input,button')?.focus({preventScroll:true}));
  }
  async submit() {
    if(this.busy)return;
    const form=this.root.querySelector('form');if(!form.reportValidity())return;
    const step=this.step;
    if(step==='name'||step==='login'||step==='admin')this.username=this.root.querySelector('#auth-name').value.trim();
    if(step==='name')this.email=this.root.querySelector('#auth-email').value.trim();
    if(step==='name'&&!/^\S+@\S+\.\S+$/.test(this.email)){this.message('Enter a valid Gmail or email address. It is unverified; never enter your Gmail password.');return;}
    if((step==='name')&&!/^[A-Za-z0-9_]{3,18}$/.test(this.username)){this.message('Use 3–18 letters, numbers or underscores for your unique name.');return;}
    if(step==='login'&&!this.username){this.message('Enter your unique name or linked email.');return;}
    let password=this.root.querySelector('#auth-password')?.value;
    if(step==='password'&&password!==this.root.querySelector('#auth-confirm').value){this.message('Passwords do not match. Please enter them again.');return;}
    let accountCreated=false;
    this.busy=true;form.querySelector('fieldset').disabled=true;form.setAttribute('aria-busy','true');this.message(step==='name'?'Checking name and email availability…':step==='login'?'Logging in…':step==='admin'?'Verifying admin access…':'Creating your account…');
    try {
      if(step==='name') {
        const data=await this.request('registration-check',{username:this.username,email:this.email});
        if(!data.available)throw new Error('That name or email is already registered. Log in to your existing account or use different details.');
        this.username=data.username;this.email=data.email;this.render('password');
      } else {
        const data=await this.request(step==='admin'?'admin-login':step==='login'?'login':'register',step==='admin'||step==='login'?{identity:this.username,password}:{username:this.username,email:this.email,password});
        accountCreated=step==='password';
        // Confirm the browser accepted the HttpOnly cookie before opening the game.
        const current=(await this.request('me')).user;
        if(current.id!==data.user.id)throw new Error('Your session could not be saved. Enable cookies for this site and log in again.');
        this.user=current;this.root.replaceChildren();this.root.hidden=true;
        document.getElementById('boot').classList.remove('hidden');this.resolve(this.user);
      }
    } catch(error) {
      if(accountCreated){
        this.render('login');
        this.message(`Your account was created, but automatic sign-in could not be confirmed. Log in with the name and GAME password you just chose. ${error.message}`);
      } else {
        if(error.status===409&&step==='password')this.render('name');
        // Preserve the server's actual error: an email conflict is not a taken name.
        this.message(error.message);
        const field=error.code==='EMAIL_TAKEN'||error.code==='INVALID_EMAIL'?'#auth-email':error.code==='USERNAME_TAKEN'||error.code==='INVALID_USERNAME'?'#auth-name':null;
        if(field)requestAnimationFrame(()=>this.root.querySelector(field)?.focus({preventScroll:true}));
      }
    } finally {password=null;this.busy=false;const active=this.root.querySelector('fieldset');if(active)active.disabled=false;form.removeAttribute('aria-busy');}
  }
}
