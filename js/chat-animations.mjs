import {MediaCache} from './chat-animation-cache.mjs';
import {describeRichImage,staticMediaPreview} from './rich-image.mjs';

const cache=new MediaCache(24*1024*1024), visible=new Set(), playing=new Set(), loading=new Set();
const nodes=new WeakMap(), system=matchMedia('(prefers-reduced-motion: reduce)');
const feed=document.getElementById('chat-feed');
const toggle=document.getElementById('orbit-chat-motion');
let generation=0, scheduled=false;

function reduced(){
    try{return system.matches||localStorage.getItem('orbit_chat_reduce_motion')==='true';}
    catch{return system.matches;}
}
const supports=msg=>!!msg&&!msg.is_deleted&&!msg.deleted_at&&!msg._e2ee_locked&&
    msg.attachments?.length===1&&msg.attachments[0]?.type==='image'&&!msg.attachments[0].view_once&&
    !(msg.attachments[0].size>12*1024*1024)&&
    (['gif','sticker'].includes(msg.metadata?.orbit_media)||msg.attachments[0].mime==='image/gif');
function stop(item){
    if(item.url){URL.revokeObjectURL(item.url);item.url=null;}
    if(playing.delete(item))item.image.removeAttribute('src');
    item.node.toggleAttribute('data-playing',false);
}
function remove(item){
    stop(item);visible.delete(item);observer.unobserve(item.node);
    item.poster.removeAttribute('src');nodes.delete(item.node);
}
function showPoster(item,asset){
    if(asset?.poster)item.poster.src=asset.poster;
}
function keyFor(item){
    const att=item.msg.attachments[0];
    return (currentUser?.id||'')+':'+(att.digest||item.msg.id);
}
async function assetFor(item){
    const key=keyFor(item);
    const existing=cache.get(key);
    if(existing)return existing;
    if(item.pendingAsset)return item.pendingAsset;
    const started=generation;
    item.pendingAsset=(async()=>{
        const att=item.msg.attachments[0];
        let blob;
        if(att.encrypted&&(!att.url||!att.url.startsWith('blob:')))blob=await OrbitCrypto.animationBlob(item.msg);
        else{
            const url=typeof formatMediaUrl==='function'?formatMediaUrl(att.url):att.url;
            if(!/^(blob:|https:\/\/|data:image\/(?:gif|webp);base64,)/i.test(url||''))throw Error('GIF unavailable.');
            const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(12000)});
            if(!response.ok)throw Error('GIF unavailable.');
            blob=await response.blob();
        }
        if(blob.size>12*1024*1024||!/^(image\/(gif|webp|png|jpeg))$/i.test(blob.type))throw Error('Unsupported animation.');
        describeRichImage(new Uint8Array(await blob.slice(0,256*1024).arrayBuffer()));
        const poster=await staticMediaPreview(blob);
        if(started!==generation)throw Error('The chat changed.');
        const asset={blob,poster,bytes:blob.size+poster.length*2};cache.set(key,asset);return asset;
    })();
    try{return await item.pendingAsset;}finally{item.pendingAsset=null;}
}
function schedule(){
    if(!scheduled){scheduled=true;requestAnimationFrame(sync);}
}
function allowed(){
    return !document.hidden&&!window.OrbitAndroidBackground&&feed?.closest('.screen')?.classList.contains('active');
}
function sync(){
    scheduled=false;
    const candidates=allowed()?[...visible].filter(item=>item.node.isConnected&&!item.failed&&item.owner===currentUser?.id):[];
    const play=new Set(reduced()?[]:candidates.slice(0,2));
    for(const item of playing)if(!play.has(item))stop(item);
    for(const item of candidates){
        if(loading.has(item)||playing.has(item))continue;
        if(item.remote){
            showPoster(item,{poster:item.remote.poster});
            if(play.has(item)&&!playing.has(item)){item.image.src=item.remote.url;playing.add(item);item.node.toggleAttribute('data-playing',true);}
            continue;
        }
        const asset=cache.get(keyFor(item));
        if(asset){
            showPoster(item,asset);
            if(play.has(item)&&!playing.has(item)){
                item.url=URL.createObjectURL(asset.blob);item.image.src=item.url;playing.add(item);item.node.toggleAttribute('data-playing',true);
            }
        }else if(loading.size<2&&(play.has(item)||!item.poster.getAttribute('src'))){
            loading.add(item);
            void assetFor(item).then(value=>{if(visible.has(item)&&nodes.has(item.node))showPoster(item,value);})
                .catch(()=>{if(nodes.has(item.node)){item.failed=true;item.retry.hidden=false;}})
                .finally(()=>{loading.delete(item);schedule();});
        }
    }
}
const observer=new IntersectionObserver(entries=>{
    for(const entry of entries){
        const item=nodes.get(entry.target);if(!item)continue;
        if(entry.isIntersecting)visible.add(item);
        else{
            visible.delete(item);stop(item);item.poster.removeAttribute('src');
            if(item.remote){item.remote.restore();remove(item);}
        }
    }
    schedule();
},{threshold:.06});
function register(node,msg,remote){
    const item={node,msg,remote,owner:currentUser?.id,image:node.querySelector('[data-motion-image]'),poster:node.querySelector('[data-motion-poster]'),retry:node.querySelector('[data-motion-retry]')};
    nodes.set(node,item);
    item.retry.onclick=()=>{item.failed=false;item.retry.hidden=true;schedule();};
    if(msg&&typeof openBatchLightbox==='function'){
        const image=item.image;
        node.addEventListener('click',event=>{
            if(event.target===item.retry||!nodes.has(node))return;
            const still=item.poster.getAttribute('src');
            const url=reduced()?still:image.getAttribute('src')||still;
            if(url)openBatchLightbox([url],0);
        });
    }
    observer.observe(node);
}
const markup=(sticker=false)=>'<div class="orbit-chat-animation'+(sticker?' orbit-chat-animation-sticker':'')+'"><img data-motion-poster alt="'+(sticker?'Sticker':'GIF')+'" decoding="async"><img data-motion-image alt="" decoding="async"><button type="button" data-motion-retry hidden>Retry media</button></div>';
function showRemote(button,url,poster){
    const container=document.createElement('div');
    container.innerHTML=markup();
    const node=container.firstElementChild;
    const credit=document.createElement('small');credit.textContent='Powered by GIPHY';
    button.replaceWith(node,credit);
    register(node,null,{url,poster,restore:()=>{button.disabled=false;node.replaceWith(button);credit.remove();}});
}
if(feed){
    new MutationObserver(records=>{
        for(const record of records)for(const element of record.removedNodes)if(element.nodeType===1){
            for(const node of [element,...element.querySelectorAll('.orbit-chat-animation')]){
                const item=nodes.get(node);if(item&&!node.isConnected)remove(item);
            }
        }
        schedule();
    }).observe(feed,{childList:true,subtree:true});
    new MutationObserver(schedule).observe(feed.closest('.screen'),{attributes:true,attributeFilter:['class']});
}
function reset(){
    generation++;
    for(const item of playing)stop(item);
    for(const item of visible){
        item.poster.removeAttribute('src');item.failed=false;item.retry.hidden=true;
        if(item.remote){item.remote.restore();remove(item);}
    }
    cache.clear();
}
if(toggle){
    toggle.checked=reduced();
    toggle.onchange=()=>{localStorage.setItem('orbit_chat_reduce_motion',String(toggle.checked));toggle.checked=reduced();schedule();};
}
system.addEventListener('change',()=>{if(toggle)toggle.checked=reduced();schedule();});
document.addEventListener('visibilitychange',schedule);
window.addEventListener('orbit-android-resume',schedule);
window.addEventListener('orbit-android-pause',schedule);
document.addEventListener('orbit-encryption-locked',reset);
window.OrbitAnimations={supports,markup,register,showRemote,reduced};
