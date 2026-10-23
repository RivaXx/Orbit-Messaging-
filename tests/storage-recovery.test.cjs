const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(){let limit=100000;class Storage{constructor(){this.data=new Map();}get length(){return this.data.size;}key(i){return [...this.data.keys()][i];}getItem(k){return this.data.get(k)||null;}removeItem(k){this.data.delete(k);}setItem(k,v){const size=[...this.data].filter(([key])=>key!==k).reduce((n,[key,val])=>n+key.length+val.length,0)+k.length+v.length;if(size>limit){const e=new Error('full');e.name='QuotaExceededError';throw e;}this.data.set(k,String(v));}}
 const local=new Storage(),session=new Storage(),events=[];const c=vm.createContext({Storage,window:{localStorage:local,dispatchEvent:e=>events.push(e.type)},CustomEvent:class{constructor(type){this.type=type;}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/storage-recovery.js'),'utf8'),c);return {local,session,events,limit:n=>limit=n};}
test('quota recovery frees only regenerable cache and retries the actual save',()=>{
 const f=fixture();f.local.setItem('orbit_global_cache_v26','x'.repeat(500));f.local.setItem('orbit_draft_room','unsent draft');f.local.setItem('sb-project-auth-token','session');f.limit(250);
 f.local.setItem('orbit_theme','light');assert.equal(f.local.getItem('orbit_theme'),'light');assert.equal(f.local.getItem('orbit_global_cache_v26'),null);assert.equal(f.local.getItem('orbit_draft_room'),'unsent draft');assert.equal(f.local.getItem('sb-project-auth-token'),'session');
});
test('pending uploads, local-only media, notes and preferences survive quota errors',()=>{
 const f=fixture();for(const [key,value] of [['orbit_cache_msgs_pending',JSON.stringify([{status:'failed',text:'pending'}])],['orbit_cache_msgs_media',JSON.stringify([{status:'sent',text:'data:image/jpeg;original'}])],['orbit_notes_me','private notes'],['orbit_calc_wallpaper','saved image']])f.local.setItem(key,value);
 f.limit(1);assert.throws(()=>f.local.setItem('orbit_draft_room','draft'));assert.ok(f.local.getItem('orbit_cache_msgs_pending'));assert.ok(f.local.getItem('orbit_cache_msgs_media'));assert.equal(f.local.getItem('orbit_notes_me'),'private notes');assert.equal(f.local.getItem('orbit_calc_wallpaper'),'saved image');assert.deepEqual(f.events,['orbit-storage-full']);
});
test('an optional cache write does not crash the app when no space can be freed',()=>{const f=fixture();f.limit(10);f.local.setItem('orbit_global_cache_v26','directory');assert.equal(f.local.getItem('orbit_global_cache_v26'),null);});
