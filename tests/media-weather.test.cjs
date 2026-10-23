const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
function mediaContext(){
 const toasts=[],store=new Map(),events=[];
 const context=vm.createContext({window:{addEventListener:()=>{}},document:{getElementById:()=>null,querySelector:()=>null,addEventListener:()=>{}},
  navigator:{onLine:true},Blob,File,URL:{createObjectURL:()=> 'blob:preview',revokeObjectURL:()=>events.push('revoke')},crypto,
  localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},console:{warn:()=>{},error:()=>{}},
  setTimeout,clearTimeout,setInterval:()=>0,clearInterval:()=>{},
  currentRoom:'room',currentUser:{id:'user',email:'user@example.com'},activeChatPeerId:null,isGroupChat:false,userProfile:{},
  isPreviewHdQuality:false,replyTargetMessage:null,messageCache:new Map(),
  showToast:message=>toasts.push(message),appendSingleMessageNode:()=>{},scrollFeedToBottom:()=>{},
  updateBubbleSendingProgress:()=>{},updateChatMediaUploadProgress:()=>{},hideChatMediaUploadProgress:()=>{},
  getOrbitStorageObjectPath:()=> 'images/user/file.jpg'});
 vm.runInContext(fs.readFileSync(path.join(root,'js/chat/chat-dispatcher.js'),'utf8'),context);
 return {context,toasts,events};
}

test('queued photos persist the chosen SD, HD or original mode in attachment metadata',async()=>{
 for(const quality of ['sd','hd','original']){
  const {context:c}=mediaContext();c.isPreviewHdQuality=quality==='hd';c._deliverOutboxMessage=async()=>{};
  c.ensureSupabase=async()=>({rpc:async()=>({error:null})});
  const file=new Blob(['photo bytes'],{type:'image/jpeg'});
  await c.queueMediaMessage([{file,name:'photo.jpg',type:'image',originalQuality:quality==='original'}]);
  const item=vm.runInContext('Array.from(_messageOutbox.values())[0]',c);await item.mediaReadyPromise;
  assert.equal(item.payload.attachments[0].quality,quality);
  await c._deleteOutboxMedia(item.payload.id);
 }
});
test('denied IndexedDB does not prevent photos, videos or files from entering the upload queue',async()=>{
 for(const type of ['image/png','video/mp4','application/pdf']){
  const {context:c,toasts}=mediaContext();let delivered;
  c._deliverOutboxMessage=async id=>{delivered=id;};
  const file=new Blob(['original bytes'],{type});file.name='example';
  await c.queueMediaMessage([{file,name:'example',type:type.split('/')[0]}]);
  const item=vm.runInContext('Array.from(_messageOutbox.values())[0]',c);
  await item.mediaReadyPromise;await Promise.resolve();
  assert.equal(delivered,item.payload.id);
  assert.equal(await (await c._getOutboxMedia(item.payload.id,0)).text(),'original bytes');
  assert.ok(toasts.some(message=>message.includes('Keep this tab open')));
  await c._deleteOutboxMedia(item.payload.id);
  assert.equal(vm.runInContext('_mediaOutboxMemory.size',c),0);
 }
});
test('failed disk write retains original bytes and retries use memory',async()=>{
 const {context:c}=mediaContext();
 c._openMediaOutboxDb=async()=>({transaction:()=>{throw new Error('DataCloneError');}});
 const file=new Blob(['video bytes']);assert.equal(await c._storeOutboxMedia('msg',0,file),false);
 assert.equal(await c._getOutboxMedia('msg',0),file);
});
test('single media preview is swapped before its blob URL is revoked',async()=>{
 const {context:c,events}=mediaContext();const file=new Blob(['photo']);
 await c._storeOutboxMedia('msg',0,file);
 c.uploadMediaToStorage=async()=> 'https://example.com/photo.jpg';
 c._persistMessageOutbox=()=>{};
 c._updateOutboxMessage=item=>{assert.equal(item.payload.attachments[0].url,'https://example.com/photo.jpg');events.push('swap');};
 const item={payload:{id:'msg',sender_id:'user',attachments:[{url:'blob:preview',size:5,upload_pending:true}]},
  mediaUploadInfo:[{index:0,name:'photo.jpg',mime:'image/jpeg',type:'image',prepared:true}]};
 await c._uploadQueuedMedia(item);assert.deepEqual(events,['swap','revoke']);
});
function weatherContext({airFailure=false}={}){
 const elements=new Map(),classes=new Set(),requests=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',dataset:{},replaceChildren(...children){this.children=children;},classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),toggle:()=>{}}});return elements.get(id);};
 const data={timezone:'UTC',current:{time:1700000000,temperature_2m:23,weather_code:0,is_day:1,relative_humidity_2m:0,apparent_temperature:22,wind_speed_10m:12,precipitation:0,surface_pressure:1010},
  daily:{temperature_2m_max:[28],temperature_2m_min:[18],precipitation_probability_max:[0],uv_index_max:[4.5],sunrise:[1700000000],sunset:[1700040000]}};
 const context=vm.createContext({currentUser:{id:'user'},document:{hidden:false,getElementById:element,createElement:()=>({}),addEventListener:()=>{}},window:{addEventListener:()=>{}},
  localStorage:{getItem:()=> 'true'},navigator:{},AbortController,Date,console,setTimeout:()=>0,clearTimeout:()=>{},
  fetch:async url=>{requests.push(url);if(url.includes('air-quality')){if(airFailure)throw Error('offline');return {ok:true,json:async()=>({current:{time:1700000000,us_aqi:51,pm2_5:10,pm10:20}})};}
   return {ok:true,json:async()=>url.includes('forecast')?data:{city:'Test city'}};}});
 vm.runInContext(fs.readFileSync(path.join(root,'js/orbit-banner-weather.js'),'utf8'),context);
 context.getOrbitPreciseWeatherLocation=async()=>({coords:{latitude:0,longitude:0,accuracy:10}});
 return {context,element,requests};
}
test('weather shows humidity, AQI scale and pollutants without treating zero as missing',async()=>{
 const {context:c,element,requests}=weatherContext();await c.refreshOrbitWeather(true);
 assert.equal(element('orbit-weather-humidity').textContent,'0%');
 assert.equal(element('orbit-weather-chance').textContent,'0%');
 assert.equal(element('orbit-weather-aqi').textContent,'51 · Moderate');
 assert.equal(element('orbit-weather-pm25').textContent,'10.0 µg/m³');
 assert.match(element('orbit-weather-position').children[0].textContent,/0\.00000, 0\.00000.*±10 m/);
 assert.equal(element('orbit-weather-position').children[1].href,'https://www.google.com/maps?q=0,0');
 assert.equal(c.orbitWeatherPlaceName({locality:'Village',city:'Town',principalSubdivision:'State',countryName:'Country'}),'Village, Town, State, Country');
 assert.match(element('orbit-weather-details').textContent,/AQI \(US\) 51/);
 assert.ok(requests.some(url=>url.includes('relative_humidity_2m')));
 assert.equal(c.orbitAqiCategory(null),'Unavailable');
 assert.equal(c.orbitAqiCategory(50),'Good');assert.equal(c.orbitAqiCategory(151),'Unhealthy');
});
test('air quality outage leaves weather usable and labels AQI unavailable',async()=>{
 const {context:c,element}=weatherContext({airFailure:true});await c.refreshOrbitWeather(true);
 assert.match(element('orbit-weather-label').textContent,/23°/);
 assert.equal(element('orbit-weather-aqi').textContent,'Unavailable');
 assert.match(element('orbit-weather-air-status').textContent,/temporarily unavailable/);
 c.stopOrbitWeather();assert.equal(element('orbit-weather-updated').textContent,'');
});
