(() => {
    const pack=['👋','😂','❤️','🎉','👍','🔥','🙌','🤩','😎','🥳','💯','🚀'];
    const packNames=Object.fromEntries(pack.map((glyph,index)=>[glyph,['Wave hello','Laugh','Heart love','Celebrate','Thumbs up','Fire','High five','Star eyes','Cool','Party','Hundred','Rocket'][index]]));
    const validGifId=id=>typeof id==='string'&&/^[a-z0-9]{1,48}$/i.test(id);
    const isRemoteGif=value=>value?.provider==='giphy'&&validGifId(value.id);
    const stored=key=>{try{return JSON.parse(localStorage.getItem(key)||'[]');}catch(_){return [];}};
    const key=(account,part)=>`orbit_picker_${account}_${part}`;
    function bump(account,part,id){const storage=key(account,part);localStorage.setItem(storage,JSON.stringify([id,...stored(storage).filter(item=>item!==id)].slice(0,28)));}
    const localAsset=path=>new URL(path,location.href).href;
    let catalog, config, database, nativeLoops, active=null;

    function sourceData(){
        return catalog ||= Promise.all(['emoji','loops'].map(name=>fetch(`assets/picker/${name}.json`).then(response=>{
            if(!response.ok)throw Error('The picker catalog could not load.');return response.json();
        }))).catch(error=>{catalog=null;throw error;});
    }
    async function giphyKey(){
        if(config!==undefined)return config;
        const origin=window.OrbitDevice?'https://orbit-messaging.vercel.app':location.origin;
        try{
            const response=await fetch(`${origin}/api/gif-config`,{signal:AbortSignal.timeout(2200),cache:'no-store'});
            const value=(await response.json()).key;
            config=/^[a-z0-9]{16,80}$/i.test(value||'')?value:null;
            return config;
        }catch(_){return null;}
    }
    async function getGifs(secret,query,id){
        const path=id?`/${id}`:query?'/search':'/trending';
        const url=new URL('https://api.giphy.com/v1/gifs'+path);
        url.searchParams.set('api_key',secret);
        if(!id){url.searchParams.set('limit','24');url.searchParams.set('rating','pg');}
        if(query)url.searchParams.set('q',query.slice(0,50));
        const response=await fetch(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(7000)});
        if(!response.ok)throw Error('GIPHY is unavailable. Try again.');
        return (await response.json()).data;
    }
    const validMediaUrl=value=>typeof value==='string'&&/^https:\/\/media\d*\.giphy\.com\//i.test(value);

    function openDB(){
        return database ||= new Promise((resolve,reject)=>{
            const operation=indexedDB.open('orbit-custom-stickers-v1',1);
            operation.onupgradeneeded=()=>operation.result.createObjectStore('stickers',{keyPath:'key'}).createIndex('account','account');
            operation.onsuccess=()=>resolve(operation.result);operation.onerror=()=>{database=null;reject(operation.error);};
        });
    }
    async function store(action,argument){
        const db=await openDB();
        return new Promise((resolve,reject)=>{
            const transaction=db.transaction('stickers',action==='getAll'?'readonly':'readwrite');
            const table=transaction.objectStore('stickers');
            const result=action==='getAll'?table.index('account').getAll(argument):table[action](argument);
            transaction.oncomplete=()=>resolve(result.result);transaction.onabort=()=>reject(transaction.error);
        });
    }
    async function stickers(account){
        if(!OrbitCrypto.isUnlocked())return [];
        const list=(await store('getAll',account)).sort((a,b)=>b.created-a.created);
        const records=await Promise.allSettled(list.map(async row=>{
            const {image,title,remote}=await OrbitCrypto.selfOpen(row.preview);
            return {id:row.id,label:title||'My sticker',preview:image,glyph:remote?'GIF':null,remote,favoriteOnly:!!row.favoriteOnly,row};
        }));
        const legacy=await Promise.allSettled(stored(`orbit_stickers_v1_${account}`).map(async (entry,index)=>{
            const {sticker}=await OrbitCrypto.selfOpen(entry);
            return {id:`old:${index}`,label:'My sticker',preview:sticker.image,glyph:sticker.emoji,legacy:sticker};
        }));
        return [...records,...legacy].filter(result=>result.status==='fulfilled').map(result=>result.value);
    }
    const same=snapshot=>!!snapshot&&snapshot.account===currentUser?.id&&snapshot.room===currentRoom;
    function close(){
        active=null;
        const dialog=document.getElementById('orbit-unified-picker');if(dialog?.open)dialog.close();
    }
    function insert(session,glyph){
        const composer=document.getElementById('msg-input');
        if(!composer||!session.symbols.has(glyph))return;
        composer.setRangeText(glyph,session.caret.start,session.caret.end,'end');
        session.caret={start:composer.selectionStart,end:composer.selectionEnd};
        composer.dispatchEvent(new Event('input',{bubbles:true}));bump(session.account,'emoji',glyph);
    }

    async function loopFile(id,loops){
        const loop=loops.find(item=>item.id===id);
        if(!loop)throw Error('This GIF is unavailable.');
        const response=await fetch(loop.url);
        if(!response.ok)throw Error('This GIF could not load.');
        return new File([await response.blob()],`${loop.title}.gif`,{type:'image/gif'});
    }
    async function saveSticker(session,file,preview,title,source){
        if(!same(session))throw Error('Open the original chat to save this sticker.');
        const rows=await store('getAll',session.account);
        if(source&&rows.some(row=>!row.favoriteOnly&&row.source===source)){showToast('Already in My Stickers.');return;}
        if(rows.filter(row=>!row.favoriteOnly).length>=32)throw Error('My Stickers is full. Delete a sticker to add another.');
        const id=crypto.randomUUID();
        const wrapped=await OrbitCrypto.sealLocalFile(file,id,0);
        const icon=await OrbitCrypto.selfSeal(id,'sticker-thumbnail',{image:preview,title});
        if(!same(session)||!OrbitCrypto.isUnlocked())throw Error('Unlock the original chat to save this sticker.');
        await store('put',{key:`${session.account}:${id}`,id,account:session.account,created:Date.now(),file:wrapped,preview:icon,source});
        showToast('Saved to My Stickers.','success');
    }
    async function edit(session,file,source){
        await OrbitCrypto.requireUnlocked();
        if(!same(session))return;
        const {openStickerEditor}=await import('./sticker-editor.mjs?v=orbit-1.5.0');
        await openStickerEditor(file,(output,preview,title)=>saveSticker(session,output,preview,title,source));
    }
    function showImport(session){
        const dialog=document.getElementById('orbit-sticker-import'), input=dialog.querySelector('input');
        input.value='';
        input.onchange=()=>{
            const file=input.files[0];dialog.close();
            if(file)void edit(session,file).catch(error=>showToast(error.message,'error'));
        };
        dialog.showModal();
    }
    async function action(message){
        const session=active;
        if(!same(session)||message.token!==session.token)return;
        const {action,id}=message;
        if(action==='closed'){close();return;}
        if(action==='emoji'){insert(session,id);return;}
        if(session.busy)return;
        session.busy=true;
        try{
            if(action==='create'){close();showImport(session);return;}
            if(action==='saveGif'){close();await edit(session,await loopFile(id,session.loops));return;}
            if(action==='favorite'||action==='delete'){
                const sticker=session.stickers.find(item=>item.id===id);
                if(action==='delete'&&sticker){
                    if(sticker.row)await store('delete',sticker.row.key);
                    else{const old=stored(`orbit_stickers_v1_${session.account}`);old.splice(Number(id.split(':')[1]),1);localStorage.setItem(`orbit_stickers_v1_${session.account}`,JSON.stringify(old));}
                    showToast('Sticker deleted.','success');
                }else if(action==='favorite'&&(sticker||pack.includes(id))){
                    const setting=key(session.account,'fav'),favorites=stored(setting),selected=favorites.includes(id);
                    localStorage.setItem(setting,JSON.stringify(selected?favorites.filter(item=>item!==id):[id,...favorites]));
                    if(selected&&sticker?.favoriteOnly)await store('delete',sticker.row.key);
                    showToast(selected?'Removed from Favorites.':'Added to Favorites.');
                }
                close();return;
            }
            if(action==='sendGiphy'&&validGifId(id)){close();await sendMessage({provider:'giphy',id});return;}
            if(action!=='sendGif'&&action!=='sendSticker')return;
            close();
            if(action==='sendSticker'){
                if(pack.includes(id)){if(await sendMessage({version:1,emoji:id}))bump(session.account,'sticker',id);return;}
                const sticker=session.stickers.find(item=>item.id===id);
                if(!sticker)throw Error('Sticker is unavailable.');
                if(isRemoteGif(sticker.remote)){if(await sendMessage(sticker.remote))bump(session.account,'sticker',id);return;}
                if(sticker.legacy){if(await sendMessage(sticker.legacy))bump(session.account,'sticker',id);return;}
                await OrbitCrypto.requireUnlocked();
                var file=await OrbitCrypto.openLocalFile(sticker.row.file);
            }else file=await loopFile(id,session.loops);
            if(!same(session))throw Error('The chat changed before sending.');
            const kind=action==='sendSticker'?(session.stickers.find(item=>item.id===id)?.row?.kind||'sticker'):'gif';
            await queueMediaMessage([{file,type:'image',name:file.name}],'','image',{roomId:session.room,userId:session.account,pickerMedia:kind});
            if(action==='sendSticker')bump(session.account,'sticker',id);
        }catch(error){showToast(error.message,'error');}finally{session.busy=false;}
    }
    async function open(tab='emoji'){
        const composer=document.getElementById('msg-input');
        if(!composer||!currentRoom||!currentUser?.id)return;
        const session={account:currentUser.id,room:currentRoom,token:crypto.randomUUID(),caret:{start:composer.selectionStart,end:composer.selectionEnd}};
        active=session;composer.blur();
        try{
            const [[categories,loops], custom]=await Promise.all([sourceData(),stickers(session.account).catch(()=>[])]);
            if(active!==session||!same(session))return;
            session.stickers=custom;session.loops=loops.map(loop=>({...loop,url:localAsset(`assets/picker/${loop.id}.gif`)}));
            session.symbols=new Set(categories.flatMap(group=>group.items.map(item=>item[0])));
            const payload={token:session.token,tab,categories,pack,packNames,stickers:custom.map(({id,label,preview,glyph,favoriteOnly})=>({id,label,preview,glyph,favoriteOnly})),
                recent:stored(key(session.account,'emoji')),stickersRecent:stored(key(session.account,'sticker')), favorites:stored(key(session.account,'fav')),
                light:document.body.classList.contains('light-mode'),loops:session.loops};
            if(window.OrbitDevice){
                nativeLoops??=Promise.all(session.loops.map(async loop=>({id:loop.id,title:loop.title,preview:await toDataURL(await loopFile(loop.id,session.loops))})))
                    .catch(error=>{nativeLoops=null;throw error;});
                payload.loops=await nativeLoops;
                if(active!==session||!same(session))return;
                if(await OrbitDevice('openChatPicker',payload))return;
            }
            if(active===session&&same(session))showWeb(payload,session);
        }catch(error){if(active===session){close();showToast(error.message,'error');}}
    }
    function toDataURL(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});}

    function showWeb(model,session){
        const dialog=document.getElementById('orbit-unified-picker'), grid=dialog.querySelector('[data-grid]');
        const nav=dialog.querySelector('[data-categories]'), input=dialog.querySelector('[type=search]');
        const recent=dialog.querySelector('[data-recent]'), status=dialog.querySelector('[role=status]');
        let tab=model.tab,collection='My Stickers',category=0,version=0,searchTimer;
        const call=(intent,id)=>action({token:model.token,action:intent,id});
        const appendButton=(parent,label,click,preview,hold)=>{
            const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',label);
            if(preview){const img=document.createElement('img');img.src=preview;img.alt='';img.loading='lazy';button.append(img);}else button.textContent=label;
            button.onclick=click;
            if(hold){let timer,held=false;
                button.oncontextmenu=event=>{event.preventDefault();clearTimeout(timer);if(!held)hold();held=true;};
                button.onpointerdown=()=>{held=false;timer=setTimeout(()=>{held=true;hold();},520);};
                for(const event of ['pointerup','pointerleave','pointercancel'])button.addEventListener(event,()=>clearTimeout(timer));
                button.onclick=()=>{if(!held)click();held=false;};
            }
            parent.append(button);
        };
        const stickerButtons=(parent,ids)=>{for(const id of ids){
            const custom=model.stickers.find(item=>item.id===id);
            if(!custom&&!model.pack.includes(id))continue;
            appendButton(parent,custom?.glyph||custom?.label||id,()=>call('sendSticker',id),custom?.preview,()=>{
                const menu=document.getElementById('orbit-picker-menu'), actions=menu.querySelector('[data-actions]');actions.replaceChildren();
                appendButton(actions,model.favorites.includes(id)?'Remove from Favorites':'Mark as favorite',()=>{menu.close();call('favorite',id);});
                if(custom&&!custom.favoriteOnly)appendButton(actions,'Delete from My Stickers',()=>{menu.close();call('delete',id);});menu.showModal();
            });
            parent.lastChild.setAttribute('aria-label',custom?.label||packNames[id]||id);
        }};
        async function render(){
            const span=++version, query=input.value.trim();
            grid.replaceChildren();nav.replaceChildren();recent.replaceChildren();status.textContent='';
            grid.dataset.tab=tab;
            input.hidden=false;input.placeholder=tab==='gif'?'Search GIFs':tab==='stickers'?'Search stickers':'Search emoji';
            for(const element of dialog.querySelectorAll('[data-tab]'))element.setAttribute('aria-pressed',String(element.dataset.tab===tab));
            if(tab==='emoji'){
                if(!query){model.categories.forEach((group,index)=>appendButton(nav,group.icon,()=>{category=index;render();}));
                    const used=stored(key(session.account,'emoji'));if(used.length){recent.dataset.caption='Recent';used.slice(0,8).forEach(glyph=>appendButton(recent,glyph,()=>{call('emoji',glyph);render();}));}}
                const data=query?model.categories.flatMap(group=>group.items).filter(item=>item.join(' ').toLowerCase().includes(query.toLowerCase())):model.categories[category].items;
                data.slice(0,220).forEach(([glyph,name])=>{appendButton(grid,glyph,()=>{call('emoji',glyph);render();});grid.lastChild.title=name;});
                if(!data.length)status.textContent='No emoji found.';return;
            }
            if(tab==='stickers'){
                const sections={'Recent':model.stickersRecent,'Favorites':model.favorites,'My Stickers':model.stickers.filter(item=>!item.favoriteOnly).map(item=>item.id),'Packs':model.pack};
                for(const section of Object.keys(sections)){
                    appendButton(nav,section,()=>{collection=section;render();});
                    nav.lastChild.setAttribute('aria-pressed',String(collection===section));
                }
                if(collection==='My Stickers')appendButton(recent,'＋ Create sticker',()=>call('create'));
                if(collection==='Packs'){const heading=document.createElement('h3');heading.textContent='Orbit Essentials';grid.append(heading);}
                const shown=sections[collection].filter(id=>{
                    const item=model.stickers.find(sticker=>sticker.id===id);
                    return (item||pack.includes(id))&&`${id} ${item?.label||packNames[id]||''} ${item?.glyph||''}`.toLowerCase().includes(query.toLowerCase());
                });
                stickerButtons(grid,shown);
                if(!shown.length)status.textContent=query?'No matching stickers.':'Nothing here yet.';
                return;
            }
            const gifKey=await giphyKey();
            if(span!==version||!dialog.open)return;
            if(gifKey){
                status.textContent='Powered by GIPHY · Loading…';
                try{
                    const data=await getGifs(gifKey,query);
                    if(span!==version||!dialog.open)return;
                    for(const gif of data||[]){const preview=gif.images?.fixed_width_small_still?.url;
                        if(validGifId(gif.id)&&validMediaUrl(preview))appendButton(grid,gif.title||'GIF',()=>call('sendGiphy',gif.id),preview);
                    }
                    status.textContent=grid.children.length?'Powered by GIPHY':'No matching GIFs · Powered by GIPHY';
                }catch(error){if(span===version)status.textContent=error.message;}
            }else{
                status.textContent='Orbit GIFs';
                model.loops.filter(loop=>loop.title.toLowerCase().includes(query.toLowerCase())).forEach(loop=>appendButton(grid,loop.title,()=>call('sendGif',loop.id),loop.url,()=>{
                    const menu=document.getElementById('orbit-picker-menu'), actions=menu.querySelector('[data-actions]');actions.replaceChildren();
                    appendButton(actions,'Save as sticker',()=>{menu.close();call('saveGif',loop.id);});menu.showModal();
                }));
            }
        }
        input.value='';input.oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(render,tab==='gif'?260:0);};
        for(const button of dialog.querySelectorAll('[data-tab]'))button.onclick=()=>{tab=button.dataset.tab;input.value='';render();};
        dialog.onclose=()=>{if(active===session)active=null;clearTimeout(searchTimer);version++;};
        dialog.showModal();render();
    }

    function mediaKind(msg){
        if(!msg||msg.is_deleted||msg.deleted_at||msg._e2ee_locked||orbitIsViewOnceMessage(msg))return null;
        if(isRemoteGif(msg.metadata?.orbit_gif))return 'gif';
        if(window.OrbitStickers?.valid(msg.metadata?.orbit_sticker))return 'sticker';
        return ['gif','sticker'].includes(msg.metadata?.orbit_media)?msg.metadata.orbit_media:null;
    }
    const messageScope=()=>({account:currentUser?.id,room:currentRoom});
    async function messageFile(msg,session){
        const legacy=msg.metadata?.orbit_sticker;
        if(OrbitStickers.valid(legacy)&&legacy.emoji&&!legacy.image){
            const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
            const ctx=canvas.getContext('2d');ctx.font='355px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(legacy.emoji,256,256);
            return new File([await new Promise(resolve=>canvas.toBlob(resolve))],'Orbit sticker.png',{type:'image/png'});
        }
        const actual=msg._e2ee_media_pending?await OrbitCrypto.materialize(msg):msg;
        if(!same(session))throw Error('The chat changed. Open the original message again.');
        const attachment=actual.attachments?.[0];
        const url=attachment?.url||(OrbitStickers.valid(legacy)&&legacy.image);
        if(!url||attachment?.upload_pending||!(/^(blob:|https:\/\/|data:image\/webp;base64,)/i.test(url)))throw Error('Wait for the original media to finish loading.');
        const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer'});
        if(!response.ok)throw Error('The original media could not be opened.');
        const blob=await response.blob(),{describeRichImage,limit}=await import('./rich-image.mjs');
        if(blob.size>limit)throw Error('Choose media under 12 MB.');
        const {mime}=describeRichImage(new Uint8Array(await blob.slice(0,256*1024).arrayBuffer()));
        return new File([blob],`Orbit media.${mime.split('/')[1]}`,{type:mime});
    }
    async function thumbnail(file){
        const bitmap=await createImageBitmap(file,{resizeWidth:64,resizeHeight:64,resizeQuality:'low'});
        try{const canvas=document.createElement('canvas');canvas.width=canvas.height=64;canvas.getContext('2d').drawImage(bitmap,0,0);return canvas.toDataURL('image/webp',.65);}
        finally{bitmap.close();}
    }
    async function favoriteMessage(msg,session,kind){
        const setting=key(session.account,'fav'),rows=await store('getAll',session.account);
        const legacy=msg.metadata?.orbit_sticker;
        const builtIn=OrbitStickers.valid(legacy)&&pack.includes(legacy.emoji)?legacy.emoji:null;
        const existing=rows.find(row=>row.source===msg.id&&stored(setting).includes(row.id));
        const id=builtIn||existing?.id||rows.find(row=>row.source===msg.id&&!row.favoriteOnly)?.id;
        if(!same(session))throw Error('The chat changed.');
        if(id){
            const favorites=stored(setting),selected=favorites.includes(id);
            localStorage.setItem(setting,JSON.stringify(selected?favorites.filter(item=>item!==id):[id,...favorites]));
            if(selected&&existing?.favoriteOnly)await store('delete',existing.key);
            showToast(selected?'Removed from Favorites.':'Added to Favorites.','success');return;
        }
        const remote=isRemoteGif(msg.metadata?.orbit_gif)?msg.metadata.orbit_gif:null;
        const file=remote?null:await messageFile(msg,session);
        const favorites=rows.filter(row=>row.favoriteOnly);
        if(favorites.length>=16||favorites.reduce((size,row)=>size+(row.size||0),0)+(file?.size||0)>24*1024*1024)throw Error('Favorites is full. Remove saved media to make space.');
        const itemId=crypto.randomUUID();
        const wrapped=file?await OrbitCrypto.sealLocalFile(file,itemId,0):null;
        const preview=await OrbitCrypto.selfSeal(itemId,'sticker-thumbnail',{image:file?await thumbnail(file):null,title:remote?'GIPHY GIF':kind==='gif'?'Saved GIF':'Saved sticker',remote});
        if(!same(session)||!OrbitCrypto.isUnlocked())throw Error('The chat changed.');
        await store('put',{key:`${session.account}:${itemId}`,account:session.account,id:itemId,created:Date.now(),source:msg.id,file:wrapped,preview,kind,size:file?.size||0,favoriteOnly:true});
        localStorage.setItem(setting,JSON.stringify([itemId,...stored(setting)]));
        showToast('Added to Favorites.','success');
    }
    async function shareNative(file,session){
        const id=await OrbitDevice('startStickerShare',{mime:file.type,size:file.size});
        try{
            for(let offset=0;offset<file.size;offset+=48*1024){
                if(!same(session))throw Error('The chat changed before sharing.');
                const bytes=new Uint8Array(await file.slice(offset,offset+48*1024).arrayBuffer());
                await OrbitDevice('writeStickerShare',{id,offset,data:btoa(String.fromCharCode(...bytes))});
            }
            if(same(session))await OrbitDevice('finishStickerShare',{id});
        }finally{await OrbitDevice('cancelStickerShare',{id}).catch(()=>{});}
    }
    async function shareMessage(msg,session){
        const remote=isRemoteGif(msg.metadata?.orbit_gif)?msg.metadata.orbit_gif:null;
        const file=remote?null:await messageFile(msg,session);
        if(!same(session))return;
        const dialog=document.getElementById('orbit-picker-menu'),actions=dialog.querySelector('[data-actions]');
        const button=document.createElement('button');button.type='button';button.textContent='Share media';actions.replaceChildren(button);
        button.onclick=async()=>{
            if(!same(session)){dialog.close();return;}
            button.disabled=true;
            try{
                if(remote){
                    const url=`https://giphy.com/gifs/${remote.id}`;
                    if(window.OrbitDevice)await OrbitDevice('shareGiphyLink',{id:remote.id});
                    else if(navigator.share)await navigator.share({url});
                    else await navigator.clipboard.writeText(url);
                }else if(window.OrbitDevice)await shareNative(file,session);
                else if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file]});
                else{
                    const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
                }
                dialog.close();
            }catch(error){if(error.name!=='AbortError')showToast(error.message,'error');}
            finally{button.disabled=false;}
        };
        dialog.showModal();
    }
    let messageActionBusy=false;
    function messageActions(msg){
        const kind=mediaKind(msg);
        if(!kind)return [];
        const session=messageScope(),remote=isRemoteGif(msg.metadata?.orbit_gif);
        const run=operation=>async()=>{
            if(messageActionBusy||!same(session))return;
            messageActionBusy=true;
            try{await operation();}catch(error){if(same(session))showToast(error.message,'error');}finally{messageActionBusy=false;}
        };
        return [
            {icon:'fa-regular fa-heart',label:'Toggle favorite',action:run(()=>favoriteMessage(msg,session,kind))},
            ...(!remote?[{icon:'fa-regular fa-note-sticky',label:'Save to My Stickers',action:run(async()=>{
                const file=await messageFile(msg,session);
                const {describeRichImage}=await import('./rich-image.mjs');
                const info=describeRichImage(new Uint8Array(await file.slice(0,256*1024).arrayBuffer()));
                if(info.mime==='image/webp'&&info.width===512&&info.height===512&&file.size<=(info.animated?500000:100000)){
                    await saveSticker(session,file,await thumbnail(file),'Saved sticker',msg.id);
                }else await edit(session,file,msg.id);
            })}]:[]),
            {icon:'fa-solid fa-share-nodes',label:'Share media',action:run(()=>shareMessage(msg,session))}
        ];
    }
    async function forwardMedia(msg){
        const session=messageScope();
        try{
            const result=msg._e2ee_media_pending?await OrbitCrypto.materialize(msg):msg;
            if(same(session))openForwardModal(result);
        }catch(error){if(same(session))showToast(error.message,'error');}
    }
    function gifMarkup(gif){return `<button type="button" class="orbit-giphy-message" data-giphy-id="${gif.id}" onclick="OrbitPicker.playGif(this)">Play GIF <span>GIPHY</span></button>`;}
    async function playGif(button){
        if(!validGifId(button.dataset.giphyId))return;
        button.disabled=true;
        try{
            const secret=await giphyKey();if(!secret)throw Error('GIPHY is unavailable on this release.');
            const gif=await getGifs(secret,'',button.dataset.giphyId);
            const preview=gif.images?.fixed_width?.url;
            if(!validMediaUrl(preview))throw Error('This GIF is unavailable.');
            const image=document.createElement('img');image.alt=gif.title||'GIF';image.src=preview;image.referrerPolicy='no-referrer';
            const credit=document.createElement('small');credit.textContent='Powered by GIPHY';button.replaceWith(image,credit);
        }catch(error){button.disabled=false;showToast(error.message,'error');}
    }
    document.addEventListener('orbit-encryption-locked',()=>{close();for(const id of ['orbit-sticker-editor','orbit-sticker-import','orbit-picker-menu']){const dialog=document.getElementById(id);if(dialog?.open)dialog.close();}});
    window.OrbitPicker={open,action,isRemoteGif,gifMarkup,playGif,mediaKind,messageActions,forwardMedia};
})();
