// Local image editing. Edits are baked into the uploaded file, not captions.
let orbitEditorItem=null,orbitEditorCanvas=null,orbitEditorMode='draw',orbitEditorHistory=[],orbitEditorPointer=false,orbitEditorBusy=false;
function orbitBlobFromData(url){const [head,data]=url.split(',');return new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:head.match(/:(.*?);/)[1]});}
function orbitImage(url){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Could not load this image.'));img.src=url;});}
function orbitSaveCaption(){const item=mediaPreviewList[currentPreviewIndex];if(item)item.caption=document.getElementById('media-preview-caption-input')?.value||'';}
function orbitUpdateEditedImage(item,canvas){
    if(item.url?.startsWith('blob:'))URL.revokeObjectURL(item.url);
    item.file=orbitBlobFromData(canvas.toDataURL('image/jpeg',.94));item.url=URL.createObjectURL(item.file);item.rotation=0;item.name=item.name.replace(/\.[^.]+$/,'')+'.jpg';
}
async function handleMediaSelection(input){
    if(!currentUser||!currentRoom){showToast('Open a chat before selecting media.','error');input.value='';return;}
    const items=Array.from(input.files||[]).filter(file=>file.type.startsWith('image/')||file.type.startsWith('video/')).map(file=>({file,url:URL.createObjectURL(file),name:file.name,type:file.type.startsWith('video/')?'video':'image',caption:'',rotation:0}));
    input.value='';if(!items.length)return;
    if(document.getElementById('modal-media-preview').classList.contains('active')){
        orbitSaveCaption();mediaPreviewList.push(...items);currentPreviewIndex=mediaPreviewList.length-items.length;renderPreviewCarousel();renderPreviewThumbStrip();
    }else openMediaPreviewScreen(items);
}
async function snapCameraToPreview(){
    const video=document.getElementById('live-camera-video');if(!video?.videoWidth){showToast('Wait for the camera to start.');return;}
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);
    closeLiveCameraModal();const file=orbitBlobFromData(canvas.toDataURL('image/jpeg',.94));
    openMediaPreviewScreen([{file,url:URL.createObjectURL(file),type:'image',name:`Photo_${Date.now()}.jpg`}]);
}
async function openOrbitMediaEditor(mode='draw'){
    orbitSaveCaption();const item=mediaPreviewList[currentPreviewIndex];if(!item||item.type!=='image'){showToast('This editor is available for photos.');return;}
    if(orbitEditorBusy)return;orbitEditorBusy=true;
    try{
        const img=await orbitImage(item.url);if(mediaPreviewList[currentPreviewIndex]!==item)return;
        orbitEditorItem=item;orbitEditorCanvas=document.getElementById('orbit-editor-canvas');
        const rotated=item.rotation%180!==0,w=rotated?img.height:img.width,h=rotated?img.width:img.height,scale=Math.min(1,2400/Math.max(w,h));
        orbitEditorCanvas.width=Math.round(w*scale);orbitEditorCanvas.height=Math.round(h*scale);
        const ctx=orbitEditorCanvas.getContext('2d');ctx.save();ctx.translate(orbitEditorCanvas.width/2,orbitEditorCanvas.height/2);ctx.rotate(item.rotation*Math.PI/180);ctx.drawImage(img,-img.width*scale/2,-img.height*scale/2,img.width*scale,img.height*scale);ctx.restore();
        orbitEditorHistory=[];orbitRememberEdit();setOrbitEditorMode(mode);document.getElementById('modal-orbit-editor').classList.add('active');
    }catch(error){showToast(error.message,'error');}finally{orbitEditorBusy=false;}
}
function setOrbitEditorMode(mode){orbitEditorMode=mode;document.querySelectorAll('[data-editor-mode]').forEach(b=>b.classList.toggle('active',b.dataset.editorMode===mode));document.getElementById('orbit-editor-text').classList.toggle('hide',mode!=='text');document.getElementById('orbit-editor-stickers').classList.toggle('hide',mode!=='sticker');document.getElementById('orbit-editor-filters').classList.toggle('hide',mode!=='filter');document.getElementById('orbit-editor-help').textContent={draw:'Draw on the photo. Use Undo to remove the last stroke.',text:'Enter text, then tap the photo to place it.',sticker:'Choose an emoji, then tap the photo to place it.',filter:'Choose a filter. The actual photo pixels will change.'}[mode];}
function orbitRememberEdit(){orbitEditorHistory.push(orbitEditorCanvas.toDataURL('image/png'));if(orbitEditorHistory.length>10)orbitEditorHistory.shift();}
async function undoOrbitMediaEdit(){if(orbitEditorBusy||orbitEditorHistory.length<2)return;orbitEditorBusy=true;try{orbitEditorHistory.pop();const img=await orbitImage(orbitEditorHistory.at(-1));orbitEditorCanvas.getContext('2d').drawImage(img,0,0);}finally{orbitEditorBusy=false;}}
function orbitEditorPosition(event){const bounds=orbitEditorCanvas.getBoundingClientRect();return[(event.clientX-bounds.left)*orbitEditorCanvas.width/bounds.width,(event.clientY-bounds.top)*orbitEditorCanvas.height/bounds.height];}
function orbitEditorPointerDown(event){
    if(orbitEditorBusy||!orbitEditorItem||orbitEditorMode==='filter')return;event.preventDefault();const [x,y]=orbitEditorPosition(event),ctx=orbitEditorCanvas.getContext('2d'),color=document.getElementById('orbit-editor-color').value;
    if(orbitEditorMode==='draw'){orbitEditorPointer=true;orbitEditorCanvas.setPointerCapture(event.pointerId);ctx.beginPath();ctx.moveTo(x,y);ctx.strokeStyle=color;ctx.lineWidth=Math.max(2,orbitEditorCanvas.width/180);ctx.lineCap='round';ctx.lineJoin='round';}
    else{
        const text=orbitEditorMode==='text'?document.getElementById('orbit-editor-text').value:document.getElementById('orbit-editor-emoji').value;
        if(!text.trim()){showToast('Enter text first.');return;}
        const size=Math.max(24,orbitEditorCanvas.width/18);ctx.font=`700 ${size}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;ctx.shadowColor='#000';ctx.shadowBlur=size/8;ctx.fillText(text,x,y,orbitEditorCanvas.width*.95);ctx.shadowBlur=0;orbitRememberEdit();
    }
}
function orbitEditorPointerMove(event){if(!orbitEditorPointer)return;const [x,y]=orbitEditorPosition(event),ctx=orbitEditorCanvas.getContext('2d');ctx.lineTo(x,y);ctx.stroke();}
function orbitEditorPointerUp(){if(!orbitEditorPointer)return;orbitEditorPointer=false;orbitRememberEdit();}
async function applyOrbitMediaFilter(filter){
    if(orbitEditorBusy)return;orbitEditorBusy=true;
    try{const img=await orbitImage(orbitEditorCanvas.toDataURL());const ctx=orbitEditorCanvas.getContext('2d');ctx.filter={vivid:'saturate(1.5) contrast(1.1)',mono:'grayscale(1)',warm:'sepia(.35) saturate(1.25)',bright:'brightness(1.2)'}[filter]||'none';ctx.drawImage(img,0,0);ctx.filter='none';orbitRememberEdit();}
    finally{orbitEditorBusy=false;}
}
function closeOrbitMediaEditor(){document.getElementById('modal-orbit-editor').classList.remove('active');orbitEditorItem=null;orbitEditorPointer=false;orbitEditorHistory=[];}
function applyOrbitMediaEdits(){if(orbitEditorBusy||!orbitEditorItem)return;if(mediaPreviewList[currentPreviewIndex]!==orbitEditorItem){closeOrbitMediaEditor();return;}orbitUpdateEditedImage(orbitEditorItem,orbitEditorCanvas);closeOrbitMediaEditor();renderPreviewCarousel();renderPreviewThumbStrip();}
function promptPreviewTextOverlay(){openOrbitMediaEditor('text');}
function togglePreviewDoodle(){openOrbitMediaEditor('draw');}
function triggerAiRestyle(){openOrbitMediaEditor('filter');}
function openOrbitStickerEditor(){openOrbitMediaEditor('sticker');}
async function downloadPreviewMedia(){
    const item=mediaPreviewList[currentPreviewIndex];if(!item)return;
    let url=item.url;
    if(item.type==='image'&&item.rotation)url=await bakeImageRotation(url,item.rotation);
    const link=document.createElement('a');link.href=url;link.download=item.name||'Orbit-photo.jpg';link.click();
}
function toggleViewOnceMode(){
    const item=mediaPreviewList[currentPreviewIndex];if(!item)return;
    if(item.type!=='image'||isGroupChat||isSelfChat){showToast('View once is available for photos in direct chats.');return;}
    item.viewOnce=!item.viewOnce;isViewOnceActive=item.viewOnce;document.getElementById('btn-view-once-toggle').classList.toggle('active',item.viewOnce);document.getElementById('btn-view-once-toggle').setAttribute('aria-pressed',String(item.viewOnce));document.getElementById('preview-view-once-hint').classList.toggle('hide',!item.viewOnce);
}
async function sendPreviewMediaBatch(){
    if(isSendingPreviewMediaBatch)return;orbitSaveCaption();
    const room=mediaPreviewTargetRoom,owner=mediaPreviewTargetUser;if(!mediaPreviewList.length||currentRoom!==room||currentUser?.id!==owner){showToast('Reopen media from the original chat.','error');return;}
    isSendingPreviewMediaBatch=true;document.getElementById('modal-media-preview').classList.add('preview-sending');
    try{
        while(mediaPreviewList.length){
            if(currentRoom!==room||currentUser?.id!==owner)throw new Error('The signed-in account or chat changed.');
            const item=mediaPreviewList[0];await queueMediaMessage([{...item}],item.caption||'');
            mediaPreviewList.shift();if(item.url?.startsWith('blob:'))URL.revokeObjectURL(item.url);
        }
        closeMediaPreviewScreen();
    }catch(error){currentPreviewIndex=0;renderPreviewCarousel();renderPreviewThumbStrip();showToast(error.message,'error');}
    finally{isSendingPreviewMediaBatch=false;document.getElementById('modal-media-preview').classList.remove('preview-sending');}
}
const orbitEditorStage=document.getElementById('orbit-editor-canvas');
orbitEditorStage.addEventListener('pointerdown',orbitEditorPointerDown);orbitEditorStage.addEventListener('pointermove',orbitEditorPointerMove);
orbitEditorStage.addEventListener('pointerup',orbitEditorPointerUp);orbitEditorStage.addEventListener('pointercancel',orbitEditorPointerUp);

const orbitOriginalViewOnceOpen=window.openViewOnceMedia;
let orbitViewOnceBusy=false;
window.openViewOnceMedia=async function(msgId,url,isOwn=false){
    if(orbitViewOnceBusy)return;
    if(isOwn){orbitOriginalViewOnceOpen(msgId,url,true);return;}
    orbitViewOnceBusy=true;
    try{
        const allowed=await orbitRpc('orbit_claim_view_once',{message_key:msgId});
        if(!allowed){showToast('This view-once photo has already been opened or is unavailable.');return;}
        orbitOriginalViewOnceOpen(msgId,url,false);
    }catch(error){showToast(`Could not open photo: ${error.message}`,'error');}
    finally{orbitViewOnceBusy=false;}
};

function orbitFitPhotoPreview(){const modal=document.getElementById('modal-media-preview');if(!modal?.classList.contains('active'))return;modal.style.setProperty('--orbit-preview-height',`${window.visualViewport?.height||window.innerHeight}px`);modal.style.setProperty('--orbit-preview-top',`${window.visualViewport?.offsetTop||0}px`);}
window.visualViewport?.addEventListener('resize',orbitFitPhotoPreview);window.visualViewport?.addEventListener('scroll',orbitFitPhotoPreview);window.addEventListener('resize',orbitFitPhotoPreview);
