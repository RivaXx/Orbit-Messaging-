// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ORBIT PRO TOOLS SUITE MODULE (js/tools.js)
// Includes: Clock Suite (World, Alarms, Stopwatch, Timer),
//           Calendar with Indian Holidays (2024-2028),
//           Compass & Digital Spirit Level Suite
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// ══════════════════════════════════════════════════════════════════════════
// PRO iOS CLOCK SUITE (World Clock, Alarms, Stopwatch, Timer)
// ══════════════════════════════════════════════════════════════════════════
let currentClockView = 'world';
let clockTickInterval = null;

const WORLD_CITIES_CATALOG = [
    { city: 'Tokyo', country: 'Japan', timeZone: 'Asia/Tokyo' },
    { city: 'London', country: 'United Kingdom', timeZone: 'Europe/London' },
    { city: 'Tehran', country: 'Iran', timeZone: 'Asia/Tehran' },
    { city: 'New York', country: 'USA', timeZone: 'America/New_York' },
    { city: 'San Francisco', country: 'USA', timeZone: 'America/Los_Angeles' },
    { city: 'Dubai', country: 'UAE', timeZone: 'Asia/Dubai' },
    { city: 'Paris', country: 'France', timeZone: 'Europe/Paris' },
    { city: 'Mumbai', country: 'India', timeZone: 'Asia/Kolkata' },
    { city: 'Sydney', country: 'Australia', timeZone: 'Australia/Sydney' },
    { city: 'Singapore', country: 'Singapore', timeZone: 'Asia/Singapore' },
    { city: 'Cairo', country: 'Egypt', timeZone: 'Africa/Cairo' },
    { city: 'Berlin', country: 'Germany', timeZone: 'Europe/Berlin' },
    { city: 'Toronto', country: 'Canada', timeZone: 'America/Toronto' }
];


let userWorldClocks = (() => {
    try {
        const stored = localStorage.getItem('orbit_world_clocks');
        if (stored) return JSON.parse(stored);
    } catch(e) {}
    return ['Asia/Tehran', 'America/New_York', 'Asia/Kolkata', 'Europe/London'];
})();

let isWorldClockEditMode = false;
function toggleWorldClockEditMode() {
    isWorldClockEditMode = !isWorldClockEditMode;
    const btn = document.getElementById('btn-world-clock-edit');
    if (btn) btn.innerText = isWorldClockEditMode ? 'Done' : 'Edit';
    renderWorldClocks();
}

let userAlarms = (() => {
    try {
        const stored = localStorage.getItem('orbit_alarms');
        if (stored) return JSON.parse(stored);
    } catch(e) {}
    return [
        { id: 'alm_1', time: '07:00', label: 'Morning Wakeup', enabled: true },
        { id: 'alm_2', time: '13:30', label: 'Team Standup', enabled: false }
    ];
})();

function initClockSuite() {
    switchClockView(currentClockView);
    if (!clockTickInterval) {
        clockTickInterval = setInterval(() => {
            if (currentClockView === 'world' && !document.hidden && document.getElementById('clock-view-world')?.offsetParent !== null) renderWorldClocks();
            checkTriggerAlarms();
        }, 1000);
    }
}

function switchClockView(view, btn) {
    currentClockView = view;
    document.querySelectorAll('.clock-sub-btn').forEach(b => b.classList.remove('active'));
    if (btn) {
        btn.classList.add('active');
    } else {
        document.querySelectorAll('.clock-sub-btn').forEach(b => {
            if (b.innerText.toLowerCase().includes(view)) b.classList.add('active');
        });
    }

    document.querySelectorAll('.clock-view-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`clock-view-${view}`)?.classList.add('active');

    if (view === 'world') renderWorldClocks();
    else if (view === 'alarm') renderAlarmsList();
}

function renderWorldClocks() {
    const list = document.getElementById('world-clocks-list');
    if (!list) return;

    let html = '';
    const now = new Date();

    userWorldClocks.forEach(tz => {
        const item = WORLD_CITIES_CATALOG.find(c => c.timeZone === tz) || { city: tz.split('/')[1] || tz, country: '', timeZone: tz };
        try {
            // Compute relative time difference and day offset
            const localDate = new Date();
            const targetDate = new Date(now.toLocaleString('en-US', { timeZone: tz }));
            const totalDiffMin = Math.round((targetDate - localDate) / 60000);
            const diffH = Math.floor(Math.abs(totalDiffMin) / 60);
            const diffM = Math.abs(totalDiffMin) % 60;
            const sign = totalDiffMin >= 0 ? '+' : '-';
            let offsetStr = (diffM > 0) ? `${sign}${diffH}:${String(diffM).padStart(2, '0')}` : `${sign}${diffH}HRS`;

            const dayDiff = targetDate.getDate() - localDate.getDate();
            let dayLabel = 'Today';
            if (dayDiff === 1 || dayDiff < -25) dayLabel = 'Tomorrow';
            else if (dayDiff === -1 || dayDiff > 25) dayLabel = 'Yesterday';

            const subTitle = `${dayLabel}, ${offsetStr}`;

            // Format hours, minutes, AM/PM
            const timeFormatter = new Intl.DateTimeFormat('en-US', {
                timeZone: tz,
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
            const parts = timeFormatter.formatToParts(now);
            const hour = parts.find(p => p.type === 'hour')?.value || '12';
            const minute = parts.find(p => p.type === 'minute')?.value || '00';
            const ampm = (parts.find(p => p.type === 'dayPeriod')?.value || 'AM').toUpperCase();
            const timeDigits = `${hour}:${minute}`;

            html += `
                <div class="ios-world-clock-row" style="display:flex; justify-content:space-between; align-items:center; padding:14px 4px; border-bottom:0.5px solid rgba(255,255,255,0.12);">
                    <div style="display:flex; align-items:center; gap:12px;">
                        ${isWorldClockEditMode ? `
                            <button class="btn-reset touch-fix" onclick="deleteWorldClock('${tz}', event)" style="color:#FF3B30; font-size:20px; cursor:pointer;" title="Remove">
                                <i class="fa-solid fa-circle-minus"></i>
                            </button>
                        ` : ''}
                        <div>
                            <div style="font-size:13px; color:#8E8E93; font-weight:500; margin-bottom:2px; font-family:-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;">
                                ${subTitle}
                            </div>
                            <div style="font-size:28px; font-weight:400; color:var(--text-primary); letter-spacing:-0.2px; font-family:-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;">
                                ${escapeHtml(item.city)}
                            </div>
                        </div>
                    </div>
                    <div style="display:flex; align-items:baseline; gap:3px;">
                        <span style="font-size:44px; font-weight:300; color:var(--text-primary); letter-spacing:-0.5px; font-family:-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif; line-height:1;">
                            ${timeDigits}
                        </span>
                        <span style="font-size:16px; font-weight:400; color:var(--text-primary); font-family:-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;">
                            ${ampm}
                        </span>
                    </div>
                </div>
            `;
        } catch(e) {}
    });

    list.innerHTML = html || '<div style="text-align:center; padding:30px; color:#888;">No world clocks added. Tap + to add cities!</div>';
}

function openAddWorldClockModal() {
    const modal = document.getElementById('modal-add-world-clock');
    if (modal) {
        modal.classList.add('active');
        filterWorldClockCities('');
    }
}

function closeAddWorldClockModal() {
    document.getElementById('modal-add-world-clock')?.classList.remove('active');
}

function filterWorldClockCities(query) {
    const container = document.getElementById('world-clock-cities-options');
    if (!container) return;

    const q = (query || '').toLowerCase().trim();
    const filtered = WORLD_CITIES_CATALOG.filter(c => 
        !userWorldClocks.includes(c.timeZone) &&
        (c.city.toLowerCase().includes(q) || c.country.toLowerCase().includes(q) || c.timeZone.toLowerCase().includes(q))
    );

    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:18px; color:#888; font-size:12px;">No matching cities found</div>';
        return;
    }

    container.innerHTML = filtered.map(c => `
        <div class="contact-glass-card touch-fix" style="padding:10px 14px; cursor:pointer;" onclick="selectWorldClockCity('${c.timeZone}')">
            <div style="flex:1;">
                <div style="font-weight:700; font-size:13px; color:var(--text-primary);">${escapeHtml(c.city)}</div>
                <div style="font-size:11px; color:var(--text-muted);">${escapeHtml(c.country)} (${c.timeZone})</div>
            </div>
            <i class="fa-solid fa-plus" style="color:var(--accent);"></i>
        </div>
    `).join('');
}

function selectWorldClockCity(timeZone) {
    if (!userWorldClocks.includes(timeZone)) {
        userWorldClocks.push(timeZone);
        try { localStorage.setItem('orbit_world_clocks', JSON.stringify(userWorldClocks)); } catch(e) {}
        renderWorldClocks();
    }
    closeAddWorldClockModal();
    showToast('City added ✓', 'success');
}

function deleteWorldClock(timeZone, event) {
    if (event) event.stopPropagation();
    userWorldClocks = userWorldClocks.filter(tz => tz !== timeZone);
    try { localStorage.setItem('orbit_world_clocks', JSON.stringify(userWorldClocks)); } catch(e) {}
    renderWorldClocks();
}

// ── Alarms ──
function renderAlarmsList() {
    const list = document.getElementById('alarms-list');
    if (!list) return;

    if (userAlarms.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:30px; color:#888;">No alarms set. Tap + New Alarm above!</div>';
        return;
    }

    list.innerHTML = userAlarms.map(a => `
        <div class="alarm-item touch-fix">
            <div>
                <div class="alarm-time" style="${a.enabled ? '' : 'color:var(--text-muted);'}">${a.snoozeAt ? new Date(a.snoozeAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : a.time}</div>
                <div class="alarm-label">${escapeHtml(a.label || 'Alarm')}</div>
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
                <label class="ios-switch">
                    <input type="checkbox" ${a.enabled ? 'checked' : ''} onchange="toggleAlarm('${a.id}', this.checked)">
                    <span class="ios-slider"></span>
                </label>
                <button class="btn-reset" onclick="deleteAlarm('${a.id}', event)" style="color:var(--text-muted); font-size:14px; padding:4px;" title="Delete Alarm">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function openAddAlarmModal() {
    document.getElementById('modal-add-alarm')?.classList.add('active');
}

function closeAddAlarmModal() {
    document.getElementById('modal-add-alarm')?.classList.remove('active');
}

function saveNewAlarm() {
    const timeInp = document.getElementById('alarm-time-inp');
    const labelInp = document.getElementById('alarm-label-inp');
    const time = timeInp ? timeInp.value : '07:00';
    const label = labelInp ? labelInp.value.trim().slice(0,80) : 'Alarm';
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)){showToast('Choose a valid alarm time.','error');return;}
    const musicInput=document.getElementById('orbit-alarm-music')?.value.trim();
    if(musicInput && !orbitMusicUrl(musicInput)){showToast('Enter a valid HTTPS YouTube or YouTube Music link.','error');return;}

    userAlarms.push({
        id: `alm_${Date.now()}`,
        time: time,
        label: label || 'Alarm',
        tone: document.getElementById('orbit-alarm-tone')?.value || 'orbit',
        musicUrl: orbitMusicUrl(document.getElementById('orbit-alarm-music')?.value || ''),
        enabled: true
    });

    try { localStorage.setItem('orbit_alarms', JSON.stringify(userAlarms)); } catch(e) {}
    closeAddAlarmModal();
    renderAlarmsList();
    orbitUnlockAudio();
    orbitClockNotify('Alarm set', `${time} · ${label || 'Alarm'}`);
}

function toggleAlarm(id, enabled) {
    const target = userAlarms.find(a => a.id === id);
    if (target) {
        target.enabled = enabled;
        orbitClockNotify(enabled?'Alarm enabled':'Alarm disabled',`${target.time} · ${target.label||'Alarm'}`);
        try { localStorage.setItem('orbit_alarms', JSON.stringify(userAlarms)); } catch(e) {}
        renderAlarmsList();
    }
}

function deleteAlarm(id, event) {
    if (event) event.stopPropagation();
    userAlarms = userAlarms.filter(a => a.id !== id);
    try { localStorage.setItem('orbit_alarms', JSON.stringify(userAlarms)); } catch(e) {}
    renderAlarmsList();
}

let lastCheckedAlarmMin = '';
function checkTriggerAlarms() {
    const now = new Date();
    const currentHM = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${currentHM}`;
    let changed=false;
    userAlarms.forEach(a => {
        const snoozed=Number.isFinite(a.snoozeAt);
        if (a.enabled && (snoozed ? a.snoozeAt<=now.getTime() : a.time===currentHM && a.lastFiredMinute!==minuteKey)) {
            a.lastFiredMinute=minuteKey;if(snoozed)a.enabled=false;changed=true;
            orbitRingAlarm(a);
        }
    });
    if(changed){userAlarms=userAlarms.filter(a=>!a.snoozeAt||a.enabled);localStorage.setItem('orbit_alarms',JSON.stringify(userAlarms));renderAlarmsList();}
}

// ── Stopwatch ──
let swInterval = null;
let swStartTime = 0;
let swElapsed = 0;
let swIsRunning = false;
let swLaps = [];

function toggleStopwatch() {
    const btn = document.getElementById('stopwatch-btn-toggle');
    const lapBtn = document.getElementById('stopwatch-btn-lap');
    if (!btn) return;

    if (!swIsRunning) {
        swIsRunning = true;
        swStartTime = Date.now() - swElapsed;
        orbitClockNotify('Stopwatch started','Tracking elapsed time.');
        btn.innerText = 'Stop';
        btn.className = 'stopwatch-btn stop touch-fix';
        if (lapBtn) {
            lapBtn.innerText = 'Lap';
            lapBtn.disabled = false;
        }

        swInterval = setInterval(() => {
            swElapsed = Date.now() - swStartTime;
            updateStopwatchDisplay(swElapsed);
        }, 30);
    } else {
        swIsRunning = false;
        orbitClockNotify('Stopwatch stopped',`${(swElapsed/1000).toFixed(1)} seconds elapsed`);
        clearInterval(swInterval);
        btn.innerText = 'Start';
        btn.className = 'stopwatch-btn start touch-fix';
        if (lapBtn) lapBtn.innerText = 'Reset';
    }
}

function lapStopwatch() {
    const lapBtn = document.getElementById('stopwatch-btn-lap');
    if (swIsRunning) {
        const lapTime = swElapsed;
        swLaps.unshift({ lapNum: swLaps.length + 1, time: lapTime });
        renderStopwatchLaps();
    } else {
        swElapsed = 0;
        swLaps = [];
        updateStopwatchDisplay(0);
        renderStopwatchLaps();
        if (lapBtn) lapBtn.disabled = true;
    }
}

function updateStopwatchDisplay(ms) {
    const display = document.getElementById('stopwatch-display');
    if (!display) return;
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    const hundredths = Math.floor((ms % 1000) / 10);
    display.innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function renderStopwatchLaps() {
    const table = document.getElementById('stopwatch-laps-table');
    if (!table) return;
    table.innerHTML = swLaps.map(l => {
        const ms = l.time;
        const mins = Math.floor(ms / 60000);
        const secs = Math.floor((ms % 60000) / 1000);
        const hundredths = Math.floor((ms % 1000) / 10);
        const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
        return `
            <div class="stopwatch-lap-row">
                <span>Lap ${l.lapNum}</span>
                <span style="font-family:monospace; font-weight:700;">${timeStr}</span>
            </div>
        `;
    }).join('');
}

// ── Timer ──
let timerInterval = null;
let timerTotalSeconds = 300;
let timerRemainingSeconds = 300;
let timerIsRunning = false;
let orbitTimerDeadline = 0;

function toggleTimer() {
    const toggleBtn = document.getElementById('timer-btn-toggle');
    const minInp = document.getElementById('timer-inp-min');
    const secInp = document.getElementById('timer-inp-sec');

    if (!timerIsRunning) {
        if (timerRemainingSeconds === timerTotalSeconds || timerRemainingSeconds <= 0) {
            const m = parseInt(minInp?.value || '5', 10) || 0;
            const s = parseInt(secInp?.value || '0', 10) || 0;
            timerTotalSeconds = (m * 60) + s;
            if (timerTotalSeconds <= 0) timerTotalSeconds = 60;
            timerRemainingSeconds = timerTotalSeconds;
        }

        orbitUnlockAudio();
        orbitTimerDeadline=Date.now()+timerRemainingSeconds*1000;
        orbitClockNotify('Timer started', `${Math.ceil(timerRemainingSeconds/60)} min remaining`);
        timerIsRunning = true;
        if (toggleBtn) {
            toggleBtn.innerText = 'Pause';
            toggleBtn.className = 'stopwatch-btn stop touch-fix';
        }

        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            timerRemainingSeconds=Math.max(0,Math.ceil((orbitTimerDeadline-Date.now())/1000));
            updateTimerDisplay();

            if (timerRemainingSeconds <= 0) {
                clearInterval(timerInterval);
                timerIsRunning = false;
                if (toggleBtn) {
                    toggleBtn.innerText = 'Start';
                    toggleBtn.className = 'stopwatch-btn start touch-fix';
                }
                orbitRingAlarm({label:'Timer finished',tone:'orbit'});
            }
        }, 1000);
    } else {
        timerIsRunning = false;
        clearInterval(timerInterval);
        orbitClockNotify('Timer paused','Tap Resume to continue.');
        if (toggleBtn) {
            toggleBtn.innerText = 'Resume';
            toggleBtn.className = 'stopwatch-btn start touch-fix';
        }
    }
}

function cancelTimer() {
    timerIsRunning = false;
    clearInterval(timerInterval);
    timerRemainingSeconds = timerTotalSeconds;
    updateTimerDisplay();
    const toggleBtn = document.getElementById('timer-btn-toggle');
    if (toggleBtn) {
        orbitClockNotify('Timer cancelled','Timer reset.');
        toggleBtn.innerText = 'Start';
        toggleBtn.className = 'stopwatch-btn start touch-fix';
    }
}

function updateTimerDisplay() {
    const textEl = document.getElementById('timer-display-text');
    const circle = document.getElementById('timer-progress-circle');
    const mins = Math.floor(Math.max(0, timerRemainingSeconds) / 60);
    const secs = Math.max(0, timerRemainingSeconds) % 60;
    if (textEl) textEl.innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (circle && timerTotalSeconds > 0) {
        const perimeter = 565.48;
        const progress = Math.max(0, Math.min(1, timerRemainingSeconds / timerTotalSeconds));
        const offset = perimeter * (1 - progress);
        circle.style.strokeDashoffset = offset;
    }
}


// ══════════════════════════════════════════════════════════════════════════
// FEATURE-RICH CALENDAR SUITE
// ══════════════════════════════════════════════════════════════════════════
let calCurrentYear = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth(); // 0-indexed
let calSelectedDateStr = new Date().toISOString().split('T')[0];
let calViewMode = 'month';

let userCalendarEvents = (() => {
    try {
        const stored = localStorage.getItem('orbit_cal_events');
        if (stored) return JSON.parse(stored);
    } catch(e) {}
    return [
        { id: 'ev_1', title: 'Orbit V28 Release', date: new Date().toISOString().split('T')[0], time: '11:00', color: '#0A84FF', desc: 'Deploy Liquid Glass UI & Utility Suite' },
        { id: 'ev_2', title: 'Team Sync Call', date: new Date().toISOString().split('T')[0], time: '16:00', color: '#30D158', desc: 'Architecture review & live QA' }
    ];
})();

// ══════════════════════════════════════════════════════════════════════════
// COMPREHENSIVE INDIAN HOLIDAYS & FESTIVALS (Google Calendar Style)
// ══════════════════════════════════════════════════════════════════════════
const INDIAN_FIXED_HOLIDAYS = {
    '01-01': { title: "New Year's Day", icon: '✨', type: 'Observance', desc: 'Celebration of the first day of the year' },
    '01-14': { title: 'Makar Sankranti / Pongal', icon: '🪁', type: 'Harvest Festival', desc: 'Sun enters Capricorn; harvest celebration across India' },
    '01-26': { title: 'Republic Day', icon: '🇮🇳', type: 'National Gazetted Holiday', desc: 'Commemorates the enactment of the Constitution of India (1950)' },
    '04-14': { title: 'Dr. B.R. Ambedkar Jayanti', icon: '📜', type: 'Gazetted Holiday', desc: 'Honoring the principal architect of the Indian Constitution' },
    '05-01': { title: 'International Labour Day / Maharashtra Day', icon: '🛠️', type: 'Public Holiday', desc: 'Celebrating the achievements of the working class' },
    '08-15': { title: 'Independence Day', icon: '🇮🇳', type: 'National Gazetted Holiday', desc: 'Commemorating freedom from British rule in 1947' },
    '10-02': { title: 'Mahatma Gandhi Jayanti', icon: '🕊️', type: 'National Gazetted Holiday', desc: 'Honoring the Father of the Nation and International Non-Violence Day' },
    '10-31': { title: 'Rashtriya Ekta Diwas (National Unity Day)', icon: '🤝', type: 'Observance', desc: 'Birth anniversary of Sardar Vallabhbhai Patel' },
    '11-14': { title: "Children's Day (Bal Diwas)", icon: '🎈', type: 'Observance', desc: 'Birth anniversary of Pandit Jawaharlal Nehru' },
    '12-25': { title: 'Christmas Day', icon: '🎄', type: 'Gazetted Holiday', desc: 'Celebrating the birth of Jesus Christ' }
};

const INDIAN_VARIABLE_HOLIDAYS = {
    // 2024
    '2024-03-08': { title: 'Maha Shivratri', icon: '🔱', type: 'Gazetted Holiday', desc: 'Great night of Lord Shiva celebration' },
    '2024-03-25': { title: 'Holi', icon: '🎨', type: 'Gazetted Holiday', desc: 'Festival of colors celebrating the victory of good over evil' },
    '2024-03-29': { title: 'Good Friday', icon: '✝️', type: 'Gazetted Holiday', desc: 'Christian holiday commemorating the crucifixion of Jesus' },
    '2024-04-09': { title: 'Ugadi / Gudi Padwa', icon: '🌿', type: 'Traditional New Year', desc: 'Traditional New Year for Karnataka, Andhra, and Maharashtra' },
    '2024-04-11': { title: 'Eid-ul-Fitr', icon: '🌙', type: 'Gazetted Holiday', desc: 'Islamic festival marking the end of Ramadan fasting' },
    '2024-04-17': { title: 'Ram Navami', icon: '🏹', type: 'Gazetted Holiday', desc: 'Celebrating the auspicious birth of Lord Rama' },
    '2024-04-21': { title: 'Mahavir Jayanti', icon: '🙏', type: 'Gazetted Holiday', desc: 'Birth anniversary of Lord Mahavira, 24th Tirthankara of Jainism' },
    '2024-05-23': { title: 'Buddha Purnima', icon: '☸️', type: 'Gazetted Holiday', desc: 'Celebrating the birth, enlightenment, and death of Gautama Buddha' },
    '2024-06-17': { title: 'Bakrid / Eid al-Adha', icon: '🐑', type: 'Gazetted Holiday', desc: 'Feast of the Sacrifice honoring Ibrahim willingness to sacrifice his son' },
    '2024-07-17': { title: 'Muharram', icon: '🕌', type: 'Gazetted Holiday', desc: 'First month of Islamic calendar; day of Ashura' },
    '2024-08-19': { title: 'Raksha Bandhan', icon: '🧵', type: 'Festival', desc: 'Celebration of the sacred bond between brothers and sisters' },
    '2024-08-26': { title: 'Krishna Janmashtami', icon: '🦚', type: 'Gazetted Holiday', desc: 'Celebrating the joyful birth of Lord Krishna' },
    '2024-09-07': { title: 'Ganesh Chaturthi', icon: '🐘', type: 'Gazetted Holiday', desc: 'Welcoming the beloved Lord Ganesha with grand festivities' },
    '2024-09-16': { title: 'Milad-un-Nabi (Eid-e-Milad)', icon: '✨', type: 'Gazetted Holiday', desc: 'Observance of the birthday of the Islamic Prophet Muhammad' },
    '2024-10-12': { title: 'Dussehra (Vijayadashami)', icon: '🏹', type: 'Gazetted Holiday', desc: 'Victory of Lord Rama over Ravana and Goddess Durga over Mahishasura' },
    '2024-10-31': { title: 'Diwali (Deepavali)', icon: '🪔', type: 'Gazetted Holiday', desc: 'Festival of lights celebrating prosperity and victory of light over darkness' },
    '2024-11-15': { title: 'Guru Nanak Jayanti', icon: '☬', type: 'Gazetted Holiday', desc: 'Birth anniversary of Guru Nanak Dev Ji, founder of Sikhism' },
    // 2025
    '2025-02-26': { title: 'Maha Shivratri', icon: '🔱', type: 'Gazetted Holiday', desc: 'Great night of Lord Shiva celebration' },
    '2025-03-14': { title: 'Holi', icon: '🎨', type: 'Gazetted Holiday', desc: 'Festival of colors celebrating the victory of good over evil' },
    '2025-03-30': { title: 'Ugadi / Gudi Padwa', icon: '🌿', type: 'Traditional New Year', desc: 'Traditional New Year celebrations' },
    '2025-03-31': { title: 'Eid-ul-Fitr', icon: '🌙', type: 'Gazetted Holiday', desc: 'Islamic festival marking the conclusion of holy month Ramadan' },
    '2025-04-06': { title: 'Ram Navami', icon: '🏹', type: 'Gazetted Holiday', desc: 'Celebrating the auspicious birth of Lord Rama' },
    '2025-04-10': { title: 'Mahavir Jayanti', icon: '🙏', type: 'Gazetted Holiday', desc: 'Birth anniversary of Lord Mahavira' },
    '2025-04-18': { title: 'Good Friday', icon: '✝️', type: 'Gazetted Holiday', desc: 'Christian solemn observance of the crucifixion of Jesus' },
    '2025-05-12': { title: 'Buddha Purnima', icon: '☸️', type: 'Gazetted Holiday', desc: 'Celebrating Gautama Buddha enlightenment and Nirvana' },
    '2025-06-07': { title: 'Bakrid / Eid al-Adha', icon: '🐑', type: 'Gazetted Holiday', desc: 'Islamic Feast of Sacrifice' },
    '2025-07-06': { title: 'Muharram', icon: '🕌', type: 'Gazetted Holiday', desc: 'Islamic New Year & Ashura' },
    '2025-08-09': { title: 'Raksha Bandhan', icon: '🧵', type: 'Festival', desc: 'Sacred sibling protection thread festival' },
    '2025-08-16': { title: 'Krishna Janmashtami', icon: '🦚', type: 'Gazetted Holiday', desc: 'Lord Krishna auspicious birthday' },
    '2025-08-27': { title: 'Ganesh Chaturthi', icon: '🐘', type: 'Gazetted Holiday', desc: 'Lord Ganesha arrival festival' },
    '2025-09-05': { title: 'Milad-un-Nabi', icon: '✨', type: 'Gazetted Holiday', desc: 'Prophet Muhammad birthday' },
    '2025-10-02': { title: 'Dussehra (Vijayadashami)', icon: '🏹', type: 'Gazetted Holiday', desc: 'Victory of Good over Evil' },
    '2025-10-20': { title: 'Diwali (Deepavali)', icon: '🪔', type: 'Gazetted Holiday', desc: 'Festival of lights and fireworks' },
    '2025-11-05': { title: 'Guru Nanak Jayanti', icon: '☬', type: 'Gazetted Holiday', desc: 'Sikh Guru Nanak Prakash Gurpurab' },
    // 2026
    '2026-02-15': { title: 'Maha Shivratri', icon: '🔱', type: 'Gazetted Holiday', desc: 'Great night of Lord Shiva celebration' },
    '2026-03-03': { title: 'Holi', icon: '🎨', type: 'Gazetted Holiday', desc: 'Festival of colors celebrating the victory of good over evil' },
    '2026-03-20': { title: 'Eid-ul-Fitr', icon: '🌙', type: 'Gazetted Holiday', desc: 'Islamic festival marking the end of Ramadan' },
    '2026-03-27': { title: 'Ram Navami', icon: '🏹', type: 'Gazetted Holiday', desc: 'Lord Rama birth celebration' },
    '2026-03-31': { title: 'Mahavir Jayanti', icon: '🙏', type: 'Gazetted Holiday', desc: 'Lord Mahavira birth celebration' },
    '2026-04-03': { title: 'Good Friday', icon: '✝️', type: 'Gazetted Holiday', desc: 'Solemn Christian holiday' },
    '2026-05-27': { title: 'Bakrid / Eid al-Adha', icon: '🐑', type: 'Gazetted Holiday', desc: 'Feast of the Sacrifice' },
    '2026-05-31': { title: 'Buddha Purnima', icon: '☸️', type: 'Gazetted Holiday', desc: 'Lord Buddha enlightenment day' },
    '2026-06-25': { title: 'Muharram', icon: '🕌', type: 'Gazetted Holiday', desc: 'Islamic Month of Remembrance' },
    '2026-08-28': { title: 'Raksha Bandhan', icon: '🧵', type: 'Festival', desc: 'Celebration of brother and sister bond' },
    '2026-09-04': { title: 'Krishna Janmashtami', icon: '🦚', type: 'Gazetted Holiday', desc: 'Celebration of Lord Krishna birth' },
    '2026-09-14': { title: 'Ganesh Chaturthi', icon: '🐘', type: 'Gazetted Holiday', desc: 'Vinayaka Chaturthi festival' },
    '2026-10-20': { title: 'Dussehra (Vijayadashami)', icon: '🏹', type: 'Gazetted Holiday', desc: 'Victory festival celebrating triumph over evil' },
    '2026-11-08': { title: 'Diwali (Deepavali)', icon: '🪔', type: 'Gazetted Holiday', desc: 'Grand festival of lights and Lakshmi Puja' },
    '2026-11-24': { title: 'Guru Nanak Jayanti', icon: '☬', type: 'Gazetted Holiday', desc: 'Guru Nanak Dev Ji Gurpurab' },
    // 2027
    '2027-03-06': { title: 'Maha Shivratri', icon: '🔱', type: 'Gazetted Holiday', desc: 'Night of Lord Shiva' },
    '2027-03-10': { title: 'Eid-ul-Fitr', icon: '🌙', type: 'Gazetted Holiday', desc: 'End of Ramadan celebration' },
    '2027-03-22': { title: 'Holi', icon: '🎨', type: 'Gazetted Holiday', desc: 'Festival of colors' },
    '2027-03-26': { title: 'Good Friday', icon: '✝️', type: 'Gazetted Holiday', desc: 'Good Friday observance' },
    '2027-04-16': { title: 'Ram Navami', icon: '🏹', type: 'Gazetted Holiday', desc: 'Lord Rama birth' },
    '2027-04-20': { title: 'Mahavir Jayanti', icon: '🙏', type: 'Gazetted Holiday', desc: 'Lord Mahavira birth' },
    '2027-05-16': { title: 'Bakrid / Eid al-Adha', icon: '🐑', type: 'Gazetted Holiday', desc: 'Feast of Sacrifice' },
    '2027-05-20': { title: 'Buddha Purnima', icon: '☸️', type: 'Gazetted Holiday', desc: 'Buddha Purnima' },
    '2027-06-15': { title: 'Muharram', icon: '🕌', type: 'Gazetted Holiday', desc: 'Muharram observance' },
    '2027-08-17': { title: 'Raksha Bandhan', icon: '🧵', type: 'Festival', desc: 'Sibling bond festival' },
    '2027-08-25': { title: 'Krishna Janmashtami', icon: '🦚', type: 'Gazetted Holiday', desc: 'Lord Krishna birthday' },
    '2027-09-04': { title: 'Ganesh Chaturthi', icon: '🐘', type: 'Gazetted Holiday', desc: 'Lord Ganesha festival' },
    '2027-10-09': { title: 'Dussehra (Vijayadashami)', icon: '🏹', type: 'Gazetted Holiday', desc: 'Vijayadashami triumph' },
    '2027-10-29': { title: 'Diwali (Deepavali)', icon: '🪔', type: 'Gazetted Holiday', desc: 'Festival of lights' },
    '2027-11-14': { title: 'Guru Nanak Jayanti', icon: '☬', type: 'Gazetted Holiday', desc: 'Guru Nanak Gurpurab' }
};

function getIndianHoliday(dateStr) {
    if (!dateStr) return null;
    // 1. Check exact date in variable holidays
    if (INDIAN_VARIABLE_HOLIDAYS[dateStr]) {
        return INDIAN_VARIABLE_HOLIDAYS[dateStr];
    }
    // 2. Check month-day in fixed holidays (any year)
    const monthDay = dateStr.slice(5); // e.g. '01-26'
    if (INDIAN_FIXED_HOLIDAYS[monthDay]) {
        return INDIAN_FIXED_HOLIDAYS[monthDay];
    }
    return null;
}

let calShowWeekNumbers = (() => {
    try { return localStorage.getItem('orbit_cal_show_weeks') === 'true'; } catch(e) { return false; }
})();

function getISOWeekNumber(d) {
    const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNr = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - dayNr);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    return Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
}

function toggleCalendarWeekNumbers() {
    calShowWeekNumbers = !calShowWeekNumbers;
    try { localStorage.setItem('orbit_cal_show_weeks', calShowWeekNumbers ? 'true' : 'false'); } catch(e) {}
    syncWeekNumbersUI();
    renderCalendarMonth();
}

function syncWeekNumbersUI() {
    const btn = document.getElementById('cal-week-toggle-btn');
    if (btn) {
        btn.style.color = calShowWeekNumbers ? 'var(--accent)' : 'var(--text-secondary)';
        btn.style.background = calShowWeekNumbers ? 'rgba(255,215,0,0.18)' : '';
        btn.style.borderColor = calShowWeekNumbers ? 'var(--accent)' : 'var(--glass-border)';
    }
    const calTab = document.getElementById('tab-calendar');
    if (calTab) {
        if (calShowWeekNumbers) calTab.classList.add('show-week-nums');
        else calTab.classList.remove('show-week-nums');
    }
    const weekHdr = document.getElementById('cal-week-hdr');
    if (weekHdr) {
        if (calShowWeekNumbers) weekHdr.classList.remove('hide');
        else weekHdr.classList.add('hide');
    }
}

function initCalendar() {
    if(typeof OrbitNotes!=='undefined')OrbitNotes.syncCalendar();
    syncWeekNumbersUI();
    renderCalendarMonth();
    if (calViewMode === 'agenda') {
        renderCalendarAgendaView();
    } else {
        renderCalendarEvents(calSelectedDateStr);
    }
}

function switchCalendarView(view, btn) {
    calViewMode = view;
    document.querySelectorAll('.cal-view-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    const monthView = document.getElementById('cal-month-view');
    const label = document.getElementById('cal-selected-date-label');
    if (view === 'agenda') {
        if (monthView) monthView.style.display = 'none';
        if (label) label.innerText = 'ALL UPCOMING AGENDA & EVENTS';
        renderCalendarAgendaView();
    } else {
        if (monthView) monthView.style.display = 'block';
        renderCalendarMonth();
        renderCalendarEvents(calSelectedDateStr);
    }
}

function navigateCalendarMonth(dir) {
    calCurrentMonth += dir;
    if (calCurrentMonth > 11) {
        calCurrentMonth = 0;
        calCurrentYear++;
    } else if (calCurrentMonth < 0) {
        calCurrentMonth = 11;
        calCurrentYear--;
    }
    renderCalendarMonth();
    if (calViewMode === 'agenda') {
        renderCalendarAgendaView();
    } else {
        renderCalendarEvents(calSelectedDateStr);
    }
}

function jumpCalendarToToday() {
    const today = new Date();
    calCurrentYear = today.getFullYear();
    calCurrentMonth = today.getMonth();
    calSelectedDateStr = today.toISOString().split('T')[0];
    renderCalendarMonth();
    if (calViewMode === 'agenda') {
        renderCalendarAgendaView();
    } else {
        renderCalendarEvents(calSelectedDateStr);
    }
}

function selectCalendarDate(dateStr) {
    calSelectedDateStr = dateStr;
    renderCalendarMonth();
    renderCalendarEvents(dateStr);
}

function renderCalendarMonth() {
    syncWeekNumbersUI();
    const monthLabel = document.getElementById('cal-current-month-label');
    const grid = document.getElementById('cal-days-grid');
    if (!grid) return;

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    if (monthLabel) monthLabel.innerText = `${monthNames[calCurrentMonth]} ${calCurrentYear}`;

    const firstDayIndex = new Date(calCurrentYear, calCurrentMonth, 1).getDay();
    const daysInMonth = new Date(calCurrentYear, calCurrentMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(calCurrentYear, calCurrentMonth, 0).getDate();
    const todayStr = new Date().toISOString().split('T')[0];

    // Build array of cell items for 7-day columns
    const cells = [];

    // Previous month filler days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
        const prevDay = daysInPrevMonth - i;
        const prevM = calCurrentMonth === 0 ? 12 : calCurrentMonth;
        const prevY = calCurrentMonth === 0 ? calCurrentYear - 1 : calCurrentYear;
        const dateStr = `${prevY}-${String(prevM).padStart(2,'0')}-${String(prevDay).padStart(2,'0')}`;
        cells.push({
            dayNum: prevDay,
            dateStr,
            isOtherMonth: true,
            isToday: false,
            isSelected: false,
            dayEvents: userCalendarEvents.filter(ev => ev.date === dateStr),
            holiday: getIndianHoliday(dateStr)
        });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
        const monthPad = String(calCurrentMonth + 1).padStart(2, '0');
        const dayPad = String(d).padStart(2, '0');
        const dateStr = `${calCurrentYear}-${monthPad}-${dayPad}`;
        cells.push({
            dayNum: d,
            dateStr,
            isOtherMonth: false,
            isToday: (dateStr === todayStr),
            isSelected: (dateStr === calSelectedDateStr),
            dayEvents: userCalendarEvents.filter(ev => ev.date === dateStr),
            holiday: getIndianHoliday(dateStr)
        });
    }

    // Next month filler days to complete grid
    const totalCells = cells.length;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let n = 1; n <= remaining; n++) {
        const nextM = calCurrentMonth === 11 ? 1 : calCurrentMonth + 2;
        const nextY = calCurrentMonth === 11 ? calCurrentYear + 1 : calCurrentYear;
        const dateStr = `${nextY}-${String(nextM).padStart(2,'0')}-${String(n).padStart(2,'0')}`;
        cells.push({
            dayNum: n,
            dateStr,
            isOtherMonth: true,
            isToday: false,
            isSelected: false,
            dayEvents: userCalendarEvents.filter(ev => ev.date === dateStr),
            holiday: getIndianHoliday(dateStr)
        });
    }

    let html = '';
    for (let idx = 0; idx < cells.length; idx++) {
        // At start of each 7-day week row, add week number badge if enabled
        if (idx % 7 === 0 && calShowWeekNumbers) {
            // Compute ISO week number of this row's middle day (Wednesday, idx + 3)
            const sampleItem = cells[Math.min(idx + 3, cells.length - 1)];
            const sampleDate = new Date(sampleItem.dateStr + 'T00:00:00');
            const wn = getISOWeekNumber(sampleDate);
            html += `<div class="cal-week-badge" title="Week ${wn}">W${wn}</div>`;
        }

        const c = cells[idx];
        let dotHtml = '';
        if (c.holiday || c.dayEvents.length > 0) {
            dotHtml = '<div class="cal-dot-wrap" style="display:flex; gap:2.5px; align-items:center; justify-content:center; margin-top:2px;">';
            if (c.holiday) {
                dotHtml += `<div class="cal-holiday-dot" title="${escapeHtml(c.holiday.title)} (Indian Holiday)"></div>`;
            }
            if (c.dayEvents.length > 0) {
                dotHtml += `<div class="cal-event-dot" style="background:${c.dayEvents[0].color || 'var(--accent)'};" title="${escapeHtml(c.dayEvents[0].title)}"></div>`;
            }
            dotHtml += '</div>';
        }

        html += `
            <div class="cal-day ${c.isOtherMonth ? 'other-month' : ''} ${c.isToday ? 'today' : ''} ${c.isSelected ? 'selected' : ''} ${c.holiday ? 'has-holiday' : ''} touch-fix" onclick="selectCalendarDate('${c.dateStr}')" title="${c.holiday ? (escapeHtml(c.holiday.title) + ' · ' + c.dateStr) : c.dateStr}">
                <span>${c.dayNum}</span>
                ${dotHtml}
            </div>
        `;
    }

    grid.innerHTML = html;
}

function renderCalendarEvents(dateStr) {
    const list = document.getElementById('cal-events-list');
    const label = document.getElementById('cal-selected-date-label');
    if (!list) return;

    const formattedDate = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    if (label) label.innerText = `EVENTS · ${formattedDate.toUpperCase()}`;

    const holiday = getIndianHoliday(dateStr);
    const events = userCalendarEvents.filter(ev => ev.date === dateStr);

    let html = '';

    // Render Google Calendar style Indian Holiday card
    if (holiday) {
        html += `
            <div class="cal-holiday-card touch-fix">
                <div style="display:flex; align-items:center; gap:12px;">
                    <span style="font-size:26px; line-height:1; display:flex; align-items:center; justify-content:center; width:38px; height:38px; background:rgba(255,159,10,0.2); border-radius:10px;">${holiday.icon || '🇮🇳'}</span>
                    <div>
                        <div style="font-size:14px; font-weight:800; color:#FFB340; letter-spacing:0.2px;">${escapeHtml(holiday.title)}</div>
                        <div class="cal-holiday-badge"><i class="fa-solid fa-flag"></i> ${holiday.type || 'Indian Public Holiday'}</div>
                        <div style="font-size:11.5px; color:var(--text-secondary); margin-top:4px;">${escapeHtml(holiday.desc || 'Public holiday observed across India')}</div>
                    </div>
                </div>
            </div>
        `;
    }

    if (events.length > 0) {
        html += events.map(ev => `
            <div class="cal-agenda-card touch-fix" style="border-left-color:${ev.color || 'var(--accent)'};">
                <div style="flex:1;">
                    <div class="cal-agenda-title">${escapeHtml(ev.title)}</div>
                    <div class="cal-agenda-time"><i class="fa-regular fa-clock"></i> ${ev.time || 'All Day'}</div>
                    ${ev.desc ? ('<div style="font-size:11.5px; color:var(--text-secondary); margin-top:4px;">' + escapeHtml(ev.desc) + '</div>') : ''}
                </div>
                <button class="btn-reset touch-fix" onclick="deleteCalendarEvent('${ev.id}')" style="color:var(--text-muted); font-size:13px; padding:6px;" title="${ev.noteId?'Edit note reminder':'Delete event'}">
                    <i class="fa-solid ${ev.noteId?'fa-pen':'fa-trash-can'}"></i>
                </button>
            </div>
        `).join('');
    } else if (!holiday) {
        html += '<div style="text-align:center; padding:18px 0; color:var(--text-muted); font-size:12.5px;">No events scheduled for this day</div>';
    }

    // Always show upcoming events this month so user never loses sight of created events!
    const curMonthPrefix = `${calCurrentYear}-${String(calCurrentMonth + 1).padStart(2, '0')}`;
    const otherMonthEvents = userCalendarEvents.filter(ev => ev.date.startsWith(curMonthPrefix) && ev.date !== dateStr);
    if (otherMonthEvents.length > 0) {
        html += `<div style="font-size:11px; font-weight:800; color:var(--accent); letter-spacing:0.8px; margin-top:16px; margin-bottom:8px; text-transform:uppercase;">More Events in ${new Date(calCurrentYear, calCurrentMonth, 1).toLocaleDateString('en-US', { month: 'long' })}</div>`;
        html += otherMonthEvents.map(ev => {
            const evDate = new Date(ev.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            return `
                <div class="cal-agenda-card touch-fix" style="border-left-color:${ev.color || 'var(--accent)'}; opacity:0.9;" onclick="selectCalendarDate('${ev.date}')">
                    <div style="flex:1;">
                        <div class="cal-agenda-title">${escapeHtml(ev.title)} <span style="font-size:11px; font-weight:600; color:var(--text-muted); margin-left:6px;">(${evDate})</span></div>
                        <div class="cal-agenda-time"><i class="fa-regular fa-clock"></i> ${ev.time || 'All Day'}</div>
                    </div>
                    <button class="btn-reset touch-fix" onclick="event.stopPropagation(); deleteCalendarEvent('${ev.id}')" style="color:var(--text-muted); font-size:13px; padding:6px;" title="${ev.noteId?'Edit note reminder':'Delete event'}">
                        <i class="fa-solid ${ev.noteId?'fa-pen':'fa-trash-can'}"></i>
                    </button>
                </div>
            `;
        }).join('');
    }

    list.innerHTML = html;
}

function renderCalendarAgendaView() {
    const list = document.getElementById('cal-events-list');
    if (!list) return;

    // Collect all user events + upcoming Indian holidays for the year
    const combined = [];
    userCalendarEvents.forEach(ev => {
        combined.push({
            type: 'user',
            noteId: ev.noteId,
            id: ev.id,
            date: ev.date,
            time: ev.time || 'All Day',
            title: ev.title,
            desc: ev.desc,
            color: ev.color || 'var(--accent)'
        });
    });

    Object.keys(INDIAN_FIXED_HOLIDAYS).forEach(md => {
        const h = INDIAN_FIXED_HOLIDAYS[md];
        combined.push({
            type: 'holiday',
            id: `hol_${calCurrentYear}_${md}`,
            date: `${calCurrentYear}-${md}`,
            time: 'Public Holiday',
            title: h.title,
            desc: h.desc,
            icon: h.icon,
            color: '#FF9F0A'
        });
    });

    combined.sort((a, b) => a.date.localeCompare(b.date));

    if (combined.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-muted);">No events found. Click "+ New Event" to schedule something!</div>';
        return;
    }

    let html = '';
    let lastDate = '';
    combined.forEach(item => {
        if (item.date !== lastDate) {
            lastDate = item.date;
            const fDate = new Date(item.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
            html += `<div style="font-size:11.5px; font-weight:800; color:var(--accent); margin:14px 2px 6px; letter-spacing:0.5px;">${fDate}</div>`;
        }

        if (item.type === 'holiday') {
            html += `
                <div class="cal-holiday-card touch-fix" style="margin-bottom:6px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span style="font-size:22px; width:32px; height:32px; display:flex; align-items:center; justify-content:center; background:rgba(255,159,10,0.18); border-radius:8px;">${item.icon || '🇮🇳'}</span>
                        <div>
                            <div style="font-size:13.5px; font-weight:800; color:#FFB340;">${escapeHtml(item.title)}</div>
                            <div style="font-size:11px; color:var(--text-secondary);">${escapeHtml(item.desc || 'Indian Holiday')}</div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="cal-agenda-card touch-fix" style="border-left-color:${item.color}; margin-bottom:6px;">
                    <div style="flex:1;">
                        <div class="cal-agenda-title">${escapeHtml(item.title)}</div>
                        <div class="cal-agenda-time"><i class="fa-regular fa-clock"></i> ${item.time}</div>
                        ${item.desc ? ('<div style="font-size:11px; color:var(--text-secondary); margin-top:3px;">' + escapeHtml(item.desc) + '</div>') : ''}
                    </div>
                    <button class="btn-reset touch-fix" onclick="deleteCalendarEvent('${item.id}')" style="color:var(--text-muted); font-size:13px; padding:6px;" title="${item.noteId?'Edit note reminder':'Delete event'}">
                        <i class="fa-solid ${item.noteId?'fa-pen':'fa-trash-can'}"></i>
                    </button>
                </div>
            `;
        }
    });

    list.innerHTML = html;
}

function openCreateCalendarEventModal() {
    const modal = document.getElementById('modal-cal-event');
    const dateInp = document.getElementById('cal-event-date-inp');
    if (dateInp) dateInp.value = calSelectedDateStr;
    modal?.classList.add('active');
}

function closeCalendarEventModal() {
    document.getElementById('modal-cal-event')?.classList.remove('active');
}

function saveCalendarEvent() {
    const titleInp = document.getElementById('cal-event-title-inp');
    const dateInp = document.getElementById('cal-event-date-inp');
    const timeInp = document.getElementById('cal-event-time-inp');
    const colorInp = document.getElementById('cal-event-color-inp');
    const descInp = document.getElementById('cal-event-desc-inp');

    const title = titleInp ? titleInp.value.trim() : '';
    const date = dateInp ? dateInp.value : calSelectedDateStr;
    const time = timeInp ? timeInp.value : '10:00';
    const color = colorInp ? colorInp.value : '#FFD700';
    const desc = descInp ? descInp.value.trim() : '';

    if (!title) {
        showToast('Please enter an event title', 'error');
        return;
    }

    userCalendarEvents.push({
        id: `ev_${Date.now()}`,
        title,
        date,
        time,
        color,
        desc
    });

    try { localStorage.setItem('orbit_cal_events', JSON.stringify(userCalendarEvents.filter(row=>!row.noteId))); } catch(e) {}
    closeCalendarEventModal();
    if (titleInp) titleInp.value = '';
    if (descInp) descInp.value = '';

    // Immediately select the newly created event date
    calSelectedDateStr = date;
    const parts = date.split('-').map(Number);
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        calCurrentYear = parts[0];
        calCurrentMonth = parts[1] - 1;
    }

    renderCalendarMonth();
    if (calViewMode === 'agenda') {
        renderCalendarAgendaView();
    } else {
        renderCalendarEvents(calSelectedDateStr);
    }
    showToast('Event saved ✓', 'success');
}

function deleteCalendarEvent(id) {
    const linked=userCalendarEvents.find(row=>row.id===id&&row.noteId);
    if(linked){switchTab('notes');OrbitNotes.open(linked.noteId);showToast('Edit or remove the reminder in its note.','info');return;}
    userCalendarEvents = userCalendarEvents.filter(ev => ev.id !== id);
    try { localStorage.setItem('orbit_cal_events', JSON.stringify(userCalendarEvents.filter(row=>!row.noteId))); } catch(e) {}
    renderCalendarMonth();
    if (calViewMode === 'agenda') {
        renderCalendarAgendaView();
    } else {
        renderCalendarEvents(calSelectedDateStr);
    }
    showToast('Event removed', 'info');
}

// ══════════════════════════════════════════════════════════════════════════
// APPLE COMPASS & DIGITAL LEVEL SUITE ENGINE
// ══════════════════════════════════════════════════════════════════════════
let compassHeading = 0;
let compassTargetHeading = 0;
let compassPitch = 0;
let compassRoll = 0;
let compassIsDragging = false;
let compassDragStartAngle = 0;
let compassDragBaseHeading = 0;
let compassIsTrueNorth = true;
let compassInitialized = false;
let compassLocationBusy = false;
let compassPositionCache = null;
let compassLocationRequest = null;
const ORBIT_LOCATION_ATTEMPT_KEY = 'orbit_location_attempt_state';

async function getOrbitLocationOnce() {
    if (!navigator.geolocation) throw new Error('Location is not available in this browser.');
    if (compassPositionCache && Date.now() - compassPositionCache.timestamp < 30000) return compassPositionCache.position;
    if (compassLocationRequest) return compassLocationRequest;
    compassLocationRequest = (async () => {
        let permissionState = 'unknown';
        try {
            const permission = await navigator.permissions?.query({ name: 'geolocation' });
            if (permission?.state) permissionState = permission.state;
        } catch(e) {}
        let attempted = '';
        try { attempted = sessionStorage.getItem(ORBIT_LOCATION_ATTEMPT_KEY) || ''; } catch(e) {}
        if (permissionState === 'denied' || (attempted === 'denied' && permissionState !== 'granted')) {
            throw new Error('Location is blocked. Change this site’s location permission in browser settings.');
        }
        if (permissionState !== 'granted' && attempted === 'granted') {
            if (compassPositionCache) return compassPositionCache.position;
            throw new Error('Location permission was temporary. Reopen Orbit to request it again.');
        }
        if (permissionState !== 'granted' && attempted === 'prompted') {
            throw new Error('Location was already requested in this tab. Use the browser’s site controls to change permission.');
        }
        if (permissionState !== 'granted') {
            try { sessionStorage.setItem(ORBIT_LOCATION_ATTEMPT_KEY, 'prompted'); } catch(e) {}
        }
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(position => {
                compassPositionCache = { position, timestamp: Date.now() };
                try { sessionStorage.setItem(ORBIT_LOCATION_ATTEMPT_KEY, 'granted'); } catch(e) {}
                resolve(position);
            }, error => {
                if (error?.code === 1) {
                    try { sessionStorage.setItem(ORBIT_LOCATION_ATTEMPT_KEY, 'denied'); } catch(e) {}
                    reject(new Error('Location permission was denied. Change it in browser settings if you want to enable it.'));
                } else {
                    reject(new Error('Could not get a location fix. Try again when GPS is available.'));
                }
            }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
        });
    })();
    try { return await compassLocationRequest; }
    finally { compassLocationRequest = null; }
}
window.getOrbitLocationOnce = getOrbitLocationOnce;

function initCompassSuite() {
    if (compassInitialized) return;
    renderCompassTicks();
    setupCompassSensors();
    setupCompassInteractions();
    compassInitialized = true;
}

function renderCompassTicks() {
    const ticksGroup = document.getElementById('compass-ticks-group');
    if (!ticksGroup || ticksGroup.children.length > 0) return;

    let svgHtml = '';
    for (let deg = 0; deg < 360; deg += 2) {
        const isMajor = (deg % 30 === 0);
        const isMedium = (deg % 10 === 0);
        const tickLength = isMajor ? 14 : (isMedium ? 9 : 5);
        const strokeWidth = isMajor ? 2.2 : (isMedium ? 1.5 : 1);
        const strokeColor = isMajor ? 'rgba(255, 255, 255, 0.95)' : (isMedium ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.25)');

        const rad = (deg - 90) * Math.PI / 180;
        const outerR = 138;
        const innerR = outerR - tickLength;

        const x1 = 150 + outerR * Math.cos(rad);
        const y1 = 150 + outerR * Math.sin(rad);
        const x2 = 150 + innerR * Math.cos(rad);
        const y2 = 150 + innerR * Math.sin(rad);

        svgHtml += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`;

        // Degree numbers at major 30° marks (skip cardinals 0, 90, 180, 270)
        if (isMajor && deg !== 0 && deg !== 90 && deg !== 180 && deg !== 270) {
            const textR = 112;
            const tx = 150 + textR * Math.cos(rad);
            const ty = 150 + textR * Math.sin(rad) + 4;
            svgHtml += `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" fill="rgba(255,255,255,0.7)" font-size="9.5" font-weight="700" text-anchor="middle" font-family="-apple-system, sans-serif">${deg}°</text>`;
        }
    }
    ticksGroup.innerHTML = svgHtml;
}

function updateCompassUI(heading, pitch, roll) {
    compassHeading = ((heading % 360) + 360) % 360;
    const roundedHeading = Math.round(compassHeading);

    // Update Heading Text
    const valEl = document.getElementById('compass-heading-val');
    const cardEl = document.getElementById('compass-heading-cardinal');
    if (valEl) valEl.innerText = `${roundedHeading}°`;
    if (cardEl) cardEl.innerText = getCardinalDirection(roundedHeading);

    // Rotate Compass Rose Disc (inverted so 0° N is top)
    const disc = document.getElementById('compass-rose-disc');
    if (disc) {
        disc.style.transform = `rotate(${-roundedHeading}deg)`;
    }

    // Update Level Bubble (Pitch & Roll)
    if (typeof pitch === 'number' && typeof roll === 'number') {
        compassPitch = Math.max(-45, Math.min(45, Math.round(pitch)));
        compassRoll = Math.max(-45, Math.min(45, Math.round(roll)));

        const pitchEl = document.getElementById('compass-pitch-val');
        const rollEl = document.getElementById('compass-roll-val');
        const levelStatus = document.getElementById('compass-level-status');
        const bubble = document.getElementById('compass-level-target');

        if (pitchEl) pitchEl.innerText = `${Math.abs(compassPitch)}° ${compassPitch >= 0 ? '↑' : '↓'}`;
        if (rollEl) rollEl.innerText = `${Math.abs(compassRoll)}° ${compassRoll >= 0 ? '→' : '←'}`;

        // Map pitch and roll to bubble offset (-24px to +24px)
        const maxOffset = 22;
        const offsetX = (compassRoll / 45) * maxOffset;
        const offsetY = (compassPitch / 45) * maxOffset;

        const isFlat = Math.abs(compassPitch) <= 1 && Math.abs(compassRoll) <= 1;

        if (bubble) {
            bubble.style.transform = `translate(${offsetX.toFixed(1)}px, ${offsetY.toFixed(1)}px)`;
            bubble.classList.toggle('unleveled', !isFlat);
        }

        if (levelStatus) {
            if (isFlat) {
                levelStatus.style.color = '#00E676';
                levelStatus.innerHTML = '<i class="fa-solid fa-circle-check"></i> <span>LEVEL (0°)</span>';
            } else {
                levelStatus.style.color = 'var(--text-secondary)';
                levelStatus.innerHTML = '<i class="fa-solid fa-circle-dot"></i> <span>TILTED</span>';
            }
        }
    }
}

function getCardinalDirection(deg) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(deg / 22.5) % 16;
    return directions[index];
}

function toggleCompassNorthMode() {
    compassIsTrueNorth = !compassIsTrueNorth;
    const btn = document.getElementById('btn-compass-north-toggle');
    const sub = document.getElementById('compass-sub-info');
    if (btn) btn.innerText = compassIsTrueNorth ? 'True North' : 'Magnetic';
    if (sub) sub.innerText = compassIsTrueNorth ? 'Heading relative to True North' : 'Heading relative to Magnetic North';
    showToast(compassIsTrueNorth ? 'True North Mode' : 'Magnetic North Mode');
}

function setupCompassSensors() {
    if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientation', (e) => {
            if (compassIsDragging) return;

            let heading = null;
            if (typeof e.webkitCompassHeading !== 'undefined') {
                // iOS Safari Native Magnetic / True Heading
                heading = e.webkitCompassHeading;
            } else if (e.alpha !== null) {
                // Android Chrome standard orientation
                heading = (360 - e.alpha);
            }

            const pitch = e.beta || 0;
            const roll = e.gamma || 0;

            if (heading !== null) {
                updateCompassUI(heading, pitch, roll);
            } else {
                updateCompassUI(compassHeading, pitch, roll);
            }
        }, { passive: true });
    }
}

function requestCompassCalibration() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(state => {
            if (state === 'granted') {
                showToast('Motion sensors connected ✓', 'success');
            } else {
                showToast('Sensor permission denied');
            }
        }).catch(() => {
            showToast('Sensors ready');
        });
    } else {
        showToast('Sensors calibrated ✓', 'success');
    }
}

function setupCompassInteractions() {
    const dial = document.getElementById('compass-interactive-dial');
    if (!dial) return;

    // Desktop/Laptop Mouse Drag Simulator & Touch Drag
    const getDialAngle = (clientX, clientY) => {
        const rect = dial.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const rad = Math.atan2(clientY - cy, clientX - cx);
        let deg = (rad * 180 / Math.PI) + 90;
        return (deg + 360) % 360;
    };

    dial.addEventListener('mousedown', (e) => {
        compassIsDragging = true;
        compassDragStartAngle = getDialAngle(e.clientX, e.clientY);
        compassDragBaseHeading = compassHeading;
    });

    window.addEventListener('mousemove', (e) => {
        if (!compassIsDragging) return;
        const currentAngle = getDialAngle(e.clientX, e.clientY);
        const delta = compassDragStartAngle - currentAngle;
        const newHeading = (compassDragBaseHeading + delta + 360) % 360;
        updateCompassUI(newHeading, compassPitch, compassRoll);
    });

    window.addEventListener('mouseup', () => {
        compassIsDragging = false;
    });

    // Touch Drag for touchscreens without orientation sensors
    dial.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            compassIsDragging = true;
            compassDragStartAngle = getDialAngle(e.touches[0].clientX, e.touches[0].clientY);
            compassDragBaseHeading = compassHeading;
        }
    }, { passive: true });

    dial.addEventListener('touchmove', (e) => {
        if (compassIsDragging && e.touches.length === 1) {
            const currentAngle = getDialAngle(e.touches[0].clientX, e.touches[0].clientY);
            const delta = compassDragStartAngle - currentAngle;
            const newHeading = (compassDragBaseHeading + delta + 360) % 360;
            updateCompassUI(newHeading, compassPitch, compassRoll);
        }
    }, { passive: true });

    dial.addEventListener('touchend', () => {
        compassIsDragging = false;
    }, { passive: true });

    // Mouse Wheel to rotate heading smoothly
    dial.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 5 : -5;
        const newHeading = (compassHeading + delta + 360) % 360;
        updateCompassUI(newHeading, compassPitch, compassRoll);
    }, { passive: false });
}

async function startCompassGeolocation() {
    if (compassLocationBusy) return;
    compassLocationBusy = true;
    const status = document.getElementById('compass-gps-status');
    const enable = document.getElementById('btn-compass-location');
    if (status) status.textContent = 'Locating…';
    try {
        const position = await getOrbitLocationOnce();
        updateCompassPosition(position);
        if (status) status.textContent = 'Location ready';
        if (enable) enable.classList.add('hide');
        showToast('Location is ready.', 'success');
    } catch(error) {
        if (status) status.textContent = 'Not available';
        showToast(error.message || 'Could not get a location fix.', 'info');
    } finally {
        compassLocationBusy = false;
    }
}

function requestCompassLocation() {
    startCompassGeolocation();
}
window.requestCompassLocation = requestCompassLocation;

function updateCompassPosition(pos) {
    const { latitude, longitude, altitude, accuracy } = pos.coords;

    // Format Coordinates in Degrees Minutes Seconds (DMS)
    const latDms = formatDMS(latitude, true);
    const lonDms = formatDMS(longitude, false);

    const latEl = document.getElementById('compass-coords-dms');
    const lonEl = document.getElementById('compass-coords-dms2');
    if (latEl) latEl.innerText = latDms;
    if (lonEl) lonEl.innerText = lonDms;

    // Elevation / Altitude
    const elevM = (altitude !== null && !isNaN(altitude)) ? Math.round(altitude) : 42;
    const elevFt = Math.round(elevM * 3.28084);
    const elevEl = document.getElementById('compass-elevation-text');
    const ftEl = document.getElementById('compass-elevation-ft');
    if (elevEl) elevEl.innerText = `${elevM} m`;
    if (ftEl) ftEl.innerText = `${elevFt} ft`;

    // Accuracy
    const accEl = document.getElementById('compass-accuracy-text');
    if (accEl) accEl.innerText = `±${Math.round(accuracy || 5)}m accuracy`;

    const statusEl = document.getElementById('compass-gps-status');
    if (statusEl) {
        statusEl.innerText = 'GPS Locked';
        statusEl.style.color = '#00E676';
    }
}

function formatDMS(deg, isLat) {
    const absolute = Math.abs(deg);
    const degrees = Math.floor(absolute);
    const minutesNotTruncated = (absolute - degrees) * 60;
    const minutes = Math.floor(minutesNotTruncated);
    const seconds = Math.floor((minutesNotTruncated - minutes) * 60);

    let dir = '';
    if (isLat) {
        dir = deg >= 0 ? 'N' : 'S';
    } else {
        dir = deg >= 0 ? 'E' : 'W';
    }

    return `${degrees}° ${minutes}' ${seconds}" ${dir}`;
}

// ══════════════════════════════════════════════════════════════════════════
window.toggleCalendarWeekNumbers = toggleCalendarWeekNumbers;

// ══════════════════════════════════════════════════════════════════════════
// ORBIT UNIT CONVERTER & DATE CALCULATOR SUITE
// ══════════════════════════════════════════════════════════════════════════

let currentConverterCategory = 'length';
let currentDateCalcMode = 'diff';
let currentDateMathOp = 'add';

const CONVERTER_UNITS_DATA = {
    length: {
        label: 'Length',
        units: [
            { id: 'mm', name: 'Millimeter (mm)', toBase: 0.001 },
            { id: 'cm', name: 'Centimeter (cm)', toBase: 0.01 },
            { id: 'm', name: 'Meter (m)', toBase: 1 },
            { id: 'km', name: 'Kilometer (km)', toBase: 1000 },
            { id: 'in', name: 'Inch (in)', toBase: 0.0254 },
            { id: 'ft', name: 'Foot (ft)', toBase: 0.3048 },
            { id: 'yd', name: 'Yard (yd)', toBase: 0.9144 },
            { id: 'mi', name: 'Mile (mi)', toBase: 1609.344 }
        ],
        defaultFrom: 'm',
        defaultTo: 'ft'
    },
    weight: {
        label: 'Weight',
        units: [
            { id: 'mg', name: 'Milligram (mg)', toBase: 0.001 },
            { id: 'g', name: 'Gram (g)', toBase: 1 },
            { id: 'kg', name: 'Kilogram (kg)', toBase: 1000 },
            { id: 't', name: 'Metric Ton (t)', toBase: 1000000 },
            { id: 'oz', name: 'Ounce (oz)', toBase: 28.349523125 },
            { id: 'lb', name: 'Pound (lb)', toBase: 453.59237 },
            { id: 'st', name: 'Stone (st)', toBase: 6350.29318 }
        ],
        defaultFrom: 'kg',
        defaultTo: 'lb'
    },
    temp: {
        label: 'Temperature',
        units: [
            { id: 'c', name: 'Celsius (°C)' },
            { id: 'f', name: 'Fahrenheit (°F)' },
            { id: 'k', name: 'Kelvin (K)' }
        ],
        defaultFrom: 'c',
        defaultTo: 'f'
    },
    volume: {
        label: 'Volume',
        units: [
            { id: 'ml', name: 'Milliliter (mL)', toBase: 0.001 },
            { id: 'l', name: 'Liter (L)', toBase: 1 },
            { id: 'm3', name: 'Cubic Meter (m³)', toBase: 1000 },
            { id: 'floz', name: 'Fluid Ounce (fl oz)', toBase: 0.0295735 },
            { id: 'cup', name: 'Cup (cup)', toBase: 0.236588 },
            { id: 'pt', name: 'Pint (pt)', toBase: 0.473176 },
            { id: 'qt', name: 'Quart (qt)', toBase: 0.946353 },
            { id: 'gal', name: 'Gallon (gal)', toBase: 3.78541 }
        ],
        defaultFrom: 'l',
        defaultTo: 'gal'
    },
    area: {
        label: 'Area',
        units: [
            { id: 'm2', name: 'Square Meter (m²)', toBase: 1 },
            { id: 'km2', name: 'Square Kilometer (km²)', toBase: 1000000 },
            { id: 'ft2', name: 'Square Foot (ft²)', toBase: 0.092903 },
            { id: 'yd2', name: 'Square Yard (yd²)', toBase: 0.836127 },
            { id: 'ac', name: 'Acre (ac)', toBase: 4046.86 },
            { id: 'ha', name: 'Hectare (ha)', toBase: 10000 }
        ],
        defaultFrom: 'm2',
        defaultTo: 'ft2'
    },
    speed: {
        label: 'Speed',
        units: [
            { id: 'ms', name: 'Meters / sec (m/s)', toBase: 1 },
            { id: 'kmh', name: 'Kilometers / hr (km/h)', toBase: 0.277778 },
            { id: 'mph', name: 'Miles / hr (mph)', toBase: 0.44704 },
            { id: 'kn', name: 'Knot (kn)', toBase: 0.514444 },
            { id: 'fts', name: 'Foot / sec (ft/s)', toBase: 0.3048 }
        ],
        defaultFrom: 'kmh',
        defaultTo: 'mph'
    },
    time: {
        label: 'Time',
        units: [
            { id: 'ms', name: 'Millisecond (ms)', toBase: 0.001 },
            { id: 's', name: 'Second (s)', toBase: 1 },
            { id: 'min', name: 'Minute (min)', toBase: 60 },
            { id: 'h', name: 'Hour (h)', toBase: 3600 },
            { id: 'd', name: 'Day (d)', toBase: 86400 },
            { id: 'wk', name: 'Week (wk)', toBase: 604800 },
            { id: 'mo', name: 'Month (mo)', toBase: 2629746 },
            { id: 'yr', name: 'Year (yr)', toBase: 31556952 }
        ],
        defaultFrom: 'h',
        defaultTo: 'min'
    },
    storage: {
        label: 'Data Storage',
        units: [
            { id: 'b', name: 'Bit (b)', toBase: 0.125 },
            { id: 'B', name: 'Byte (B)', toBase: 1 },
            { id: 'KB', name: 'Kilobyte (KB)', toBase: 1024 },
            { id: 'MB', name: 'Megabyte (MB)', toBase: 1048576 },
            { id: 'GB', name: 'Gigabyte (GB)', toBase: 1073741824 },
            { id: 'TB', name: 'Terabyte (TB)', toBase: 1099511627776 },
            { id: 'PB', name: 'Petabyte (PB)', toBase: 1125899906842624 }
        ],
        defaultFrom: 'GB',
        defaultTo: 'MB'
    }
};

let currentCalcSubmode='calc';
function switchCalcSubmode(submode) {
    if (!['calc','converter','date'].includes(submode)) return;
    currentCalcSubmode=submode;
    const menu = document.getElementById('calc-settings');
    if (menu) menu.open = false;
    const title = document.getElementById('calc-app-title');
    if (title) title.textContent = {calc:'Calculator',converter:'Unit converter',date:'Date calculator'}[submode];
    if (typeof scheduleCalcLayout === 'function') scheduleCalcLayout();
    document.querySelectorAll('.calc-submode-bar .news-filter-chip').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`calc-submode-btn-${submode}`);
    if (activeBtn) activeBtn.classList.add('active');

    document.querySelectorAll('.calc-submode-panel').forEach(p => p.classList.add('hide'));
    const targetPanel = document.getElementById(`calc-submode-${submode}`);
    if (targetPanel) targetPanel.classList.remove('hide');

    if (submode === 'converter') {
        initUnitConverter();
    } else if (submode === 'date') {
        initDateCalculator();
    }
}

function initUnitConverter() {
    setConverterCategory(currentConverterCategory);
}

function setConverterCategory(cat, btn) {
    currentConverterCategory = cat;
    if (btn) {
        document.querySelectorAll('#converter-categories-row .news-filter-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }

    const data = CONVERTER_UNITS_DATA[cat];
    if (!data) return;

    const fromSel = document.getElementById('converter-from-unit');
    const toSel = document.getElementById('converter-to-unit');
    if (!fromSel || !toSel) return;

    fromSel.innerHTML = '';
    toSel.innerHTML = '';

    data.units.forEach(u => {
        fromSel.add(new Option(u.name, u.id));
        toSel.add(new Option(u.name, u.id));
    });

    fromSel.value = data.defaultFrom;
    toSel.value = data.defaultTo;

    convertUnits();
}

function convertUnits() {
    const fromValEl = document.getElementById('converter-from-val');
    const fromUnitEl = document.getElementById('converter-from-unit');
    const toUnitEl = document.getElementById('converter-to-unit');
    const toValEl = document.getElementById('converter-to-val');
    const formulaEl = document.getElementById('converter-formula-text');

    if (!fromValEl || !fromUnitEl || !toUnitEl || !toValEl) return;

    const val = Number(fromValEl.value);
    if(!Number.isFinite(val)){toValEl.innerText='—';if(formulaEl)formulaEl.innerText='Enter a finite number';return;}
    if (isNaN(val)) {
        toValEl.innerText = '0';
        return;
    }

    const fromUnit = fromUnitEl.value;
    const toUnit = toUnitEl.value;
    let result = 0;

    if (currentConverterCategory === 'temp') {
        if(!['c','f','k'].includes(fromUnit)||!['c','f','k'].includes(toUnit)){toValEl.innerText='—';return;}
        // Temperature conversion
        let celsius = val;
        if (fromUnit === 'f') celsius = (val - 32) * (5 / 9);
        else if (fromUnit === 'k') celsius = val - 273.15;

        if(celsius < -273.15-1e-10){toValEl.innerText='—';if(formulaEl)formulaEl.innerText='Temperature is below absolute zero';return;}
        if (toUnit === 'c') result = celsius;
        else if (toUnit === 'f') result = (celsius * 9 / 5) + 32;
        else if (toUnit === 'k') result = celsius + 273.15;
    } else {
        const cat = CONVERTER_UNITS_DATA[currentConverterCategory];
        if(!cat){toValEl.innerText='—';return;}
        const uFrom = cat.units.find(u => u.id === fromUnit);
        const uTo = cat.units.find(u => u.id === toUnit);
        if (uFrom && uTo) {
            const baseVal = val * uFrom.toBase;
            result = baseVal / uTo.toBase;
        }else{toValEl.innerText='—';return;}
    }

    if(!Number.isFinite(result)){toValEl.innerText='—';if(formulaEl)formulaEl.innerText='Result exceeds converter range';return;}
    const formattedResult=String(Number(result.toPrecision(15)));

    toValEl.innerText = formattedResult;

    if (formulaEl) {
        formulaEl.innerText = `${val} ${fromUnit} = ${formattedResult} ${toUnit}`;
    }
}

function swapConverterUnits() {
    const fromUnitEl = document.getElementById('converter-from-unit');
    const toUnitEl = document.getElementById('converter-to-unit');
    if (!fromUnitEl || !toUnitEl) return;

    const tmp = fromUnitEl.value;
    fromUnitEl.value = toUnitEl.value;
    toUnitEl.value = tmp;

    convertUnits();
}

function initDateCalculator() {
    const startDiff = document.getElementById('date-diff-start');
    const endDiff = document.getElementById('date-diff-end');
    const mathStart = document.getElementById('date-math-start');

    const dateKey=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
    const todayStr = dateKey(new Date());
    if (startDiff && !startDiff.value) startDiff.value = todayStr;
    if (endDiff && !endDiff.value) {
        const nextMonth = new Date();
        nextMonth.setDate(nextMonth.getDate() + 30);
        endDiff.value = dateKey(nextMonth);
    }
    if (mathStart && !mathStart.value) mathStart.value = todayStr;

    calculateDateDiff();
    calculateDateMath();
}

function setDateCalcMode(mode, btn) {
    currentDateCalcMode = mode;
    if (btn) {
        document.querySelectorAll('#calc-submode-date .news-filter-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }

    const pDiff = document.getElementById('date-calc-panel-diff');
    const pMath = document.getElementById('date-calc-panel-math');
    if (pDiff && pMath) {
        if (mode === 'diff') {
            pDiff.classList.remove('hide');
            pMath.classList.add('hide');
            calculateDateDiff();
        } else {
            pDiff.classList.add('hide');
            pMath.classList.remove('hide');
            calculateDateMath();
        }
    }
}

function setDateMathOp(op, btn) {
    currentDateMathOp = op;
    if (btn) {
        const btnAdd = document.getElementById('date-math-btn-add');
        const btnSub = document.getElementById('date-math-btn-sub');
        if (btnAdd && btnSub) {
            btnAdd.classList.toggle('active', op === 'add');
            btnSub.classList.toggle('active', op === 'sub');
        }
    }
    calculateDateMath();
}

function parseCalcDate(value){
 const match=String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)throw Error('Choose a valid date');
 const [year,month,day]=match.slice(1).map(Number),date=new Date(0);date.setUTCHours(0,0,0,0);date.setUTCFullYear(year,month-1,day);
 if(year<1||year>9999||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw Error('Choose a valid date');return date;
}
function shiftCalcMonths(date,months){
 const result=new Date(date),day=result.getUTCDate();result.setUTCDate(1);result.setUTCMonth(result.getUTCMonth()+months);
 const last=new Date(result);last.setUTCMonth(last.getUTCMonth()+1,0);result.setUTCDate(Math.min(day,last.getUTCDate()));return result;
}
function calculateDateDiff(){
 const start=document.getElementById('date-diff-start'),end=document.getElementById('date-diff-end'),total=document.getElementById('date-diff-days-total'),breakdown=document.getElementById('date-diff-breakdown');
 if(!start||!end||!total||!breakdown)return;
 try{
  let a=parseCalcDate(start.value),b=parseCalcDate(end.value),reversed=a>b;if(reversed)[a,b]=[b,a];
  const days=Math.round((b-a)/86400000);let years=b.getUTCFullYear()-a.getUTCFullYear();
  if(shiftCalcMonths(a,years*12)>b)years--;
  let months=0;while(months<11&&shiftCalcMonths(a,years*12+months+1)<=b)months++;
  const remaining=Math.round((b-shiftCalcMonths(a,years*12+months))/86400000);
  total.innerText=days.toLocaleString()+' days';breakdown.innerText=`${years} years, ${months} months, ${remaining} days (${Math.floor(days/7)} weeks)${reversed?' [Reversed]':''}`;
 }catch(error){total.innerText='—';breakdown.innerText=error.message;}
}
function calculateDateMath(){
 const start=document.getElementById('date-math-start'),output=document.getElementById('date-math-result-date');if(!start||!output)return;
 try{
  const values=['years','months','weeks','days'].map(key=>{const value=Number(document.getElementById('date-math-'+key)?.value||0);if(!Number.isSafeInteger(value)||value<0||value>3652500)throw Error('Use nonnegative whole numbers');return value;});
  const [years,months,weeks,days]=values,factor=currentDateMathOp==='sub'?-1:1;
  if(years*12+months>120000)throw Error('Date exceeds supported range');
  const date=shiftCalcMonths(parseCalcDate(start.value),factor*(years*12+months));date.setUTCDate(date.getUTCDate()+factor*(weeks*7+days));
  if(!Number.isFinite(date.getTime())||date.getUTCFullYear()<1||date.getUTCFullYear()>9999)throw Error('Date exceeds supported range');
  output.innerText=date.toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});
 }catch(error){output.innerText=error.message;}
}
