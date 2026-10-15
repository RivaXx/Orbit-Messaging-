// ========================================================================
// ORBIT MESSENGER - CONFIG & GLOBAL STATE MODULE (js/config.js)
// ========================================================================

// ══════════════════════════════════════════════════════════════════════════
// ORBIT MESSENGER ENGINE V28.1.0 (Your Go-To Messaging System)
// ══════════════════════════════════════════════════════════════════════════

const SB_URL = "https://dhtbiggamuwoqurguhib.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRodGJpZ2dhbXV3b3F1cmd1aGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxNzY2MzksImV4cCI6MjA3ODc1MjYzOX0.-utin9W_-hSeijdHwcVSjft9biB5DSXrNOmuz5kCPlE";

let sb = null;
const _orbitLibraryPromises = new Map();
function ensureOrbitLibrary(name) {
    const libraries = {
        tus: ['tus', 'assets/vendor/tus.min.js'],
        cropper: ['Cropper', 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.js'],
        pdf: ['pdfjsLib', 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'],
        xlsx: ['XLSX', 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js']
    };
    const spec = libraries[name];
    if (!spec) return Promise.reject(new Error('Unknown media tool.'));
    if (window[spec[0]]) return Promise.resolve(window[spec[0]]);
    if (_orbitLibraryPromises.has(name)) return _orbitLibraryPromises.get(name);
    const promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = spec[1];
        script.async = true;
        const timer = setTimeout(() => fail(), 30000);
        const fail = () => {
            clearTimeout(timer); script.remove(); _orbitLibraryPromises.delete(name);
            reject(new Error('The media tool could not load. Reconnect and try again.'));
        };
        script.onerror = fail;
        script.onload = () => {
            clearTimeout(timer);
            if (!window[spec[0]]) return fail();
            if (name === 'pdf') window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            resolve(window[spec[0]]);
        };
        document.head.appendChild(script);
        if (name === 'cropper' && !document.getElementById('orbit-cropper-css')) {
            const css = document.createElement('link');
            css.id = 'orbit-cropper-css'; css.rel = 'stylesheet';
            css.href = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.css';
            document.head.appendChild(css);
        }
    });
    _orbitLibraryPromises.set(name, promise);
    return promise;
}
window.ensureOrbitLibrary = ensureOrbitLibrary;
function isOrbitSlowConnection() {
    const connection = navigator.connection;
    return !navigator.onLine || !!connection?.saveData ||
        ['slow-2g', '2g', '3g'].includes(connection?.effectiveType) ||
        (Number(connection?.downlink) > 0 && connection.downlink < 1.5);
}
window.isOrbitSlowConnection = isOrbitSlowConnection;

// Bulletproof, Null-Safe Supabase Client Initializer
function getSupabase() {
    if (sb) return sb;
    const clientFactory = (typeof supabase !== 'undefined' && supabase.createClient) 
        ? supabase.createClient 
        : (window.supabase && window.supabase.createClient ? window.supabase.createClient : null);

    if (clientFactory) {
        try {
            sb = clientFactory(SB_URL, SB_KEY, {
                auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
                global: {
                    fetch: async (input, init = {}) => {
                        const url = typeof input === 'string' ? input : input?.url || String(input);
                        const priority = /\/rest\/v1\/messages(?:\?|$)/.test(url) && init.method === 'POST' ? 'high'
                            : /\/storage\/v1\//.test(url) ? 'low' : 'auto';
                        const response = await fetch(input, { ...init, priority });
                        if (!response.ok && /\/storage\/v1\//.test(url)) {
                            const responseText = await response.clone().text().catch(() => '');
                            console.warn('[Orbit Storage Response] ' + JSON.stringify({ status: response.status, contentType: response.headers.get('content-type'), body: responseText.slice(0, 2000) }));
                        }
                        return response;
                    }
                },
                realtime: { params: { eventsPerSecond: 30 } }
            });
            return sb;
        } catch(e) {
            console.error('Failed to create Supabase client:', e);
        }
    }
    return sb;
}

// Initial client creation attempt
getSupabase();

async function ensureSupabase() {
    let client = getSupabase();
    if (client) return client;
    
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 100));
        client = getSupabase();
        if (client) return client;
    }
    
    // CDN fallback if primary failed
    if (!window.supabase) {
        await new Promise(resolve => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/@supabase/supabase-js@2';
            script.onload = () => resolve(true);
            script.onerror = () => resolve(false);
            document.head.appendChild(script);
        });
        client = getSupabase();
        if (client) return client;
    }
    
    throw new Error('Could not connect to authentication services. Please check your network connection.');
}

const _compactSessionRepairs = new Map();
async function ensureCompactAuthSession(client, session) {
    if (!session?.user?.id || !navigator.onLine || (session.access_token?.length || 0) < 7000) return session;
    const userId = session.user.id;
    if (_compactSessionRepairs.has(userId)) return _compactSessionRepairs.get(userId);
    const repair = (async () => {
        const latest = await client.auth.getSession();
        if (latest.error) throw latest.error;
        const active = latest.data?.session;
        if (!active || active.user.id !== userId) throw new Error('The signed-in account changed. Reopen the chat.');
        if ((active.access_token?.length || 0) < 7000) return active;
        const avatar = active.user.user_metadata?.avatar_url;
        if (typeof avatar !== 'string' || avatar.length < 4096) {
            // A previous repair may have saved metadata but lost its refresh
            // response. Finish refreshing instead of keeping the old large JWT.
            const refreshed = await client.auth.refreshSession();
            if (refreshed.error) throw refreshed.error;
            return refreshed.data?.session || active;
        }

        // Legacy builds put the entire avatar into Auth metadata. Every JWT
        // then carries the image and exceeds Storage's HTTP header limit.
        // Preserve the photo before removing it from authentication claims.
        const profileResult = await client.from('user_profiles').select('*').eq('user_id', userId).maybeSingle();
        if (profileResult.error) throw profileResult.error;
        const profile = profileResult.data;
        if (!profile?.dp_url) {
            const saved = await client.from('user_profiles').upsert({
                user_id: userId,
                first_name: profile?.first_name || active.user.user_metadata?.display_name || active.user.email?.split('@')[0] || 'Orbit User',
                last_name: profile?.last_name || '',
                dp_url: avatar,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
            if (saved.error) throw saved.error;
        } else if (profile.dp_url !== avatar) {
            // Keep the current profile photo and preserve the older Auth photo.
            localStorage.setItem(`orbit_legacy_auth_avatar_${userId}`, avatar);
        }
        const updated = await client.auth.updateUser({ data: { avatar_url: null } });
        if (updated.error) throw updated.error;
        const refreshed = await client.auth.refreshSession();
        if (refreshed.error) throw refreshed.error;
        const compact = refreshed.data?.session;
        if (!compact || compact.user.id !== userId) throw new Error('Please sign in again to finish repairing the upload session.');
        console.info('[Orbit] Repaired oversized login token: ' + active.access_token.length + ' → ' + compact.access_token.length + ' bytes. Profile photo preserved.');
        return compact;
    })();
    _compactSessionRepairs.set(userId, repair);
    try { return await repair; } finally { _compactSessionRepairs.delete(userId); }
}
window.ensureCompactAuthSession = ensureCompactAuthSession;

const ADMIN_EMAILS = ['rivaldo.a.rodrigues@gmail.com'];
const ADMIN_EMAIL = 'rivaldo.a.rodrigues@gmail.com'; // legacy fallback

// State Store
let currentUser = null;
let userProfile = null;
let currentRoom = null;
let isSelfChat = false;
let isGroupChat = false;
let myFriendsSet = new Set();
let myOutgoingRequestsSet = new Set();
let messageCache = new Map();
let globalUsersMap = new Map();
let globalUsersArray = [];
let allRoomsMap = new Map();
let userDirectRoomsMap = new Map();

function hydrateUserRoomsCache(userId = currentUser?.id) {
    if (!userId) {
        allRoomsMap.clear();
        userDirectRoomsMap.clear();
        return;
    }
    try {
        const r = localStorage.getItem(`orbit_user_rooms_v27_${userId}`);
        allRoomsMap = r ? new Map(JSON.parse(r)) : new Map();
        const dr = localStorage.getItem(`orbit_user_direct_rooms_v27_${userId}`);
        userDirectRoomsMap = dr ? new Map(JSON.parse(dr)) : new Map();
    } catch(e) {
        allRoomsMap = new Map();
        userDirectRoomsMap = new Map();
    }
}
function persistUserRoomsCache(userId = currentUser?.id) {
    if (!userId) return;
    try {
        localStorage.setItem(`orbit_user_rooms_v27_${userId}`, JSON.stringify(Array.from(allRoomsMap.entries())));
        localStorage.setItem(`orbit_user_direct_rooms_v27_${userId}`, JSON.stringify(Array.from(userDirectRoomsMap.entries())));
    } catch(e) {}
}
window.hydrateUserRoomsCache = hydrateUserRoomsCache;
window.persistUserRoomsCache = persistUserRoomsCache;

let pendingAttachments = [];
let replyTargetMessage = null;
let notificationHistory = [];
let activeRealtimeChannel = null;
let presenceChannel = null;
let currentNewsCategory = 'global';
let activeReadingNews = null;
let editingProfileFieldKey = null;
let inspectedTargetUser = null;
let adminInactiveBlacklist = new Set(JSON.parse(localStorage.getItem('orbit_admin_blacklist') || '[]'));

// Universal Media URL Formatter (Fixes broken images for cloud & storage files!)
function formatMediaUrl(urlOrPath) {
    if (!urlOrPath) return '';
    if (typeof urlOrPath !== 'string') urlOrPath = urlOrPath.url || '';
    if (/^(data:|blob:|https?:\/\/)/i.test(urlOrPath)) return urlOrPath;
    if (/^\/?storage\/v1\/object\//i.test(urlOrPath)) return `${SB_URL}/${urlOrPath.replace(/^\/+/, '')}`;
    const clean = urlOrPath.replace(/^\/+/, '').replace(/^\.\//, '').replace(/^chat-assets\//i, '');
    const encoded = clean.split('/').map(encodeURIComponent).join('/');
    return `${SB_URL}/storage/v1/object/public/chat-assets/${encoded}`;
}

function getOrbitStorageObjectPath(urlOrPath) {
    if (!urlOrPath) return '';
    if (typeof urlOrPath !== 'string') urlOrPath = urlOrPath.url || urlOrPath.path || '';
    if (/^(data:|blob:)/i.test(urlOrPath)) return '';
    let pathname = urlOrPath;
    try {
        const parsed = new URL(urlOrPath, window.location.href);
        if (/^https?:$/i.test(parsed.protocol) && parsed.hostname !== new URL(SB_URL).hostname && !parsed.pathname.includes('/storage/v1/object/')) return '';
        pathname = parsed.pathname;
    } catch(e) {}
    const objectMatch = pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/chat-assets\/(.+)$/i);
    let objectPath = objectMatch ? objectMatch[1] : pathname;
    objectPath = objectPath.split('?')[0].split('#')[0].replace(/^\/+/, '').replace(/^\.\//, '').replace(/^chat-assets\//i, '');
    try { objectPath = decodeURIComponent(objectPath); } catch(e) {}
    return objectPath;
}

async function getSignedOrbitMediaUrl(urlOrPath, expiresIn = 3600) {
    const objectPath = getOrbitStorageObjectPath(urlOrPath);
    if (!objectPath || objectPath.startsWith('storage/v1/')) return null;
    try {
        const client = await ensureSupabase();
        if (!client?.storage) return null;
        const { data, error } = await client.storage.from('chat-assets').createSignedUrl(objectPath, expiresIn);
        if (error) throw error;
        return data?.signedUrl || null;
    } catch(error) {
        console.warn('[Orbit] Could not create an attachment preview URL:', error?.message || error);
        return null;
    }
}

async function resolveMediaUrlForAccess(urlOrPath) {
    const formatted = formatMediaUrl(urlOrPath);
    if (!formatted || /^(data:|blob:)/i.test(formatted)) return formatted;
    const signed = await getSignedOrbitMediaUrl(urlOrPath);
    return signed || formatted;
}

async function retryMediaPreview(img) {
    if (!img || img.dataset.mediaFallbackBusy === 'true') return;
    img.dataset.mediaFallbackBusy = 'true';
    const original = img.dataset.mediaOriginal || img.currentSrc || img.src;
    const mayRetrySignedUrl = img.dataset.mediaFallbackCount !== '1';
    img.dataset.mediaFallbackCount = '1';
    const signed = mayRetrySignedUrl ? await getSignedOrbitMediaUrl(original) : null;
    img.dataset.mediaFallbackBusy = 'false';
    if (signed && signed !== img.src) {
        img.dataset.mediaOriginal = original;
        img.style.display = '';
        img.src = signed;
        img.closest('.wa-image-bunch-grid')?.classList.remove('media-preview-unavailable');
        img.parentElement?.querySelector('.media-load-fallback')?.remove();
        return;
    }

    img.alt = '';
    img.style.display = 'none';
    const parent = img.parentElement;
    if (parent && !parent.querySelector('.media-load-fallback')) {
        const fallback = document.createElement('button');
        fallback.type = 'button';
        fallback.className = 'media-load-fallback';
        fallback.textContent = 'Photo unavailable · Tap to retry';
        fallback.onclick = () => {
            img.dataset.mediaFallbackBusy = 'false';
            img.dataset.mediaFallbackCount = '0';
            img.style.display = '';
            img.src = img.dataset.mediaOriginal || original;
        };
        parent.appendChild(fallback);
    }
}

window.formatMediaUrl = formatMediaUrl;
window.getSignedOrbitMediaUrl = getSignedOrbitMediaUrl;
window.resolveMediaUrlForAccess = resolveMediaUrlForAccess;
window.retryMediaPreview = retryMediaPreview;


// --- Global States (Pre-declared for cross-module accessibility) ---
const unreadRoomsSet = new Set();
let activeChatPeerId = null;
let blockedUsersSet = (() => {
    try {
        return new Set(JSON.parse(localStorage.getItem('orbit_blocked_users') || '[]'));
    } catch(e) {
        return new Set();
    }
})();

// Universal Message Deduplication & Chronological Sorting Helper
function deduplicateAndSort(msgs) {
    if (!msgs || msgs.length === 0) return [];
    const seen = new Set();
    return msgs.filter(m => {
        if (!m || !m.id || seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
    }).sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || String(a.id).localeCompare(String(b.id)));
}
window.deduplicateAndSort = deduplicateAndSort;

function isAdmin() {
    if (!currentUser || !currentUser.email) return false;
    const userEmail = currentUser.email.trim().toLowerCase();
    return ADMIN_EMAILS.some(adm => adm.toLowerCase() === userEmail);
}

function isPrimaryAdmin() {
    return !!currentUser?.email && currentUser.email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

async function fetchUserProfile() {
    try {
        const { data } = await sb.from('user_profiles').select('*').eq('user_id', currentUser.id).maybeSingle();
        if (data) {
            userProfile = {
                ...data,
                username: userProfile?.username || currentUser.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_'),
                about: userProfile?.about || 'Hey there! I am using Orbit.'
            };
            localStorage.setItem(`orbit_profile_${currentUser.id}`, JSON.stringify(userProfile));
            updateUserHeaderUI();
        } else {
            const initial = {
                user_id: currentUser.id,
                first_name: currentUser.email.split('@')[0],
                last_name: '',
                dp_url: null,
                updated_at: new Date().toISOString()
            };
            await sb.from('user_profiles').upsert(initial, { onConflict: 'user_id' });
            userProfile = {
                ...initial,
                username: currentUser.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_'),
                about: 'Hey there! I am using Orbit.'
            };
            localStorage.setItem(`orbit_profile_${currentUser.id}`, JSON.stringify(userProfile));
            updateUserHeaderUI();
        }
    } catch(e) {}
}

function getVerifiedBadgeHtml(isAdminUser) {
    if (!isAdminUser) return '';
    return `<span class="verified-badge" title="Verified Creator & Admin"><svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.79-4-4-4-.495 0-.965.084-1.4.238C14.55 2.475 13.18 1.6 11.6 1.6s-2.95.875-3.6 2.148c-.435-.154-.905-.238-1.4-.238-2.21 0-4 1.79-4 4 0 .495.084.965.238 1.4C1.575 9.55.7 10.92.7 12.5s.875 2.95 2.148 3.6c-.154.435-.238.905-.238 1.4 0 2.21 1.79 4 4 4 .495 0 .965-.084 1.4-.238.65 1.273 2.02 2.148 3.6 2.148s2.95-.875 3.6-2.148c.435.154.905.238 1.4.238 2.21 0 4-1.79 4-4 0-.495-.084-.965-.238-1.4 1.273-.65 2.148-2.02 2.148-3.6z" fill="#00B0FF"/><path d="M10.2 16.2l-3.6-3.6 1.4-1.4 2.2 2.2 5.4-5.4 1.4 1.4-6.8 6.8z" fill="#FFFFFF"/></svg></span>`;
}

function updateUserHeaderUI() {
    const name = userProfile?.first_name ? `${userProfile.first_name} ${userProfile.last_name || ''}`.trim() : currentUser.email.split('@')[0];
    const isUserAdmin = isAdmin();
    const verifiedBadge = getVerifiedBadgeHtml(isUserAdmin);
    document.getElementById('dash-id').innerHTML = `<span class="user-chip-label">${escapeHtml(name)}</span>${verifiedBadge}`;
    
    const av = document.getElementById('dash-av');
    if (userProfile?.dp_url) {
        av.innerHTML = `<img src="${formatMediaUrl(userProfile.dp_url)}" alt="Avatar">`;
    } else {
        av.innerText = name[0].toUpperCase();
    }
    av.title = 'Open profile';
    av.style.cursor = 'pointer';
    av.onclick = event => { event.stopPropagation(); openProfileScreen(); };
}

function formatSmartOnlineText(otherCount) {
    if (otherCount <= 0) return "🟢 You're Online";
    if (otherCount === 1) return "🟢 2 Online (You + 1 other)";
    return `🟢 ${otherCount + 1} Online`;
}


function formatSmartActivity(lastSeenIso, isOnline = false) {
    if (!lastSeenIso) return isOnline ? '🟢 Online' : 'Offline';
    const last = new Date(lastSeenIso);
    const now = new Date();
    const diffMs = now - last;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    // Strictly online ONLY if is_online is true AND last ping was within 65 seconds
    if (isOnline && diffSec < 65) return '🟢 Online';
    if (diffMin < 1) return 'Last seen just now';
    if (diffMin < 60) return `Last seen ${diffMin}m ago`;
    if (diffHours < 24 && now.getDate() === last.getDate()) {
        const timeStr = last.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `Last seen today at ${timeStr}`;
    }
    if (diffDays === 1 || (diffHours < 48 && (now.getDate() - last.getDate() === 1 || now.getDate() < last.getDate()))) {
        const timeStr = last.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `Last seen yesterday at ${timeStr}`;
    }
    if (diffDays < 7) {
        const dayName = last.toLocaleDateString([], { weekday: 'short' });
        const timeStr = last.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `Last seen ${dayName} at ${timeStr}`;
    }
    if (diffDays < 30) {
        return `Last seen ${diffDays}d ago (${last.toLocaleDateString([], { month: 'short', day: 'numeric' })})`;
    }
    return `Last seen ${last.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

function formatLastSeen(lastSeenIso) {
    if (!lastSeenIso) return 'Offline';
    const last = new Date(lastSeenIso);
    const now = new Date();
    const diffSec = Math.floor((now - last) / 1000);
    if (diffSec < 60) return 'Last seen just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `Last seen ${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `Last seen ${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Last seen yesterday';
    if (diffDays < 7) return `Last seen ${diffDays}d ago`;
    return `Last seen ${last.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

function formatDateSeparator(dateIso) {
    if (!dateIso) return 'Today';
    const d = new Date(dateIso);
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const targetMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((todayMidnight - targetMidnight) / (1000 * 60 * 60 * 24));

    if (!Number.isFinite(d.getTime())) return 'Unknown date';
    if (diffDays === 0) return 'Today';
    if (diffDays < 0) return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) {
        return d.toLocaleDateString([], { weekday: 'long' });
    }
    const isSameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: isSameYear ? undefined : 'numeric' });
}

// ══════════════════════════════════════════════════════════════════════════
// USER PROFILE INSPECTOR (Click ANY DP to inspect user)
// ══════════════════════════════════════════════════════════════════════════

function timeAgo(dateString) {
    if (!dateString) return '';
    const d = Date.now() - new Date(dateString).getTime();
    if (d < 60000) return 'just now';
    if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
    if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
    return `${Math.floor(d / 86400000)}d ago`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(new RegExp("'", "g"),'&#39;');
}

