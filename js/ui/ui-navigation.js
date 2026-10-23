// ORBIT UI - NAVIGATION, APP LIFECYCLE & FEEDS (js/ui/ui-navigation.js)
// launchApp, prewarming, presence realtime, tab switching, liquid pod, news & trending feeds.

const roomPrewarmLastAt = new Map();
async function _prewarmRecentMessages() {
    try {
        const selfId = currentUser?.id;
        if (!selfId) return;
        if (isOrbitSlowConnection() || currentRoom || (typeof _messageDeliveryActive !== 'undefined' && _messageDeliveryActive.size)) return;
        const recent = JSON.parse(localStorage.getItem(`orbit_recent_chats_v27_${selfId}`) || '[]');
        const ids = Array.from(new Set([...recent.map(item => item.roomId), ...allRoomsMap.keys()])).filter(Boolean).slice(0, 6);
        if (!ids.length || Date.now() - (roomPrewarmLastAt.get(selfId) || 0) < 30000) return;
        roomPrewarmLastAt.set(selfId, Date.now());
        const client = await ensureSupabase();
        await Promise.allSettled(ids.map(async roomId => {
            const meta = allRoomsMap.get(roomId);
            const peerId = meta?.is_direct ? meta.participants?.find(id => id !== selfId) : resolveDirectPeerId(roomId, selfId);
            const aliases = resolveRoomAliases(roomId, peerId);
            const data = await queryRoomHistoryPage(client, aliases);
            if (currentUser?.id !== selfId || aliases.includes(currentRoom)) return;
            const old = filterRoomHistory(messageCache.get(roomId), aliases, peerId, selfId);
            const pending = old.filter(item => ['sending','queued','failed'].includes(item.status));
            persistRoomHistory(roomId, aliases, deduplicateAndSort([...filterRoomHistory(data, aliases, peerId, selfId), ...pending]));
        }));
    } catch (error) { console.warn('[Orbit History] Prewarm failed:', error); }
}

async function launchApp({introduction=false,forceIntroduction=false}={}) {
    let repeatIntro=forceIntroduction;try{repeatIntro=repeatIntro||localStorage.getItem('orbit_explicit_signout')==='true';}catch(_){}
    window.OrbitIntroduction?.afterSignIn(currentUser,{interactive:introduction,force:repeatIntro});
    try{localStorage.removeItem('orbit_explicit_signout');}catch(_){}
    if(typeof orbitRememberSessionActivity==='function')orbitRememberSessionActivity(true);
    if (typeof syncOrbitCleanupWatermark === 'function') syncOrbitCleanupWatermark().catch(() => {});
    document.getElementById('screen-auth').classList.remove('active');
    document.getElementById('screen-dash').classList.add('active');

    // Immediately hydrate user-scoped room cache & profile (0ms)
    if (typeof hydrateUserRoomsCache === 'function') {
        hydrateUserRoomsCache(currentUser.id);
    }
    const cachedProfile = localStorage.getItem(`orbit_profile_${currentUser.id}`);
    if (cachedProfile) {
        try{userProfile = JSON.parse(cachedProfile);updateUserHeaderUI();}catch(_){}
    }
    document.documentElement.classList.remove('orbit-restoring');
    // Give the cached chat list its first frame before optional suites start.
    const launchOwner=currentUser.id;
    setTimeout(()=>{
        if(currentUser?.id!==launchOwner)return;
        initOrbitWeather().catch(()=>{});
        if(typeof OrbitNotes!=='undefined'){OrbitNotes.load();if(window.orbitPendingNote)orbitOpenNoteLink(window.orbitPendingNote);}
        initOrbitChatServices().catch(error=>console.warn('[Orbit Services]',error.message));
        if(typeof enableOrbitBackgroundPush==='function'&&notificationPreference('orbit_device_notifications',true))enableOrbitBackgroundPush();
    },0);

    // Synchronously pre-warm global users from disk cache so clicking Global tab is instant
    const cachedGlobal = localStorage.getItem('orbit_global_cache_v26');
    if (cachedGlobal) {
        try {
            globalUsersArray = JSON.parse(cachedGlobal);
            globalUsersArray.forEach(u => globalUsersMap.set(u.user_id, u));
            // The hidden directory is rendered only when opened.
        } catch(e) {}
    }

    // Synchronously render cached chats at 0ms so user immediately sees chat list upon login
    if (typeof loadMainChats === 'function') {
        loadMainChats(true);
    }

    // Immediately trigger pre-warming of recent messages at 250ms for instant 0ms chat opening
    setTimeout(() => {
        if (typeof _prewarmRecentMessages === 'function') _prewarmRecentMessages();
    }, 2000);

    // Setup global realtime message listener so peer messages are delivered instantly regardless of current tab/room
    if (typeof setupGlobalRealtimeMessageListener === 'function') {
        setupGlobalRealtimeMessageListener();
    }

    // A token refresh or legacy avatar repair must never hold the loading screen.
    document.documentElement.classList.remove('orbit-restoring');
    if (navigator.onLine) {
        (async()=>{try {
            const owner=currentUser?.id;
            const client = await ensureSupabase();
            const result = await client.auth.getSession();
            if(!result.error&&!result.data?.session&&currentUser?.id===owner){
                currentUser=null;userProfile=null;
                document.querySelectorAll('.screen.active').forEach(node=>node.classList.remove('active'));
                document.getElementById('screen-auth').classList.add('active');
                if(typeof disposeOrbitTyping==='function')disposeOrbitTyping();
                return;
            }
            const session = await ensureCompactAuthSession(client, result.data?.session);
            if (currentUser?.id===owner && session?.user?.id === owner) currentUser = session.user;
        } catch (error) { console.warn('[Orbit] Session repair could not finish: ' + error.message); }})();
    }
    if (navigator.onLine) Promise.allSettled([
        fetchUserProfile(),
        updatePresenceStatus(true),
        initPresenceRealtime(),
        (typeof loadMainChats === 'function' ? loadMainChats() : Promise.resolve()),
        loadFriendRequestsCount(),
    ]);
    setTimeout(() => {
        if (isOrbitSlowConnection() || currentRoom) return;
        if (typeof _bgFetchGlobalUsers === 'function') _bgFetchGlobalUsers();
        if (typeof _prewarmRecentMessages === 'function') _prewarmRecentMessages();
    }, 3000);

    // Background purge of legacy base64 bloat via RPC if available
    try {
        ensureSupabase().then(client => {
            if (client && typeof client.rpc === 'function' && !isOrbitSlowConnection() && !currentRoom) {
                client.rpc('purge_base64_bloat').catch(() => {});
            }
        }).catch(() => {});
    } catch(e) {}

    const sqlButton = document.getElementById('btn-supabase-sql');
    if (sqlButton) sqlButton.classList.toggle('hide', typeof isPrimaryAdmin !== 'function' || !isPrimaryAdmin());

    if (isAdmin()) {
        const adminMenu = document.getElementById('admin-menu-item');
        if (adminMenu) adminMenu.classList.remove('hide');
        const adminStorage = document.getElementById('admin-storage-section');
        const storageToolsAvailable = typeof adminCleanOldNonAdminMedia === 'function' && typeof toggleAutoStorageClean === 'function';
        if (adminStorage) adminStorage.classList.toggle('hide', !storageToolsAvailable);
        const btnInactive = document.getElementById('btn-settings-inactive');
        if (btnInactive) btnInactive.classList.remove('hide');
        
        loadOrbitCleanupSettings();
        setTimeout(() => { if (!isOrbitSlowConnection() && !currentRoom && typeof scanForInactiveAccounts === 'function') scanForInactiveAccounts(); }, 10000);
    }
    document.getElementById('admin-menu-item')?.classList.toggle('hide', !isPrimaryAdmin());
    document.getElementById('admin-storage-section')?.classList.toggle('hide', !isPrimaryAdmin());
    document.getElementById('btn-settings-inactive')?.classList.toggle('hide', !isPrimaryAdmin());
    updateAdminTabVisibility();
}



// ══════════════════════════════════════════════════════════════════════════
// PROFILE SCREEN (Clean WhatsApp Style Layout with ZERO Screen Overlap)
// ══════════════════════════════════════════════════════════════════════════

async function updatePresenceStatus(isOnline = true) {
    if (!currentUser || !sb || !navigator.onLine) return;
    try {
        const name = (userProfile && (userProfile.display_name || userProfile.first_name))
            ? (userProfile.display_name || userProfile.first_name)
            : (currentUser.email ? currentUser.email.split('@')[0] : 'User');
        let dp = userProfile?.dp_url || null;
        if (dp && dp.startsWith('data:') && dp.length > 2000) dp = null;
        const nowIso = new Date().toISOString();

        await sb.from('user_presence').upsert({
            user_id: currentUser.id,
            email: currentUser.email,
            display_name: name,
            dp_url: dp,
            is_online: isOnline,
            last_seen: nowIso
        }, { onConflict: 'user_id' });
    } catch(err) {
        // Silent catch for background heartbeat
    }
}

function startPresenceHeartbeat() {
    if (presenceHeartbeatInterval) clearInterval(presenceHeartbeatInterval);
    // Immediate ping
    updatePresenceStatus(true);
    // Heartbeat every 25 seconds
    presenceHeartbeatInterval = setInterval(() => {
        if (currentUser && document.visibilityState === 'visible') {
            updatePresenceStatus(true);
        }
    }, 25000);
}

function initPresenceRealtime() {
    startPresenceHeartbeat();

    window.addEventListener('beforeunload', () => {
        if (currentUser && sb) {
            try {
                updatePresenceStatus(false);
            } catch(e) {}
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && currentUser) {
            updatePresenceStatus(true);
        }
    });

    try {
        if (sb && typeof sb.channel === 'function') {
            sb.channel('public:user_presence')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence' }, (payload) => {
                    const updatedUser = payload.new;
                    if (!updatedUser || !updatedUser.user_id) return;
                    if (typeof globalUsersMap !== 'undefined') {
                        const existing = globalUsersMap.get(updatedUser.user_id) || {};
                        globalUsersMap.set(updatedUser.user_id, { ...existing, ...updatedUser });
                        globalUsersArray=Array.from(globalUsersMap.values());
                    }
                    if(typeof orbitRefreshChatPresence==='function')orbitRefreshChatPresence();
                    const activeTab = document.querySelector('.liquid-tab-btn.active')?.getAttribute('data-tab');
                    if (activeTab === 'friends' && typeof loadFriends === 'function') {
                        loadFriends();
                    } else if (activeTab === 'global' && typeof loadGlobalUsers === 'function') {
                        renderGlobalUsersDOM(globalUsersArray);
                    }
                })
                .subscribe();
        }
    } catch(e) {}
}


let liveFeedRefreshTimer = null;
function startLiveFeedAutoRefresh() {
    if (liveFeedRefreshTimer) return;
    liveFeedRefreshTimer = setInterval(() => {
        if (!document.getElementById('screen-dash')?.classList.contains('active')) return;
        if (!document.getElementById('tab-news')?.classList.contains('hide')) refreshNewsFeed();
        if (!document.getElementById('tab-trending')?.classList.contains('hide')) refreshTrendingFeed();
    }, 2 * 60 * 1000);
}
startLiveFeedAutoRefresh();

function filterNewsCategory(cat, btn) {
    if (!['global', 'india', 'tech', 'finance', 'entertainment', 'sports'].includes(cat)) return;
    currentNewsCategory = cat;
    newsVisibleCount=20;
    document.querySelectorAll('#tab-news .news-filter-chip').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadNewsFeed();
    refreshNewsFeed();
}

function cleanFeedText(value) {
    let text=String(value||'');
    // Old cached feeds may contain entity-escaped HTML more than once.
    for(let i=0;i<4;i++){
        const doc=new DOMParser().parseFromString(text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,''),'text/html');
        const next=(doc.body.textContent||'').replace(/\s+/g,' ').trim();
        if(next===text)return next;text=next;
    }
    return text.replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').trim();
}

function formatFeedTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date unavailable';
    const elapsed = Math.max(0, Date.now() - date.getTime());
    const minutes = Math.floor(elapsed / 60000);
    let relative = 'Just now';
    if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        relative = hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
    } else if (minutes > 0) {
        relative = `${minutes}m ago`;
    }
    const absolute = date.toLocaleString([], {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit'
    });
    return `${relative} · ${absolute}`;
}

function setFeedUpdatedAt(elementId, prefix = 'Live · Updated') {
    const element = document.getElementById(elementId);
    if (element) element.textContent = `${prefix} ${new Date().toLocaleString([], {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit'
    })}`;
}

function readCachedFeed(key) {
    try {
        const cached = JSON.parse(localStorage.getItem(`orbit_news_${key}`) || '[]');
        return Array.isArray(cached) ? cached.filter(item => item?.link && item?.title && item?.pubDate) : [];
    } catch(e) { return []; }
}

async function fetchRssItems(feedUrl, limit = 40) {
    const errors = [];
    const fetchText = async (url) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);
        try {
            const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
            if (!response.ok) throw new Error(`Feed route returned ${response.status}`);
            return await response.text();
        } finally { clearTimeout(timeout); }
    };
    const parseXml = (raw) => {
        const xml = new DOMParser().parseFromString(raw, 'application/xml');
        if (xml.querySelector('parsererror')) throw new Error('Feed route returned invalid XML');
        const nodes = [...xml.querySelectorAll('item, entry')];
        const read = (node, ...names) => {
            for (const name of names) {
                const child = node.querySelector(name);
                if (child?.textContent?.trim()) return child.textContent.trim();
            }
            return '';
        };
        return nodes.map(node => ({
            title: read(node, 'title'),
            link: read(node, 'link') || node.querySelector('link')?.getAttribute('href') || '',
            pubDate: read(node, 'pubDate', 'published', 'updated', 'date'),
            author: read(node, 'author', 'source'),
            description: read(node, 'description', 'summary', 'content'),
            category: read(node, 'category'),
            thumbnail: Array.from(node.getElementsByTagNameNS('*','thumbnail')).find(el => el.getAttribute('url'))?.getAttribute('url') || Array.from(node.getElementsByTagNameNS('*','content')).find(el => el.getAttribute('url') && /image/i.test(el.getAttribute('type') || el.getAttribute('medium') || ''))?.getAttribute('url') || node.querySelector('enclosure[type^="image"]')?.getAttribute('url') || ''
        })).filter(item => item.title && item.link).slice(0, limit);
    };
    try {
        const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}&t=${Date.now()}`;
        const data = JSON.parse(await fetchText(url));
        if (data.status !== 'ok' || !Array.isArray(data.items)) throw new Error(data.message || 'RSS converter returned no items');
        if (data.items.length) return data.items.slice(0, limit);
        throw new Error('RSS converter returned an empty feed');
    } catch (error) { errors.push(error.message); }

    const encodedFeed = encodeURIComponent(feedUrl);
    const proxyRoutes = [
        `https://api.allorigins.win/raw?url=${encodedFeed}&t=${Date.now()}`,
        `https://corsproxy.io/?url=${encodedFeed}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodedFeed}`
    ];
    const proxyAttempts = proxyRoutes.map(async proxyUrl => {
        const items = parseXml(await fetchText(proxyUrl)).filter(item => item.pubDate);
        if (!items.length) throw new Error('Feed route returned no dated items');
        return items;
    });
    try { return await Promise.any(proxyAttempts); }
    catch (error) { errors.push(...(error.errors || []).map(item => item.message)); }
    throw new Error(errors.join(' · ') || 'Live feed unavailable');
}

function parseGdeltTimestamp(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 14);
    if (digits.length !== 14) return null;
    const date = new Date(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
}

async function fetchGdeltNews(category) {
    const queries = {
        global: '(world OR international OR politics OR economy) sourcelang:English',
        india: 'India sourcelang:English',
        tech: '(technology OR "artificial intelligence" OR software OR AI) sourcelang:English',
        finance: '(finance OR markets OR stocks OR banking) sourcelang:English',
        entertainment: '(entertainment OR cinema OR music OR television) sourcelang:English',
        sports: '(sports OR football OR cricket OR tennis) sourcelang:English'
    };
    const params = new URLSearchParams({
        query: queries[category] || queries.global,
        mode: 'ArtList', format: 'json', maxrecords: '75', timespan: '24h', sort: 'DateDesc'
    });
    const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, { cache: 'no-store',signal:AbortSignal.timeout(6500) });
    if (!response.ok) throw new Error(`Live news source returned ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.articles)) throw new Error('Live news source returned no article list');
    const seen = new Set();
    return data.articles.map(article => {
        const title = cleanFeedText(article.title);
        const published = parseGdeltTimestamp(article.seendate);
        const link = article.url || article.url_mobile;
        if (!title || !published || !link || seen.has(link)) return null;
        seen.add(link);
        return {
            id: `${category}_${encodeURIComponent(link)}`, title, source: cleanFeedText(article.domain || 'Live news'),
            pubDate: published.toISOString(), img: safeNewsImage(article.socialimage),
            body: title, link, category
        };
    }).filter(Boolean).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate)).slice(0, 40);
}

function safeNewsImage(value) {
    if (typeof value !== 'string' || /photo-1504711434969-e33886168f5c|photo-1518770660439-4636190af475/.test(value)) return '';
    try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : ''; } catch (_) { return ''; }
}
function articleNewsImage(item) {
    const description = new DOMParser().parseFromString(String(item.description || ''), 'text/html');
    return [item.thumbnail, item.enclosure?.link, item.enclosure?.url, description.querySelector('img')?.getAttribute('src')].map(safeNewsImage).find(Boolean) || '';
}
function makeNewsItems(items, category, defaultSource = 'Google News') {
    return items.map(item => {
        const pubDate = item.pubDate ? new Date(item.pubDate) : null;
        if (!pubDate || Number.isNaN(pubDate.getTime()) || !item.link) return null;
        const rawTitle = cleanFeedText(item.title);
        const sourceFromTitle = rawTitle.match(/\s+[–-]\s+([^–-]+)$/)?.[1]?.trim();
        const title = defaultSource.startsWith('Google') ? rawTitle.replace(/\s+[–-]\s+[^–-]+$/, '').trim() : rawTitle;
        if (!title) return null;
        return {
            id: `${category}_${encodeURIComponent(item.link)}`,
            title,
            source: cleanFeedText(item.author || item.source || (defaultSource.startsWith('Google') ? sourceFromTitle : '') || defaultSource),
            pubDate: pubDate.toISOString(),
            img: articleNewsImage(item),
            body: cleanFeedText(item.description).slice(0, 700) || title,
            link: item.link,
            category
        };
    }).filter(Boolean).slice(0, 40);
}

let newsVisibleCount=20;
const newsRefreshPending = new Set();
const newsPublisherFeeds = {
    global:'https://feeds.bbci.co.uk/news/world/rss.xml',
    india:'https://feeds.bbci.co.uk/news/world/asia/india/rss.xml',
    tech:'https://feeds.bbci.co.uk/news/technology/rss.xml',
    finance:'https://feeds.bbci.co.uk/news/business/rss.xml',
    entertainment:'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml',
    sports:'https://feeds.bbci.co.uk/sport/rss.xml'
};
async function refreshNewsFeed() {
    const category = currentNewsCategory;
    if (newsRefreshPending.has(category)) return;
    newsRefreshPending.add(category);
    const icon = document.getElementById('news-refresh-icon');
    const list = document.getElementById('news-feed-list');
    if (icon) icon.classList.add('fa-spin');
    if (list && !liveNewsCache[currentNewsCategory]?.length) list.innerHTML = '<div class="feed-state">Loading the latest headlines…</div>';
    try {
        let items = [];
        try{
            const response=await fetch('/api/news?category='+encodeURIComponent(category),{cache:'no-store',signal:AbortSignal.timeout(8000)});
            if(response.ok){const feed=await response.json();if(Array.isArray(feed.items))items=feed.items.filter(row=>row.category===category&&row.title&&/^https?:/.test(row.link)&&Number.isFinite(Date.parse(row.pubDate)));}
        }catch(error){console.warn('[Orbit News] Aggregator unavailable:',error.message);}
        // Publisher RSS carries story images. Never substitute a stock photo.
        try { if(!items.length) items = makeNewsItems(await fetchRssItems(newsPublisherFeeds[category] || newsPublisherFeeds.global), category, category === 'sports' ? 'BBC Sport' : 'BBC News'); }
        catch (error) { console.warn('[Orbit News] Publisher feed unavailable:', error.message); }
        try { if (!items.length) items = await fetchGdeltNews(category); }
        catch (primaryError) { console.warn('[Orbit News] Primary live feed unavailable; trying backup:', primaryError); }

        if (!items.length && category === 'tech') {
            const response = await fetch(`https://hacker-news.firebaseio.com/v0/newstories.json?${Date.now()}`, { cache: 'no-store' });
            if (!response.ok) throw new Error('Hacker News is unavailable');
            const ids = (await response.json()).slice(0, 40);
            const stories = await Promise.all(ids.map(id => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)));
            items = stories.filter(story => story?.title && story?.url && story.time)
                .sort((a, b) => b.time - a.time).slice(0, 40).map(story => ({
                id: `hn_${story.id}`, title: story.title, source: `Hacker News · ${story.by || 'community'}`,
                pubDate: new Date(story.time * 1000).toISOString(), img: '',
                body: `${story.title}\n\n${story.score || 0} points · ${story.descendants || 0} comments`, link: story.url, category
            }));
        } else if (!items.length) {
            const topic = {finance:'finance markets',entertainment:'entertainment film music',sports:'sports cricket football'}[category];
            const feed = topic ? `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en` : category === 'india'
                ? 'https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en'
                : 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en';
            items = makeNewsItems(await fetchRssItems(feed), category);
        }
        if (!items.length) throw new Error('No recent stories were returned');
        const seen=new Set();
        items=items.filter(item=>{const key=item.title.toLocaleLowerCase().replace(/\W/g,'');if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>Date.parse(b.pubDate)-Date.parse(a.pubDate)).slice(0,60);
        items=items.map(item=>({...item,title:cleanFeedText(item.title),source:cleanFeedText(item.source),body:cleanFeedText(item.body)}));
        liveNewsCache[category] = items;
        try { localStorage.setItem(`orbit_news_${category}`, JSON.stringify(items)); } catch(e) {}
        if (category === currentNewsCategory) { setFeedUpdatedAt('news-last-updated'); loadNewsFeed(); }
    } catch(error) {
        console.warn(`[Orbit News] ${category} feed refresh failed:`, error);
        if (category === currentNewsCategory && liveNewsCache[category]?.length) {
            const status = document.getElementById('news-last-updated');
            if (status) status.textContent = 'Saved headlines · live refresh unavailable';
        }
        if (category === currentNewsCategory && list && !liveNewsCache[category]?.length) list.innerHTML = '<div class="feed-state">Live headlines could not load. Check your connection and refresh.</div>';
    } finally {
        newsRefreshPending.delete(category);
        if (icon && !newsRefreshPending.has(currentNewsCategory)) icon.classList.remove('fa-spin');
    }
}

function loadNewsFeed() {
    const list = document.getElementById('news-feed-list');
    if (!list) return;
    let items = liveNewsCache[currentNewsCategory];
    if (!items?.length) {
        items = readCachedFeed(currentNewsCategory);
        if (items.length) liveNewsCache[currentNewsCategory] = items;
    }
    items = (items || []).filter(item => item?.link && item?.pubDate).slice().sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    if (!items.length) {
        list.innerHTML = '<div class="feed-state">Headlines will appear here when the live feed loads.</div>';
        return;
    }
    list.innerHTML = items.slice(0,newsVisibleCount).map(item => {
        const image = safeNewsImage(item.img);
        return `<button type="button" class="news-card-liquid touch-fix" data-news-id="${escapeHtml(item.id)}">
            <div class="news-thumb-wrap ${image ? '' : 'no-news-image'}">
                ${image ? `<img src="${escapeHtml(image)}" alt="Article image from ${escapeHtml(item.source)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.hidden=true;this.parentElement.classList.add('no-news-image')">` : ''}
                <span class="news-thumb-empty"><i class="fa-regular fa-newspaper" aria-hidden="true"></i><small>No publisher image</small></span>
            </div>
            <span class="news-card-copy"><span class="news-headline">${escapeHtml(item.title)}</span>
                <span class="news-source-meta"><span class="news-source-name">${escapeHtml(item.source)}</span> · ${escapeHtml(formatFeedTimestamp(item.pubDate))}</span>
            </span>
        </button>`;
    }).join('');
    if(items.length>newsVisibleCount){list.innerHTML+='<button type="button" class="news-filter-chip" onclick="newsVisibleCount+=20;loadNewsFeed()">More headlines ('+(items.length-newsVisibleCount)+')</button>';}
    list.querySelectorAll('[data-news-id]').forEach(button => button.addEventListener('click', () => openNewsReader(button.dataset.newsId)));
}

function openNewsReader(newsId) {
    const item = Object.values(liveNewsCache).flat().find(news => news.id === newsId);
    if (!item) return;
    activeReadingNews = item;
    document.getElementById('news-reader-title').innerText = cleanFeedText(item.title);
    document.getElementById('news-reader-meta').innerText = `${cleanFeedText(item.source)} · ${formatFeedTimestamp(item.pubDate)}`;
    document.getElementById('news-reader-body').innerText = cleanFeedText(item.body)||cleanFeedText(item.title);
    const hero = document.getElementById('news-reader-img'), image = safeNewsImage(item.img);
    hero.hidden = !image; hero.onerror = () => { hero.hidden = true; };
    if (image) hero.src = image; else hero.removeAttribute('src');
    document.getElementById('news-reader-source-link').href = item.link;
    document.getElementById('modal-news-reader').classList.add('active');
}

function closeNewsReader() {
    document.getElementById('modal-news-reader').classList.remove('active');
    activeReadingNews = null;
}

function shareCurrentNewsToChat() {
    if (!activeReadingNews) return;
    const story = activeReadingNews;
    closeNewsReader();
    openSelfChat();
    setTimeout(() => {
        document.getElementById('msg-input').value = `📰 ${story.title}\n${story.link}`;
        handleInputResize(document.getElementById('msg-input'));
    }, 400);
}

async function refreshTrendingFeed() {
    const icon = document.getElementById('trending-refresh-icon');
    const list = document.getElementById('trending-feed-list');
    if (icon) icon.classList.add('fa-spin');
    if (list && !CURATED_TRENDING.length) list.innerHTML = '<div class="feed-state">Loading live search trends…</div>';
    try {
        const items = await fetchRssItems('https://trends.google.com/trending/rss?geo=IN', 20);
        const liveTrends = items.map((item, index) => {
            const title = cleanFeedText(item.title);
            const pubDate = item.pubDate ? new Date(item.pubDate) : null;
            if (!title || !pubDate || Number.isNaN(pubDate.getTime())) return null;
            return { rank: index + 1, tag: title, category: cleanFeedText(item.category || 'Google Search'), pubDate: pubDate.toISOString(), link: item.link || `https://trends.google.com/trending?geo=IN&q=${encodeURIComponent(title)}` };
        }).filter(Boolean).slice(0, 40);
        if (!liveTrends.length) throw new Error('Google Trends returned no current search terms');
        CURATED_TRENDING = liveTrends;
        setFeedUpdatedAt('trending-last-updated');
        try { localStorage.setItem('orbit_trending_live', JSON.stringify(CURATED_TRENDING)); } catch(e) {}
    } catch(error) {
        console.warn('[Orbit Trends] Live trend refresh failed:', error);
        let savedTrends = [];
        try { savedTrends = JSON.parse(localStorage.getItem('orbit_trending_live') || '[]'); } catch(e) {}
        CURATED_TRENDING = Array.isArray(savedTrends) ? savedTrends : [];
        try {
            const headlines = await fetchGdeltNews('global');
            if (headlines.length) {
                CURATED_TRENDING = headlines.slice(0, 8).map((item, index) => ({
                    rank: index + 1, tag: item.title, category: 'Live news topic', pubDate: item.pubDate,
                    link: `https://trends.google.com/trending?geo=IN&q=${encodeURIComponent(item.title)}`
                }));
                try { localStorage.setItem('orbit_trending_live', JSON.stringify(CURATED_TRENDING)); } catch(e) {}
                const status = document.getElementById('trending-last-updated');
                if (status) status.textContent = `Live news topics · Google Trends unavailable · ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`;
            } else if (CURATED_TRENDING.length) {
                const status = document.getElementById('trending-last-updated');
                if (status) status.textContent = 'Saved trends · live sources unavailable';
            } else {
                const status = document.getElementById('trending-last-updated');
                if (status) status.textContent = 'Google Trends is live · feed connection unavailable';
            }
        } catch(fallbackError) {
            console.warn('[Orbit Trends] Headline fallback unavailable:', fallbackError);
            const status = document.getElementById('trending-last-updated');
            if (status) status.textContent = CURATED_TRENDING.length ? 'Saved trends · live refresh unavailable' : 'Google Trends is live · feed connection unavailable';
        }
    }
    loadTrendingTopics();
    if (icon) icon.classList.remove('fa-spin');
}

function loadTrendingTopics() {
    const list = document.getElementById('trending-feed-list');
    if (!list) return;
    if (!CURATED_TRENDING.length) {
        try { CURATED_TRENDING = JSON.parse(localStorage.getItem('orbit_trending_live') || '[]'); } catch(e) { CURATED_TRENDING = []; }
    }
    if (!CURATED_TRENDING.length) {
        list.innerHTML = '<div class="feed-state">Live trend cards could not connect. <a href="https://trends.google.com/trending?geo=IN" target="_blank" rel="noopener noreferrer">Open Google Trends</a> to see current searches.</div>';
        return;
    }
    list.innerHTML = CURATED_TRENDING.map(topic => `
        <article class="trending-card-liquid">
            <div class="trending-topic-info"><span class="trending-rank-num">#${topic.rank}</span><span class="trending-topic-copy">
                <strong>${escapeHtml(topic.tag)}</strong><small>${escapeHtml(topic.category || 'Google Trends')} · ${escapeHtml(formatFeedTimestamp(topic.pubDate))}</small>
            </span></div>
            <div class="trending-topic-actions">
                <a href="${escapeHtml(topic.link)}" target="_blank" rel="noopener noreferrer">Trends</a>
                <a href="https://x.com/search?q=${encodeURIComponent(topic.tag)}" target="_blank" rel="noopener noreferrer">Search X</a>
            </div>
        </article>`).join('');
}

function shareTrendingToChat(tag) {
    openSelfChat();
    setTimeout(() => {
        document.getElementById('msg-input').value = `🔥 Trending Topic: ${tag}`;
        handleInputResize(document.getElementById('msg-input'));
    }, 400);
}


function orbitEnsureTabVisible(button,smooth=true){
    const pod=document.getElementById('dash-tabs-wrapper');if(!pod||!button)return;
    const item=button.getBoundingClientRect(),frame=pod.getBoundingClientRect();
    const right=item.right??item.left+button.offsetWidth;
    const delta=item.left<frame.left?item.left-frame.left:right>frame.right?right-frame.right:0;
    if(!delta)return;const left=Math.max(0,pod.scrollLeft+delta);
    if(pod.scrollTo)pod.scrollTo({left,behavior:smooth?'smooth':'auto'});else pod.scrollLeft=left;
}
function switchTab(tabKey) {
    document.querySelectorAll('.liquid-tab-btn').forEach(b => b.classList.remove('active'));
    const selectedTabButton = document.querySelector(`.liquid-tab-btn[data-tab="${tabKey}"]`);
    selectedTabButton?.classList.add('active');
    orbitEnsureTabVisible(selectedTabButton);

    // Smoothly animate liquid glass pod indicator
    updateLiquidPodThumb(tabKey);

    // 0ms instant DOM toggle
    document.querySelectorAll('.contact-feed').forEach(f => f.classList.add('hide'));
    document.getElementById(`tab-${tabKey}`)?.classList.remove('hide');

    if (tabKey === 'main-chats') loadMainChats();
    else if (tabKey === 'friends') loadFriends();
    else if (tabKey === 'groups') loadGroups();
    else if (tabKey === 'global') loadGlobalUsers(true);
    else if (tabKey === 'notes') loadPersonalNotes();
    else if (tabKey === 'clock') initClockSuite();
    else if (tabKey === 'calculator') initCalculator();
    else if (tabKey === 'calendar') initCalendar();
    else if (tabKey === 'compass') initCompassSuite();
    else if (tabKey === 'news') { loadNewsFeed(); refreshNewsFeed(); }
    else if (tabKey === 'trending') { loadTrendingTopics(); refreshTrendingFeed(); }
}

// ══════════════════════════════════════════════════════════════════════════
// LIQUID GLASS POD CONTROLLER (Physical Spring Interpolation)
// ══════════════════════════════════════════════════════════════════════════

const liquidPodSpring = { x: null, width: null, vx: 0, vw: 0, targetX: 0, targetWidth: 0, frame: 0, initialized: false };
let liquidPodObservedButton = null;
const liquidPodResizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    const pod = document.getElementById('dash-tabs-wrapper');
    const activeBtn = pod?.querySelector('.liquid-tab-btn.active');
    const thumb = document.getElementById('liquid-pill-thumb');
    if (!activeBtn || !thumb) return;
    liquidPodSpring.targetX = activeBtn.offsetLeft;
    liquidPodSpring.targetWidth = activeBtn.offsetWidth;
    if (!liquidPodSpring.frame && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        liquidPodSpring.lastTime = undefined;
        liquidPodSpring.frame = requestAnimationFrame(animateLiquidPodThumb);
    } else if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        thumb.style.width = `${activeBtn.offsetWidth}px`;
        thumb.style.transform = `translate3d(${activeBtn.offsetLeft}px,0,0)`;
    }
});
function updateLiquidPodThumb(tabKey) {
    const pod = document.getElementById('dash-tabs-wrapper');
    const thumb = document.getElementById('liquid-pill-thumb');
    if (!pod || !thumb) return;

    const activeBtn = (tabKey ? pod.querySelector(`.liquid-tab-btn[data-tab="${tabKey}"]`) : null) || pod.querySelector('.liquid-tab-btn.active');
    if (!activeBtn) {
        thumb.classList.remove('active');
        return;
    }
    const targetKey = tabKey || activeBtn.dataset.tab;
    thumb.classList.toggle('is-global', targetKey === 'global');
    if (liquidPodResizeObserver && liquidPodObservedButton !== activeBtn) {
        if (liquidPodObservedButton) liquidPodResizeObserver.unobserve(liquidPodObservedButton);
        liquidPodObservedButton = activeBtn;
        liquidPodResizeObserver.observe(activeBtn);
    }

    const alignThumb = () => {
        if (!activeBtn.isConnected || !thumb.isConnected) return;
        liquidPodSpring.targetX = activeBtn.offsetLeft;
        liquidPodSpring.targetWidth = activeBtn.offsetWidth;
        if (!liquidPodSpring.initialized) {
            liquidPodSpring.x = liquidPodSpring.targetX;
            liquidPodSpring.width = liquidPodSpring.targetWidth;
            liquidPodSpring.initialized = true;
        }
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            liquidPodSpring.x = liquidPodSpring.targetX;
            liquidPodSpring.width = liquidPodSpring.targetWidth;
            liquidPodSpring.vx = liquidPodSpring.vw = 0;
            thumb.style.width = `${liquidPodSpring.width}px`;
            thumb.style.transform = `translate3d(${liquidPodSpring.x}px,0,0)`;
            thumb.style.setProperty('--pod-squish-x', '1');
            thumb.style.setProperty('--pod-squish-y', '1');
            thumb.classList.add('active');
            return;
        }
        thumb.classList.add('active');
        if (!liquidPodSpring.frame) liquidPodSpring.frame = requestAnimationFrame(animateLiquidPodThumb);
    };
    requestAnimationFrame(alignThumb);
};

function animateLiquidPodThumb(now) {
    const state = liquidPodSpring;
    state.frame = 0;
    if (state.lastTime === undefined) state.lastTime = now;
    const dt = Math.min((now - state.lastTime) / 1000 || 1 / 60, 0.032);
    state.lastTime = now;
    const pod = document.getElementById('dash-tabs-wrapper');
    const activeBtn = pod?.querySelector('.liquid-tab-btn.active');
    if (activeBtn) {
        state.targetX = activeBtn.offsetLeft;
        state.targetWidth = activeBtn.offsetWidth;
    }
    const stiffness = 310;
    const damping = 27;
    state.vx += (stiffness * (state.targetX - state.x) - damping * state.vx) * dt;
    state.vw += (stiffness * (state.targetWidth - state.width) - damping * state.vw) * dt;
    state.x += state.vx * dt;
    state.width += state.vw * dt;

    const thumb = document.getElementById('liquid-pill-thumb');
    if (!thumb) return;
    const stretch = Math.min(0.12, Math.abs(state.vx) / 1800 + Math.abs(state.vw) / 1200);
    thumb.style.width = `${Math.max(1, state.width)}px`;
    thumb.style.transform = `translate3d(${state.x}px,0,0) scaleX(${1 + stretch}) scaleY(${1 - stretch * 0.3})`;
    thumb.style.setProperty('--pod-squish-x', String(1 + stretch));
    thumb.style.setProperty('--pod-squish-y', String(1 - stretch * 0.3));
    if (Math.abs(state.targetX - state.x) + Math.abs(state.targetWidth - state.width) + Math.abs(state.vx) + Math.abs(state.vw) > 0.08) {
        state.frame = requestAnimationFrame(animateLiquidPodThumb);
    } else {
        state.x = state.targetX;
        state.width = state.targetWidth;
        state.vx = state.vw = 0;
        state.lastTime = undefined;
        thumb.style.width = `${state.width}px`;
        thumb.style.transform = `translate3d(${state.x}px,0,0)`;
        thumb.style.setProperty('--pod-squish-x', '1');
        thumb.style.setProperty('--pod-squish-y', '1');
    }
}
window.updateLiquidPodThumb = updateLiquidPodThumb;

function togglePodDockPosition(pos) {
    const pod = document.getElementById('dash-tabs-wrapper');
    if (!pod) return;
    const targetPos = pos || (pod.classList.contains('dock-bottom') ? 'top' : 'bottom');
    if (targetPos === 'bottom') {
        pod.classList.remove('dock-top');
        pod.classList.add('dock-bottom');
        const rBottom = document.getElementById('dock-pos-bottom');
        if (rBottom) rBottom.checked = true;
    } else {
        pod.classList.remove('dock-bottom');
        pod.classList.add('dock-top');
        const rTop = document.getElementById('dock-pos-top');
        if (rTop) rTop.checked = true;
    }
    try { localStorage.setItem('orbit_pref_pod_dock', targetPos); } catch(e) {}
    setTimeout(() => updateLiquidPodThumb(), 60);
}
window.togglePodDockPosition = togglePodDockPosition;

let liquidPodInitialized = false;
const orbitDefaultTabOrder = ['main-chats','friends','groups','global','news','trending','notes','clock','calculator','calendar','compass'];
function orbitTabButtons() {
    return Array.from(document.getElementById('dash-tabs-wrapper')?.querySelectorAll('.liquid-tab-btn') || []);
}
function saveOrbitTabOrder() {
    try { localStorage.setItem('orbit_pref_tab_order', JSON.stringify(orbitTabButtons().map(button => button.dataset.tab))); } catch (_) {}
}
function restoreOrbitTabOrder(reset = false) {
    const pod = document.getElementById('dash-tabs-wrapper');
    if (!pod) return;
    let saved = [];
    try { saved = reset ? orbitDefaultTabOrder : JSON.parse(localStorage.getItem('orbit_pref_tab_order') || '[]'); } catch (_) {}
    const buttons = orbitTabButtons(), byKey = new Map(buttons.map(button => [button.dataset.tab, button]));
    const keys = [...new Set([...(Array.isArray(saved) ? saved : []), ...buttons.map(button => button.dataset.tab)])];
    keys.forEach(key => { if (byKey.has(key)) pod.appendChild(byKey.get(key)); });
    if (reset) saveOrbitTabOrder();
    updateLiquidPodThumb();
}
function moveOrbitTab(button, direction) {
    const buttons = orbitTabButtons().filter(item => item.style.display !== 'none' && !item.classList.contains('hide'));
    const index = buttons.indexOf(button), neighbor = buttons[index + direction];
    if (!neighbor) return false;
    button.parentElement.insertBefore(button, direction < 0 ? neighbor : neighbor.nextSibling);
    updateLiquidPodThumb();
    return true;
}
function announceOrbitTab(button) {
    const status = document.getElementById('orbit-tab-order-status');
    const buttons = orbitTabButtons().filter(item => item.style.display !== 'none' && !item.classList.contains('hide'));
    if (status) status.textContent = `${button.title || button.dataset.tab}: position ${buttons.indexOf(button) + 1} of ${buttons.length}`;
}
function resetOrbitTabOrder() { restoreOrbitTabOrder(true); }
function initOrbitTabReorder() {
    const pod = document.getElementById('dash-tabs-wrapper');
    if (!pod) return;
    let hold = null, state = null, edgeFrame = 0, suppressClickUntil = 0;
    restoreOrbitTabOrder();
    pod.title = 'Hold a button, then drag it left or right to reorder. Alt + arrow keys also moves a focused button.';
    orbitTabButtons().forEach(button => button.setAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight'));
    function reorderAtPointer() {
        if (!state?.dragging) return;
        const button = state.button;
        const others = orbitTabButtons().filter(item => item !== button && item.offsetWidth > 0);
        const before = others.find(item => state.clientX < item.getBoundingClientRect().left + item.offsetWidth / 2);
        const visible = orbitTabButtons().filter(item => item.offsetWidth > 0);
        const currentIndex = visible.indexOf(button);
        const targetIndex = before ? visible.indexOf(before) - (currentIndex < visible.indexOf(before) ? 1 : 0) : visible.length - 1;
        if (currentIndex !== targetIndex) {
            pod.insertBefore(button, before || (others.at(-1)?.nextSibling ?? null));
            updateLiquidPodThumb();
            announceOrbitTab(button);
        }
    }
    function edgeScroll() {
        edgeFrame = 0;
        if (!state?.dragging) return;
        const rect = pod.getBoundingClientRect();
        const step = state.clientX < rect.left + 32 ? -8 : state.clientX > rect.right - 32 ? 8 : 0;
        if (step) { pod.scrollLeft += step; reorderAtPointer(); }
        edgeFrame = requestAnimationFrame(edgeScroll);
    }
    pod.addEventListener('pointerdown', event => {
        const button = event.target.closest('.liquid-tab-btn');
        if (event.button !== 0 || state || !button || !pod.contains(button)) return;
        state = {id:event.pointerId, button, x:event.clientX, y:event.clientY, clientX:event.clientX, dragging:false,
            scroll:pod.scrollLeft, original:orbitTabButtons()};
        hold = setTimeout(() => {
            if (!state) return;
            state.dragging = true;
            pod.setPointerCapture(state.id);
            pod.classList.add('tabs-reordering');
            state.button.classList.add('tab-reordering');
            state.button.focus({preventScroll:true});
            navigator.vibrate?.(20);
            edgeFrame = requestAnimationFrame(edgeScroll);
            announceOrbitTab(state.button);
        }, 500);
    });
    pod.addEventListener('pointermove', event => {
        if (!state || event.pointerId !== state.id) return;
        state.clientX = event.clientX;
        const dx = event.clientX - state.x;
        if (!state.dragging) {
            if (Math.hypot(dx, event.clientY - state.y) > 8) {
                clearTimeout(hold);
                pod.scrollLeft = state.scroll - dx;
                suppressClickUntil = Date.now() + 400;
            }
            return;
        }
        event.preventDefault();
        reorderAtPointer();
    });
    function release(event) {
        if (!state || event.pointerId !== state.id) return;
        clearTimeout(hold); cancelAnimationFrame(edgeFrame); edgeFrame = 0;
        const finished = state;
        state = null;
        if (finished.dragging) {
            suppressClickUntil = Date.now() + 500;
            if (event.type === 'pointercancel' || event.type === 'lostpointercapture') finished.original.forEach(button => pod.appendChild(button));
            else saveOrbitTabOrder();
            finished.button.classList.remove('tab-reordering');
            announceOrbitTab(finished.button);
        }
        pod.classList.remove('tabs-reordering');
        if (pod.hasPointerCapture(finished.id)) pod.releasePointerCapture(finished.id);
        updateLiquidPodThumb();
    }
    ['pointerup','pointercancel','lostpointercapture'].forEach(type => pod.addEventListener(type, release));
    pod.addEventListener('pointerleave', () => {
        if (state && !state.dragging) { clearTimeout(hold); state = null; }
    });
    pod.addEventListener('click', event => {
        if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    pod.addEventListener('keydown', event => {
        const button = event.target.closest('.liquid-tab-btn');
        if (event.key === 'Escape' && state?.dragging) { release({pointerId:state.id,type:'pointercancel'}); event.preventDefault(); return; }
        if (!button || !event.altKey || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        if (moveOrbitTab(button, event.key === 'ArrowLeft' ? -1 : 1)) {
            saveOrbitTabOrder(); button.focus({preventScroll:true}); orbitEnsureTabVisible(button,false); announceOrbitTab(button);
        }
    });
    pod.addEventListener('contextmenu', event => { if (state?.dragging) event.preventDefault(); });
}
function initLiquidPod() {
    if (liquidPodInitialized) { updateLiquidPodThumb(); return; }
    liquidPodInitialized = true;
    try {
        const savedDock = localStorage.getItem('orbit_pref_pod_dock');
        if (savedDock) {
            togglePodDockPosition(savedDock);
        }
    } catch(e) {}

    initOrbitTabReorder();
    window.addEventListener('resize', () => {
        requestAnimationFrame(() => updateLiquidPodThumb());
    });

    // Ensure thumb aligns after layout settle
    setTimeout(() => updateLiquidPodThumb(), 100);
    setTimeout(() => updateLiquidPodThumb(), 400);
}
window.initLiquidPod = initLiquidPod;

function updateAdminTabVisibility() {
    const newsTabBtn = document.querySelector('.liquid-tab-btn[data-tab="news"]');
    const trendingTabBtn = document.querySelector('.liquid-tab-btn[data-tab="trending"]');
    if (newsTabBtn) newsTabBtn.style.display = '';
    if (trendingTabBtn) trendingTabBtn.style.display = '';
}


async function loadPersonalNotes(){await OrbitNotes.load();}

// ══════════════════════════════════════════════════════════════════════════
// GENERAL HELPERS & UI
// ══════════════════════════════════════════════════════════════════════════



window.launchApp = launchApp;
window.switchTab = switchTab;
window.updatePresenceStatus = updatePresenceStatus;
window.initPresenceRealtime = initPresenceRealtime;
window.initLiquidPod = initLiquidPod;
window.togglePodDockPosition = togglePodDockPosition;
window.updateLiquidPodThumb = updateLiquidPodThumb;
window.filterNewsCategory = filterNewsCategory;
window.refreshNewsFeed = refreshNewsFeed;
window.loadNewsFeed = loadNewsFeed;
window.openNewsReader = openNewsReader;
window.closeNewsReader = closeNewsReader;
window.shareCurrentNewsToChat = shareCurrentNewsToChat;
window.refreshTrendingFeed = refreshTrendingFeed;
window.loadTrendingTopics = loadTrendingTopics;
window.shareTrendingToChat = shareTrendingToChat;
window.loadPersonalNotes = loadPersonalNotes;
