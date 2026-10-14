import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { isCleanupAdmin, normalizeAttachments, storageRef, refKey } from './cleanup.ts';

const projectUrl = Deno.env.get('SUPABASE_URL')!;
const db = createClient(projectUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
Deno.serve(async req => {
    const origin = req.headers.get('origin') || '';
    const allowed = origin === 'https://orbit-messaging.vercel.app' || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
    const headers = {'Access-Control-Allow-Origin':allowed ? origin : 'https://orbit-messaging.vercel.app',
        'Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type,x-orbit-user-token,x-orbit-cleanup-secret',
        'Access-Control-Allow-Methods':'POST,OPTIONS', 'Vary':'Origin', 'Cache-Control':'no-store'};
    const reply = (data: unknown, status = 200) => Response.json(data, {status,headers});
    if (req.method === 'OPTIONS') return new Response('ok',{headers});
    if (req.method !== 'POST') return reply({error:'Method not allowed'},405);
    try {
        const body = await req.json();
        const scheduled = body.action === 'scheduled';
        if (scheduled) {
            const secret = Deno.env.get('ORBIT_CLEANUP_SECRET');
            if (!secret || req.headers.get('x-orbit-cleanup-secret') !== secret) return reply({error:'Unauthorized'},401);
        } else {
            const jwt = req.headers.get('x-orbit-user-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
            if (!jwt) return reply({error:'Sign in required'},401);
            const {data,error} = await db.auth.getUser(jwt);
            if (error || !data.user) return reply({error:'Invalid session'},401);
            if (!isCleanupAdmin(data.user.email)) return reply({error:'Primary admin only'},403);
        }
        if (body.action === 'settings') {
            const {data,error} = await db.from('orbit_cleanup_settings').select('enabled').eq('id',true).single();
            if (error) throw error;
            return reply(data);
        }
        if (body.action === 'schedule') {
            if (typeof body.enabled !== 'boolean') return reply({error:'Invalid setting'},400);
            if (body.enabled) {
                const {data:ready,error} = await db.rpc('orbit_cleanup_schedule_ready');
                if (error) throw error;
                if (!ready) return reply({error:'Set up the daily cron job in SETUP_ORBIT_ADMIN_CLEANUP.sql before enabling scheduled cleanup.'},409);
            }
            const {error} = await db.from('orbit_cleanup_settings').update({enabled:body.enabled}).eq('id',true);
            if (error) throw error;
            return reply({enabled:body.enabled});
        }
        if (!scheduled && (body.action !== 'clear' || body.confirm !== 'CLEAR_ALL_MESSAGES')) return reply({error:'Explicit cleanup confirmation required'},400);
        if (scheduled) {
            const {data,error} = await db.from('orbit_cleanup_settings').select('enabled').eq('id',true).single();
            if (error) throw error;
            if (!data.enabled) return reply({skipped:true});
        }
        // Fetch all protection sources BEFORE modifying data. Paginate to avoid
        // the REST row cap silently omitting profile pictures or shared files.
        const protectedKeys = new Set<string>();
        for (let offset = 0;; offset += 500) {
            const {data,error} = await db.rpc('orbit_cleanup_protected_urls').range(offset,offset+499);
            if (error) throw error;
            for (const row of data || []) {
                const ref = storageRef({url:row.url}, projectUrl);
                if (ref) protectedKeys.add(refKey(ref));
            }
            if (!data || data.length < 500) break;
        }
        const cutoff = new Date(Date.now() - (scheduled ? 10*86400000 : 0)).toISOString();
        const {data:messages,error:enqueueError} = await db.rpc('orbit_enqueue_cleanup',{before_time:cutoff});
        if (enqueueError) throw enqueueError;
        for (let offset = 0;; offset += 500) {
            const {data,error} = await db.rpc('orbit_cleanup_live_attachments').range(offset,offset+499);
            if (error) throw error;
            for (const row of data || []) for (const item of normalizeAttachments(row.attachments)) {
                const ref = storageRef(item,projectUrl); if (ref) protectedKeys.add(refKey(ref));
            }
            if (!data || data.length < 500) break;
        }
        // Queue survives failures and timeouts, so another run can retry files
        // even after the corresponding message records have been removed.
        const {data:queue,error:queueError} = await db.from('orbit_cleanup_queue').select('id,sender_id,attachments').order('id').limit(200);
        if (queueError) throw queueError;
        let removedFiles = 0;
        for (const row of queue || []) {
            const refs = new Map<string,{bucket:string,path:string}>();
            for (const item of normalizeAttachments(row.attachments)) {
                const ref = storageRef(item,projectUrl);
                if (!ref || protectedKeys.has(refKey(ref))) continue;
                // Attachments are user input: prevent a forged metadata path
                // from deleting another user's files or any avatar directory.
                const parts = ref.path.split('/');
                const owned = ref.bucket === 'orbit-view-once' ? parts[0] === row.sender_id : parts[1] === row.sender_id;
                if (owned && !/^(avatars?|profiles?|profile-pictures)$/i.test(parts[0])) refs.set(refKey(ref),ref);
            }
            let ok = true;
            for (const bucket of ['chat-assets','orbit-view-once']) {
                const paths = [...refs.values()].filter(ref => ref.bucket === bucket).map(ref => ref.path);
                if (!paths.length) continue;
                const {error} = await db.storage.from(bucket).remove(paths);
                if (error) { console.error('Cleanup storage retry:',error.message); ok = false; break; }
                removedFiles += paths.length;
            }
            if (ok) {
                const {error} = await db.from('orbit_cleanup_queue').delete().eq('id',row.id);
                if (error) throw error;
            }
        }
        const {count,error} = await db.from('orbit_cleanup_queue').select('id',{count:'exact',head:true});
        if (error) throw error;
        return reply({messages:Number(messages), files:removedFiles, pending:count || 0, cutoff});
    } catch (error) {
        console.error('Orbit cleanup failed:',error);
        return reply({error:'Cleanup failed. Some messages may already be cleared; queued media is retained for retry.'},500);
    }
});
