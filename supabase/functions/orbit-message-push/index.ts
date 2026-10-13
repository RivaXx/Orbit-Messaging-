import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import webpush from 'npm:web-push@3.6.7';

const db = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const publicKey = Deno.env.get('ORBIT_VAPID_PUBLIC_KEY');
const privateKey = Deno.env.get('ORBIT_VAPID_PRIVATE_KEY');
if (publicKey && privateKey) webpush.setVapidDetails('https://orbit-messaging.vercel.app/',publicKey,privateKey);
const allowedPushHost = (host: string) => ['fcm.googleapis.com','updates.push.services.mozilla.com','push.services.mozilla.com','web.push.apple.com'].includes(host) || /^[a-z0-9-]+\.(notify|notifications)\.windows\.com$/i.test(host);
Deno.serve(async (req) => {
    if (req.method !== 'POST') return new Response('Method not allowed',{status:405});
    const secret = Deno.env.get('ORBIT_PUSH_WEBHOOK_SECRET');
    if (!secret || req.headers.get('x-orbit-webhook-secret') !== secret) return new Response('Unauthorized',{status:401});
    if (!publicKey || !privateKey) return new Response('Push keys unavailable',{status:503});
    try {
        const payload = await req.json();
        if (payload.type !== 'INSERT' || payload.table !== 'messages' || payload.schema !== 'public' || !/^[0-9a-f-]{36}$/i.test(payload.record?.id || '')) return new Response('Invalid event',{status:400});
        const {data:message,error} = await db.from('messages').select('id,room,sender_id,username,type,created_at').eq('id',payload.record.id).single();
        if (error || !message) return new Response('Message unavailable',{status:404});
        const isCall = message.type === 'call';
        if (isCall) {
            const {data:call} = await db.from('orbit_calls').select('state,created_at').eq('id',message.id).single();
            if (!call || call.state !== 'ringing' || Date.parse(call.created_at) < Date.now()-45000) return Response.json({sent:0});
        }
        const {data:recipients,error:recipientError} = await db.rpc('orbit_push_message_recipients',{message_id:message.id});
        if (recipientError) throw recipientError;
        if (!recipients?.length) return Response.json({sent:0});
        const {data:devices,error:deviceError} = await db.from('orbit_push_subscriptions').select('*').in('user_id',recipients.map(r=>r.user_id));
        if (deviceError) throw deviceError;
        let sent=0;
        await Promise.all((devices || []).map(async device => {
            if ((device.muted_rooms || []).includes(message.room)) return;
            const url = new URL(device.endpoint);
            if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowedPushHost(url.hostname)) return;
            const body = JSON.stringify({title:device.previews ? message.username || 'New message' : 'Orbit Messenger',body:isCall ? 'Incoming voice call — open Orbit to answer.' : 'You have a new message.',isCall,roomId:message.room,msgId:message.id,timestamp:Date.parse(message.created_at),tag:`orbit-message-${message.id}`});
            try { await webpush.sendNotification(device.subscription,body,{TTL:isCall ? 45 : 86400,urgency:'high',timeout:10000}); sent++; }
            catch (error) {
                if (error.statusCode===404 || error.statusCode===410) await db.from('orbit_push_subscriptions').delete().eq('endpoint',device.endpoint);
                else console.warn('Push delivery failed:',error.statusCode || 'network');
            }
        }));
        return Response.json({sent});
    } catch (_) { return new Response('Delivery failed',{status:500}); }
});
