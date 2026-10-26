// View-once metadata is normalized before any rendering or sharing decision.
function orbitMessageAttachments(message){
    let list=message?.attachments||[];
    if(typeof list==='string'){try{list=JSON.parse(list);}catch{list=[list];}}
    return (Array.isArray(list)?list:[list]).map(item=>{if(typeof item==='string'){try{return JSON.parse(item);}catch{return {url:item};}}return item;}).filter(Boolean);
}
function orbitIsViewOnceMessage(message){return orbitMessageAttachments(message).some(item=>item.view_once===true||item.view_once==='true');}
function orbitViewOnceKey(id){return `orbit_view_once_${currentUser?.id||'signed-out'}_${id}`;}
function orbitMarkViewOnceOpened(id){
    try{localStorage.setItem(orbitViewOnceKey(id),'opened');}catch(_){}
    const card=document.querySelector(`[data-view-once-id="${id}"]`);
    if(card){card.classList.remove('unopened');card.classList.add('opened');card.onclick=null;card.setAttribute('aria-label','View-once photo opened');card.querySelector('.view-once-title').textContent='Opened';card.querySelector('.view-once-subtitle').textContent='This photo cannot be reopened';}
}
async function uploadOrbitPrivatePhoto(body,name,id,index,onProgress){
    if(!(body instanceof Blob)||!body.size)throw new Error('The photo is unavailable. Select it again.');
    if(body.size>10485760)throw new Error('View-once photos must be below 10 MB. Use Standard quality.');
    const owner=currentUser?.id,client=await ensureSupabase();
    if(!owner)throw new Error('Sign in before sending photos.');
    const sessionResult=await client.auth.getSession();
    if(sessionResult.error)throw sessionResult.error;
    const session=await ensureCompactAuthSession(client,sessionResult.data?.session);
    if(session?.user?.id!==owner||currentUser?.id!==owner)throw new Error('Sign in again before sending this photo.');
    const path=`${owner}/${id}_${index}.jpg`;
    onProgress?.({loaded:0,total:body.size,percent:0});
    const {error}=await client.storage.from('orbit-view-once').upload(path,body,{contentType:body.type||'image/jpeg',cacheControl:'0',upsert:false});
    if(error&&!['409','Duplicate'].includes(String(error.statusCode||error.code))&&!/already exists|duplicate/i.test(error.message||''))throw error;
    if(currentUser?.id!==owner)throw new Error('The signed-in account changed.');
    onProgress?.({loaded:body.size,total:body.size,percent:100});
    return {url:`orbit-once://${id}`,storage_bucket:'orbit-view-once',storage_path:path};
}
let orbitPrivateViewerUrl=null,orbitPrivateViewerOwner=null,orbitPrivateOpening=false,orbitPrivateViewerEpoch=0,orbitPrivateAbort=null;
window.openViewOnceMedia=async function(id){
    if(orbitPrivateOpening)return;
    const message=_findViewOnceMessage(id);
    if(!message||message.sender_id===currentUser?.id){showToast('Sent view-once photos cannot be reopened.');return;}
    const attachment=orbitMessageAttachments(message).find(item=>item.view_once===true||item.view_once==='true');
    if(!attachment){showToast('This photo is unavailable.');return;}
    if(attachment.upload_pending||['queued','sending'].includes(message.status)){showToast('This photo is still uploading.');return;}
    if(localStorage.getItem(orbitViewOnceKey(id))==='opened'){showToast('This photo has already been opened.');return;}
    orbitPrivateOpening=true;const owner=currentUser?.id,epoch=++orbitPrivateViewerEpoch;
    try{
        const client=await ensureSupabase();
        const sessionResult=await client.auth.getSession();
        if(sessionResult.error)throw sessionResult.error;
        const session=await ensureCompactAuthSession(client,sessionResult.data?.session);
        if(session?.user?.id!==owner)throw new Error('Sign in again to open this photo.');
        let blob;
        if(attachment.storage_bucket==='orbit-view-once'){
            const controller=new AbortController();orbitPrivateAbort=controller;const timer=setTimeout(()=>controller.abort(),25000);
            try{
                const response=await fetch(`${SB_URL}/functions/v1/orbit-view-once`,{method:'POST',headers:{Authorization:`Bearer ${SB_KEY}`,apikey:SB_KEY,'x-orbit-user-token':session.access_token,'Content-Type':'application/json'},body:JSON.stringify({messageId:id}),signal:controller.signal,cache:'no-store',credentials:'omit'});
                if(!response.ok){if(response.status===410)orbitMarkViewOnceOpened(id);throw new Error(response.status===410?'This photo has already been opened or is unavailable.':'Could not open this photo. Check your connection and try again.');}
                blob=await response.blob();
            }finally{clearTimeout(timer);if(orbitPrivateAbort===controller)orbitPrivateAbort=null;}
        }else{
            throw new Error('This older photo is being secured. Reload the chat shortly.');
        }
        if(attachment.encrypted)blob=await OrbitCrypto.decryptAttachment(blob,attachment,message.sender_id);
        if(currentUser?.id!==owner||epoch!==orbitPrivateViewerEpoch)return;
        orbitMarkViewOnceOpened(id);
        orbitPrivateViewerUrl=URL.createObjectURL(blob);orbitPrivateViewerOwner=owner;
        const image=document.getElementById('view-once-main-img');image.src=orbitPrivateViewerUrl;image.draggable=false;
        image.oncontextmenu=event=>event.preventDefault();image.onerror=()=>{closeViewOnceViewer();showToast('Could not display this photo.','error');};
        const modal=document.getElementById('modal-view-once-viewer');modal.classList.remove('hide');modal.classList.add('active');modal.setAttribute('aria-hidden','false');
    }catch(error){if(epoch===orbitPrivateViewerEpoch)showToast(error.message,'error');}
    finally{orbitPrivateOpening=false;}
};
window.closeViewOnceViewer=function(){
    orbitPrivateViewerEpoch++;orbitPrivateAbort?.abort();orbitPrivateAbort=null;
    const image=document.getElementById('view-once-main-img');image.onload=null;image.onerror=null;image.removeAttribute('src');
    if(orbitPrivateViewerUrl)URL.revokeObjectURL(orbitPrivateViewerUrl);orbitPrivateViewerUrl=null;orbitPrivateViewerOwner=null;
    const modal=document.getElementById('modal-view-once-viewer');modal.classList.remove('active');modal.classList.add('hide');modal.setAttribute('aria-hidden','true');
};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(orbitPrivateViewerUrl||orbitPrivateOpening))closeViewOnceViewer();});
window.addEventListener('pagehide',()=>closeViewOnceViewer());
window.addEventListener('blur',()=>{if(orbitPrivateViewerUrl||orbitPrivateOpening)closeViewOnceViewer();});
