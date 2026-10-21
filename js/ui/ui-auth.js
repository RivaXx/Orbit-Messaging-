// ORBIT UI - AUTHENTICATION & SESSION MANAGEMENT (js/ui/ui-auth.js)
// Service worker, deep links, login, signup, forgot password OTP, session verification, logout.

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
        const registration=await navigator.serviceWorker.register('./sw.js?v=delivery-notes-20261021-r3',{scope:'./'});
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
        if(await orbitCompleteGoogleSignIn())return;
        if(localStorage.getItem('orbit_explicit_signout')==='true')return;
        let cached=null;try{cached=JSON.parse(localStorage.getItem(`sb-${project}-auth-token`)||'null');}catch(_){}
        if(cached?.user?.id && orbitSessionIdleExpired(cached.user.id)){
            const client=await ensureSupabase();await client.auth.signOut({scope:'local'});
            localStorage.removeItem(`sb-${project}-auth-token`);return;
        }
        // A still-valid local session can paint its cached shell immediately.
        // Supabase continues to authenticate all network reads and writes.
        if(cached?.user?.id && Number(cached.expires_at)>Date.now()/1000+30){
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
        const redirect=new URL(location.pathname,location.origin);redirect.searchParams.set('orbit_oauth','google');
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

// 3. FORGOT PASSWORD & OTP ENGINE
function openForgotPasswordModal() {
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

function closeForgotPasswordModal() {
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

// ── Segmented 6-Digit OTP Setup & Handlers ──
let otpResendCooldownInterval = null;
let otpResendSecondsLeft = 0;

function initOtpSegmentInputs() {
    const container = document.getElementById('otp-inputs-container');
    if (!container) return;
    const inputs = container.querySelectorAll('.otp-segment');

    inputs.forEach((input, index) => {
        // Handle direct input & auto-advance
        input.addEventListener('input', (e) => {
            const val = e.target.value.replace(/[^0-9]/g, '');
            e.target.value = val ? val[0] : '';
            if (val && index < inputs.length - 1) {
                inputs[index + 1].focus();
                inputs[index + 1].select();
            }
            updateHiddenOtpValue();
        });

        // Handle backspace retreat
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && index > 0) {
                inputs[index - 1].focus();
                inputs[index - 1].select();
            }
        });

        // Handle full 6-digit clipboard paste
        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const pasteData = (e.clipboardData || window.clipboardData).getData('text').trim().replace(/[^0-9]/g, '');
            if (!pasteData) return;
            inputs.forEach((inp, idx) => {
                inp.value = pasteData[idx] || '';
            });
            const nextFocusIdx = Math.min(pasteData.length, inputs.length - 1);
            inputs[nextFocusIdx].focus();
            updateHiddenOtpValue();
        });
    });
}

function updateHiddenOtpValue() {
    const inputs = document.querySelectorAll('.otp-segment');
    const combined = Array.from(inputs).map(inp => inp.value).join('');
    const hidden = document.getElementById('forgot-otp-input');
    if (hidden) hidden.value = combined;
}

function clearOtpSegmentInputs() {
    document.querySelectorAll('.otp-segment').forEach(inp => inp.value = '');
    const hidden = document.getElementById('forgot-otp-input');
    if (hidden) hidden.value = '';
}

function startOtpResendTimer() {
    if (otpResendCooldownInterval) clearInterval(otpResendCooldownInterval);
    otpResendSecondsLeft = 60;
    const btn = document.getElementById('btn-resend-otp');
    const label = document.getElementById('resend-timer-text');
    if (btn) btn.disabled = true;

    otpResendCooldownInterval = setInterval(() => {
        otpResendSecondsLeft--;
        if (label) label.innerText = `Resend Code (${otpResendSecondsLeft}s)`;
        if (otpResendSecondsLeft <= 0) {
            clearInterval(otpResendCooldownInterval);
            otpResendCooldownInterval = null;
            if (btn) btn.disabled = false;
            if (label) label.innerText = 'Resend Code';
        }
    }, 1000);
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

async function handleSendForgotOtp() {
    const email = document.getElementById('forgot-email-input')?.value.trim();
    const btn = document.getElementById('btn-send-otp');
    const err = document.getElementById('forgot-err');
    const step1 = document.getElementById('forgot-step-1');
    const step2 = document.getElementById('forgot-step-2');
    const targetSpan = document.getElementById('forgot-sent-target');

    if (err) err.style.display = 'none';
    if (!email || !email.includes('@')) {
        if (err) {
            err.innerText = 'Please enter a valid email address.';
            err.style.display = 'block';
        }
        return;
    }

    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> SENDING 6-DIGIT OTP...';
        btn.disabled = true;
    }

    try {
        const client = await ensureSupabase();
        
        // Trigger 6-digit OTP to user email
        const { error } = await client.auth.resetPasswordForEmail(email);
        if (error) throw error;

        if (targetSpan) targetSpan.innerText = email;
        if (step1) step1.classList.add('hide');
        if (step2) step2.classList.remove('hide');
        
        clearOtpSegmentInputs();
        initOtpSegmentInputs();
        startOtpResendTimer();

        // Auto focus first OTP input box
        setTimeout(() => {
            const first = document.querySelector('.otp-segment');
            if (first) first.focus();
        }, 150);

        showToast('6-Digit verification code sent to your email!', 'success');
    } catch(e) {
        if (err) {
            err.innerText = e.message || 'Could not send verification code. Please check email.';
            err.style.display = 'block';
        }
    } finally {
        if (btn) {
            btn.innerHTML = '<i class="fa-regular fa-paper-plane" style="margin-right:6px;"></i> SEND 6-DIGIT OTP';
            btn.disabled = false;
        }
    }
}

async function handleVerifyForgotOtpAndReset() {
    const email = document.getElementById('forgot-email-input')?.value.trim();
    const inputs = document.querySelectorAll('.otp-segment');
    const otp = Array.from(inputs).map(inp => inp.value.trim()).join('');
    const newPass = document.getElementById('forgot-new-pass-input')?.value || '';
    const confirmPass = document.getElementById('forgot-confirm-pass-input')?.value || '';
    const btn = document.getElementById('btn-verify-otp');
    const err = document.getElementById('forgot-err');

    if (err) err.style.display = 'none';

    // 1. Validate 6-Digit OTP completeness
    if (!otp || otp.length < 6) {
        if (err) {
            err.innerText = 'Please enter all 6 digits of the verification code.';
            err.style.display = 'block';
        }
        const firstEmpty = Array.from(inputs).find(inp => !inp.value.trim());
        if (firstEmpty) firstEmpty.focus();
        return;
    }

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

    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> UPDATING PASSWORD...';
        btn.disabled = true;
    }

    try {
        const client = await ensureSupabase();
        
        // 1. Verify 6-digit OTP with Supabase Recovery
        let { data, error } = await client.auth.verifyOtp({
            email,
            token: otp,
            type: 'recovery'
        });

        if (error) {
            // Fallback for email OTP type
            const retryRes = await client.auth.verifyOtp({
                email,
                token: otp,
                type: 'email'
            });
            if (retryRes.error) throw retryRes.error;
            data = retryRes.data;
        }

        // 2. Set the new verified password
        const updateRes = await client.auth.updateUser({ password: newPass });
        if (updateRes.error) throw updateRes.error;

        closeForgotPasswordModal();
        showToast('Password updated successfully! Welcome back.', 'success');
        
        if (updateRes.data && updateRes.data.user) {
            currentUser = updateRes.data.user;
            await launchApp({introduction:true});
        } else {
            switchAuthTab('login');
            const loginEmail = document.getElementById('auth-login-email');
            const loginPass = document.getElementById('auth-login-pass');
            if (loginEmail) loginEmail.value = email;
            if (loginPass) loginPass.value = newPass;
        }
    } catch(e) {
        if (err) {
            err.innerText = e.message || 'OTP verification failed. Please check the code and try again.';
            err.style.display = 'block';
        }
    } finally {
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-shield-check" style="margin-right:6px;"></i> VERIFY & UPDATE PASSWORD';
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
        await stopOrbitChatServices();
        try {
            await updatePresenceStatus(false);
            await sb.auth.signOut();
        } catch(e) {}
        if (typeof allRoomsMap !== 'undefined') allRoomsMap.clear();
        if (typeof userDirectRoomsMap !== 'undefined') userDirectRoomsMap.clear();
        if (typeof messageCache !== 'undefined') messageCache.clear();
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
window.initOtpSegmentInputs = initOtpSegmentInputs;
window.handleSendForgotOtp = handleSendForgotOtp;
window.handleVerifyForgotOtpAndReset = handleVerifyForgotOtpAndReset;
window.signOut = signOut;
