// ORBIT UI - MODALS, CUSTOMIZATIONS & SETTINGS (js/ui/ui-modals.js)
// Settings modal, themes, liquid blur, chat wallpapers, profile editor & inspector,
// global users directory, QR code generator, database SQL modal, admin utilities.

function previewUserDp(url, name = 'Profile photo') {
    if (!url || typeof openMediaLightbox !== 'function') return;
    openMediaLightbox(formatMediaUrl(url), name);
}
window.previewUserDp = previewUserDp;

function openProfileScreen() {
    document.getElementById('user-dropdown').classList.remove('open');
    
    const name = userProfile?.first_name ? `${userProfile.first_name} ${userProfile.last_name || ''}`.trim() : currentUser.email.split('@')[0];
    const about = userProfile?.about || 'Set About';
    const username = userProfile?.username || currentUser.email.split('@')[0];

    document.getElementById('profile-display-name-val').innerText = name;
    document.getElementById('profile-about-val').innerText = about;
    document.getElementById('profile-username-val').innerText = username;

    const av = document.getElementById('profile-large-av');
    if (userProfile?.dp_url) {
        av.innerHTML = `<img src="${formatMediaUrl(userProfile.dp_url)}" alt="Avatar" style="cursor:zoom-in;">`;
        av.onclick = () => previewUserDp(userProfile.dp_url, name);
    } else {
        av.innerText = name[0].toUpperCase();
        av.onclick = null;
    }

    document.getElementById('screen-dash').classList.remove('active');
    document.getElementById('screen-profile').classList.add('active');
}

function closeProfileScreen() {
    document.getElementById('screen-profile').classList.remove('active');
    document.getElementById('screen-dash').classList.add('active');
}

function editProfileField(fieldKey) {
    editingProfileFieldKey = fieldKey;
    const modal = document.getElementById('modal-edit-field');
    const title = document.getElementById('edit-field-title');
    const inp = document.getElementById('edit-field-input');

    if (fieldKey === 'name') {
        title.innerText = 'Edit Your Name';
        inp.value = userProfile?.first_name || '';
    } else if (fieldKey === 'about') {
        title.innerText = 'Edit About Bio';
        inp.value = userProfile?.about || '';
    } else if (fieldKey === 'username') {
        title.innerText = 'Edit Reserved Username';
        inp.value = userProfile?.username || '';
    }

    modal.classList.add('active');
    inp.focus();
}

function closeEditFieldModal() {
    document.getElementById('modal-edit-field').classList.remove('active');
    editingProfileFieldKey = null;
}

async function submitEditField() {
    const val = document.getElementById('edit-field-input').value.trim();
    if (!val) return;

    if (!userProfile) userProfile = { user_id: currentUser.id };

    if (editingProfileFieldKey === 'name') {
        userProfile.first_name = val;
        document.getElementById('profile-display-name-val').innerText = val;
    } else if (editingProfileFieldKey === 'about') {
        userProfile.about = val;
        document.getElementById('profile-about-val').innerText = val;
    } else if (editingProfileFieldKey === 'username') {
        const cleanUsername = val.replace(/[^a-zA-Z0-9_]/g, '');
        userProfile.username = cleanUsername;
        document.getElementById('profile-username-val').innerText = cleanUsername;
    }

    closeEditFieldModal();
    updateUserHeaderUI();
    showToast('Profile updated ✓', 'success');

    localStorage.setItem(`orbit_profile_${currentUser.id}`, JSON.stringify(userProfile));
    
    try {
        await sb.from('user_profiles').upsert({
            user_id: currentUser.id,
            first_name: userProfile.first_name || '',
            last_name: userProfile.last_name || '',
            dp_url: userProfile.dp_url || null,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        await updatePresenceStatus(true);
    } catch(e) {}
}

let orbitProfilePhotoUploading = false;
async function handleProfileAvatarUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !currentUser?.id) return;
    if (orbitProfilePhotoUploading) { showToast('Please wait for the current photo to finish.'); return; }
    if (!file.type.startsWith('image/')) { showToast('Choose an image file.', 'error'); return; }
    const owner = currentUser.id;
    orbitProfilePhotoUploading = true;
    showToast('Uploading profile photo…', 'info');
    try {
        const resized = await compressImageForUpload(file, 512, 0.85);
        if (!resized?.startsWith('data:image/')) throw new Error('This photo could not be read. Try a JPG or PNG image.');
        const mime = resized.match(/^data:([^;,]+)/)?.[1] || 'image/jpeg';
        const bytes = Uint8Array.from(atob(resized.split(',')[1]), char => char.charCodeAt(0));
        const photo = new Blob([bytes], {type:mime});
        const url = await uploadMediaToStorage(photo, 'profile-photo.jpg', mime, 'avatars');
        if (currentUser?.id !== owner) return;
        const client = await ensureSupabase();
        const profile = {...(userProfile || {}), dp_url:url};
        const {error} = await client.from('user_profiles').upsert({
            user_id: owner,
            first_name: profile.first_name || '',
            last_name: profile.last_name || '',
            dp_url: url,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        if (error) throw error;
        if (currentUser?.id !== owner) return;
        userProfile = profile;
        try { localStorage.setItem(`orbit_profile_${owner}`, JSON.stringify(profile)); } catch (_) {}
        updateUserHeaderUI();
        const avatar = document.getElementById('profile-large-av');
        if (avatar) {
            const image = document.createElement('img'); image.src = url; image.alt = 'Your profile photo';
            avatar.replaceChildren(image);
        }
        await updatePresenceStatus(true);
        showToast('Profile photo updated ✓', 'success');
    } catch(err) {
        showToast(`Profile photo could not be saved: ${err.message || 'Please try again.'}`, 'error');
    } finally { orbitProfilePhotoUploading = false; }
}

async function confirmDeleteSelfAccount() {
    const confirmPhrase = prompt('To permanently delete your account, type "DELETE":');
    if (confirmPhrase === 'DELETE') {
        try {
            showToast('Deleting account...', 'success');
            await sb.rpc('self_delete_account').catch(() => {});
            
            await Promise.all([
                sb.from('messages').delete().eq('sender_id', currentUser.id),
                sb.from('room_members').delete().eq('user_id', currentUser.id),
                sb.from('user_profiles').delete().eq('user_id', currentUser.id),
                sb.from('user_presence').delete().eq('user_id', currentUser.id)
            ]);

            localStorage.clear();
            await sb.auth.signOut();
            window.location.reload();
        } catch(e) {
            showToast('Account deletion failed');
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// SMART PRESENCE & DATE UTILITIES
// ══════════════════════════════════════════════════════════════════════════

let presenceHeartbeatInterval = null;


function openUserProfileInspector(userId) {
    if (!userId) return;
    const user = globalUsersMap.get(userId) || (userId === currentUser?.id ? userProfile : null);
    if (!user) return;

    inspectedTargetUser = user;
    const name = user.display_name || user.first_name || user.email?.split('@')[0] || 'User';
    const username = user.username ? `@${user.username}` : `@${user.email?.split('@')[0] || 'user'}`;
    const about = user.about || 'Available';
    const smartStatus = formatSmartActivity(user.last_seen, user.is_online);

    document.getElementById('inspector-name').innerText = name;
    document.getElementById('inspector-username').innerText = username;
    document.getElementById('inspector-about').innerText = about;
    document.getElementById('inspector-status-badge').innerText = smartStatus;

    const av = document.getElementById('inspector-av');
    if (user.dp_url) {
        av.innerHTML = `<img src="${formatMediaUrl(user.dp_url)}" alt="Avatar" style="cursor:zoom-in;">`;
        av.onclick = () => previewUserDp(user.dp_url, name);
    } else {
        av.innerText = name[0].toUpperCase();
        av.onclick = null;
    }

    document.getElementById('modal-user-inspector').classList.add('active');
}

function closeUserProfileInspector() {
    document.getElementById('modal-user-inspector').classList.remove('active');
    inspectedTargetUser = null;
}

function inspectorStartChat() {
    if (!inspectedTargetUser) return;
    const uid = inspectedTargetUser.user_id || inspectedTargetUser.id;
    const name = inspectedTargetUser.display_name || inspectedTargetUser.first_name || 'User';
    const dp = inspectedTargetUser.dp_url || null;
    closeUserProfileInspector();
    if (typeof openDirectChat === 'function') {
        openDirectChat(uid, name, dp);
    }
}

function inspectorSendFriendReq() {
    if (!inspectedTargetUser) return;
    const email = inspectedTargetUser.email;
    if (email) {
        document.getElementById('friend-email-input').value = email;
        closeUserProfileInspector();
        submitFriendRequest();
    }
}

function handleHeaderAvatarClick() {
    if (isSelfChat) {
        openProfileScreen();
    } else {
        const otherUser = Array.from(globalUsersMap.values()).find(u => u.display_name === document.getElementById('chat-target-name').innerText);
        if (otherUser) {
            if (otherUser.dp_url) {
                previewUserDp(otherUser.dp_url, otherUser.display_name || 'User');
            } else {
                openUserProfileInspector(otherUser.user_id);
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// GLOBAL DIRECTORY — True instant cache → silent background Supabase sync
// ══════════════════════════════════════════════════════════════════════════

function loadGlobalUsers(fromCacheFirst) {
    const list = document.getElementById('global-list');
    if (!list) return;

    // 1. SHOW CACHED DATA INSTANTLY (pure synchronous, zero network)
    if (globalUsersArray && globalUsersArray.length > 0) {
        renderGlobalUsersDOM(globalUsersArray);
    } else {
        const raw = localStorage.getItem('orbit_global_cache_v26');
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    globalUsersArray = parsed;
                    parsed.forEach(u => globalUsersMap.set(u.user_id, u));
                    renderGlobalUsersDOM(parsed);
                    const activeCount = parsed.filter(u => u.is_online === true && u.last_seen && (Date.now() - new Date(u.last_seen).getTime() < 65000)).length;
                    const el = document.getElementById('global-online-count');
                    if (el) el.innerText = `${activeCount} online`;
                }
            } catch(err) { localStorage.removeItem('orbit_global_cache_v26'); }
        }
    }

    // 2. If still empty, show skeleton
    if (!globalUsersArray || globalUsersArray.length === 0) {
        list.innerHTML = `<div style="padding:20px 0;display:flex;flex-direction:column;gap:8px;">
            ${[0,1,2,3,4].map(() => `<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(255,255,255,0.03);border-radius:16px;">
                <div style="width:48px;height:48px;border-radius:50%;background:rgba(255,255,255,0.07);flex-shrink:0;"></div>
                <div style="flex:1;"><div style="height:12px;background:rgba(255,255,255,0.07);border-radius:6px;width:55%;margin-bottom:7px;"></div><div style="height:10px;background:rgba(255,255,255,0.05);border-radius:6px;width:38%;"></div></div>
            </div>`).join('')}
        </div>`;
    }

    // 3. Silently refresh from Supabase in background (no await = doesn't block render)
    _bgFetchGlobalUsers();
}

async function _bgFetchGlobalUsers() {
    try {
        let query = sb.from('user_presence').select('user_id,email,display_name,dp_url,is_online,last_seen');
        if (currentUser && currentUser.id) {
            query = query.neq('user_id', currentUser.id);
        }
        const { data, error } = await query
            .order('is_online', { ascending: false })
            .order('last_seen', { ascending: false })
            .limit(350);

        if (error || !data) return;

        // Filter out deleted/blocked accounts in JS
        const clean = data.filter(u =>
            u && u.user_id &&
            !adminInactiveBlacklist.has(u.user_id) &&
            u.display_name !== '[Deleted Account]'
        );

        if (clean.length === 0) return;

        // Update memory cache
        globalUsersArray = clean;
        clean.forEach(u => globalUsersMap.set(u.user_id, u));

        // Persist to disk cache
        try { localStorage.setItem('orbit_global_cache_v26', JSON.stringify(clean)); } catch(e) {}

        // Re-render
        renderGlobalUsersDOM(clean);

        // Strictly count online users (is_online === true AND pinged within 120s)
        const activeOnlineCount = clean.filter(u => u.is_online === true && u.last_seen && (Date.now() - new Date(u.last_seen).getTime() < 65000)).length;
        const el = document.getElementById('global-online-count');
        if (el) el.innerText = `${activeOnlineCount} online`;

    } catch(e) {}
}

function renderGlobalUsersDOM(users) {
    const list=document.getElementById('global-list');
    if(!list || !Array.isArray(users))return;
    const seen=new Set(), now=Date.now();
    const online=user=>user.is_online===true && Number.isFinite(Date.parse(user.last_seen)) && now-Date.parse(user.last_seen)>=0 && now-Date.parse(user.last_seen)<65000;
    const people=users.filter(user=>{if(!user?.user_id||seen.has(user.user_id))return false;seen.add(user.user_id);return true;})
        .sort((a,b)=>Number(online(b))-Number(online(a)) || String(a.display_name||a.email||'').localeCompare(String(b.display_name||b.email||'')));
    const count=document.getElementById('global-online-count');if(count)count.textContent=`${people.filter(online).length} online`;
    if(!people.length){list.innerHTML='<div class="orbit-people-empty"><i class="fa-solid fa-users"></i><strong>No people to show yet</strong><span>People will appear here when the directory is available.</span></div>';return;}
    const frag=document.createDocumentFragment();
    people.forEach(user=>{
        const uid=user.user_id,name=String(user.display_name||user.email?.split('@')[0]||'Orbit user');
        const handle='@'+String(user.username||user.email?.split('@')[0]||'user');
        const isOnline=online(user),isSelf=uid===currentUser?.id;
        const card=document.createElement('article');card.className='contact-glass-card orbit-directory-card';card.dataset.userId=uid;
        const avatar=document.createElement('button');avatar.type='button';avatar.className='btn-reset c-av-wrap orbit-directory-avatar';avatar.classList.toggle('is-online',isOnline);avatar.setAttribute('aria-label',`View ${name}'s profile`);
        const initial=()=>{avatar.replaceChildren();const letter=document.createElement('span');letter.textContent=Array.from(name)[0]||'?';avatar.append(letter);};
        if(user.dp_url){const image=document.createElement('img');image.src=formatMediaUrl(user.dp_url);image.alt='';image.loading='lazy';image.decoding='async';image.onerror=initial;avatar.append(image);}else initial();
        avatar.onclick=()=>openUserProfileInspector(uid);
        const open=document.createElement('button');open.type='button';open.className='btn-reset orbit-person-open';open.setAttribute('aria-label',`Chat with ${name}`);open.onclick=()=>openDirectChat(uid,name,user.dp_url||'');
        const title=document.createElement('span');title.className='orbit-person-name';
        const label=document.createElement('span');label.textContent=name;title.append(label);
        if(String(user.email||'').toLowerCase()===ADMIN_EMAIL.toLowerCase()){const verified=document.createElement('span');verified.innerHTML=getVerifiedBadgeHtml(true);title.append(verified);}
        const username=document.createElement('span');username.className='orbit-person-handle';username.textContent=handle;
        const activity=document.createElement('span');activity.className=`orbit-person-presence${isOnline?' is-online':''}`;
        activity.textContent=isOnline?'Online':localStorage.getItem('orbit_privacy_last_seen')==='nobody'?'Offline':Number.isFinite(Date.parse(user.last_seen))?formatSmartActivity(user.last_seen,false):'Last seen unavailable';
        open.append(title,username,activity);
        const action=document.createElement('button');action.type='button';action.className='btn-reset orbit-person-action';
        if(isSelf){action.textContent='You';action.disabled=true;}
        else if(myFriendsSet.has(uid)){action.textContent='Friends';action.disabled=true;action.classList.add('is-connected');}
        else if(myOutgoingRequestsSet.has(uid)){action.textContent='Requested';action.disabled=true;}
        else{action.textContent='Add friend';action.setAttribute('aria-label',`Add ${name} as a friend`);action.onclick=event=>handleGlobalFriendBtnClick(uid,action,event);}
        card.append(avatar,open,action);frag.append(card);
    });
    const scroll=list.scrollTop;list.replaceChildren(frag);list.scrollTop=scroll;
}

// ══════════════════════════════════════════════════════════════════════════
// CHAT OPENING & REALTIME — V28 COMPLETE REWRITE (8-bug fix)
// ══════════════════════════════════════════════════════════════════════════
// deduplicateAndSort is centrally defined in js/config.js

// ══════════════════════════════════════════════════════════════════════════
// DYNAMIC TOP 10 NEWS & TRENDING WITH LIVE TIMESTAMPS
// ══════════════════════════════════════════════════════════════════════════
let liveNewsCache = { global: [], india: [], tech: [] };
let CURATED_TRENDING = [];


// Universal file previewer (handleDocumentFilePreview, openPdfViewer, closeXlsxViewer) is defined in js/chat-actions.js

// ══════════════════════════════════════════════════════════════════════════
// SETTINGS CUSTOMIZATIONS (Liquid Blur, Wallpapers, Accents)
// ══════════════════════════════════════════════════════════════════════════

const ORBIT_SUPABASE_SQL = "-- Optional server setup for private fast message previews and media access.\n-- Run in this Orbit project's Supabase SQL Editor. Existing bucket visibility,\n-- MIME restrictions, stored messages and message table policies are preserved.\nbegin;\n\ncreate or replace function public.orbit_can_access_chat_room(chat_room text)\nreturns boolean language sql stable security invoker set search_path = ''\nas $function$\n    select auth.uid() is not null and (\n        chat_room = 'self_' || auth.uid()::text\n        or (left(chat_room, 3) = 'dm_' and split_part(chat_room, '_', 4) = '' and (\n            split_part(chat_room, '_', 2) in (auth.uid()::text, left(auth.uid()::text, 12))\n            or split_part(chat_room, '_', 3) in (auth.uid()::text, left(auth.uid()::text, 12))\n        ))\n        or exists (\n            select 1 from public.rooms r\n            where r.id::text = chat_room and (\n                r.created_by::text = auth.uid()::text\n                or to_jsonb(r.participants) ? auth.uid()::text\n            )\n        )\n    );\n$function$;\nrevoke all on function public.orbit_can_access_chat_room(text) from public;\ngrant execute on function public.orbit_can_access_chat_room(text) to authenticated;\n\ndrop policy if exists \"Orbit Chat Broadcast Read\" on realtime.messages;\ncreate policy \"Orbit Chat Broadcast Read\" on realtime.messages\nfor select to authenticated using (\n    extension = 'broadcast'\n    and left(realtime.topic(), 11) = 'orbit_fast_'\n    and public.orbit_can_access_chat_room(substring(realtime.topic() from 12))\n);\ndrop policy if exists \"Orbit Chat Broadcast Send\" on realtime.messages;\ncreate policy \"Orbit Chat Broadcast Send\" on realtime.messages\nfor insert to authenticated with check (\n    extension = 'broadcast'\n    and left(realtime.topic(), 11) = 'orbit_fast_'\n    and public.orbit_can_access_chat_room(substring(realtime.topic() from 12))\n);\ngrant select, insert on realtime.messages to authenticated;\n\ninsert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)\nvalues ('chat-assets', 'chat-assets', true, 52428800, null)\non conflict (id) do nothing;\n\ndrop policy if exists \"Authenticated Users Upload Chat Assets\" on storage.objects;\ncreate policy \"Authenticated Users Upload Chat Assets\" on storage.objects\nfor insert to authenticated with check (\n    bucket_id = 'chat-assets' and (storage.foldername(name))[2] = auth.uid()::text\n);\n\ndrop policy if exists \"Orbit Read Own Chat Assets\" on storage.objects;\ndrop policy if exists \"Orbit Read Chat Attachments\" on storage.objects;\ncreate policy \"Orbit Read Chat Attachments\" on storage.objects\nfor select to authenticated using (\n    bucket_id = 'chat-assets' and (\n        (storage.foldername(name))[2] = auth.uid()::text\n        or exists (\n            select 1 from public.messages m\n            where public.orbit_can_access_chat_room(m.room::text)\n              and exists (\n                select 1 from jsonb_array_elements(\n                    case when jsonb_typeof(m.attachments) = 'array' then m.attachments else '[]'::jsonb end\n                ) attachment\n                where attachment->>'storage_path' = storage.objects.name\n                   or split_part(split_part(attachment->>'url', '/chat-assets/', 2), '?', 1) = storage.objects.name\n              )\n        )\n    )\n);\nnotify pgrst, 'reload schema';\ncommit;\n";

function openSupabaseSqlModal() {
    if (typeof isPrimaryAdmin !== 'function' || !isPrimaryAdmin()) {
        showToast('This control is available only to the primary admin.', 'error');
        return;
    }
    const modal = document.getElementById('modal-supabase-sql');
    if (!modal) return;
    const pre = document.getElementById('supabase-sql-code');
    if (pre) pre.textContent = ORBIT_SUPABASE_SQL;
    modal.classList.add('active');
}
window.openSupabaseSqlModal = openSupabaseSqlModal;

function closeSupabaseSqlModal() {
    const modal = document.getElementById('modal-supabase-sql');
    if (modal) modal.classList.remove('active');
}
window.closeSupabaseSqlModal = closeSupabaseSqlModal;

function copySupabaseSql() {
    if (typeof isPrimaryAdmin !== 'function' || !isPrimaryAdmin()) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ORBIT_SUPABASE_SQL).then(() => {
            if (typeof showToast === 'function') showToast('Supabase SQL copied to clipboard! Paste in SQL Editor.', 'success');
            const btnText = document.getElementById('btn-copy-sql-text');
            if (btnText) {
                btnText.textContent = 'Copied! ✓';
                setTimeout(() => { if (btnText) btnText.textContent = 'Copy Complete SQL Script'; }, 2500);
            }
        }).catch(() => fallbackCopySql());
    } else {
        fallbackCopySql();
    }
}
window.copySupabaseSql = copySupabaseSql;

function fallbackCopySql() {
    if (typeof isPrimaryAdmin !== 'function' || !isPrimaryAdmin()) return;
    const textarea = document.createElement('textarea');
    textarea.value = ORBIT_SUPABASE_SQL;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        if (typeof showToast === 'function') showToast('Supabase SQL copied to clipboard!', 'success');
    } catch(e) {
        if (typeof showToast === 'function') showToast('Please select and copy the SQL code manually.', 'info');
    }
    document.body.removeChild(textarea);
}

function openSettingsModal() {
    document.getElementById('user-dropdown')?.classList.remove('open');
    const sqlButton = document.getElementById('btn-supabase-sql');
    if (sqlButton) sqlButton.classList.toggle('hide', typeof isPrimaryAdmin !== 'function' || !isPrimaryAdmin());
    const email = document.getElementById('settings-account-email');
    if (email) email.textContent = currentUser?.email || 'Customize your Orbit experience';
    syncOrbitSettingsControls();
    window.refreshOrbitLiquidGlass?.();
    document.getElementById('admin-storage-section')?.classList.toggle('hide', !isPrimaryAdmin());
    if (isPrimaryAdmin()) loadOrbitCleanupSettings();
    document.getElementById('modal-settings').classList.add('active');
    if (typeof updateNotificationSettingsUI === 'function') updateNotificationSettingsUI();
}

function scrollSettingsTo(sectionId, button) {
    const target = document.getElementById(sectionId);
    document.querySelectorAll('.settings-section-nav button').forEach(item => {
        item.classList.toggle('active', item === button);
        if (item === button) item.setAttribute('aria-current', 'location');
        else item.removeAttribute('aria-current');
    });
    button?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.scrollSettingsTo = scrollSettingsTo;

function closeSettingsModal() {
    document.getElementById('modal-settings').classList.remove('active');
}

function handleBlurSlider(val) {
    const el = document.getElementById('val-blur');
    const input = document.getElementById('slider-blur');
    if (el) el.innerText = `${val}px`;
    if (input && input.value !== String(val)) input.value = val;

    if (parseInt(val, 10) === 0) {
        document.documentElement.style.setProperty('--blur-deep', 'none');
        document.documentElement.style.setProperty('--blur-light', 'none');
    } else {
        document.documentElement.style.setProperty('--blur-deep', `blur(${val}px) saturate(180%)`);
        document.documentElement.style.setProperty('--blur-light', `blur(${Math.round(val/2)}px)`);
    }
    try { localStorage.setItem('orbit_pref_blur', val); localStorage.removeItem('orbit_pref_glass_preset'); } catch(e) {}
    window.refreshOrbitLiquidGlass?.();
}

function handleOpacitySlider(val) {
    const el = document.getElementById('val-opacity');
    const input = document.getElementById('slider-opacity');
    if (el) el.innerText = `${val}%`;
    if (input && input.value !== String(val)) input.value = val;

    const alpha = (val / 100).toFixed(2);
    const isLight = document.body.classList.contains('light-mode');
    if (isLight) {
        document.documentElement.style.setProperty('--glass-card', `rgba(255, 255, 255, ${alpha})`);
    } else {
        document.documentElement.style.setProperty('--glass-card', `rgba(18, 18, 24, ${alpha})`);
    }
    try { localStorage.setItem('orbit_pref_opacity', val); localStorage.removeItem('orbit_pref_glass_preset'); } catch(e) {}
    window.refreshOrbitLiquidGlass?.();
}

function handleGlowSlider(val) {
    const el = document.getElementById('val-glow');
    const input = document.getElementById('slider-glow');
    if (el) el.innerText = `${val}%`;
    if (input && input.value !== String(val)) input.value = val;

    const opacity = (val / 100).toFixed(2);
    document.querySelectorAll('.ambient-glow, .ambient-glow-2').forEach(elem => {
        elem.style.opacity = opacity;
    });
    try { localStorage.setItem('orbit_pref_glow', val); localStorage.removeItem('orbit_pref_glass_preset'); } catch(e) {}
}

function setLiquidBlur(mode, btn) {
    window.setOrbitGlassQuality?.(mode === 'perf' ? 'fast' : mode === 'ultra' ? 'full' : 'balanced');
    window.setOrbitGlassControl?.('enabled', 1);
    window.setOrbitGlassControl?.('speed', mode === 'perf' ? 0 : mode === 'ultra' ? 70 : 40);
    window.setOrbitGlassControl?.('saturation', mode === 'perf' ? 100 : 155);
    window.setOrbitGlassControl?.('highlight', mode === 'perf' ? 0 : 55);
    document.querySelectorAll('#settings-glass .news-filter-chip').forEach(b => b.classList.remove('active'));
    if (btn) {
        btn.classList.add('active');
    } else {
        const matchingBtn = Array.from(document.querySelectorAll('#settings-glass .news-filter-chip')).find(b => 
            b.innerText.toLowerCase().includes(mode === 'ultra' ? 'ultra' : mode === 'balanced' ? 'balanced' : 'fast')
        );
        if (matchingBtn) matchingBtn.classList.add('active');
    }
    
    if (mode === 'ultra') {
        handleBlurSlider(8);
        handleOpacitySlider(35);
        handleGlowSlider(75);
        handleRefractionSlider(80);
    } else if (mode === 'balanced') {
        handleBlurSlider(12);
        handleOpacitySlider(50);
        handleGlowSlider(50);
        handleRefractionSlider(45);
    } else {
        handleBlurSlider(0);
        handleOpacitySlider(95);
        handleGlowSlider(0);
        handleRefractionSlider(0);
    }
    try { localStorage.setItem('orbit_pref_glass_preset', mode); } catch(e) {}
}

function handleRefractionSlider(value) {
    const amount = Math.max(0, Math.min(100, Number(value) || 0));
    const input = document.getElementById('slider-refraction');
    const label = document.getElementById('val-refraction');
    if (input) input.value = String(amount);
    if (label) label.textContent = `${amount}%`;
    try {
        localStorage.setItem('orbit_pref_refraction', String(amount));
        localStorage.removeItem('orbit_pref_glass_preset');
    } catch (_) {}
    window.refreshOrbitLiquidGlass?.();
}

function resetOrbitGlassControls() {
    setLiquidBlur('balanced');
    window.refreshOrbitLiquidGlass?.();
}

function setLiquidAccent(hex, quiet = false) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const luminance = channels => channels.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126,.7152,.0722][i], 0);
    const readable = light => {
        const background = luminance(light ? [245,249,255] : [14,20,30]);
        let ink = rgb.slice();
        for (let n = 0; n <= 100; n++) {
            ink = rgb.map(v => Math.round(v + ((light ? 0 : 255) - v) * n / 100));
            const value = luminance(ink);
            if ((Math.max(value,background) + .05) / (Math.min(value,background) + .05) >= 4.5) break;
        }
        return '#' + ink.map(v => v.toString(16).padStart(2,'0')).join('');
    };
    // Body themes define their own variables; update both scopes.
    [document.documentElement, document.body].forEach(el => {
        el.style.setProperty('--accent', hex);
        el.style.removeProperty('--accent-readable');
        el.style.setProperty('--accent-ink-dark', readable(false));
        el.style.setProperty('--accent-ink-light', readable(true));
        el.style.setProperty('--accent-on', luminance(rgb) > .179 ? '#000000' : '#ffffff');
        el.style.setProperty('--accent-glow', `rgba(${rgb.join(',')}, 0.35)`);
        el.style.setProperty('--accent-gradient', `linear-gradient(135deg, ${hex} 0%, ${hex}CC 100%)`);
    });
    try {
        localStorage.setItem('orbit_pref_accent', hex);
        localStorage.setItem('orbit_selected_color', hex);
    } catch(e) {}
    document.querySelectorAll('#modal-settings [onclick^="setLiquidAccent"]').forEach(btn => {
        const selected = btn.getAttribute('onclick').toLowerCase().includes(hex.toLowerCase());
        btn.setAttribute('aria-pressed', String(selected));
        btn.style.outline = selected ? '2px solid var(--text-primary)' : '';
        btn.style.outlineOffset = '3px';
    });
    if (!quiet) showToast('Accent color updated ✓', 'success');
}

function syncOrbitSettingsControls() {
    const values = {
        'media-quality': localStorage.getItem('orbit_media_quality_pref') || 'standard',
        'group-privacy': getGroupPrivacyPref(currentUser?.id),
        'pod-dock-pos': localStorage.getItem('orbit_pref_pod_dock') || 'top'
    };
    Object.entries(values).forEach(([name, value]) => {
        document.querySelectorAll(`input[name="${name}"]`).forEach(input => input.checked = input.value === value);
    });
}

// ══════════════════════════════════════════════════════════════════════════
// CHAT WALLPAPER & CUSTOM BACKGROUNDS
// ══════════════════════════════════════════════════════════════════════════
function setChatWallpaper(preset, quiet = false) {
    preset = (preset || '').replace(/-/g, '_');
    const allowed = ['doodle', 'pour_pause', 'celestial', 'botanical', 'midnight', 'oled', 'parade', 'emerald', 'cyberpunk'];
    if (!allowed.includes(preset)) preset = 'doodle';
    try { localStorage.removeItem('orbit_custom_wallpaper'); } catch(e) {}
    document.documentElement.style.setProperty('--chat-wallpaper-position', 'center');
    
    // 1. Remove previous theme classes
    ['theme-doodle', 'theme-pour_pause', 'theme-celestial', 'theme-botanical', 'theme-midnight', 'theme-oled', 'theme-parade', 'theme-emerald', 'theme-cyberpunk'].forEach(cls => {
        document.body.classList.remove(cls);
    });
    document.body.classList.add(`theme-${preset}`);

    // 2. Highlight active wallpaper card
    document.querySelectorAll('.wallpaper-card').forEach(card => {
        if (card.getAttribute('data-preset') === preset) {
            card.style.border = '2px solid var(--accent)';
            card.style.boxShadow = '0 0 14px rgba(255,215,0,0.35)';
        } else {
            card.style.border = '1px solid var(--glass-border)';
            card.style.boxShadow = 'none';
        }
    });

    // 3. Set specific CSS variables per preset
    if (preset === 'doodle') {
        const doodleFile = 'assets/wallpapers/doodle-user.png';
        document.documentElement.style.setProperty('--chat-wallpaper', `url("${doodleFile}")`);
        document.documentElement.style.setProperty('--chat-wallpaper-size', '236px 405px');
        document.documentElement.style.setProperty('--chat-wallpaper-repeat', 'repeat');
    } else if (preset === 'pour_pause') {
        document.documentElement.style.setProperty('--chat-wallpaper', 'url("assets/wallpapers/pour_a_pause.svg")');
        document.documentElement.style.setProperty('--chat-wallpaper-size', 'cover');
        document.documentElement.style.setProperty('--chat-wallpaper-repeat', 'no-repeat');
    } else if (preset === 'celestial') {
        document.documentElement.style.setProperty('--chat-wallpaper', 'url("assets/wallpapers/celestial_odyssey.svg")');
        document.documentElement.style.setProperty('--chat-wallpaper-size', 'cover');
        document.documentElement.style.setProperty('--chat-wallpaper-repeat', 'no-repeat');
    } else if (preset === 'botanical') {
        document.documentElement.style.setProperty('--chat-wallpaper', 'url("assets/wallpapers/botanical_bloom.svg")');
        document.documentElement.style.setProperty('--chat-wallpaper-size', 'cover');
        document.documentElement.style.setProperty('--chat-wallpaper-repeat', 'no-repeat');
    } else if (preset === 'midnight') {
        document.documentElement.style.setProperty('--chat-wallpaper', 'linear-gradient(135deg, rgba(30, 27, 75, 0.5) 0%, rgba(15, 23, 42, 0.7) 100%)');
        document.documentElement.style.setProperty('--chat-wallpaper-size', '100% 100%');
        document.documentElement.style.setProperty('--chat-wallpaper-repeat', 'no-repeat');
    } else if (preset === 'oled') {
        document.documentElement.style.setProperty('--chat-wallpaper', 'none');
        document.documentElement.style.setProperty('--chat-wallpaper-repeat', 'no-repeat');
    } else {
        document.documentElement.style.setProperty('--chat-wallpaper', 'url("assets/wallpapers/doodle-user.png")');
        document.documentElement.style.setProperty('--chat-wallpaper-size', '236px 405px');
        document.documentElement.style.setProperty('--chat-wallpaper-repeat', 'repeat');
    }

    try { localStorage.setItem('orbit_chat_wallpaper', preset); } catch(e) {}
    if (!quiet) showToast(`Applied ${preset.toUpperCase()} theme ✓`, 'success');
}
window.setChatWallpaper = setChatWallpaper;

let wallpaperDraft = null;
function getWallpaperPresetBackground(preset) {
    preset = (preset || '').replace(/-/g, '_');
    const backgrounds = {
        doodle: 'url("assets/wallpapers/doodle-user.png")',
        pour_pause: 'url("assets/wallpapers/pour_a_pause.svg")',
        celestial: 'url("assets/wallpapers/celestial_odyssey.svg")',
        botanical: 'url("assets/wallpapers/botanical_bloom.svg")',
        midnight: 'linear-gradient(135deg, rgba(30,27,75,.5), rgba(15,23,42,.7))',
        oled: 'none'
    };
    return backgrounds[preset] || backgrounds.doodle;
}

function previewChatWallpaper(preset = 'doodle') {
    preset = (preset || '').replace(/-/g, '_');
    const savedSize = localStorage.getItem('orbit_wallpaper_zoom') || '100% 100%';
    const savedPosition = localStorage.getItem('orbit_wallpaper_position') || '50% 50%';
    const savedPos = savedPosition.match(/[\d.]+/g) || ['50', '50'];
    wallpaperDraft = {
        preset,
        image: null,
        zoom: Number(savedSize.match(/[\d.]+/)?.[0] || 100),
        x: Number(savedPos[0] || 50),
        y: Number(savedPos[1] || 50),
        dim: Number(localStorage.getItem('orbit_wallpaper_dim') || 20)
    };
    const modal = document.getElementById('modal-wallpaper-editor');
    const zoom = document.getElementById('wallpaper-zoom');
    const x = document.getElementById('wallpaper-position-x');
    const y = document.getElementById('wallpaper-position-y');
    const dim = document.getElementById('wallpaper-editor-dim');
    if (zoom) zoom.value = String(wallpaperDraft.zoom);
    if (x) x.value = String(wallpaperDraft.x);
    if (y) y.value = String(wallpaperDraft.y);
    if (dim) dim.value = String(wallpaperDraft.dim);
    if (modal) modal.classList.add('active');
    updateWallpaperPreview();
}
window.previewChatWallpaper = previewChatWallpaper;

function updateWallpaperPreview() {
    if (!wallpaperDraft) return;
    wallpaperDraft.zoom = Number(document.getElementById('wallpaper-zoom')?.value || 100);
    wallpaperDraft.x = Number(document.getElementById('wallpaper-position-x')?.value || 50);
    wallpaperDraft.y = Number(document.getElementById('wallpaper-position-y')?.value || 50);
    wallpaperDraft.dim = Number(document.getElementById('wallpaper-editor-dim')?.value || 20);
    const stage = document.getElementById('wallpaper-preview-stage');
    const imageBg = wallpaperDraft.image ? `url("${wallpaperDraft.image}")` : getWallpaperPresetBackground(wallpaperDraft.preset);
    if (stage) {
        const dim = (wallpaperDraft.dim / 100).toFixed(2);
        stage.style.backgroundImage = `linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim})),${imageBg}`;
        stage.style.backgroundSize = `100% 100%, ${wallpaperDraft.zoom}% ${wallpaperDraft.zoom}%`;
        stage.style.backgroundPosition = `center, ${wallpaperDraft.x}% ${wallpaperDraft.y}%`;
        stage.style.backgroundRepeat = 'no-repeat, no-repeat';
    }
    const labels = [
        ['wallpaper-zoom-value', `${wallpaperDraft.zoom}%`],
        ['wallpaper-x-value', `${wallpaperDraft.x}%`],
        ['wallpaper-y-value', `${wallpaperDraft.y}%`],
        ['wallpaper-editor-dim-value', `${wallpaperDraft.dim}%`]
    ];
    labels.forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.textContent = value; });
}
window.updateWallpaperPreview = updateWallpaperPreview;

function closeWallpaperEditor() {
    document.getElementById('modal-wallpaper-editor')?.classList.remove('active');
    wallpaperDraft = null;
}
window.closeWallpaperEditor = closeWallpaperEditor;

function applyWallpaperDraft() {
    if (!wallpaperDraft) return;
    const draft = { ...wallpaperDraft };
    if (draft.image) {
        ['theme-parade', 'theme-doodle', 'theme-midnight', 'theme-emerald', 'theme-cyberpunk', 'theme-oled'].forEach(cls => document.body.classList.remove(cls));
        try {
            localStorage.setItem('orbit_custom_wallpaper', draft.image);
            localStorage.setItem('orbit_chat_wallpaper', 'custom');
        } catch(e) {
            showToast('Could not save this wallpaper. Choose a smaller image.', 'error');
            return;
        }
        document.documentElement.style.setProperty('--chat-wallpaper', `url("${draft.image}")`);
        document.documentElement.style.setProperty('--chat-wallpaper-repeat', 'no-repeat');
        document.querySelectorAll('.wallpaper-card').forEach(card => { card.style.border = '1px solid var(--glass-border)'; card.style.boxShadow = 'none'; });
    } else {
        setChatWallpaper(draft.preset, true);
    }
    const size = `${draft.zoom}% ${draft.zoom}%`;
    const position = `${draft.x}% ${draft.y}%`;
    document.documentElement.style.setProperty('--chat-wallpaper-size', size);
    document.documentElement.style.setProperty('--chat-wallpaper-position', position);
    try {
        localStorage.setItem('orbit_wallpaper_zoom', size);
        localStorage.setItem('orbit_wallpaper_position', position);
    } catch(e) {}
    handleWallpaperDimSlider(draft.dim);
    closeWallpaperEditor();
    showToast('Wallpaper preview applied to your chats.', 'success');
}
window.applyWallpaperDraft = applyWallpaperDraft;

function clearChatWallpaper() {
    try {
        localStorage.removeItem('orbit_wallpaper_zoom');
        localStorage.removeItem('orbit_wallpaper_position');
        localStorage.setItem('orbit_wallpaper_dim', '20');
    } catch(e) {}
    setChatWallpaper('doodle');
    document.documentElement.style.setProperty('--chat-wallpaper-size', '236px 405px');
    document.documentElement.style.setProperty('--chat-wallpaper-position', 'center');
    handleWallpaperDimSlider(20);
}
window.clearChatWallpaper = clearChatWallpaper;

function removeChatWallpaper() {
    try {
        localStorage.removeItem('orbit_wallpaper_zoom');
        localStorage.removeItem('orbit_wallpaper_position');
    } catch(e) {}
    setChatWallpaper('oled');
}
window.removeChatWallpaper = removeChatWallpaper;

function openChatWallpaperSettings() {
    document.getElementById('chat-options-dropdown')?.classList.add('hide');
    openSettingsModal();
    setTimeout(() => document.getElementById('wallpaper-settings-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}
window.openChatWallpaperSettings = openChatWallpaperSettings;

function compressWallpaperImage(file, maxSide = 1600) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('Could not read image'));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error('This image could not be opened'));
            image.onload = () => {
                const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.78));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

async function handleCustomWallpaperUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
        const base64 = await compressWallpaperImage(file);
        previewChatWallpaper('doodle');
        wallpaperDraft.image = base64;
        updateWallpaperPreview();
    } catch(err) {
        showToast('Could not save this wallpaper. Choose a smaller image.', 'error');
    }
}

function handleWallpaperDimSlider(val) {
    const el = document.getElementById('val-wallpaper-dim');
    if (el) el.innerText = `${val}%`;
    const opacity = (val / 100).toFixed(2);
    document.documentElement.style.setProperty('--chat-wallpaper-dim', `rgba(0, 0, 0, ${opacity})`);
    try { localStorage.setItem('orbit_wallpaper_dim', val); } catch(e) {}
}


function applyDashboardWallpaper(image = null) {
    const dashboard = document.getElementById('screen-dash');
    if (!dashboard) return;
    const saved = image ?? (() => { try { return localStorage.getItem('orbit_dashboard_wallpaper'); } catch(e) { return null; } })();
    if (saved) {
        dashboard.classList.add('has-dashboard-wallpaper');
        dashboard.style.setProperty('--dashboard-wallpaper-image', `url("${saved}")`);
    } else {
        dashboard.classList.remove('has-dashboard-wallpaper');
        dashboard.style.removeProperty('--dashboard-wallpaper-image');
    }
}

async function handleDashboardWallpaperUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
        const image = await compressWallpaperImage(file, 2000);
        localStorage.setItem('orbit_dashboard_wallpaper', image);
        applyDashboardWallpaper(image);
        showToast('Home wallpaper updated.', 'success');
    } catch (error) {
        showToast('Could not save this wallpaper. Choose a smaller image.', 'error');
    }
}

function clearDashboardWallpaper() {
    try { localStorage.removeItem('orbit_dashboard_wallpaper'); } catch(e) {}
    applyDashboardWallpaper(null);
    showToast('Home wallpaper reset.', 'success');
}
window.handleDashboardWallpaperUpload = handleDashboardWallpaperUpload;
window.clearDashboardWallpaper = clearDashboardWallpaper;

function openChatSecurityModal() { document.getElementById('modal-security').classList.add('active'); }
function closeChatSecurityModal() { document.getElementById('modal-security').classList.remove('active'); }

// ══════════════════════════════════════════════════════════════════════════
// ADMIN INACTIVE SCAN & BULLETPROOF PURGE
// ══════════════════════════════════════════════════════════════════════════
async function scanForInactiveAccounts() {
    if (!isAdmin()) return;
    try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data } = await sb.from('user_presence').select('user_id, email, display_name, last_seen').lt('last_seen', thirtyDaysAgo).neq('user_id', currentUser.id);
        if (data && data.length > 0) {
            const clean = data.filter(u => !adminInactiveBlacklist.has(u.user_id));
            const badge = document.getElementById('inactive-badge-count');
            if (badge) badge.innerText = clean.length;
            const btn = document.getElementById('btn-admin-inactive');
            if (btn) btn.classList.remove('hide');
        }
    } catch(e) {}
}

async function openInactiveReviewModal() {
    const modal = document.getElementById('modal-inactive-review');
    const list = document.getElementById('inactive-users-list');
    document.getElementById('user-dropdown').classList.remove('open');
    modal.classList.add('active');
    list.innerHTML = '<div class="admin-panel-state is-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><span>Scanning the 30-day review window…</span></div>';

    try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data } = await sb.from('user_presence').select('user_id, email, display_name, last_seen').lt('last_seen', thirtyDaysAgo).neq('user_id', currentUser.id);
        const clean = (data || []).filter(u => !adminInactiveBlacklist.has(u.user_id));

        if (clean.length === 0) {
            list.innerHTML = '<div class="admin-panel-state is-clear"><i class="fa-solid fa-circle-check"></i><strong>All clear</strong><span>No accounts have crossed the 30-day inactivity threshold.</span></div>';
            return;
        }

        const frag = document.createDocumentFragment();
        clean.forEach(u => {
            const name = u.display_name || u.email.split('@')[0];
            const card = document.createElement('div');
            card.className = 'contact-glass-card touch-fix admin-account-card';
            card.innerHTML = `
                <div class="admin-account-identity">
                    <span class="admin-account-avatar"><i class="fa-solid fa-user"></i></span>
                    <span class="admin-account-copy">
                        <strong>${escapeHtml(name)}</strong>
                        <small>${escapeHtml(u.email)}</small>
                        <small>Last active · ${formatSmartActivity(u.last_seen)}</small>
                    </span>
                </div>
                <button class="btn-reset admin-account-delete" type="button">
                    <i class="fa-regular fa-trash-can"></i><span>Remove</span>
                </button>
            `;
            const delBtn = card.querySelector('button');
            if (delBtn) {
                delBtn.onclick = () => adminDeleteUser(u.user_id, name);
            }
            frag.appendChild(card);
        });

        list.innerHTML = '';
        list.appendChild(frag);
    } catch(e) {
        list.innerHTML = '<div class="admin-panel-state is-error"><i class="fa-solid fa-triangle-exclamation"></i><strong>Could not load the review queue</strong><span>Check your connection and reopen the panel.</span></div>';
    }
}

function closeInactiveReviewModal() {
    document.getElementById('modal-inactive-review').classList.remove('active');
}

async function adminDeleteUser(targetId, name) {
    if (!confirm(`Permanently delete account for "${name}" and erase all records?`)) return;
    try {
        showToast('Purging account...', 'success');
        adminInactiveBlacklist.add(targetId);
        try { localStorage.setItem('orbit_admin_blacklist', JSON.stringify(Array.from(adminInactiveBlacklist))); } catch(e) {}

        await Promise.all([
            sb.from('user_presence').delete().eq('user_id', targetId),
            sb.from('user_profiles').delete().eq('user_id', targetId),
            sb.from('messages').delete().eq('sender_id', targetId),
            sb.from('room_members').delete().eq('user_id', targetId)
        ]);

        globalUsersArray = globalUsersArray.filter(u => u.user_id !== targetId);
        globalUsersMap.delete(targetId);
        userDirectRoomsMap.delete(targetId);
        try { localStorage.setItem('orbit_global_cache_v26', JSON.stringify(globalUsersArray)); } catch(e) {}
        renderGlobalUsersDOM(globalUsersArray);

        showToast(`Account for ${name} erased ✓`, 'success');
        openInactiveReviewModal();
        scanForInactiveAccounts();
    } catch(e) {
        showToast('Delete failed');
    }
}

async function adminDeleteAllInactiveUsers() {
    if (!confirm('Are you sure you want to permanently delete ALL inactive accounts listed?')) return;
    showToast('Purging all inactive accounts...', 'success');
    const dirty = document.querySelectorAll('#inactive-users-list .contact-glass-card button');
    dirty.forEach(btn => btn.click());
}

// ══════════════════════════════════════════════════════════════════════════
// TABS & DIRECTORY NAVIGATION (TRUE 0ms Instant Tab Switch!)
// ══════════════════════════════════════════════════════════════════════════


function toggleUserDropdown(e) {
    e.stopPropagation();
    document.getElementById('user-dropdown').classList.toggle('open');
}
document.addEventListener('click', () => document.getElementById('user-dropdown').classList.remove('open'));



function openNewNoteModal() { document.getElementById('modal-note').classList.add('active'); }
function closeNoteModal() { document.getElementById('modal-note').classList.remove('active'); }
async function savePersonalNote() {
    const title = document.getElementById('note-title-inp').value.trim();
    const content = document.getElementById('note-body-inp').value.trim();
    if (!title || !content) return;
    try {
        await sb.from('secure_notes').insert([{ user_id: currentUser.id, title, content }]);
        closeNoteModal();
        loadPersonalNotes();
        showToast('Note saved ✓', 'success');
    } catch(e) {}
}


function initTheme() {
    if (localStorage.getItem('orbit_theme') === 'light') {
        document.body.classList.add('light-mode');
        document.getElementById('theme-toggle').innerHTML = '<i class="fa-solid fa-sun" style="color:var(--accent);"></i>';
    }
    const customWall = localStorage.getItem('orbit_custom_wallpaper');
    if (customWall) {
        document.documentElement.style.setProperty('--chat-wallpaper', `url("${customWall}")`);
        document.documentElement.style.setProperty('--chat-wallpaper-repeat', 'no-repeat');
        document.documentElement.style.setProperty('--chat-wallpaper-size', localStorage.getItem('orbit_wallpaper_zoom') || 'cover');
    } else {
        const wp = localStorage.getItem('orbit_chat_wallpaper') || 'doodle';
        setChatWallpaper(wp, true);
        const savedSize = localStorage.getItem('orbit_wallpaper_zoom');
        if (savedSize) document.documentElement.style.setProperty('--chat-wallpaper-size', savedSize);
    }
    document.documentElement.style.setProperty('--chat-wallpaper-position', localStorage.getItem('orbit_wallpaper_position') || 'center');
    const dim = localStorage.getItem('orbit_wallpaper_dim') || 20;
    handleWallpaperDimSlider(dim);
    const accent = localStorage.getItem('orbit_pref_accent');
    if (accent) setLiquidAccent(accent, true);
    const preset = localStorage.getItem('orbit_pref_glass_preset');
    const sliders = ['blur', 'opacity', 'glow'].map(key => localStorage.getItem(`orbit_pref_${key}`));
    if (preset && sliders.every(value => value === null)) setLiquidBlur(preset);
    const savedPreset = localStorage.getItem('orbit_pref_glass_preset');
    handleRefractionSlider(localStorage.getItem('orbit_pref_refraction') ?? (preset === 'perf' ? 0 : 55));
    handleBlurSlider(sliders[0] ?? 12);
    handleOpacitySlider(sliders[1] ?? 50);
    handleGlowSlider(sliders[2] ?? 60);
    if (savedPreset) localStorage.setItem('orbit_pref_glass_preset', savedPreset);
    document.querySelectorAll('#settings-glass .news-filter-chip').forEach(button => {
        button.classList.toggle('active', !!savedPreset && button.getAttribute('onclick').includes(`'${savedPreset}'`));
    });

}
function toggleTheme() {
    const isLight = document.body.classList.toggle('light-mode');
    if (isLight) {
        document.body.classList.remove('amoled-dark');
    } else {
        if (localStorage.getItem('orbit_amoled_dark') === 'true') {
            document.body.classList.add('amoled-dark');
        }
    }
    const toggleIcon = document.getElementById('theme-toggle');
    if (toggleIcon) {
        toggleIcon.innerHTML = isLight ? '<i class="fa-solid fa-sun" style="color:var(--accent);"></i>' : '<i class="fa-solid fa-moon" style="color:var(--accent);"></i>';
    }
    localStorage.setItem('orbit_theme', isLight ? 'light' : 'dark');
    localStorage.setItem('orbit_theme_mode', isLight ? 'light' : 'dark');
    
    // Dynamically update doodle wallpaper if active
    const currentWp = localStorage.getItem('orbit_chat_wallpaper') || 'doodle';
    if (currentWp === 'doodle' && !localStorage.getItem('orbit_custom_wallpaper')) {
        const doodleFile = 'assets/wallpapers/doodle-user.png';
        document.documentElement.style.setProperty('--chat-wallpaper', `url("${doodleFile}")`);
    }

    // Refresh opacity with updated light/dark background
    const opacity = localStorage.getItem('orbit_pref_opacity') || '75';
    handleOpacitySlider(opacity);
}



// ══════════════════════════════════════════════════════════════════════════
// SHARE WEB APP (QR Code Canvas Generator & Link Sharing)
// ══════════════════════════════════════════════════════════════════════════
function openShareAppModal() {
    const modal = document.getElementById('modal-share-app');
    const input = document.getElementById('share-url-inp');
    const canvas = document.getElementById('share-qr-canvas');
    document.getElementById('user-dropdown')?.classList.remove('open');
    
    let currentUrl = window.location.href.split('?')[0].split('#')[0];
    if (currentUrl.startsWith('file:///')) {
        currentUrl = 'https://orbit-messenger.web.app';
    }
    if (input) input.value = currentUrl;
    
    modal.classList.add('active');
    renderQrCode(canvas, currentUrl);
}

function closeShareAppModal(e) {
    if (!e || e.target.id === 'modal-share-app' || !e.target.closest('.glass-modal-box')) {
        document.getElementById('modal-share-app').classList.remove('active');
    }
}

function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
}

function copyShareAppUrl() {
    const input = document.getElementById('share-url-inp');
    const textToCopy = input ? input.value : window.location.href;
    copyToClipboard(textToCopy);
    showToast('App link copied to clipboard ✓', 'success');
}

function copyInviteMessage() {
    const input = document.getElementById('share-url-inp');
    const url = input ? input.value : window.location.href;
    const msg = `✨ Join me on Orbit Messenger — Your Go-To Messaging System!\n🔗 Link: ${url}`;
    copyToClipboard(msg);
    showToast('Full invitation copied ✓', 'success');
}

async function triggerNativeAppShare() {
    const shareUrl = document.getElementById('share-url-inp')?.value || window.location.href;
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'Orbit Messenger',
                text: 'Join me on Orbit Messenger — Your Go-To Messaging System!',
                url: shareUrl
            });
        } catch(e) {}
    } else {
        copyShareAppUrl();
    }
}

function renderQrCode(canvas, text) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    // High quality dynamic 25x25 QR Matrix Generator
    const qrMatrixSize = 25;
    const cellSize = (size - 24) / qrMatrixSize;
    const offset = 12;

    ctx.fillStyle = '#08080A';

    // Position detection patterns (Top-Left, Top-Right, Bottom-Left)
    function drawFinderPattern(x, y) {
        ctx.fillRect(offset + x * cellSize, offset + y * cellSize, 7 * cellSize, 7 * cellSize);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(offset + (x + 1) * cellSize, offset + (y + 1) * cellSize, 5 * cellSize, 5 * cellSize);
        ctx.fillStyle = '#08080A';
        ctx.fillRect(offset + (x + 2) * cellSize, offset + (y + 2) * cellSize, 3 * cellSize, 3 * cellSize);
    }

    drawFinderPattern(0, 0);
    drawFinderPattern(qrMatrixSize - 7, 0);
    drawFinderPattern(0, qrMatrixSize - 7);

    // Deterministic pseudo-random payload grid based on text hash
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = (hash << 5) - hash + text.charCodeAt(i);
        hash |= 0;
    }

    for (let r = 0; r < qrMatrixSize; r++) {
        for (let c = 0; c < qrMatrixSize; c++) {
            if ((r < 8 && c < 8) || (r < 8 && c >= qrMatrixSize - 8) || (r >= qrMatrixSize - 8 && c < 8)) {
                continue;
            }
            const bit = Math.abs(Math.sin((r * 31 + c * 17 + hash)) * 10000) % 1 > 0.48;
            if (bit) {
                ctx.fillRect(offset + c * cellSize, offset + r * cellSize, cellSize - 0.5, cellSize - 0.5);
            }
        }
    }
}

function downloadQrCodeImage() {
    const canvas = document.getElementById('share-qr-canvas');
    if (!canvas) return;
    try {
        const dataUrl = canvas.toDataURL('image/png');
        downloadFile(dataUrl, 'Orbit_Messenger_QR.png');
        showToast('QR Code downloaded ✓', 'success');
    } catch(e) {
        showToast('Download failed');
    }
}

// ══════════════════════════════════════════════════════════════════════════
// FULL CATEGORIZED PROFESSIONAL EMOJI GALLERY & SEARCH
// ══════════════════════════════════════════════════════════════════════════
const EMOJI_DATABASE = {
    smileys: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
    gestures: ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄'],
    animals: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🦟','🦗','🕷️','🕸️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🦭','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🪶','🐓','🦃','🦤','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔'],
    food: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','☕','🫖','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾'],
    travel: ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🦯','🦽','🦼','🛴','🚲','🛵','🏍️','🛺','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩️','💺','🛰️','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢','⚓','🪝','⛽','🚧','🚥','🚦','🪧','🗺️','🗿','🗽','🗼','🏰','🏯','🏟️','🎡','🎢','🎠','⛲','⛱️','🏖️','🏝️','🏜️','🌋','⛰️','🏔️','🗻','🏕️','⛺','🛖','🏠','🏡','🏢','🏬','🏣','🏥','🏦','🏨','🏪','🏫','🏭'],
    activities: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🪂','🏋️','🤼','🤸','⛹️','🤺','🤾','🏌️','🏇','🧘','🏄','🏊','🤽','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🎰','🧩'],
    objects: ['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','⏱️','⏲️','⏰','🕰️','⏳','⌛','📡','🔋','🪫','🔌','💡','🔦','🕯️','🪔','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒️','🛠️','⛏️','🪚','🔩','⚙️','🪤','🧱','⛓️','🧲','🔫','💣','🧨','🪓','🔪','🗡️','⚔️','🛡️','🚬','⚰️','🪦','⚱️','🏺','🔮','📿','🧿','🪬','💈','🧲','🔬','🔭','📡','💉','🩸','💊','🩹','🩺','🚪','🛗','🪞','🪟','🛏️','🛋️','🪑','🚽','🪠','🚿','🛁','🪤','🧴','🧷','🧹','🧺','🧻','🪣','🧼','🪥','🧽','🧯','🛒','🚬','🗝️','🔑','🔐','🔏','🔒','🔓'],
    symbols: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼','🚻','🚮','🎦','📶','🈁','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'],
    flags: ['🏳️','🏴','🏁','🚩','🏳️‍🌈','🏳️‍⚧️','🏴‍☠️','🇦🇨','🇦🇩','🇦🇪','🇦🇫','🇦🇬','🇦🇮','🇦🇱','🇦🇲','🇦🇴','🇦🇶','🇦🇷','🇦🇸','🇦🇹','🇦🇺','🇦🇼','🇦🇽','🇦🇿','🇧🇦','🇧🇧','🇧🇩','🇧🇪','🇧🇫','🇧🇬','🇧🇭','🇧🇮','🇧🇯','🇧🇱','🇧🇲','🇧🇳','🇧🇴','🇧🇶','🇧🇷','🇧🇸','🇧🇹','🇧🇻','🇧🇼','🇧🇾','🇧🇿','🇨🇦','🇨🇨','🇨🇩','🇨🇫','🇨🇬','🇨🇭','🇨🇮','🇨🇰','🇨🇱','🇨🇲','🇨🇳','🇨🇴','🇨🇵','🇨🇷','🇨🇺','🇨🇻','🇨🇼','🇨🇽','🇨🇾','🇨🇿','🇩🇪','🇩🇪','🇩🇬','🇩🇯','🇩🇰','🇩🇲','🇩🇴','🇩🇿','🇪🇦','🇪🇨','🇪🇪','🇪🇬','🇪🇭','🇪🇷','🇪🇸','🇪🇹','🇪🇺','🇫🇮','🇫🇯','🇫🇰','🇫🇲','🇫🇴','🇫🇷','🇬🇦','🇬🇧','🇬🇩','🇬🇪','🇬🇫','🇬🇬','🇬🇭','🇬🇮','🇬🇱','🇬🇲','🇬🇳','🇬🇵','🇬🇶','🇬🇷','🇬🇸','🇬🇹','🇬🇺','🇬🇼','🇬🇾','🇭🇰','🇭🇲','🇭🇳','🇭🇷','🇭🇹','🇭🇺','🇮🇨','🇮🇩','🇮🇪','🇮🇱','🇮🇲','🇮🇳','🇮🇴','🇮🇶','🇮🇷','🇮🇸','🇮🇹','🇯🇪','🇯🇲','🇯🇴','🇯🇵','🇰🇪','🇰🇬','🇰🇭','🇰🇮','🇰🇲','🇰🇳','🇰🇵','🇰🇷','🇰🇼','🇰🇾','🇰🇿','🇱🇦','🇱🇧','🇱🇨','🇱🇮','🇱🇰','🇱🇷','🇱🇸','🇱🇹','🇱🇺','🇱🇻','🇱🇾','🇲🇦','🇲🇨','🇲🇩','🇲🇪','🇲🇫','🇲🇬','🇲🇭','🇲🇰','🇲🇱','🇲🇲','🇲🇳','🇲🇴','🇲🇵','🇲🇶','🇲🇷','🇲🇸','🇲🇹','🇲🇺','🇲🇻','🇲🇼','🇲🇽','🇲🇾','🇲🇿','🇳🇦','🇳🇨','🇳🇪','🇳🇫','🇳🇬','🇳🇮','🇳🇱','🇳🇴','🇳🇵','🇳🇷','🇳🇺','🇳🇿','🇴🇲','🇵🇦','🇵🇪','🇵🇫','🇵🇬','🇵🇭','🇵🇰','🇵🇱','🇵🇲','🇵🇳','🇵🇷','🇵🇸','🇵🇹','🇵🇼','🇵🇾','🇶🇦','🇷🇪','🇷🇴','🇷🇸','🇷🇺','🇷🇼','🇸🇦','🇸🇧','🇸🇨','🇸🇩','🇸🇪','🇸🇬','🇸🇭','🇸🇮','🇸🇯','🇸🇰','🇸🇱','🇸🇲','🇸🇳','🇸🇴','🇸🇷','🇸🇸','🇸🇹','🇸🇻','🇸🇽','🇸🇾','🇸🇿','🇹🇦','🇹🇨','🇹🇩','🇹🇫','🇹🇬','🇹🇭','🇹🇯','🇹🇰','🇹🇱','🇹🇲','🇹🇳','🇹🇴','🇹🇷','🇹🇹','🇹🇻','🇹🇼','🇹🇿','🇺🇦','🇺🇬','🇺🇲','🇺🇳','🇺🇸','🇺🇾','🇺🇿','🇻🇦','🇻🇨','🇻🇪','🇻🇬','🇻🇮','🇻🇳','🇻🇺','🇼🇫','🇼🇸','🇽🇰','🇾🇪','🇾🇹','🇿🇦','🇿🇲','🇿🇼']
};

let currentEmojiCategory = 'smileys';


function initTabVisibilitySettings() {
    Object.keys(userTabConfig).forEach(tabKey => {
        const isVisible = userTabConfig[tabKey] !== false;
        const btn = document.querySelector(`.liquid-tab-btn[data-tab="${tabKey}"]`);
        if (btn) {
            btn.style.display = isVisible ? 'flex' : 'none';
        }
        const chk = document.getElementById(`tab-toggle-${tabKey}`);
        if (chk) {
            chk.checked = isVisible;
        }
    });
}

function toggleTabVisibility(tabKey, isVisible) {
    userTabConfig[tabKey] = isVisible;
    try {
        localStorage.setItem('orbit_tab_preferences', JSON.stringify(userTabConfig));
    } catch(e) {}

    const btn = document.querySelector(`.liquid-tab-btn[data-tab="${tabKey}"]`);
    if (btn) {
        btn.style.display = isVisible ? 'flex' : 'none';
    }

    // If currently viewing a tab that just got hidden, switch to main-chats
    const activeBtn = document.querySelector('.liquid-tab-btn.active');
    if (activeBtn && activeBtn.getAttribute('data-tab') === tabKey && !isVisible) {
        switchTab('main-chats');
    }
}

// INITIALIZATION
// ══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initScheduleButtonListener, 800);
    setTimeout(initTabVisibilitySettings, 300);
    setTimeout(initClockSuite, 500);
});



// â”€â”€ Admin & Storage Settings Handlers â”€â”€
function setMediaQualityPref(pref) {
    localStorage.setItem('orbit_media_quality_pref', pref);
    showToast(`Media upload quality set to: ${pref}`);
}

async function orbitCleanupRequest(body) {
    const client = await ensureSupabase();
    const {data, error} = await client.auth.getSession();
    if (error || !data.session) throw new Error('Sign in again.');
    const result = await client.functions.invoke('orbit-admin-cleanup', {
        body, headers: {'Authorization': `Bearer ${SB_KEY}`, 'x-orbit-user-token': data.session.access_token}
    });
    if (result.error) {
        const detail = await result.error.context?.json?.().catch(() => null);
        throw new Error(detail?.error || 'Cleanup service unavailable. Deploy SETUP_ORBIT_ADMIN_CLEANUP.sql and orbit-admin-cleanup, then retry.');
    }
    if (result.data?.error) throw new Error(result.data.error);
    return result.data;
}

async function loadOrbitCleanupSettings() {
    const input = document.getElementById('chk-auto-storage-clean');
    if (!input || !isPrimaryAdmin()) return;
    input.disabled = true;
    try { const result = await orbitCleanupRequest({action:'settings'}); input.checked = result.enabled === true; }
    catch (error) { input.checked = false; showToast(error.message, 'error'); }
    finally { input.disabled = false; }
}

async function toggleAutoStorageClean(checked) {
    if (!isPrimaryAdmin()) return;
    const input = document.getElementById('chk-auto-storage-clean');
    input.disabled = true;
    try {
        await orbitCleanupRequest({action:'schedule', enabled:checked});
        showToast(checked ? 'Daily cleanup enabled: messages older than 10 days.' : 'Scheduled cleanup disabled.');
    } catch (error) { input.checked = !checked; showToast(error.message, 'error'); }
    finally { input.disabled = false; }
}

let orbitCleanupBusy = false;
let orbitCleanupSync = null;
function applyOrbitCleanupCutoff(cutoff) {
    const timestamp = Date.parse(cutoff);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    const keep = message => ['sending', 'queued', 'failed'].includes(message?.status) || Date.parse(message?.created_at) >= timestamp;
    for (const [room, messages] of messageCache) messageCache.set(room, messages.filter(keep));
    for (const key of Object.keys(localStorage)) {
        if (key.startsWith('orbit_cache_msgs_')) {
            try {
                const messages = JSON.parse(localStorage.getItem(key));
                if (Array.isArray(messages)) localStorage.setItem(key, JSON.stringify(messages.filter(keep)));
            } catch (_) { localStorage.removeItem(key); }
        } else if (key.startsWith('orbit_recent_chats_v27_')) localStorage.removeItem(key);
    }
    if (typeof olderPageCache !== 'undefined') olderPageCache.clear();
    if (currentRoom && typeof renderMessageFeed === 'function') renderMessageFeed(messageCache.get(currentRoom) || [], false);
}
async function syncOrbitCleanupWatermark() {
    if (!currentUser || !navigator.onLine) return;
    if (orbitCleanupSync) return orbitCleanupSync;
    orbitCleanupSync = (async () => {
        const client = await ensureSupabase();
        const {data, error} = await client.rpc('orbit_message_cleanup_cutoff');
        // Older deployments may not have the optional cleanup migration yet.
        if (!error && data) applyOrbitCleanupCutoff(data);
    })();
    try { await orbitCleanupSync; } finally { orbitCleanupSync = null; }
}
window.addEventListener('online', () => syncOrbitCleanupWatermark().catch(() => {}));
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncOrbitCleanupWatermark().catch(() => {});
});
async function adminCleanOldNonAdminMedia() {
    if (!isPrimaryAdmin()) { showToast('Only the primary admin can clear messages.', 'error'); return; }
    if (orbitCleanupBusy || !confirm('Permanently clear ALL existing text messages and media for every account, including admin messages? Profile pictures will be kept.')) return;
    orbitCleanupBusy = true;
    try {
        const result = await orbitCleanupRequest({action:'clear', confirm:'CLEAR_ALL_MESSAGES'});
        applyOrbitCleanupCutoff(result.cutoff);
        if (typeof loadMainChats === 'function') loadMainChats(true);
        showToast(`${result.messages} messages cleared. ${result.pending ? `${result.pending} media batches await retry; run cleanup again.` : 'Media cleanup complete.'} Profile pictures preserved.`, result.pending ? 'info' : 'success');
    } catch (error) { showToast(error.message, 'error'); }
    finally { orbitCleanupBusy = false; }
}

// ══════════════════════════════════════════════════════════════════════════
// DISPLAY SETTINGS SUITE (media_1789891353182.jpg)
// ══════════════════════════════════════════════════════════════════════════

function openCalcDisplaySettings() {
    const modal = document.getElementById('modal-display-settings');
    if (!modal) return;

    // Load persisted settings
    const themeMode = localStorage.getItem('orbit_theme_mode') || 'dark';
    const isAmoled = localStorage.getItem('orbit_amoled_dark') === 'true';
    const isDynamic = localStorage.getItem('orbit_dynamic_colors') === 'true';
    const selectedColor = localStorage.getItem('orbit_selected_color') || '#82e0aa';
    const selectedStyle = parseInt(localStorage.getItem('orbit_selected_style') || '2', 10);
    const showAc = localStorage.getItem('orbit_calc_show_ac') !== 'false';
    const zeroMiddle = localStorage.getItem('orbit_calc_zero_middle') !== 'false';
    const currentLang = localStorage.getItem('orbit_app_language_name') || 'English (US)';

    // Theme Pills
    ['auto', 'light', 'dark'].forEach(m => {
        const pill = document.getElementById(`theme-pill-${m}`);
        if (pill) pill.classList.toggle('active', themeMode === m);
    });

    // Switches
    const chkAmoled = document.getElementById('chk-amoled-dark');
    if (chkAmoled) chkAmoled.checked = isAmoled;

    const chkDynamic = document.getElementById('chk-dynamic-colors');
    if (chkDynamic) chkDynamic.checked = isDynamic;

    const chkAc = document.getElementById('chk-ac-button');
    if (chkAc) chkAc.checked = showAc;

    const chkZero = document.getElementById('chk-zero-middle');
    if (chkZero) chkZero.checked = zeroMiddle;

    // Swatches
    document.querySelectorAll('#display-swatches-row .color-swatch-chip').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-color') === selectedColor);
    });

    // Styles
    document.querySelectorAll('#display-styles-row .style-preset-chip').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.getAttribute('data-preset'), 10) === selectedStyle);
    });

    // Language label
    const langLabel = document.getElementById('display-selected-lang-label');
    if (langLabel) langLabel.innerText = currentLang;

    modal.classList.add('active');
}

function closeCalcDisplaySettings() {
    const modal = document.getElementById('modal-display-settings');
    if (modal) modal.classList.remove('active');
}

function setDisplayColorTheme(mode) {
    localStorage.setItem('orbit_theme_mode', mode);
    localStorage.setItem('orbit_theme', mode);
    ['auto', 'light', 'dark'].forEach(m => {
        const pill = document.getElementById(`theme-pill-${m}`);
        if (pill) pill.classList.toggle('active', mode === m);
    });

    if (mode === 'light') {
        document.body.classList.add('light-mode');
        document.body.classList.remove('amoled-dark');
    } else if (mode === 'dark') {
        document.body.classList.remove('light-mode');
        if (localStorage.getItem('orbit_amoled_dark') === 'true') {
            document.body.classList.add('amoled-dark');
        }
    } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.body.classList.toggle('light-mode', !prefersDark);
        if (!prefersDark) {
            document.body.classList.remove('amoled-dark');
        } else if (localStorage.getItem('orbit_amoled_dark') === 'true') {
            document.body.classList.add('amoled-dark');
        }
    }
    showToast(`Theme mode set to ${mode.toUpperCase()}`);
}

function toggleAmoledDark(enabled) {
    localStorage.setItem('orbit_amoled_dark', enabled ? 'true' : 'false');
    if (!document.body.classList.contains('light-mode')) {
        document.body.classList.toggle('amoled-dark', enabled);
    }
    showToast(enabled ? 'AMOLED Dark (#000000) Enabled' : 'Standard Dark Mode Enabled');
}

function toggleDynamicColors(enabled) {
    localStorage.setItem('orbit_dynamic_colors', enabled ? 'true' : 'false');
    showToast(enabled ? 'Dynamic wallpaper colors enabled' : 'Dynamic colors disabled');
}

function setSelectedColorSwatch(colorHex) {
    localStorage.setItem('orbit_selected_color', colorHex);
    document.querySelectorAll('#display-swatches-row .color-swatch-chip').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-color') === colorHex);
    });
    setLiquidAccent(colorHex, true);
    showToast('Accent color updated');
}

function setSelectedStylePreset(presetIndex) {
    localStorage.setItem('orbit_selected_style', presetIndex);
    document.querySelectorAll('#display-styles-row .style-preset-chip').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.getAttribute('data-preset'), 10) === presetIndex);
    });

    const styleAccents = {
        1: '#a8e6cf',
        2: '#82e0aa',
        3: '#00e5ff',
        4: '#ffecd2',
        5: '#10b981',
        6: '#ffd700',
        7: '#ffffff'
    };
    if (styleAccents[presetIndex]) {
        setLiquidAccent(styleAccents[presetIndex], true);
    }
    showToast(`Style preset ${presetIndex} applied`);
}

function toggleCalcAcButton(enabled) {
    localStorage.setItem('orbit_calc_show_ac', enabled ? 'true' : 'false');
    if (typeof applyCalcKeypadLayout === 'function') {
        applyCalcKeypadLayout();
    }
    showToast(enabled ? 'Separate AC button enabled' : 'Standard Clear button enabled');
}

function toggleCalcZeroInMiddle(enabled) {
    localStorage.setItem('orbit_calc_zero_middle', enabled ? 'true' : 'false');
    if (typeof applyCalcKeypadLayout === 'function') {
        applyCalcKeypadLayout();
    }
    showToast(enabled ? 'Zero in the middle: ON' : 'Standard Zero layout: ON');
}

function openLanguageSelectorModal() {
    const modal = document.getElementById('modal-language-picker');
    if (modal) modal.classList.add('active');
}

function closeLanguageSelectorModal() {
    const modal = document.getElementById('modal-language-picker');
    if (modal) modal.classList.remove('active');
}

function setAppLanguage(code, name) {
    localStorage.setItem('orbit_app_language_code', code);
    localStorage.setItem('orbit_app_language_name', name);
    const label = document.getElementById('display-selected-lang-label');
    if (label) label.innerText = name;
    closeLanguageSelectorModal();
    showToast(`Language set to ${name}`);
}

function initDisplaySettingsOnLoad() {
    applyDashboardWallpaper();
    const themeMode = localStorage.getItem('orbit_theme_mode') || localStorage.getItem('orbit_theme');
    if (themeMode === 'light') {
        document.body.classList.add('light-mode');
        document.body.classList.remove('amoled-dark');
    } else {
        const isAmoled = localStorage.getItem('orbit_amoled_dark') === 'true';
        if (isAmoled) document.body.classList.add('amoled-dark');
    }

    const savedColor = localStorage.getItem('orbit_selected_color');
    const accent = localStorage.getItem('orbit_pref_accent') || savedColor;
    if (accent) setLiquidAccent(accent, true);
}

// Auto init on script run
initDisplaySettingsOnLoad();

window.openProfileScreen = openProfileScreen;
window.closeProfileScreen = closeProfileScreen;
window.editProfileField = editProfileField;
window.closeEditFieldModal = closeEditFieldModal;
window.submitEditField = submitEditField;
window.handleProfileAvatarUpload = handleProfileAvatarUpload;
window.confirmDeleteSelfAccount = confirmDeleteSelfAccount;
window.openUserProfileInspector = openUserProfileInspector;
window.closeUserProfileInspector = closeUserProfileInspector;
window.inspectorStartChat = inspectorStartChat;
window.inspectorSendFriendReq = inspectorSendFriendReq;
window.loadGlobalUsers = loadGlobalUsers;
window.renderGlobalUsersDOM = renderGlobalUsersDOM;
window.openSupabaseSqlModal = openSupabaseSqlModal;
window.closeSupabaseSqlModal = closeSupabaseSqlModal;
window.copySupabaseSql = copySupabaseSql;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.handleBlurSlider = handleBlurSlider;
window.handleOpacitySlider = handleOpacitySlider;
window.handleGlowSlider = handleGlowSlider;
window.setLiquidBlur = setLiquidBlur;
window.setLiquidAccent = setLiquidAccent;
window.setChatWallpaper = setChatWallpaper;
window.handleCustomWallpaperUpload = handleCustomWallpaperUpload;
window.scanForInactiveAccounts = scanForInactiveAccounts;
window.openInactiveReviewModal = openInactiveReviewModal;
window.closeInactiveReviewModal = closeInactiveReviewModal;
window.adminDeleteUser = adminDeleteUser;
window.adminDeleteAllInactiveUsers = adminDeleteAllInactiveUsers;
window.openNewNoteModal = openNewNoteModal;
window.closeNoteModal = closeNoteModal;
window.savePersonalNote = savePersonalNote;
window.initTheme = initTheme;
window.toggleTheme = toggleTheme;
window.openShareAppModal = openShareAppModal;
window.closeShareAppModal = closeShareAppModal;
window.copyToClipboard = copyToClipboard;
window.copyShareAppUrl = copyShareAppUrl;
window.copyInviteMessage = copyInviteMessage;
window.triggerNativeAppShare = triggerNativeAppShare;
window.renderQrCode = renderQrCode;
window.downloadQrCodeImage = downloadQrCodeImage;
window.toggleTabVisibility = toggleTabVisibility;
window.setMediaQualityPref = setMediaQualityPref;
window.toggleAutoStorageClean = toggleAutoStorageClean;
window.adminCleanOldNonAdminMedia = adminCleanOldNonAdminMedia;
window.openCalcDisplaySettings = openCalcDisplaySettings;
window.closeCalcDisplaySettings = closeCalcDisplaySettings;
window.setDisplayColorTheme = setDisplayColorTheme;
window.toggleAmoledDark = toggleAmoledDark;
window.toggleDynamicColors = toggleDynamicColors;
window.openLanguageSelectorModal = openLanguageSelectorModal;
window.closeLanguageSelectorModal = closeLanguageSelectorModal;
window.setAppLanguage = setAppLanguage;
window.toggleUserDropdown = toggleUserDropdown;
