const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../js/calculator.js'),'utf8');
function fixture(initial={}) {
 const storage=new Map(Object.entries(initial)),nodes=new Map(),toasts=[],released=[],pending=[];
 const node=id=>{if(!nodes.has(id)){const classes=new Set();nodes.set(id,{style:{setProperty(k,v){this[k]=v;}},dataset:{},attributes:{},classList:{add(...v){v.forEach(x=>classes.add(x));},remove(...v){v.forEach(x=>classes.delete(x));},contains:x=>classes.has(x),toggle(x,on){on?classes.add(x):classes.delete(x);}},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,fn){this[k]=fn;},click(){this.clicked=true;}});}return nodes.get(id);};
 const c=vm.createContext({console:{warn(){}},document:{getElementById:node,addEventListener(){},createElement(){return {getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,YWJj'};}},localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){storage.set(k,String(v));},removeItem:k=>storage.delete(k)},showToast:(...a)=>toasts.push(a),Image:class{width=2000;height=1000;set src(v){pending.push(()=>this.onload());}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:x=>released.push(x)},window:{},setTimeout(){},clearTimeout(){}});
 vm.runInContext(source,c);return {c,node,storage,toasts,released,pending};
}
test('calculator size clamps at bounds, repairs invalid preferences and restores bold',()=>{
 const {c,node,storage}=fixture({orbit_calc_fontscale:'bad',orbit_calc_bold:'true'});c.applyCalcFontSettings();assert.equal(node('calc-font-label').textContent,'M');assert.equal(node('calc-bold-btn').attributes['aria-pressed'],'true');
 for(let n=0;n<8;n++)c.adjustCalcFontSize(-1);assert.equal(storage.get('orbit_calc_fontscale'),'-2');assert.equal(node('calc-font-smaller').disabled,true);assert.equal(node('calc-font-label').textContent,'XS');
 for(let n=0;n<8;n++)c.adjustCalcFontSize(1);assert.equal(storage.get('orbit_calc_fontscale'),'2');assert.equal(node('calc-font-larger').disabled,true);assert.equal(node('calc-font-label').textContent,'XL');
 c.toggleCalcFontBold();assert.equal(node('calc-theme-wrapper').classList.contains('calc-font-normal'),true);assert.equal(node('calc-bold-btn').attributes['aria-pressed'],'false');assert.equal(storage.get('orbit_calc_bold'),'false');
 const restored=fixture(Object.fromEntries(storage));restored.c.applyCalcFontSettings();assert.equal(restored.node('calc-font-label').textContent,'XL');assert.equal(restored.node('calc-bold-btn').attributes['aria-pressed'],'false');
});
test('long values shrink without replacing the selected CSS font size',()=>{
 const {c,node}=fixture();vm.runInContext("calcCurrentVal='12345678901234'",c);c.updateCalcDisplay();assert.equal(node('calc-val-display').style.fontSize,'');assert.equal(node('calc-val-display').style['--calc-value-fit'],'0.5');
});
test('wallpaper chooser binds before first calculator initialization',()=>{const {c,node}=fixture();c.chooseCalcWallpaper();assert.equal(node('calc-wallpaper-input').clicked,true);assert.equal(node('calc-wallpaper-input').change,c.saveCalcWallpaper);});
test('wallpaper converts, persists, restores and removes; cancellation preserves it',async()=>{
 const {c,node,storage,released,pending}=fixture();const input={files:[{name:'photo.png',type:'image/png',size:1024}],value:'photo'};const saved=c.saveCalcWallpaper({target:input});pending.shift()();await saved;
 assert.equal(input.value,'');assert.equal(storage.get('orbit_calc_wallpaper'),'data:image/jpeg;base64,YWJj');assert.equal(node('tab-calculator').classList.contains('calc-has-wallpaper'),true);assert.equal(released.length,1);
 await c.saveCalcWallpaper({target:{files:[],value:''}});assert.ok(storage.has('orbit_calc_wallpaper'));
 const restored=fixture(Object.fromEntries(storage));restored.c.applyCalcWallpaper(restored.storage.get('orbit_calc_wallpaper'));assert.match(restored.node('tab-calculator').style['--calc-wallpaper'],/^url/);
 c.clearCalcWallpaper();assert.equal(storage.has('orbit_calc_wallpaper'),false);assert.equal(node('tab-calculator').style['--calc-wallpaper'],'none');
});
test('invalid wallpaper and full storage preserve previous photo and never report success',async()=>{
 const {c,node,storage,toasts,pending,released}=fixture({orbit_calc_wallpaper:'data:image/jpeg;base64,b2xk'});c.applyCalcWallpaper(storage.get('orbit_calc_wallpaper'));
 await c.saveCalcWallpaper({target:{files:[{type:'text/html',size:10}],value:''}});assert.equal(toasts.at(-1)[1],'error');
 c.localStorage.setItem=()=>{throw Error('QuotaExceededError');};const save=c.saveCalcWallpaper({target:{files:[{name:'photo.jpg',type:'',size:10}],value:''}});pending.shift()();await save;
 assert.match(toasts.at(-1)[0],/storage is full/);assert.equal(storage.get('orbit_calc_wallpaper'),'data:image/jpeg;base64,b2xk');assert.equal(released.length,1);assert.equal(node('tab-calculator').style['--calc-wallpaper'],'url("data:image/jpeg;base64,b2xk")');
});
test('clearing while an image is loading cannot restore it later',async()=>{
 const {c,node,storage,pending,released}=fixture();const save=c.saveCalcWallpaper({target:{files:[{type:'image/png',size:10}],value:''}});c.clearCalcWallpaper();pending.shift()();await save;assert.equal(storage.has('orbit_calc_wallpaper'),false);assert.equal(node('tab-calculator').style['--calc-wallpaper'],'none');assert.equal(released.length,1);
});
