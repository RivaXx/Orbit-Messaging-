import {test} from 'node:test';
import assert from 'node:assert/strict';
import {removeBorderBackground} from '../js/sticker-webp.mjs';

function canvas(background) {
    const size = 5;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < data.length; i += 4) data.set(background,i);
    return {size,data,
        getImageData:()=>({data}),putImageData:()=>{},
        set(x,y,color){data.set(color,(y*size+x)*4);},
        alpha(x,y){return data[(y*size+x)*4+3];}
    };
}

test('background sensitivity removes a connected gradient without erasing a different subject',()=>{
    for (const tolerance of [30,70]) {
        const image=canvas([210,215,220,255]);
        image.set(1,2,[195,200,205,255]);
        image.set(2,2,[200,20,15,255]);
        removeBorderBackground(image,image.size,tolerance);
        assert.equal(image.alpha(0,0),0);
        assert.equal(image.alpha(1,2),tolerance===30?255:0);
        assert.equal(image.alpha(2,2),255);
    }
});

test('transparent corner pixels do not turn opaque dark artwork into a background sample',()=>{
    const image=canvas([0,0,0,0]);
    image.set(0,2,[10,10,10,255]);
    removeBorderBackground(image,image.size,82);
    assert.equal(image.alpha(0,2),255);
});
