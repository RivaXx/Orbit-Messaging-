// Recover from browser quota exhaustion without clearing personal local data.
(()=>{
 'use strict';
 const nativeSet=Storage.prototype.setItem;
 const cacheKey=key=>key==='orbit_global_cache_v26'||/^orbit_(recent_chats_v27_|groups_cache_|cache_msgs_)/.test(key);
 function disposable(key,value){
  if(!cacheKey(key))return false;
  if(!key.startsWith('orbit_cache_msgs_'))return true;
  try{return JSON.parse(value||'[]').every(m=>!['sending','queued','failed','error'].includes(m.status)&&!JSON.stringify(m).match(/(?:blob:|data:(?:image|video|audio))/));}catch(_){return false;}
 }
 Storage.prototype.setItem=function(key,value){
  key=String(key);value=String(value);
  if(this!==window.localStorage)return nativeSet.call(this,key,value);
  // Re-downloadable directory/history snapshots must not monopolize localStorage.
  if(cacheKey(key)&&value.length>256*1024&&disposable(key,value))return;
  try{return nativeSet.call(this,key,value);}catch(error){
   if(!['QuotaExceededError','NS_ERROR_DOM_QUOTA_REACHED'].includes(error.name)&&error.code!==22&&error.code!==1014)throw error;
   const candidates=[];
   for(let i=0;i<this.length;i++){const k=this.key(i),v=this.getItem(k);if(k!==key&&disposable(k,v))candidates.push({key:k,size:v.length});}
   candidates.sort((a,b)=>b.size-a.size);
   for(const candidate of candidates){
    this.removeItem(candidate.key);
    try{return nativeSet.call(this,key,value);}catch(retry){if(retry.name!==error.name&&retry.code!==error.code)throw retry;}
   }
   // Losing an optional cache is safe; drafts/auth/settings still report failure.
   if(disposable(key,value))return;
   window.dispatchEvent(new CustomEvent('orbit-storage-full'));
   throw error;
  }
 };
})();
