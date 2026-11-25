import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {describeRichImage, limit} from '../js/rich-image.mjs';

test('identifies a real Orbit picker GIF and its canvas size', async () => {
    const gif = await readFile(new URL('../assets/picker/heart.gif', import.meta.url));
    assert.deepEqual(describeRichImage(gif), {mime:'image/gif',width:120,height:120,animated:true});
    assert.equal(limit, 12582912);
});

test('checks dimensions before a keyboard image is decoded', () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d494844520000000800000008','hex');
    assert.deepEqual(describeRichImage(png), {mime:'image/png',width:8,height:8,animated:false});
    png.writeUInt32BE(5000,16);
    assert.throws(()=>describeRichImage(png),/4096 pixels/);
    png.writeUInt32BE(0,16);
    assert.throws(()=>describeRichImage(png),/dimensions/);
    assert.throws(()=>describeRichImage(Buffer.from('<svg>')),/Choose a GIF/);
});

test('preserves animation advertised by an extended WebP header', () => {
    const webp = Buffer.alloc(30);
    webp.write('RIFF',0);webp.write('WEBPVP8X',8);webp[20]=2;webp[24]=255;webp[25]=1;webp[27]=255;webp[28]=1;
    assert.deepEqual(describeRichImage(webp), {mime:'image/webp',width:512,height:512,animated:true});
});
