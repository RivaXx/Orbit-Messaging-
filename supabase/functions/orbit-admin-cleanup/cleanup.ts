export const ADMIN_EMAIL = 'rivaldo.a.rodrigues@gmail.com';
export function isCleanupAdmin(email: unknown): boolean {
    return typeof email === 'string' && email.trim().toLowerCase() === ADMIN_EMAIL;
}
export function normalizeAttachments(value: unknown): any[] {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return []; } }
    return (Array.isArray(value) ? value : []).map(item => {
        if (typeof item === 'string') { try { return JSON.parse(item); } catch { return null; } }
        return item;
    }).filter(item => item && typeof item === 'object');
}
// Never delete a whole bucket or accept an arbitrary URL as a storage object.
export function storageRef(item: any, projectUrl: string): {bucket:string,path:string} | null {
    let bucket = item?.storage_bucket || 'chat-assets', path = item?.storage_path;
    if (!path && typeof item?.url === 'string') {
        try {
            const url = new URL(item.url);
            if (url.origin !== new URL(projectUrl).origin) return null;
            const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/(chat-assets|orbit-view-once)\/(.+)$/);
            if (!match) return null;
            bucket = match[1]; path = decodeURIComponent(match[2]);
        } catch { return null; }
    }
    if (!['chat-assets','orbit-view-once'].includes(bucket) || typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').includes('..')) return null;
    return {bucket,path};
}
export const refKey = (ref: {bucket:string,path:string}) => `${ref.bucket}/${ref.path}`;
