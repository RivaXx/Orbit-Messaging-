import {animatedWebp,removeBorderBackground} from './sticker-webp.mjs';

const side = 512;
const frameBudget = 500000;
const stillBudget = 100000;
const encode = (canvas, quality) => new Promise((resolve, reject) => canvas.toBlob(
    result => result?.type === 'image/webp' ? resolve(result) : reject(Error('WebP encoding is unavailable on this device.')),
    'image/webp', quality));

async function loadMedia(file) {
    if (!file.size || file.size > 24*1024*1024) throw Error('Choose an image, GIF, or video under 24 MB.');
    if (file.type.startsWith('video/')) {
        const video = document.createElement('video'), url = URL.createObjectURL(file);
        video.preload = 'auto';video.muted = true;video.playsInline = true;
        try {
            await new Promise((resolve,reject) => {
                video.onloadeddata = resolve; video.onerror = () => reject(Error('This video could not be opened.'));video.src=url;
            });
            if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 10) throw Error('Choose a video up to 10 seconds long.');
            return {duration:video.duration, async frame(time) {
                if (Math.abs(video.currentTime-time) > .005) await new Promise((resolve,reject) => {
                    const timeout=setTimeout(()=>reject(Error('This video frame could not be read.')),3000);
                    video.onseeked=()=>{clearTimeout(timeout);resolve();};video.currentTime=time;
                });
                return {image:video,width:video.videoWidth,height:video.videoHeight,release(){}};
            }, close(){video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}};
        } catch (error) { URL.revokeObjectURL(url);throw error; }
    }
    if (file.type === 'image/gif') {
        if (!window.ImageDecoder || !await ImageDecoder.isTypeSupported('image/gif')) throw Error('Update Android System WebView or your browser to edit GIFs.');
        const decoder=new ImageDecoder({data:await file.arrayBuffer(),type:'image/gif'});
        try {
            await decoder.tracks.ready;await decoder.completed;
            const count=decoder.tracks.selectedTrack.frameCount, times=[];
            if (!count || count > 240) throw Error('Choose a shorter GIF.');
            let duration=0;
            for(let index=0;index<count;index++) {
                const {image}=await decoder.decode({frameIndex:index});
                const seconds=Math.max(.02,Number(image.duration || 100000)/1000000);
                image.close();times.push(duration);duration+=seconds;
                if(duration>10.01)throw Error('Choose a GIF up to 10 seconds long.');
            }
            return {duration:count>1?Math.min(duration,10):0,async frame(time){
                const after=times.findIndex(value=>value>time);
                const {image}=await decoder.decode({frameIndex:after<0?count-1:Math.max(0,after-1)});
                return {image,width:image.displayWidth,height:image.displayHeight,release:()=>image.close()};
            },close:()=>decoder.close()};
        } catch(error) {decoder.close();throw error;}
    }
    if (!/^image\/(jpeg|png|webp|avif|bmp|heic|heif)$/i.test(file.type)) throw Error('Choose a supported image, GIF, or short video.');
    const bitmap=await createImageBitmap(file);
    return {duration:0,frame:async()=>({image:bitmap,width:bitmap.width,height:bitmap.height,release(){}}),close:()=>bitmap.close()};
}

function paint(canvas, frame, options) {
    const ctx=canvas.getContext('2d',{willReadFrequently:options.remove});
    ctx.clearRect(0,0,side,side);
    const inset=options.animated?12:0, length=side-inset*2;
    const crop=Math.min(frame.width,frame.height)/options.zoom;
    const left=(frame.width-crop)*options.horizontal, top=(frame.height-crop)*options.vertical;
    ctx.drawImage(frame.image,left,top,crop,crop,inset,inset,length,length);
    if(options.remove)removeBorderBackground(ctx);
    if(options.label){
        ctx.textAlign='center';ctx.textBaseline='bottom';ctx.font='700 42px system-ui, sans-serif';
        ctx.lineWidth=6;ctx.lineJoin='round';ctx.strokeStyle='#101525';ctx.fillStyle='#fff';
        ctx.strokeText(options.label,side/2,side-30,side-60);ctx.fillText(options.label,side/2,side-30,side-60);
    }
}

export async function openStickerEditor(file, save) {
    const dialog=document.getElementById('orbit-sticker-editor');
    if(dialog.open)return;
    const fields=Object.fromEntries([...dialog.querySelectorAll('[name]')].map(field=>[field.name,field]));
    const canvas=dialog.querySelector('canvas'), status=dialog.querySelector('[role=status]');
    const done=dialog.querySelector('[data-save]'), cancel=dialog.querySelector('[data-cancel]');
    const trim=dialog.querySelector('[data-trim]');
    let source=null, disposed=false, rendering=false, saving=false, renderAgain=false;
    dialog.querySelector('form').reset();
    done.disabled=true;status.textContent='Opening media…';canvas.getContext('2d').clearRect(0,0,side,side);
    dialog.showModal();cancel.onclick=()=>dialog.close();
    dialog.onclose=()=>{disposed=true;source?.close();dialog.onclose=null;};
    function options() {
        return {zoom:Number(fields.zoom.value),horizontal:Number(fields.horizontal.value)/100,vertical:Number(fields.vertical.value)/100,
            label:fields.label.value.trim().slice(0,38),remove:!source.duration&&fields.background.checked,animated:!!source.duration};
    }
    const value=time=>Math.min(time,Math.max(0,source.duration-.02));
    async function renderAt(time, crop) {
        const frame=await source.frame(value(time));
        try {if(!disposed)paint(canvas,frame,crop);} finally {frame.release();}
    }
    async function preview() {
        renderAgain=true;
        if(!source||rendering||saving)return;
        rendering=true;done.disabled=true;
        try {
            while(renderAgain&&!disposed){
                renderAgain=false;await renderAt(Number(fields.start.value),options());
            }
        } catch(error) {if(!disposed)status.textContent=error.message;}
        finally {rendering=false;if(!disposed)done.disabled=false;}
    }
    try {
        const loaded=await loadMedia(file);
        if(disposed){loaded.close();return;}
        source=loaded;trim.hidden=!source.duration;fields.background.closest('label').hidden=!!source.duration;
        fields.start.max=fields.end.max=String(source.duration);
        fields.start.value='0';fields.end.value=String(source.duration);
        for(const field of Object.values(fields))field.oninput=()=>{
            const start=Number(fields.start.value),end=Number(fields.end.value);
            if(source.duration&&start+.15>end){
                if(field===fields.start)fields.start.value=String(Math.max(0,end-.15));
                else fields.end.value=String(Math.min(source.duration,start+.15));
            }
            dialog.querySelector('[data-duration]').textContent=`${Math.max(0,Number(fields.end.value)-Number(fields.start.value)).toFixed(1)} s`;
            void preview();
        };
        status.textContent=source.duration?'Scrub the start slider to preview your trim.':'Adjust the crop, then save your sticker.';
        await preview();
    } catch(error){if(!disposed)status.textContent=error.message;return;}
    done.onclick=async()=>{
        if(disposed||saving||rendering)return;
        saving=true;done.disabled=true;
        const crop=options(),start=Number(fields.start.value),end=Number(fields.end.value);
        try {
            status.textContent='Encoding sticker…';
            let output;
            if(!source.duration){
                await renderAt(0,crop);
                for(const quality of [.88,.74,.57,.40,.23,.08]){output=await encode(canvas,quality);if(output.size<=stillBudget)break;}
                if(output.size>stillBudget)throw Error('This image is too detailed. Crop closer or use the background remover.');
            }else{
                const duration=Math.min(10,end-start);
                if(duration<.1)throw Error('Choose a longer trim.');
                for(const [fps,quality] of [[8,.66],[6,.47],[5,.32],[3,.22],[2,.12]]){
                    const count=Math.max(2,Math.ceil(duration*fps)),frames=[];
                    let total=0;
                    for(let index=0;index<count&&!disposed;index++){
                        await renderAt(start+index*duration/count,crop);
                        const encoded=await encode(canvas,quality);total+=encoded.size;
                        if(total>frameBudget)break;
                        frames.push({bytes:new Uint8Array(await encoded.arrayBuffer()),duration:duration*1000/count});
                        status.textContent=`Encoding frame ${index+1} of ${count}…`;
                        await new Promise(resolve=>setTimeout(resolve,0));
                    }
                    if(disposed)return;
                    if(frames.length===count){output=animatedWebp(frames);if(output.size<=frameBudget)break;}
                }
                if(!output||output.size>frameBudget)throw Error('Trim a shorter section to fit the 500 KB limit.');
            }
            if(disposed)return;
            await renderAt(start,crop);
            const thumb=document.createElement('canvas');thumb.width=thumb.height=64;thumb.getContext('2d').drawImage(canvas,0,0,64,64);
            await save(new File([output],'Orbit sticker.webp',{type:'image/webp'}),thumb.toDataURL('image/webp',.5));
            if(!disposed)dialog.close();
        } catch(error){if(!disposed)status.textContent=error.message;}
        finally{saving=false;if(!disposed)done.disabled=false;}
    };
}
