const edge = 512;
const tag = text => Uint8Array.from(text, character => character.charCodeAt(0));
const readTag = (bytes, at) => String.fromCharCode(...bytes.subarray(at, at + 4));
const write24 = (bytes, at, value) => { bytes[at] = value; bytes[at + 1] = value >>> 8; bytes[at + 2] = value >>> 16; };

function chunk(name, body) {
    const bytes = new Uint8Array(8 + body.length + (body.length & 1));
    bytes.set(tag(name));
    new DataView(bytes.buffer).setUint32(4, body.length, true);
    bytes.set(body, 8);
    return bytes;
}

function frameChunks(bytes) {
    if (readTag(bytes, 0) !== 'RIFF' || readTag(bytes, 8) !== 'WEBP') throw Error('WebP encoding is unavailable.');
    const chunks = [];
    const sizes = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 12; offset + 8 <= bytes.length;) {
        const name = readTag(bytes, offset);
        const length = sizes.getUint32(offset + 4, true);
        const end = offset + 8 + length + (length & 1);
        if (end > bytes.length) throw Error('Invalid WebP frame.');
        if (['ALPH','VP8 ','VP8L'].includes(name)) chunks.push(bytes.subarray(offset, end));
        offset = end;
    }
    if (!chunks.some(item => ['VP8 ','VP8L'].includes(readTag(item, 0)))) throw Error('Invalid WebP frame.');
    return chunks;
}

export function animatedWebp(frames, side = edge) {
    const extended = new Uint8Array(10);
    extended[0] = 0x12;
    write24(extended, 4, side - 1);
    write24(extended, 7, side - 1);
    const chunks = [chunk('VP8X', extended),chunk('ANIM', new Uint8Array(6))];
    for (const frame of frames) {
        const data = frameChunks(frame.bytes);
        const body = new Uint8Array(16 + data.reduce((sum, part) => sum + part.length, 0));
        write24(body, 6, side - 1);
        write24(body, 9, side - 1);
        write24(body, 12, Math.max(20, Math.round(frame.duration)));
        body[15] = 2;
        let cursor = 16;
        for (const part of data) { body.set(part, cursor); cursor += part.length; }
        chunks.push(chunk('ANMF', body));
    }
    const length = chunks.reduce((sum, part) => sum + part.length, 4);
    const header = new Uint8Array(12);
    header.set(tag('RIFF'));
    new DataView(header.buffer).setUint32(4, length, true);
    header.set(tag('WEBP'), 8);
    return new Blob([header,...chunks], {type:'image/webp'});
}

export function removeBorderBackground(context, size = edge) {
    const layer = context.getImageData(0,0,size,size);
    const pixels = layer.data;
    const indices = [0, size-1, size*(size-1), size*size-1];
    const samples = indices.map(index => pixels.slice(index*4,index*4+3));
    const points = new Uint32Array(size*size);
    const visited = new Uint8Array(size*size);
    let head = 0, tail = 0;
    function enqueue(index) {
        if (visited[index]) return;
        visited[index] = 1;
        const at = index*4;
        if (pixels[at+3] === 0 || samples.some(([r,g,b]) => Math.abs(r-pixels[at])+Math.abs(g-pixels[at+1])+Math.abs(b-pixels[at+2]) < 82)) {
            points[tail++] = index;
        }
    }
    for (let n=0;n<size;n++) { enqueue(n); enqueue(n*size); enqueue(n*size+size-1); enqueue(size*(size-1)+n); }
    while (head<tail) {
        const index=points[head++], x=index%size;
        pixels[index*4+3]=0;
        if(x>0)enqueue(index-1);
        if(x<size-1)enqueue(index+1);
        if(index>=size)enqueue(index-size);
        if(index<size*(size-1))enqueue(index+size);
    }
    context.putImageData(layer,0,0);
}
