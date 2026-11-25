export const limit = 12 * 1024 * 1024;

export function describeRichImage(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (offset, text) => offset + text.length <= bytes.length &&
        [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
    const read24 = offset => bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
    let mime, width, height, animated = false;
    if (bytes.length >= 13 && (tag(0, 'GIF89a') || tag(0, 'GIF87a'))) {
        mime = 'image/gif'; animated = true;
        width = view.getUint16(6, true); height = view.getUint16(8, true);
    } else if (bytes.length >= 24 && bytes[0] === 137 && tag(1, 'PNG\r\n\x1a\n') && tag(12, 'IHDR')) {
        mime = 'image/png';
        width = view.getUint32(16); height = view.getUint32(20);
    } else if (bytes.length >= 25 && tag(0, 'RIFF') && tag(8, 'WEBP')) {
        mime = 'image/webp';
        if (bytes.length >= 30 && tag(12, 'VP8X')) {
            animated = Boolean(bytes[20] & 2);
            width = read24(24) + 1; height = read24(27) + 1;
        } else if (bytes.length >= 30 && tag(12, 'VP8 ') && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
            width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
        } else if (tag(12, 'VP8L') && bytes[20] === 0x2f) {
            const size = view.getUint32(21, true);
            width = 1 + (size & 0x3fff); height = 1 + ((size >>> 14) & 0x3fff);
        }
    } else if (bytes[0] === 255 && bytes[1] === 216) {
        mime = 'image/jpeg';
        for (let offset = 2; offset + 4 < bytes.length;) {
            if (bytes[offset++] !== 255) break;
            while (bytes[offset] === 255) offset++;
            const marker = bytes[offset++];
            if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break;
            const length = view.getUint16(offset);
            if (length < 2 || offset + length > bytes.length) break;
            if (marker >= 0xc0 && marker <= 0xcf && ![0xc4,0xc8,0xcc].includes(marker) && length >= 7) {
                height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
            }
            offset += length;
        }
    }
    if (!mime) throw new Error('Choose a GIF, PNG, WebP, or JPEG.');
    if (!width || !height) throw new Error('This image is damaged or its dimensions could not be read.');
    if (width > 4096 || height > 4096 || width * height > 12000000) {
        throw new Error('Choose an image up to 4096 pixels per side and 12 megapixels.');
    }
    return {mime, width, height, animated};
}
