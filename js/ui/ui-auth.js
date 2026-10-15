// ORBIT UI - AUTHENTICATION & SESSION MANAGEMENT (js/ui/ui-auth.js)
// Service worker, deep links, login, signup, forgot password OTP, session verification, logout.

async function initServiceWorker() {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
        try {
            // Only the worker's activate handler knows the current cache name.
            // Deleting caches here used to erase the current offline shell.
            const reg = await navigator.serviceWorker.register('./sw.js?v=media-weather-20261015-sw4', { scope: './' });
            reg.update().catch(() => {});
            navigator.serviceWorker.addEventListener('message', event => {
                if (event.data?.type === 'ORBIT_PUSH_VISIBLE_QUERY') {
                    const active = isOrbitChatVisible(event.data.roomId);
                    event.ports[0]?.postMessage({active});
                }
                if (event.data && event.data.type === 'NOTIFICATION_NAVIGATE') {
                    handleDeepLinkNavigation(event.data.roomId, event.data.msgId, event.data.timestamp);
                }
            });
        } catch(e) {}
    }
}

function handleUrlDeepLinkParams() {
    const params = new URLSearchParams(window.location.search);
    const openRoom = params.get('openRoom');
    const focusMsg = params.get('focusMsg');
    const msgTime = params.get('msgTime');
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
    try {
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
            currentUser = session.user;
            await launchApp();
        }
    } catch(e) {
        console.warn('Session restore note:', e);
    }
}

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
        showToast('Welcome back to Orbit!', 'success');
        await launchApp();
    } catch(e) {
        if (err) {
            err.innerText = e.message || 'Login failed. Please try again.';
            err.style.display = 'block';
        }
    } finally {
        _authRequestInFlight = false;
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
            await launchApp();
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
            await launchApp();
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
        if (typeof disableOrbitBackgroundPush === 'function') {
            const disconnected = await disableOrbitBackgroundPush();
            if (!disconnected) { showToast('Reconnect so Orbit can turn off notifications before signing out.', 'error'); return; }
        }
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
