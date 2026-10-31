// Detach selected files from Android Gallery/cloud-provider handles before the
// picker is cleared or an album is accepted. Owned blobs can be read repeatedly.
var OrbitMediaSource = (() => {
    const owned = new WeakSet();
    function validate(files) {
        if (!files.length || files.length > 20 || files.some(file => !file.size || file.size > 49 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) {
            throw new Error('Choose up to 20 non-empty files, 49 MB each and 100 MB total.');
        }
    }
    async function snapshot(file) {
        if (owned.has(file)) return file;
        let timer;
        try {
            const bytes = await Promise.race([
                file.arrayBuffer(),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('File provider timed out')), 45000); })
            ]);
            if (bytes.byteLength !== file.size) throw new Error('Incomplete file');
            const copy = new File([bytes], file.name || 'Attachment', { type: file.type || 'application/octet-stream', lastModified: file.lastModified || Date.now() });
            owned.add(copy);
            return copy;
        } catch (cause) {
            const error = new Error(`Could not read ${String(file.name || 'this file').slice(0, 180)} from Gallery. Download it to this phone, then select it again. The selection has not been sent.`);
            error.code = 'ORBIT_SOURCE_UNREADABLE';
            error.cause = cause;
            throw error;
        } finally { clearTimeout(timer); }
    }
    async function capture(files, onProgress = () => {}, stillCurrent = () => true) {
        files = Array.from(files);
        validate(files);
        const copies = [];
        for (let index = 0; index < files.length; index++) {
            if (!stillCurrent()) throw new Error('The account or chat changed. Select the files again in the intended chat.');
            onProgress(index + 1, files.length);
            copies.push(await snapshot(files[index]));
        }
        if (!stillCurrent()) throw new Error('The account or chat changed. Select the files again in the intended chat.');
        return copies;
    }
    return { capture, snapshot, validate };
})();
