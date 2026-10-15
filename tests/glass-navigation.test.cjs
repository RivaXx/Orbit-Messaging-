const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname,'..');
function classes() {
 const values = new Set();
 return {add:k=>values.add(k),remove:k=>values.delete(k),contains:k=>values.has(k),toggle:(k,on)=>on?values.add(k):values.delete(k)};
}
function navigation(saved='[]') {
 const store = new Map([['orbit_pref_tab_order',saved]]), events={}, timers=new Map(); let serial=0;
 const pod={children:[],classList:classes(),style:{},scrollLeft:0,getBoundingClientRect:()=>({left:0,right:240}),
  querySelectorAll:()=>pod.children,addEventListener:(k,fn)=>events[k]=fn,contains:b=>pod.children.includes(b),
  setPointerCapture:()=>{},hasPointerCapture:()=>false,
  appendChild:b=>{pod.children=pod.children.filter(item=>item!==b);pod.children.push(b);},
  insertBefore:(b,next)=>{if(b===next)return;pod.children=pod.children.filter(item=>item!==b);const i=next?pod.children.indexOf(next):pod.children.length;pod.children.splice(i,0,b);}};
 const buttons=['main-chats','friends','global','news'].map(key=>({dataset:{tab:key},title:key,style:{},classList:classes(),offsetWidth:80,parentElement:pod,
  setAttribute:()=>{},focus:()=>{},scrollIntoView:()=>{},closest(){return this;},
  get nextSibling(){return pod.children[pod.children.indexOf(this)+1]||null;},
  getBoundingClientRect(){return {left:pod.children.indexOf(this)*80-pod.scrollLeft};}}));
 pod.children=buttons.slice();
 const context=vm.createContext({window:{},document:{getElementById:id=>id==='dash-tabs-wrapper'?pod:null,querySelectorAll:()=>[]},navigator:{},
  localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},
  setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),setInterval:()=>0,
  requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{},Date,console});
 vm.runInContext(fs.readFileSync(path.join(root,'js/ui/ui-navigation.js'),'utf8'),context);
 context.updateLiquidPodThumb=()=>{};
 context.initOrbitTabReorder();
 const event=(button,x=40)=>({button:0,target:button,pointerId:1,clientX:x,clientY:5,preventDefault:()=>{},stopImmediatePropagation:()=>{}});
 return {context,pod,buttons,store,events,event,hold:()=>{const tasks=[...timers.values()];timers.clear();tasks.forEach(fn=>fn());},order:()=>pod.children.map(b=>b.dataset.tab)};
}
test('long press reorders individual buttons and persists without moving the pod',()=>{
 const n=navigation();const startStyle={...n.pod.style};
 n.events.pointerdown(n.event(n.buttons[0])); n.hold();
 n.events.pointermove(n.event(n.buttons[0],205));n.events.pointerup({...n.event(n.buttons[0],205),type:'pointerup'});
 assert.deepEqual(n.order(),['friends','global','main-chats','news']);
 assert.deepEqual(n.pod.style,startStyle);
 const restored=navigation(n.store.get('orbit_pref_tab_order'));
 assert.deepEqual(restored.order(),n.order());
 let prevented=false;
 n.events.click({preventDefault:()=>prevented=true,stopImmediatePropagation:()=>{}});assert.equal(prevented,true);
});
test('scroll gesture does not reorder; cancelled drag restores original order',()=>{
 const n=navigation();const original=n.order();
 n.events.pointerdown(n.event(n.buttons[0]));n.events.pointermove(n.event(n.buttons[0],90));n.hold();
 n.events.pointerup({...n.event(n.buttons[0]),type:'pointerup'});assert.deepEqual(n.order(),original);
 n.events.pointerdown(n.event(n.buttons[0]));n.hold();n.events.pointermove(n.event(n.buttons[0],205));
 n.events.pointercancel({...n.event(n.buttons[0]),type:'pointercancel'});assert.deepEqual(n.order(),original);
 assert.equal(n.store.get('orbit_pref_tab_order'),'[]');
});
test('keyboard moves skip hidden tabs; corrupt saved order cannot drop buttons; reset restores defaults',()=>{
 const n=navigation('["global","global","unknown"]');
 assert.deepEqual(n.order(),['global','main-chats','friends','news']);
 n.buttons[0].style.display='none';
 n.events.keydown({target:n.buttons[2],altKey:true,key:'ArrowRight',preventDefault:()=>{}});
 assert.deepEqual(n.order(),['main-chats','friends','global','news']);
 n.context.resetOrbitTabOrder();assert.deepEqual(n.order(),['main-chats','friends','global','news']);
 assert.equal(navigation('{bad').order().length,4);
});
function glass({saved={},safari=false,reduced=false}={}) {
 const store=new Map(Object.entries(saved)), properties=new Map(), attrs=new Map(), frames=[];
 const controls={},events={},timers=new Map();const body={classList:classes(),prepend:()=>{}};
 const context=vm.createContext({window:{addEventListener:()=>{}},document:{body,hidden:false,addEventListener:(name,fn)=>events[name]=fn,querySelectorAll:()=>[],
  documentElement:{style:{setProperty:(k,v)=>properties.set(k,v)}},
  getElementById:id=>id.startsWith('glass-')?(controls[id]??={}):null,
  createElementNS:()=>({setAttribute:()=>{},style:{},querySelector:tag=>({setAttribute:(k,v)=>attrs.set(tag+':'+k,v)})})},
  localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  matchMedia:()=>({matches:reduced,addEventListener:()=>{}}),navigator:{userAgent:safari?'Safari':'Chrome Safari'},
  CSS:{supports:()=>true},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame:()=>{},performance:{now:()=>0},
  setTimeout:fn=>{timers.set(1,fn);return 1;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(fs.readFileSync(path.join(root,'js/liquid-glass.js'),'utf8'),context);
 return {context,body,store,properties,controls,attrs,frames,events,timers};
}
test('whole UI glass controls persist, support zero values and master disable',()=>{
 const g=glass();g.context.window.setOrbitGlassControl('speed',0);g.context.window.setOrbitGlassControl('saturation',0);
 g.context.window.setOrbitGlassControl('highlight',100);g.context.window.setOrbitGlassControl('enabled',0);
 const restored=glass({saved:Object.fromEntries(g.store)});
 assert.equal(restored.body.classList.contains('orbit-glass-enabled'),false);
 assert.equal(restored.controls['glass-enabled'].checked,false);
 assert.equal(restored.controls['glass-speed-value'].textContent,'Still');
 assert.match(restored.properties.get('--liquid-backdrop'),/saturate\(0%\)/);
 assert.equal(restored.properties.get('--liquid-highlight-alpha'),'1');
 restored.context.window.setOrbitGlassControl('enabled',1);
 assert.equal(restored.body.classList.contains('orbit-glass-enabled'),true);
});
test('Safari fallback keeps full blur; reduced motion retains static glass',()=>{
 const fallback=glass({safari:true,saved:{orbit_pref_blur:'18'}});
 assert.equal(fallback.properties.get('--liquid-surface-blur'),'18px');
 assert.doesNotMatch(fallback.properties.get('--liquid-backdrop'),/url\(/);
 const still=glass({reduced:true});assert.equal(still.frames.length,0);
 assert.equal(still.body.classList.contains('orbit-water-glass'),true);
});
test('balanced glass avoids global ripple animation; scrolling suspends filters and restores after idle',()=>{
 const g=glass();g.events.pointermove();assert.equal(g.frames.length,0);
 g.events.scroll();assert.equal(g.body.classList.contains('orbit-glass-scrolling'),true);
 [...g.timers.values()].forEach(fn=>fn());assert.equal(g.body.classList.contains('orbit-glass-scrolling'),false);
 g.context.window.setOrbitGlassQuality('full');g.events.pointermove();assert.equal(g.frames.length,1);
 g.context.window.setOrbitGlassQuality('fast');assert.doesNotMatch(g.properties.get('--liquid-backdrop'),/url\(/);
 assert.equal(glass({saved:Object.fromEntries(g.store)}).controls['glass-quality'].value,'fast');
});
