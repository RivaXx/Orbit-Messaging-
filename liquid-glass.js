/* Damped spring motion with pointer capture and reduced-motion support. */
(() => {
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 document.querySelectorAll('.chat-circle-action-btn,.chat-nav-bar .glass-icon-btn').forEach(el=>{
  let x=0,y=0,scale=1,vx=0,vy=0,vs=0,tx=0,ty=0,ts=1,frame=0,last=0,origin=null;
  function step(now){const dt=Math.min((now-last)/1000||1/60,.032);last=now;
   vx+=(220*(tx-x)-24*vx)*dt;vy+=(220*(ty-y)-24*vy)*dt;vs+=(260*(ts-scale)-22*vs)*dt;
   x+=vx*dt;y+=vy*dt;scale+=vs*dt;
   el.style.setProperty('--spring-x',x+'px');el.style.setProperty('--spring-y',y+'px');el.style.setProperty('--spring-scale',scale);
   if(Math.abs(x-tx)+Math.abs(y-ty)+Math.abs(scale-ts)+Math.abs(vx)+Math.abs(vy)+Math.abs(vs)>.002)frame=requestAnimationFrame(step);else{frame=0;last=0;}
  }
  function run(){if(!frame)frame=requestAnimationFrame(step);}
  el.classList.add('spring-control');
  el.addEventListener('pointerdown',e=>{if(reduced.matches||e.button!==0)return;origin=[e.clientX,e.clientY];ts=.9;el.setPointerCapture(e.pointerId);run();});
  el.addEventListener('pointermove',e=>{if(!origin)return;tx=Math.max(-5,Math.min(5,(e.clientX-origin[0])*.16));ty=Math.max(-5,Math.min(5,(e.clientY-origin[1])*.16));run();});
  function release(){origin=null;tx=ty=0;ts=1;run();}
  ['pointerup','pointercancel','lostpointercapture'].forEach(type=>el.addEventListener(type,release));
 });
 // Measure chrome so messages scroll beneath the frost without hiding the newest message.
 const screen=document.getElementById('screen-chat'),feed=document.getElementById('chat-feed');
 if(screen&&feed){
  const header=screen.querySelector('.chat-nav-bar'),composer=screen.querySelector('.chat-input-bar');
  const measure=()=>{if(header?.offsetHeight)screen.style.setProperty('--chrome-top',header.offsetHeight+'px');if(composer?.offsetHeight)screen.style.setProperty('--chrome-bottom',composer.offsetHeight+'px');};
  if(window.ResizeObserver){const observer=new ResizeObserver(measure);if(header)observer.observe(header);if(composer)observer.observe(composer);}measure();
  let energy=0,velocity=0,target=0,frame=0,last=0,lastScroll=feed.scrollTop,lastEvent=performance.now();
  function settle(now){const dt=Math.min((now-last)/1000||1/60,.032);last=now;if(now-lastEvent>80)target=0;
   velocity+=(125*(target-energy)-23*velocity)*dt;energy+=velocity*dt;
   screen.style.setProperty('--glass-energy',Math.max(0,Math.min(1,energy)).toFixed(3));
   if(Math.abs(energy-target)+Math.abs(velocity)>.003)frame=requestAnimationFrame(settle);else{frame=0;last=0;}
  }
  feed.addEventListener('scroll',()=>{const now=performance.now(),delta=Math.abs(feed.scrollTop-lastScroll);lastScroll=feed.scrollTop;
   if(reduced.matches)return;target=Math.min(1,delta/Math.max(16,now-lastEvent)/2);lastEvent=now;if(!frame)frame=requestAnimationFrame(settle);
  },{passive:true});
 }
})();
