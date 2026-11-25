import {describeRichImage} from './rich-image.mjs';

export const packLimit = 30;
export const packBytes = 21 * 1024 * 1024;
export const packFormat = 'orbit-sticker-pack';

const clean = (value, length) => typeof value==='string' ? value.trim().slice(0,length) : '';
export function packInfo(value){
    const name=clean(value?.name,48),author=clean(value?.author,48);
    if(!name)throw Error('Enter a pack name.');
    return {name,author};
}

export async function decodePack(file){
    if(file.size>packBytes)throw Error('Choose an Orbit pack under 21 MB.');
    let record;
    try{record=JSON.parse(await file.text());}catch{throw Error('This is not a readable Orbit sticker pack.');}
    if(record?.format!==packFormat||record.version!==1||!Array.isArray(record.stickers)||!record.stickers.length||record.stickers.length>packLimit)throw Error('An Orbit pack must contain 1 to 30 stickers.');
    const info=packInfo(record);
    const stickers=record.stickers.map(item=>{
        if(typeof item?.data!=='string'||item.data.length>666672||!/^[A-Za-z0-9+/]+={0,2}$/.test(item.data))throw Error('This pack contains an invalid sticker.');
        let bytes;
        try{bytes=Uint8Array.from(atob(item.data),char=>char.charCodeAt(0));}catch{throw Error('This pack contains invalid image encoding.');}
        const image=describeRichImage(bytes);
        if(image.mime!=='image/webp'||image.width!==512||image.height!==512||bytes.length>(image.animated?500000:100000))throw Error('Pack stickers must be 512 × 512 WebP within Orbit’s size limits.');
        return {title:clean(item.title,40),file:new Blob([bytes],{type:image.mime})};
    });
    return {...info,stickers};
}

export function makePack(info,stickers){
    if(stickers.length===0||stickers.length>packLimit)throw Error('Choose 1 to 30 stickers before exporting.');
    const blob=new Blob([JSON.stringify({format:packFormat,version:1,...packInfo(info),stickers})],{type:'application/json'});
    if(blob.size>packBytes)throw Error('The exported pack exceeds 21 MB.');
    return blob;
}
