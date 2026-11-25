import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MediaCache} from '../js/chat-animation-cache.mjs';
import {decodePack,makePack,packInfo} from '../js/sticker-packs.mjs';

function webp() {
    const bytes=Buffer.alloc(30);
    bytes.write('RIFF',0);bytes.write('WEBPVP8X',8);
    bytes[24]=255;bytes[25]=1;bytes[27]=255;bytes[28]=1;
    return bytes;
}

test('pack format preserves order, labels and author',async()=>{
    const pack=makePack({name:' Weekend ',author:' Orbit '},[
        {title:'Second',data:webp().toString('base64')},
        {title:'First',data:webp().toString('base64')}
    ]);
    const decoded=await decodePack(pack);
    assert.equal(decoded.name,'Weekend');assert.equal(decoded.author,'Orbit');
    assert.deepEqual(decoded.stickers.map(sticker=>sticker.title),['Second','First']);
    assert.deepEqual(Buffer.from(await decoded.stickers[0].file.arrayBuffer()),webp());
});

test('validates pack version, member count, base64, dimensions and format',async()=>{
    const base={format:'orbit-sticker-pack',version:1,name:'Test',stickers:[{data:webp().toString('base64')}]};
    const decode=record=>decodePack(new Blob([JSON.stringify(record)]));
    await assert.rejects(decode({...base,version:2}),/1 to 30/);
    await assert.rejects(decode({...base,stickers:Array(31).fill(base.stickers[0])}),/1 to 30/);
    await assert.rejects(decode({...base,stickers:[{data:'https://invalid.example'}]}),/invalid sticker/);
    const narrow=webp();narrow[24]=0;narrow[25]=0;
    await assert.rejects(decode({...base,stickers:[{data:narrow.toString('base64')}]}),/512/);
    assert.throws(()=>packInfo({name:' '}),/Enter a pack name/);
});

test('animation cache counts bytes, keeps recently read values and rejects oversized assets',()=>{
    const cache=new MediaCache(12);
    cache.set('a',{bytes:5});cache.set('b',{bytes:5});assert.ok(cache.get('a'));
    cache.set('c',{bytes:5});
    assert.equal(cache.get('b'),undefined);assert.ok(cache.get('a'));assert.ok(cache.get('c'));
    cache.set('too-big',{bytes:13});assert.equal(cache.bytes,10);
    cache.set('a',{bytes:1});assert.equal(cache.bytes,6);
    cache.clear();assert.equal(cache.bytes,0);
});
