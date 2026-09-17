// Original procedural sound design: no recordings, samples, or third-party audio.
export class AudioSystem {
  constructor(settings) {this.settings=settings;this.context=null;this.ambientNodes=[];this.inGame=false;}
  unlock() {
    if(!this.context) {
      const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
      this.context=new AC();this.master=this.context.createGain();this.master.connect(this.context.destination);
      this.sfx=this.context.createGain();this.sfx.connect(this.master);this.ambient=this.context.createGain();this.ambient.connect(this.master);
      this.noise=this.context.createBuffer(1,this.context.sampleRate*1.6,this.context.sampleRate);
      const data=this.noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1);
      for(const frequency of [55,82.41,110.2]) {const osc=this.context.createOscillator(),gain=this.context.createGain();osc.type='sine';osc.frequency.value=frequency;gain.gain.value=.018;osc.connect(gain);gain.connect(this.ambient);osc.start();this.ambientNodes.push(osc);}
      this.apply(this.settings);
    }
    if(this.context.state==='suspended')this.context.resume().catch(()=>{});
  }
  apply(settings){this.settings=settings;if(!this.context)return;const t=this.context.currentTime;this.master.gain.setTargetAtTime(settings.volume/100,t,.03);this.sfx.gain.setTargetAtTime(settings.effects/100,t,.03);this.ambient.gain.setTargetAtTime(settings.ambience/100*(this.inGame?.18:1),t,.1);}
  setGame(active){this.inGame=active;this.apply(this.settings);}
  tone(frequency,duration=.08,volume=.08,type='sine',end=frequency,pan=0) {
    if(!this.context)return;const c=this.context,t=c.currentTime,osc=c.createOscillator(),gain=c.createGain(),panner=c.createStereoPanner();
    osc.type=type;osc.frequency.setValueAtTime(frequency,t);osc.frequency.exponentialRampToValueAtTime(Math.max(1,end),t+duration);
    gain.gain.setValueAtTime(Math.max(.0001,volume),t);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);panner.pan.value=Math.max(-1,Math.min(1,pan));
    osc.connect(gain);gain.connect(panner);panner.connect(this.sfx);osc.start();osc.stop(t+duration+.015);osc.onended=()=>{osc.disconnect();gain.disconnect();panner.disconnect();};
  }
  burst(duration,volume,cutoff=2000,pan=0) {
    if(!this.context)return;const c=this.context,t=c.currentTime,source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain(),panner=c.createStereoPanner();
    source.buffer=this.noise;filter.type='lowpass';filter.frequency.setValueAtTime(cutoff,t);filter.frequency.exponentialRampToValueAtTime(120,t+duration);
    gain.gain.setValueAtTime(Math.max(.0001,volume),t);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);panner.pan.value=Math.max(-1,Math.min(1,pan));
    source.connect(filter);filter.connect(gain);gain.connect(panner);panner.connect(this.sfx);source.start(t,Math.random()*.3);source.stop(t+duration);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();panner.disconnect();};
  }
  shoot(w,distance=0,pan=0){const gain=.36/(1+distance*.11),heavy=['Shotgun','Sniper rifle'].includes(w.category);this.burst(heavy?.22:.12,gain,heavy?3200:5100,pan);this.tone(heavy?100:160,heavy?.2:.09,gain*.7,'triangle',42,pan);}
  step(sprint=false){this.burst(.05,sprint?.047:.032,550);this.tone(95,.04,.018,'sine',48);}
  hit(head=false){this.tone(head?1500:980,.055,.085,'triangle',head?2200:1400);}
  kill(){this.tone(740,.12,.095,'sine',1480);setTimeout(()=>this.tone(1110,.1,.07,'sine',1480),65);}
  reload(){this.burst(.12,.08,2500);setTimeout(()=>this.tone(480,.055,.035,'square',280),140);}
  loaded(){this.burst(.06,.11,3800);}
  melee(){this.burst(.15,.12,2100);}
  throw(){this.burst(.12,.05,1200);}
  explosion(distance=0,pan=0){const gain=.7/(1+distance*.08);this.burst(.7,gain,1800,pan);this.tone(66,.55,gain*.5,'sine',22,pan);}
  ui(){this.tone(620,.045,.025,'sine',880);}
}
