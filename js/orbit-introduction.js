// Automatic, finite introduction. Session restoration never waits for this module.
(() => {
 const VERSION='v1',guestKey='orbit_intro_guest_'+VERSION;
 let active=null,scenePromise=null,audio=null,audioGain=null,guestPlayed=false;
 const read=key=>{try{return localStorage.getItem(key);}catch(_){return null;}};
 const write=key=>{try{localStorage.setItem(key,'done');}catch(_) {}};
 function primeAudio(){
  try{const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return null;if(!audio||audio.state==='closed')audio=new Context();audio.resume().catch(()=>{});return audio;}catch(_){return null;}
 }
 function stopAudio(){
  const closing=audio,gain=audioGain;audio=null;audioGain=null;if(!closing)return;
  try{if(gain){gain.gain.cancelScheduledValues(closing.currentTime);gain.gain.setTargetAtTime(.0001,closing.currentTime,.08);}}catch(_){}
  setTimeout(()=>{try{closing.close().catch(()=>{});}catch(_){}},280);
 }
 function playMusic(state){
  if(active!==state||state.music)return;
  const context=primeAudio();if(!context)return;
  const begin=()=>{
   if(active!==state||state.music||audio!==context||context.state!=='running'||performance.now()-state.started>9000)return;
   try{
    state.music=true;const gain=context.createGain();audioGain=gain;gain.gain.setValueAtTime(.0001,context.currentTime);gain.gain.linearRampToValueAtTime(.2,context.currentTime+1.4);
    const filter=context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=1200;filter.Q.value=.5;filter.connect(gain);gain.connect(context.destination);
    const chords=[[48,55,59,64],[45,52,55,60],[41,48,52,57],[43,50,55,62]];
    const elapsed=(performance.now()-state.started)/1000,remaining=Math.max(0,12-elapsed);
    chords.forEach((chord,index)=>{const delay=index*2.6;if(delay>remaining-1)return;const at=context.currentTime+delay;
     chord.forEach((note,voice)=>{const oscillator=context.createOscillator(),envelope=context.createGain();oscillator.type=voice===0?'sine':'triangle';oscillator.frequency.value=440*Math.pow(2,(note-69)/12);envelope.gain.setValueAtTime(.0001,at);envelope.gain.linearRampToValueAtTime(voice===0?.12:.07,at+1.1);envelope.gain.exponentialRampToValueAtTime(.0001,at+4.5);oscillator.connect(envelope);envelope.connect(filter);oscillator.start(at);oscillator.stop(at+4.6);});
    });
   }catch(_){stopAudio();}
  };
  begin();if(context.state!=='running')context.resume().then(begin).catch(()=>{});
 }
 function loadScene(){
  if(typeof window.createOrbitIntroScene==='function')return Promise.resolve(window.createOrbitIntroScene);
  if(!scenePromise)scenePromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='js/orbit-intro-scene.js?v=albums-typing-startup-20261022-r1';script.onload=()=>typeof window.createOrbitIntroScene==='function'?resolve(window.createOrbitIntroScene):reject(Error('Scene unavailable'));script.onerror=()=>reject(Error('Scene unavailable'));document.head.append(script);}).catch(error=>{scenePromise=null;throw error;});
  return scenePromise;
 }
 function finish(){
  const state=active;if(!state)return;active=null;clearTimeout(state.timer);clearTimeout(state.sceneTimer);state.cleanup?.();state.cleanup=null;
  state.host.classList.add('is-finishing');stopAudio();document.removeEventListener('visibilitychange',state.visibility);window.removeEventListener('keydown',state.key,true);state.host.removeEventListener('pointerdown',state.tap);
  if(state.viewport)state.viewport.inert=state.wasInert;
  const remove=()=>{state.host.remove();if(state.focus?.isConnected&&state.focus.closest?.('.active'))state.focus.focus({preventScroll:true});state.resolve(true);};
  if(state.reduced)remove();else setTimeout(remove,450);
 }
 function play(){
  if(active)return active.promise;
  if(document.hidden)return Promise.resolve(false);
  const host=document.createElement('div');host.id='orbit-introduction';host.setAttribute('role','status');host.setAttribute('aria-label','Orbit introduction');
  host.innerHTML='<canvas data-intro-canvas aria-hidden="true"></canvas><canvas data-intro-bloom aria-hidden="true"></canvas><img class="intro-static-logo" src="orbit-icon.svg?v=brand-20261015" alt=""><h1 class="intro-wordmark" aria-label="Orbit"><span class="intro-letter" style="--i:0" aria-hidden="true">O</span><span class="intro-letter" style="--i:1" aria-hidden="true">R</span><span class="intro-letter" style="--i:2" aria-hidden="true">B</span><span class="intro-letter" style="--i:3" aria-hidden="true">I</span><span class="intro-letter" style="--i:4" aria-hidden="true">T</span></h1>';
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
  const state={host,reduced,started:performance.now(),focus:document.activeElement,viewport:document.getElementById('app-viewport'),cleanup:null,music:false};
  state.promise=new Promise(resolve=>state.resolve=resolve);active=state;
  if(state.viewport){state.wasInert=state.viewport.inert;state.viewport.inert=true;}
  document.body.append(host);host.tabIndex=-1;host.focus({preventScroll:true});
  state.visibility=()=>{if(document.hidden)finish();};state.key=event=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish();}};state.tap=()=>playMusic(state);
  document.addEventListener('visibilitychange',state.visibility);window.addEventListener('keydown',state.key,true);host.addEventListener('pointerdown',state.tap,{passive:true});
  const staticScene=()=>{if(active!==state)return;host.classList.add('is-static');clearTimeout(state.timer);state.timer=setTimeout(finish,1500);};
  state.timer=setTimeout(finish,reduced?1500:12000);
  if(reduced){host.classList.add('is-static');}else{
   state.sceneTimer=setTimeout(staticScene,2500);
   loadScene().then(create=>{if(active!==state)return;clearTimeout(state.sceneTimer);if(host.classList.contains('is-static'))return;try{state.cleanup=create(host);}catch(_){staticScene();}}).catch(staticScene);
  }
  playMusic(state);return state.promise;
 }
 function boot(){
  if(read(guestKey)||read('orbit_explicit_signout')==='true')return;
  try{const cached=JSON.parse(read('sb-dhtbiggamuwoqurguhib-auth-token')||'null');if(cached?.user?.id)return;}catch(_){}
  if(new URLSearchParams(location.search).has('orbit_oauth'))return;
  const shown=play();if(active)guestPlayed=true;shown.then(completed=>{if(completed)write(guestKey);});
 }
 function afterSignIn(user,{interactive=false,force=false}={}){
  if(!user?.id||!interactive)return;
  const key='orbit_intro_user_'+VERSION+'_'+user.id;
  if(!force&&(read(key)||guestPlayed)){write(key);releaseIfIdle();return;}
  play().then(completed=>{if(completed)write(key);});
 }
 function releaseIfIdle(){if(!active)stopAudio();}
 window.OrbitIntroduction={boot,afterSignIn,finish,primeAudio,releaseIfIdle,isActive:()=>!!active};
 document.addEventListener('DOMContentLoaded',boot,{once:true});
})();
