// ORBIT UI - AUTHENTICATION & SESSION MANAGEMENT (js/ui/ui-auth.js)
// Service worker, deep links, login, signup, password recovery links, session verification, logout.

let orbitWorkerMessagesBound=false;
async function initServiceWorker() {
    if(!('serviceWorker' in navigator)||!/^https?:$/.test(location.protocol))return;
    // Bind immediately, even when a worker update is waiting on the network.
    if(!orbitWorkerMessagesBound){
        orbitWorkerMessagesBound=true;
        navigator.serviceWorker.addEventListener('message',event=>{
            if(event.data?.type==='ORBIT_PUSH_VISIBLE_QUERY'){
                const active=event.data.isCall?!!(_activeCallId===event.data.callId&&!document.hidden&&document.hasFocus()):isOrbitChatVisible(event.data.roomId);
                const silent=event.data.isCall?localStorage.getItem('orbit_call_ringtone')==='silent':!notificationPreference('orbit_notification_sound',true)||!!_activeCallId;
                event.ports[0]?.postMessage({active,silent,previews:notificationPreference('orbit_notification_previews',true)});
            }
            if(event.data?.type==='ORBIT_CALL_PUSH')recoverOrbitIncomingCall().catch(()=>{});
            if(event.data?.type==='NOTIFICATION_NAVIGATE'){
                if(event.data.noteId)orbitOpenNoteLink(event.data.noteId);
                else if(event.data.callId)orbitOpenCallNotification(event.data.callId);
                else handleDeepLinkNavigation(event.data.roomId,event.data.msgId,event.data.timestamp);
            }
        });
    }
    try{
        const registration=await navigator.serviceWorker.register('./sw.js?v=e2ee-20261025-r1',{scope:'./'});
        registration.update().catch(()=>{});
    }catch(_){}
}

function handleUrlDeepLinkParams() {
    const params = new URLSearchParams(window.location.search);
    const noteId=params.get('noteId');if(noteId){orbitOpenNoteLink(noteId);return;}
    const openRoom = params.get('openRoom');
    const focusMsg = params.get('focusMsg');
    const msgTime = params.get('msgTime');
    const callId=params.get('callId');
    if(callId){orbitOpenCallNotification(callId);return;}
    if (openRoom) {
        setTimeout(() => handleDeepLinkNavigation(openRoom, focusMsg, msgTime), 1000);
    }
}

// ══════════════════════════════════════════════════════════════════════════
let _authRequestInFlight = false;

// AUTHENTICATION (Dedicated Log In, Sign Up & Forgot Password Engine)
// ══════════════════════════════════════════════════════════════════════════

function switchAuthTab(mode) {
    const btnLogin = document.getElementById('tab-btn-login');
    const btnSignup = document.getElementById('tab-btn-signup');
    const panelLogin = document.getElementById('panel-auth-login');
    const panelSignup = document.getElementById('panel-auth-signup');
    const err = document.getElementById('auth-err');
    if (err) err.style.display = 'none';

    if (mode === 'signup') {
        btnLogin?.classList.remove('active');
        btnSignup?.classList.add('active');
        panelLogin?.classList.remove('active');
        panelSignup?.classList.add('active');
    } else {
        btnSignup?.classList.remove('active');
        btnLogin?.classList.add('active');
        panelSignup?.classList.remove('active');
        panelLogin?.classList.add('active');
    }
}

function orbitTogglePass(inputId, iconId) {
    const p = document.getElementById(inputId);
    const i = document.getElementById(iconId);
    if (!p || !i) return;
    p.type = p.type === 'password' ? 'text' : 'password';
    i.className = p.type === 'password' ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
}

async function checkExistingSession() {
    document.documentElement.classList.add('orbit-restoring');
    try {
        const project = new URL(SB_URL).hostname.split('.')[0];
        if(await orbitCompletePasswordRecovery())return;
        if(await orbitCompleteGoogleSignIn())return;
        if(localStorage.getItem('orbit_explicit_signout')==='true')return;
        let cached=null;try{cached=JSON.parse(localStorage.getItem(`sb-${project}-auth-token`)||'null');}catch(_){}
        if(cached?.user?.id && orbitSessionIdleExpired(cached.user.id)){
            const client=await ensureSupabase();await client.auth.signOut({scope:'local'});
            localStorage.removeItem(`sb-${project}-auth-token`);return;
        }
        // Render this device's remembered shell without waiting for the hourly
        // token refresh. This is not authentication: the SDK/RLS still gate I/O.
        if(cached?.user?.id && (cached.refresh_token || Number(cached.expires_at)>Date.now()/1000+30)){
            currentUser=cached.user;await launchApp();return;
        }
        if (!navigator.onLine) {
            // Restore the local UI without waiting for an expired token refresh.
            // The SDK and server still authenticate every eventual upload/send.
            const project = new URL(SB_URL).hostname.split('.')[0];
            const cached = JSON.parse(localStorage.getItem(`sb-${project}-auth-token`) || 'null');
            if (cached?.user?.id) { currentUser = cached.user; await launchApp(); }
            return;
        }
        const client = await ensureSupabase();
        const { data: { session } } = await client.auth.getSession();
        if (session && session.user) {
            if(orbitSessionIdleExpired(session.user.id)){await client.auth.signOut({scope:'local'});return;}
            currentUser = session.user;
            await launchApp();
        }
    } catch(e) {
        console.warn('Session restore note:', e);
    } finally {
        document.documentElement.classList.remove('orbit-restoring');
    }
}

// Use the app root, never a preview/editor path or a previous website.
function orbitAuthReturnUrl(kind){
    const url=new URL('/',location.origin || new URL(location.href).origin);
    url.searchParams.set(kind==='google'?'orbit_oauth':'orbit_auth',kind);
    return url.href;
}
let orbitRecoveryUserId=null;
let orbitRecoveryBusy=false;
function orbitShowRecoveryForm(){
    openForgotPasswordModal();
    document.getElementById('forgot-step-1')?.classList.add('hide');
    document.getElementById('forgot-step-2')?.classList.remove('hide');
    const desc=document.getElementById('forgot-desc-text');
    if(desc)desc.textContent='Your reset link is verified. Choose a new password for your Orbit account.';
    document.getElementById('forgot-new-pass-input')?.focus();
}
async function orbitCompletePasswordRecovery(){
    if(typeof location==='undefined')return false;
    const url=new URL(location.href),fragment=new URLSearchParams(url.hash.slice(1));
    const recovery=url.searchParams.get('orbit_auth')==='recovery'||fragment.get('type')==='recovery'||url.searchParams.get('type')==='recovery';
    if(!recovery)return false;
    const code=url.searchParams.get('code'),tokenHash=url.searchParams.get('token_hash');
    const access=fragment.get('access_token'),refresh=fragment.get('refresh_token');
    const failed=url.searchParams.has('error')||fragment.has('error');
    ['orbit_auth','code','token_hash','type','error','error_code','error_description'].forEach(key=>url.searchParams.delete(key));
    // Remove credentials before loading the SDK or displaying any UI.
    window.history.replaceState({},document.title,url.pathname+url.search);
    orbitRecoveryUserId=null;
    try{
        if(failed)throw new Error('This reset link has expired or was already used. Request a new link below.');
        const client=await ensureSupabase();let result;
        if(code)result=await client.auth.exchangeCodeForSession(code);
        else if(tokenHash)result=await client.auth.verifyOtp({token_hash:tokenHash,type:'recovery'});
        else if(access&&refresh)result=await client.auth.setSession({access_token:access,refresh_token:refresh});
        else throw new Error('This reset link is incomplete. Request a new link below.');
        if(result.error||!result.data?.session?.user)throw new Error('Could not verify this reset link. Open it in the browser where you requested it, or request a new link.');
        orbitRecoveryUserId=result.data.session.user.id;
        orbitShowRecoveryForm();
    }catch(error){
        openForgotPasswordModal();
        const node=document.getElementById('forgot-err');if(node){node.textContent=error.message;node.style.display='block';}
    }
    return true;
}

async function handleGoogleSignIn(){
    if(_authRequestInFlight)return;
    const button=document.getElementById('auth-google-btn'),errorNode=document.getElementById('auth-err');
    _authRequestInFlight=true;if(button){button.disabled=true;button.textContent='Connecting to Google…';}
    if(errorNode)errorNode.style.display='none';
    try{
        const client=await ensureSupabase();
        // Supabase returns an authorize URL even when a provider is disabled.
        // Check the public provider setting so beta users stay in a usable form.
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
        try{
            const response=await fetch(`${SB_URL}/auth/v1/settings`,{headers:{apikey:SB_KEY},signal:controller.signal});
            if(!response.ok)throw new Error('Could not check Google sign-in. Please use email or try again.');
            const settings=await response.json();
            if(!settings.external?.google)throw new Error('Google sign-in beta is not enabled for Orbit yet. Please use email and password.');
        }finally{clearTimeout(timer);}
        localStorage.setItem('orbit_google_pending',String(Date.now()));
        const redirect=new URL(orbitAuthReturnUrl('google'));
        const {data,error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:redirect.href,skipBrowserRedirect:true,queryParams:{prompt:'select_account'}}});
        if(error)throw error;
        const authorize=new URL(data?.url);
        if(authorize.origin!==new URL(SB_URL).origin)throw new Error('Invalid sign-in destination.');
        window.location.assign(authorize.href);
    }catch(error){
        localStorage.removeItem('orbit_google_pending');
        if(errorNode){errorNode.textContent=error.name==='AbortError'?'Google sign-in timed out. Try email or retry.':error.message;errorNode.style.display='block';}
    }finally{_authRequestInFlight=false;if(button){button.disabled=false;button.textContent='Continue with Google · Beta';}}
}
async function orbitCompleteGoogleSignIn(){
    if(typeof location==='undefined')return false;
    const url=new URL(location.href);
    if(url.searchParams.get('orbit_oauth')!=='google')return false;
    const code=url.searchParams.get('code'),providerError=url.searchParams.has('error');
    ['code','orbit_oauth','error','error_description','error_code'].forEach(key=>url.searchParams.delete(key));
    window.history.replaceState({},document.title,url.pathname+url.search+url.hash);
    const pending=Number(localStorage.getItem('orbit_google_pending'));
    try{
        if(providerError)throw new Error('Google sign-in was cancelled or could not finish. You can still use email.');
        if(!code || !pending || Date.now()-pending>15*60000 || pending>Date.now())throw new Error('This Google sign-in has expired. Please try again.');
        const client=await ensureSupabase();
        const {data,error}=await client.auth.exchangeCodeForSession(code);
        if(error)throw error;
        if(!data?.session?.user)throw new Error('Google did not create a session. Please try again.');
        const repeatIntro=localStorage.getItem('orbit_explicit_signout')==='true';
        currentUser=data.session.user;localStorage.removeItem('orbit_explicit_signout');orbitRememberSessionActivity(true);
        await launchApp({introduction:true,forceIntroduction:repeatIntro});
    }catch(error){const node=document.getElementById('auth-err');if(node){node.textContent=error.message;node.style.display='block';}}
    finally{
        localStorage.removeItem('orbit_google_pending');
    }
    return true;
}
window.handleGoogleSignIn=handleGoogleSignIn;
const ORBIT_SESSION_IDLE_MS=6*24*60*60*1000;
function orbitSessionIdleExpired(userId,now=Date.now()){
    try{const last=Number(localStorage.getItem(`orbit_session_activity_${userId}`));return last>0 && now-last>=ORBIT_SESSION_IDLE_MS;}catch(_){return false;}
}
function orbitRememberSessionActivity(force=false){
    if(!currentUser?.id || document.hidden)return;
    const key=`orbit_session_activity_${currentUser.id}`,now=Date.now();
    if(!force&&orbitSessionIdleExpired(currentUser.id,now)){
        try{localStorage.setItem('orbit_explicit_signout','true');const project=new URL(SB_URL).hostname.split('.')[0];localStorage.removeItem(`sb-${project}-auth-token`);}catch(_){}
        window.location.reload();return;
    }
    try{const last=Number(localStorage.getItem(key));if(force||!last||now-last>60000)localStorage.setItem(key,String(now));}catch(_){}
}
document.addEventListener('pointerdown',()=>orbitRememberSessionActivity(),{passive:true});
document.addEventListener('keydown',()=>orbitRememberSessionActivity(),{passive:true});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&currentUser?.id&&orbitSessionIdleExpired(currentUser.id))orbitRememberSessionActivity();});

// 1. DEDICATED LOG IN HANDLER
async function handleLogin() {
    const email = document.getElementById('auth-login-email')?.value.trim().toLowerCase();
    const pass = document.getElementById('auth-login-pass')?.value;
    const btn = document.getElementById('auth-login-btn');
    const err = document.getElementById('auth-err');

    if (err) err.style.display = 'none';
    if (!email || !pass) {
        if (err) {
            err.innerText = 'Please enter both your email address and password.';
            err.style.display = 'block';
        }
        return;
    }

    if (_authRequestInFlight) return;
    _authRequestInFlight = true;
    window.OrbitIntroduction?.primeAudio();
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px;"></i> LOGGING IN...';
        btn.disabled = true;
    }

    try {
        const client = await ensureSupabase();
        const { data, error } = await client.auth.signInWithPassword({ email, password: pass });

        if (error) {
            let msg = error.message || 'Login failed.';
            if (msg.toLowerCase().includes('invalid login credentials')) {
                msg = 'Invalid email or password. Please check your credentials or click Sign Up.';
            } else if (msg.toLowerCase().includes('email not confirmed')) {
                msg = 'Please check your email inbox to confirm your email before logging in.';
            }
            throw new Error(msg);
        }

        if (!data?.user || !data?.session) {
            throw new Error('Login did not create an active session. Please try again.');
        }

        currentUser = data.user;
        orbitRememberSessionActivity(true);
        showToast('Welcome back to Orbit!', 'success');
        await launchApp({introduction:true});
    } catch(e) {
        if (err) {
            err.innerText = e.message || 'Login failed. Please try again.';
            err.style.display = 'block';
        }
    } finally {
        _authRequestInFlight = false;
        window.OrbitIntroduction?.releaseIfIdle();
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket" style="margin-right:6px;"></i> LOG IN TO ORBIT';
            btn.disabled = false;
        }
    }
}

// 2. DEDICATED SIGN UP HANDLER
async function handleSignUp() {
    const name = document.getElementById('auth-signup-name')?.value.trim();
    const email = document.getElementById('auth-signup-email')?.value.trim().toLowerCase();
    const pass = document.getElementById('auth-signup-pass')?.value;
    const confirmPass = document.getElementById('auth-signup-confirm')?.value;
    const btn = document.getElementById('auth-signup-btn');
    const err = document.getElementById('auth-err');

    if (err) err.style.display = 'none';

    if (!name) {
        if (err) {
            err.innerText = 'Please enter your full name or display name.';
            err.style.display = 'block';
        }
        return;
    }
    if (!email || !email.includes('@')) {
        if (err) {
            err.innerText = 'Please provide a valid email address.';
            err.style.display = 'block';
        }
        return;
    }
    if (!pass || pass.length < 6) {
        if (err) {
            err.innerText = 'Password must be at least 6 characters long.';
            err.style.display = 'block';
        }
        return;
    }
    if (pass !== confirmPass) {
        if (err) {
            err.innerText = 'Passwords do not match. Please verify.';
            err.style.display = 'block';
        }
        return;
    }

    if (_authRequestInFlight) return;
    _authRequestInFlight = true;
    window.OrbitIntroduction?.primeAudio();
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px;"></i> CREATING ACCOUNT...';
        btn.disabled = true;
    }

    try {
        const client = await ensureSupabase();
        const { data, error } = await client.auth.signUp({
            email,
            password: pass,
            options: {
                data: {
                    full_name: name,
                    username: name.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 20)
                }
            }
        });

        if (error) {
            let msg = error.message || 'Sign up error.';
            if (msg.toLowerCase().includes('already registered')) {
                msg = 'This email is already registered. Please switch to Log In.';
            }
            throw new Error(msg);
        }

        if (!data?.user) {
            throw new Error('Account creation did not return a user. Please try again.');
        }

        currentUser = data.user;

        // Auto-create initial profile row
        try {
            await client.from('user_profiles').upsert({
                user_id: data.user.id,
                first_name: name,
                last_name: '',
                dp_url: null,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
        } catch(pe) {}

        // Email confirmation may leave the new account without an active session.
        if (data.session) {
            showToast(`Welcome to Orbit, ${name}!`, 'success');
            await launchApp({introduction:true});
        } else {
            showToast('Account created! Please check your email to verify, or log in.', 'success');
            switchAuthTab('login');
            const loginEmail = document.getElementById('auth-login-email');
            if (loginEmail) loginEmail.value = email;
        }
    } catch(e) {
        if (err) {
            err.innerText = e.message || 'Sign up failed. Please try again.';
            err.style.display = 'block';
        }
    } finally {
        _authRequestInFlight = false;
        window.OrbitIntroduction?.releaseIfIdle();
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-user-plus" style="margin-right:6px;"></i> CREATE FREE ACCOUNT';
            btn.disabled = false;
        }
    }
}

// 3. PASSWORD RECOVERY
function openForgotPasswordModal() {
    document.getElementById('forgot-new-pass-input').value='';
    document.getElementById('forgot-confirm-pass-input').value='';
    const desc=document.getElementById('forgot-desc-text');if(desc)desc.textContent='Enter your registered email. We will send a secure link that opens this Orbit website. Open it in the same browser where you request it.';
    const modal = document.getElementById('modal-forgot-password');
    const step1 = document.getElementById('forgot-step-1');
    const step2 = document.getElementById('forgot-step-2');
    const err = document.getElementById('forgot-err');
    const loginEmail = document.getElementById('auth-login-email')?.value.trim();
    const forgotInp = document.getElementById('forgot-email-input');

    if (forgotInp && loginEmail) forgotInp.value = loginEmail;
    if (step1) step1.classList.remove('hide');
    if (step2) step2.classList.add('hide');
    if (err) err.style.display = 'none';
    if (modal) modal.classList.add('active');
}

async function closeForgotPasswordModal() {
    if(orbitRecoveryBusy)return;
    if(orbitRecoveryUserId){orbitRecoveryUserId=null;try{const client=await ensureSupabase();await client.auth.signOut({scope:'local'});}catch(_){}}
    document.getElementById('forgot-new-pass-input').value='';
    document.getElementById('forgot-confirm-pass-input').value='';
    const modal = document.getElementById('modal-forgot-password');
    if (modal) modal.classList.remove('active');
}

function orbitToggleForgotPass(inputId = 'forgot-new-pass-input', iconId = 'forgot-eye-icon') {
    const p = document.getElementById(inputId);
    const i = document.getElementById(iconId);
    if (!p || !i) return;
    p.type = p.type === 'password' ? 'text' : 'password';
    i.className = p.type === 'password' ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
}

function checkPasswordStrength(pass) {
    const bar = document.getElementById('pass-strength-bar-fill');
    const label = document.getElementById('pass-strength-label');
    if (!bar || !label) return;

    if (!pass) {
        bar.style.width = '0%';
        label.innerText = 'Password Strength: -';
        label.style.color = 'var(--text-secondary)';
        return;
    }

    let score = 0;
    if (pass.length >= 8) score += 1;
    if (pass.length >= 12) score += 1;
    if (/[a-z]/.test(pass) && /[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^a-zA-Z0-9]/.test(pass)) score += 1;

    if (score <= 1) {
        bar.style.width = '25%';
        bar.style.backgroundColor = '#FF453A';
        label.innerText = 'Strength: Weak (Requires 8+ chars)';
        label.style.color = '#FF453A';
    } else if (score <= 3) {
        bar.style.width = '60%';
        bar.style.backgroundColor = '#FF9F0A';
        label.innerText = 'Strength: Moderate (Add special symbols/caps)';
        label.style.color = '#FF9F0A';
    } else {
        bar.style.width = '100%';
        bar.style.backgroundColor = '#30D158';
        label.innerText = 'Strength: Strong ✓';
        label.style.color = '#30D158';
    }
}

let orbitRecoverySentAt=0;
async function handleSendForgotOtp(){
    const email=document.getElementById('forgot-email-input')?.value.trim();
    const btn=document.getElementById('btn-send-otp'),err=document.getElementById('forgot-err');
    if(err)err.style.display='none';
    if(!email||!/^\S+@\S+\.\S+$/.test(email)){if(err){err.textContent='Enter a valid email address.';err.style.display='block';}return;}
    if(orbitRecoveryBusy)return;
    if(Date.now()-orbitRecoverySentAt<60000){if(err){err.textContent='Please wait a minute before requesting another link.';err.style.display='block';}return;}
    orbitRecoveryBusy=true;if(btn){btn.disabled=true;btn.textContent='Sending reset link…';}
    try{
        const client=await ensureSupabase();
        const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:orbitAuthReturnUrl('recovery')});
        if(error)throw error;
        orbitRecoverySentAt=Date.now();
        const desc=document.getElementById('forgot-desc-text');
        if(desc)desc.textContent='If this email has an Orbit account, a reset link is on its way. Check your inbox and spam folder. Open the newest link in this browser.';
        showToast('Check your email for the Orbit reset link.','success');
    }catch(error){if(err){err.textContent=error.message||'Could not send the reset link. Please retry.';err.style.display='block';}}
    finally{orbitRecoveryBusy=false;if(btn){btn.disabled=false;btn.textContent='Send reset link';}}
}

async function handleVerifyForgotOtpAndReset() {
    const email = document.getElementById('forgot-email-input')?.value.trim();
    const newPass = document.getElementById('forgot-new-pass-input')?.value || '';
    const confirmPass = document.getElementById('forgot-confirm-pass-input')?.value || '';
    const btn = document.getElementById('btn-verify-otp');
    const err = document.getElementById('forgot-err');

    if (err) err.style.display = 'none';

    if(orbitRecoveryBusy)return;
    if(!orbitRecoveryUserId){if(err){err.textContent='Open the reset link from your email before choosing a new password.';err.style.display='block';}return;}

    // 2. Validate Password: minimum 8 chars
    if (newPass.length < 8) {
        if (err) {
            err.innerText = 'Password must be at least 8 characters long.';
            err.style.display = 'block';
        }
        document.getElementById('forgot-new-pass-input')?.focus();
        return;
    }

    // 3. Validate Alphanumeric + Special Char
    const hasLetter = /[a-zA-Z]/.test(newPass);
    const hasNumber = /[0-9]/.test(newPass);
    if (!hasLetter || !hasNumber) {
        if (err) {
            err.innerText = 'Password must contain both letters and numbers.';
            err.style.display = 'block';
        }
        document.getElementById('forgot-new-pass-input')?.focus();
        return;
    }

    // 4. Validate Confirm Password Match
    if (newPass !== confirmPass) {
        if (err) {
            err.innerText = 'Passwords do not match. Please re-enter.';
            err.style.display = 'block';
        }
        document.getElementById('forgot-confirm-pass-input')?.focus();
        return;
    }

    orbitRecoveryBusy=true;
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> UPDATING PASSWORD...';
        btn.disabled = true;
    }

    try {
        const client = await ensureSupabase();

        const {data:sessionData,error:sessionError}=await client.auth.getSession();
        if(sessionError||sessionData?.session?.user?.id!==orbitRecoveryUserId)throw new Error('Your recovery session has changed. Request a new reset link.');
        // 2. Set the new verified password
        const updateRes = await client.auth.updateUser({ password: newPass });
        if (updateRes.error) throw updateRes.error;

        orbitRecoveryUserId=null;orbitRecoveryBusy=false;
        await closeForgotPasswordModal();
        localStorage.removeItem('orbit_explicit_signout');
        showToast('Password updated successfully! Welcome back.', 'success');

        if (updateRes.data && updateRes.data.user) {
            currentUser = updateRes.data.user;orbitRememberSessionActivity(true);
            await launchApp({introduction:true});
        } else {
            switchAuthTab('login');
            const loginEmail = document.getElementById('auth-login-email');
            const loginPass = document.getElementById('auth-login-pass');
            if (loginEmail) loginEmail.value = email;
            if (loginPass) loginPass.value = '';
        }
    } catch(e) {
        if (err) {
            err.innerText = e.message || 'Could not update your password. Please retry.';
            err.style.display = 'block';
        }
    } finally {
        orbitRecoveryBusy=false;
        if (btn) {
            btn.innerHTML = 'UPDATE PASSWORD';
            btn.disabled = false;
        }
    }
}

async function signOut() {
    if (confirm('Sign out of Orbit?')) {
        window.OrbitIntroduction?.finish();
        const signedOutId=currentUser?.id;
        if (typeof disableOrbitBackgroundPush === 'function') {
            const disconnected = await disableOrbitBackgroundPush();
            if (!disconnected) { showToast('Reconnect so Orbit can turn off notifications before signing out.', 'error'); return; }
        }
        if(typeof OrbitNotes!=='undefined')OrbitNotes.stop();
        stopOrbitWeather();closeViewOnceViewer();
        if(typeof disposeOrbitTyping==='function')disposeOrbitTyping();
        await stopOrbitChatServices();
        window.OrbitCrypto?.lock();
        try {
            await updatePresenceStatus(false);
            await sb.auth.signOut();
        } catch(e) {}
        if (typeof allRoomsMap !== 'undefined') allRoomsMap.clear();
        if (typeof userDirectRoomsMap !== 'undefined') userDirectRoomsMap.clear();
        if (typeof messageCache !== 'undefined') messageCache.clear();
        if(typeof orbitSignedMedia!=='undefined')orbitSignedMedia.clear();
        if (typeof _messageOutbox !== 'undefined') _messageOutbox.clear();
        if (typeof _inflightMessages !== 'undefined') _inflightMessages.clear();
        if (typeof unreadRoomsSet !== 'undefined') unreadRoomsSet.clear();
        if (globalRealtimeChannel) { try { await sb.removeChannel(globalRealtimeChannel); } catch (_) {} globalRealtimeChannel = null; }
        currentUser = null;
        try{localStorage.setItem('orbit_explicit_signout','true');}catch(_){}
        try{const project=new URL(SB_URL).hostname.split('.')[0];localStorage.removeItem(`sb-${project}-auth-token`);}catch(_){}
        try{if(signedOutId)localStorage.removeItem(`orbit_session_activity_${signedOutId}`);}catch(_){}
        userProfile = null;
        currentRoom = null;
        activeChatPeerId = null;
        _isSendingMessage = false;
        document.getElementById('screen-chat')?.classList.remove('active');
        document.getElementById('screen-profile')?.classList.remove('active');
        document.getElementById('screen-dash')?.classList.remove('active');
        document.getElementById('screen-auth')?.classList.add('active');
        document.getElementById('user-dropdown')?.classList.remove('open');
        showToast('Signed out');
    }
}

// ══════════════════════════════════════════════════════════════════════════
// LAUNCH & FAST CLOUD SYNC
// ══════════════════════════════════════════════════════════════════════════


window.initServiceWorker = initServiceWorker;
window.handleUrlDeepLinkParams = handleUrlDeepLinkParams;
window.switchAuthTab = switchAuthTab;
window.orbitTogglePass = orbitTogglePass;
window.checkExistingSession = checkExistingSession;
window.handleLogin = handleLogin;
window.handleSignUp = handleSignUp;
window.openForgotPasswordModal = openForgotPasswordModal;
window.closeForgotPasswordModal = closeForgotPasswordModal;
window.orbitToggleForgotPass = orbitToggleForgotPass;
window.handleSendForgotOtp = handleSendForgotOtp;
window.handleVerifyForgotOtpAndReset = handleVerifyForgotOtpAndReset;
window.signOut = signOut;
