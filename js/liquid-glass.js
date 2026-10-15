/* Refraction affects backdrop pixels only: labels and controls stay sharp. */
(() => {
 const NS = 'http://www.w3.org/2000/svg';
 const svg = document.createElementNS(NS, 'svg');
 svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
 svg.setAttribute('aria-hidden', 'true'); svg.style.cssText = 'position:fixed;pointer-events:none;overflow:hidden';
 svg.innerHTML = '<defs><filter id="orbit-water-refraction" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.022" numOctaves="1" seed="8" result="waves"/><feDisplacementMap in="SourceGraphic" in2="waves" scale="30" xChannelSelector="R" yChannelSelector="G"/></filter></defs>';
 document.body.prepend(svg);
 const noise = svg.querySelector('feTurbulence'), displacement = svg.querySelector('feDisplacementMap');
 const reduced = matchMedia('(prefers-reduced-motion: reduce)');
 // WebKit versions that reject SVG backdrop references retain ordinary glass.
 const safari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent);
 const canRefract = !safari && CSS.supports('backdrop-filter', 'url("#orbit-water-refraction")');
 let intensity = 0, speed = 50, frame = 0, until = 0, last = 0, scrollTimer = 0, scrolling = false, quality = 'balanced', lastScale = null;
 function preference(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw === null ? fallback : Number(raw); } catch (_) { return fallback; }
 }
 function refresh() {
  const enabled = preference('orbit_pref_glass_enabled', 1) !== 0;
  try { quality = localStorage.getItem('orbit_pref_glass_quality') || 'balanced'; } catch (_) {}
  if (!['balanced','full','fast'].includes(quality)) quality = 'balanced';
  const refract = canRefract && quality !== 'fast';
  intensity = Math.max(0, Math.min(100, preference('orbit_pref_refraction', 55) || 0));
  speed = Math.max(0, Math.min(100, preference('orbit_pref_glass_speed', 50) || 0));
  const saturation = Math.max(0, Math.min(200, preference('orbit_pref_glass_saturation', 155) || 0));
  const highlight = Math.max(0, Math.min(100, preference('orbit_pref_glass_highlight', 55) || 0));
  const blur = Math.max(0, Math.min(45, preference('orbit_pref_blur', 12) || 0));
  const tint = Math.max(0, Math.min(100, preference('orbit_pref_opacity', 50) || 0));
  const root = document.documentElement;
  root.style.setProperty('--liquid-refraction-filter', intensity && refract ? 'url("#orbit-water-refraction")' : '');
  root.style.setProperty('--liquid-surface-blur', `${intensity && refract ? blur / 3 : Math.min(blur, quality === 'fast' ? 6 : 45)}px`);
  root.style.setProperty('--liquid-tint-alpha', String(tint / 100));
  root.style.setProperty('--liquid-highlight-alpha', String(highlight / 100));
  root.style.setProperty('--liquid-saturation', `${saturation}%`);
  root.style.setProperty('--liquid-backdrop', `${intensity && refract ? 'url("#orbit-water-refraction") ' : ''}blur(${intensity && refract ? blur / 3 : Math.min(blur, quality === 'fast' ? 6 : 45)}px) saturate(${saturation}%)`);
  if (lastScale !== intensity * 0.75) { lastScale = intensity * 0.75; displacement.setAttribute('scale', String(lastScale)); }
  document.body.classList.toggle('orbit-glass-enabled', enabled);
  document.body.classList.toggle('orbit-water-glass', enabled && intensity > 0 && refract);
  document.body.classList.toggle('orbit-glass-full', quality === 'full');
  document.body.classList.toggle('orbit-glass-fast', intensity === 0 && blur === 0);
  const toggle = document.getElementById('glass-enabled');
  if (toggle) toggle.checked = enabled;
  const qualityInput = document.getElementById('glass-quality');
  if (qualityInput) qualityInput.value = quality;
  for (const [name, value] of Object.entries({speed, saturation, highlight})) {
   const input = document.getElementById(`glass-${name}`), label = document.getElementById(`glass-${name}-value`);
   if (input) input.value = String(value);
   if (label) label.textContent = name === 'speed' && value === 0 ? 'Still' : `${value}%`;
  }
  if (!enabled || !intensity || !speed || reduced.matches || quality !== 'full') { cancelAnimationFrame(frame); frame = 0; }
 }
 function animate(now) {
  frame = 0;
  if (document.hidden || reduced.matches || !intensity || !speed || !canRefract || quality !== 'full' || scrolling || !document.body.classList.contains('orbit-glass-enabled')) return;
  if (now - last >= 80) {
   last = now;
   const time = now * speed / 50;
   noise.setAttribute('baseFrequency', `${0.012 + Math.sin(time / 1700) * 0.002} ${0.022 + Math.cos(time / 2100) * 0.003}`);
  }
  if (now < until) frame = requestAnimationFrame(animate);
 }
 function wake() {
  if (document.hidden || reduced.matches || !intensity || !speed || !canRefract || quality !== 'full' || scrolling || !document.body.classList.contains('orbit-glass-enabled')) return;
  until = performance.now() + 350;
  if (!frame) frame = requestAnimationFrame(animate);
 }
 window.refreshOrbitLiquidGlass = refresh;
 window.setOrbitGlassQuality = value => {
  if (!['balanced','full','fast'].includes(value)) return;
  try { localStorage.setItem('orbit_pref_glass_quality', value); } catch (_) {}
  refresh();
 };
 window.setOrbitGlassControl = (name, value) => {
  const limits = {enabled:1, speed:100, saturation:200, highlight:100};
  if (!(name in limits)) return;
  const amount = Math.max(0, Math.min(limits[name], Number(value) || 0));
  try { localStorage.setItem(`orbit_pref_glass_${name}`, String(amount)); localStorage.removeItem('orbit_pref_glass_preset'); } catch (_) {}
  refresh();
 };
 document.addEventListener('pointermove', wake, {passive:true});
 // Shared SVG noise can invalidate every glass surface at once. Keep it static
 // by default. Pause noise animation during scroll without changing the glass.
 document.addEventListener('scroll', () => {
  if (!document.body.classList.contains('orbit-glass-enabled')) return;
  scrolling = true;
  cancelAnimationFrame(frame); frame = 0;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => { scrolling = false; }, 180);
 }, {capture:true,passive:true});
 document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else refresh();
 });
 reduced.addEventListener('change', refresh);
 window.addEventListener('storage', event => { if (event.key?.startsWith('orbit_pref_')) refresh(); });
 refresh();
})();

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
   if(reduced.matches||!document.body.classList.contains('orbit-glass-full'))return;target=Math.min(1,delta/Math.max(16,now-lastEvent)/2);lastEvent=now;if(!frame)frame=requestAnimationFrame(settle);
  },{passive:true});
 }
})();
