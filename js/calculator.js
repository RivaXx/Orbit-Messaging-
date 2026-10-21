// ========================================================================
// ORBIT MESSENGER - CALCULATOR SUITE MODULE (js/calculator.js)
// ========================================================================

// ══════════════════════════════════════════════════════════════════════════
// PRO iOS & VISIONOS CALCULATOR
// ══════════════════════════════════════════════════════════════════════════
let calcCurrentVal = '0';
let calcExpression = '';
let isCalcResultShown = false;
let calcMemory = 0;
let calcPreviewEnabled=localStorage.getItem('orbit_calc_preview')!=='false';
function toggleCalcPreview(){calcPreviewEnabled=!calcPreviewEnabled;try{localStorage.setItem('orbit_calc_preview',String(calcPreviewEnabled));}catch(_){}updateCalcDisplay();}
function updateCalcAnswerPreview(){
 const output=document.getElementById('calc-answer-preview'),button=document.getElementById('calc-preview-toggle');
 button?.setAttribute('aria-pressed',String(calcPreviewEnabled));
 if(button)button.textContent=calcPreviewEnabled?'Live preview: On':'Live preview: Off';
 if(!output)return;output.textContent='';
 if(!calcPreviewEnabled||isCalcResultShown||!calcExpression||calcCurrentVal==='Error')return;
 try{const expression=calcCurrentVal==='0' && /[%) ]$/.test(calcExpression.trim())?calcExpression.trim():`${calcExpression} ${calcCurrentVal}`;const value=evaluateCalcExpression(expression);if(Number.isFinite(value))output.textContent='= '+String(Math.round(value*100000000)/100000000);}catch(_){}
}

let calcHistory = (() => {
    try {
        const stored = localStorage.getItem('orbit_calc_history');
        if (stored) return JSON.parse(stored);
    } catch(e) {}
    return [];
})();

let calcFontScale = Math.max(-2, Math.min(2, parseInt(localStorage.getItem('orbit_calc_fontscale') || '0', 10) || 0));
let calcIsBold = localStorage.getItem('orbit_calc_bold') === 'true';
let calcIsFitScreen = localStorage.getItem('orbit_calc_fitscreen') !== 'false';

function initCalculator() {
    // Restore theme
    const savedTheme = localStorage.getItem('orbit_calc_theme') || 'classic';
    setCalcTheme(savedTheme);
    applyCalcFontSettings();
    applyCalcFitSettings();
    applyCalcKeypadLayout();
    updateCalcDisplay();
    renderCalcHistory();
    initCalcAppearance();
}

function adjustCalcFontSize(dir) {
    calcFontScale = Math.max(-2, Math.min(2, calcFontScale + dir));
    try { localStorage.setItem('orbit_calc_fontscale', calcFontScale); } catch(e) {}
    applyCalcFontSettings();
    const labels = { '-2': 'Extra Small (XS)', '-1': 'Small (S)', '0': 'Default (M)', '1': 'Large (L)', '2': 'Extra Large (XL)' };
    if (typeof showToast === 'function') showToast(`Text Size: ${labels[calcFontScale] || 'Normal'}`);
}

function toggleCalcFontBold() {
    calcIsBold = !calcIsBold;
    try { localStorage.setItem('orbit_calc_bold', calcIsBold); } catch(e) {}
    applyCalcFontSettings();
    if (typeof showToast === 'function') showToast(calcIsBold ? 'Bold Numbers: ON' : 'Normal Numbers: ON');
}

function applyCalcFontSettings() {
    const wrapper = document.getElementById('calc-theme-wrapper');
    const boldBtn = document.getElementById('calc-bold-btn');
    if (!wrapper) return;
    wrapper.classList.remove('calc-font-xs', 'calc-font-sm', 'calc-font-md', 'calc-font-lg', 'calc-font-xl', 'calc-font-normal', 'calc-font-bold');

    if (calcFontScale === -2) wrapper.classList.add('calc-font-xs');
    else if (calcFontScale === -1) wrapper.classList.add('calc-font-sm');
    else if (calcFontScale === 1) wrapper.classList.add('calc-font-lg');
    else if (calcFontScale === 2) wrapper.classList.add('calc-font-xl');
    else wrapper.classList.add('calc-font-md');

    if (calcIsBold) {
        wrapper.classList.add('calc-font-bold');
    } else {
        wrapper.classList.add('calc-font-normal');
    }

    const sizes = ['XS', 'S', 'M', 'L', 'XL'];
    const label = document.getElementById('calc-font-label');
    if (label) label.textContent = sizes[calcFontScale + 2];
    const smaller = document.getElementById('calc-font-smaller');
    const larger = document.getElementById('calc-font-larger');
    if (smaller) smaller.disabled = calcFontScale === -2;
    if (larger) larger.disabled = calcFontScale === 2;
    if (boldBtn) {
        boldBtn.setAttribute('aria-pressed', String(calcIsBold));
        boldBtn.style.color = calcIsBold ? 'var(--accent)' : 'var(--text-primary)';
        boldBtn.style.background = calcIsBold ? 'rgba(255,215,0,0.25)' : 'rgba(255,255,255,0.08)';
        boldBtn.style.borderColor = calcIsBold ? 'var(--accent)' : 'rgba(255,255,255,0.15)';
    }
}

function toggleCalcFitScreen() {
    calcIsFitScreen = !calcIsFitScreen;
    try { localStorage.setItem('orbit_calc_fitscreen', calcIsFitScreen); } catch(e) {}
    applyCalcFitSettings();
    if (typeof showToast === 'function') showToast(calcIsFitScreen ? 'Fit View Enabled (Full Screen)' : 'Normal View Enabled');
}

function applyCalcFitSettings() {
    const tab = document.getElementById('tab-calculator');
    const wrapper = document.getElementById('calc-theme-wrapper');
    const btn = document.getElementById('calc-fit-btn');
    const label = document.getElementById('calc-fit-btn-label');
    if (tab) tab.classList.toggle('calc-fit-mode', calcIsFitScreen);
    scheduleCalcLayout();
    if (!wrapper) return;
    if (calcIsFitScreen) {
        wrapper.classList.add('calc-fit-screen');
        if (btn) {
            btn.classList.add('active');
            btn.style.background = 'rgba(255,215,0,0.15)';
            btn.style.borderColor = 'rgba(255,215,0,0.4)';
            btn.style.color = 'var(--accent)';
        }
        if (label) label.innerText = 'Full screen';
    } else {
        wrapper.classList.remove('calc-fit-screen');
        if (btn) {
            btn.classList.remove('active');
            btn.style.background = 'rgba(255,255,255,0.08)';
            btn.style.borderColor = 'var(--glass-border)';
            btn.style.color = 'var(--text-secondary)';
        }
        if (label) label.innerText = 'Use full screen';
    }
}

function setCalcTheme(theme) {
    const wrapper = document.getElementById('calc-theme-wrapper');
    const btnClassic = document.getElementById('calc-theme-btn-classic');
    const btnGlass = document.getElementById('calc-theme-btn-glass');

    if (theme === 'glass') {
        if (wrapper) wrapper.classList.add('calc-theme-glass');
        if (btnGlass) btnGlass.classList.add('active');
        if (btnClassic) btnClassic.classList.remove('active');
    } else {
        if (wrapper) wrapper.classList.remove('calc-theme-glass');
        if (btnClassic) btnClassic.classList.add('active');
        if (btnGlass) btnGlass.classList.remove('active');
    }
    try { localStorage.setItem('orbit_calc_theme', theme); } catch(e) {}
}

function highlightCalcButton(btnId) {
    const btn = document.getElementById(btnId);
    if (btn) {
        btn.classList.add('calc-key-pressed');
        setTimeout(() => btn.classList.remove('calc-key-pressed'), 140);
    }
}

function updateCalcDisplay() {
    updateCalcAnswerPreview();
    const exprEl = document.getElementById('calc-expr-display');
    const valEl = document.getElementById('calc-val-display');
    if (exprEl) exprEl.innerText = calcExpression;
    if (valEl) {
        valEl.innerText = calcCurrentVal;
        // Let the chosen size apply; shrink only values that would overflow.
        valEl.style.fontSize = '';
        valEl.style.setProperty?.('--calc-value-fit', String(Math.min(1, 7 / Math.max(7, calcCurrentVal.length))));
    }
}

function applyCalcKeypadLayout() {
    const zeroInMiddle = localStorage.getItem('orbit_calc_zero_middle') !== 'false';
    const showSeparateAc = localStorage.getItem('orbit_calc_show_ac') !== 'false';

    const btn0 = document.getElementById('calc-btn-0');
    const btnDot = document.getElementById('calc-btn-dot');
    const btnPm = document.getElementById('calc-btn-pm');
    const btnEq = document.getElementById('calc-btn-eq');
    const btnAc = document.getElementById('calc-btn-ac');

    if (btn0 && btnDot && btnPm && btnEq) {
        if (zeroInMiddle) {
            // Zero in the middle: ± (17), 0 (18), . (19), = (20)
            btnPm.style.order = '17';
            btn0.style.order = '18';
            btnDot.style.order = '19';
            btnEq.style.order = '20';
        } else {
            // Standard: 0 (17), . (18), ± (19), = (20)
            btn0.style.order = '17';
            btnDot.style.order = '18';
            btnPm.style.order = '19';
            btnEq.style.order = '20';
        }
    }

    if (btnAc) {
        btnAc.innerText = showSeparateAc ? 'AC' : 'C';
    }
}

function evaluateCalcExpression(rawExpr) {
    if (!rawExpr || !rawExpr.trim()) return 0;
    let expr = rawExpr.trim();

    // 1. Handle X + Y% or X - Y% (e.g. "100 + 20%" -> "100 + ((100 * 20) / 100)")
    expr = expr.replace(/(\d+(?:\.\d+)?)\s*([+\-])\s*(\d+(?:\.\d+)?)%/g, (match, a, op, b) => {
        return `${a} ${op} ((${a} * ${b}) / 100)`;
    });

    // 2. Handle X * Y% or X / Y% (e.g. "100 * 20%" -> "100 * (20 / 100)")
    expr = expr.replace(/(\d+(?:\.\d+)?)\s*([*/])\s*(\d+(?:\.\d+)?)%/g, (match, a, op, b) => {
        return `${a} ${op} (${b} / 100)`;
    });

    // 3. Handle binary X % Y (e.g. "80 % 3" -> "((80 / 100) * 3)")
    expr = expr.replace(/(\d+(?:\.\d+)?)\s*%\s*(\d+(?:\.\d+)?)/g, (match, a, b) => {
        return `((${a} / 100) * ${b})`;
    });

    // 4. Handle standalone X% (e.g. "80%" -> "(80 / 100)")
    expr = expr.replace(/(\d+(?:\.\d+)?)%/g, (match, a) => {
        return `(${a} / 100)`;
    });

    // 5. Replace ^ with ** for exponentiation
    expr = expr.replace(/\^/g, '**');

    // 6. Sanitize remaining characters: only allow 0-9 + - * / . ( )
    const sanitized = expr.replace(/[^0-9+\-*/().]/g, '');
    const result = Function(`'use strict'; return (${sanitized})`)();
    return result;
}

function calcInput(val) {
    if (val === 'AC') {
        calcCurrentVal = '0';
        calcExpression = '';
        isCalcResultShown = false;
    } else if (val === 'BACKSPACE') {
        if (isCalcResultShown || calcCurrentVal === 'Error') {
            calcCurrentVal = '0';
            isCalcResultShown = false;
        } else if (calcCurrentVal.length > 1) {
            calcCurrentVal = calcCurrentVal.slice(0, -1);
        } else {
            calcCurrentVal = '0';
        }
    } else if (val === '+/-') {
        if (calcCurrentVal !== '0') {
            calcCurrentVal = calcCurrentVal.startsWith('-') ? calcCurrentVal.slice(1) : `-${calcCurrentVal}`;
        }
    } else if (val === '%') {
        if (calcExpression && /[+\-*/]\s*$/.test(calcExpression.trim())) {
            calcCurrentVal = `${calcCurrentVal}%`;
        } else {
            calcExpression = `${calcCurrentVal} %`;
            calcCurrentVal = '0';
            isCalcResultShown = false;
        }
    } else if (['+', '-', '*', '/'].includes(val)) {
        calcExpression = `${calcExpression} ${calcCurrentVal} ${val}`;
        calcCurrentVal = '0';
        isCalcResultShown = false;
    } else if (val === '(' || val === ')') {
        if (val === '(') {
            calcExpression = `${calcExpression} (`;
        } else {
            calcExpression = `${calcExpression} ${calcCurrentVal} )`;
            calcCurrentVal = '0';
        }
    } else if (val === '=') {
        if (!calcExpression && !calcCurrentVal) return;
        try {
            let fullExpr = '';
            if (calcCurrentVal === '0' && calcExpression.trim().endsWith('%')) {
                fullExpr = calcExpression.trim();
            } else if (calcExpression) {
                fullExpr = `${calcExpression} ${calcCurrentVal}`.trim();
            } else {
                fullExpr = calcCurrentVal.trim();
            }

            const result = evaluateCalcExpression(fullExpr);
            const formattedResult = String(Math.round(result * 100000000) / 100000000);

            calcHistory.unshift({ expr: fullExpr, result: formattedResult, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
            if (calcHistory.length > 30) calcHistory.pop();
            try { localStorage.setItem('orbit_calc_history', JSON.stringify(calcHistory)); } catch(e) {}
            renderCalcHistory();

            calcExpression = '';
            calcCurrentVal = formattedResult;
            isCalcResultShown = true;
        } catch(e) {
            calcCurrentVal = 'Error';
            isCalcResultShown = true;
        }
    } else if (val === '.') {
        if (!calcCurrentVal.includes('.')) {
            calcCurrentVal += '.';
        }
    } else {
        if (calcCurrentVal === '0' || isCalcResultShown) {
            calcCurrentVal = val;
            isCalcResultShown = false;
        } else {
            if (calcCurrentVal.length < 14) {
                calcCurrentVal += val;
            }
        }
    }
    updateCalcDisplay();
}

function calcSciOp(op) {
    const num = parseFloat(calcCurrentVal) || 0;
    let res = 0;
    switch(op) {
        case 'mc':
            calcMemory = 0;
            showToast('Memory Cleared');
            return;
        case 'mr':
            calcCurrentVal = String(calcMemory);
            isCalcResultShown = false;
            updateCalcDisplay();
            showToast(`MR: ${calcMemory}`);
            return;
        case 'm+':
            calcMemory += num;
            showToast(`M+: ${calcMemory}`);
            return;
        case 'm-':
            calcMemory -= num;
            showToast(`M−: ${calcMemory}`);
            return;
        case 'pow':
            calcExpression = `${calcExpression} ${calcCurrentVal} ^`;
            calcCurrentVal = '0';
            isCalcResultShown = false;
            updateCalcDisplay();
            return;
        case 'inv':
            if (num === 0) { calcCurrentVal = 'Error'; }
            else { calcCurrentVal = String(Math.round((1 / num) * 100000000) / 100000000); }
            isCalcResultShown = true;
            updateCalcDisplay();
            return;
        case 'sin': res = Math.sin(num); break;
        case 'cos': res = Math.cos(num); break;
        case 'tan': res = Math.tan(num); break;
        case 'pi': res = Math.PI; break;
        case 'sqrt': res = Math.sqrt(num); break;
        case 'sq': res = Math.pow(num, 2); break;
        case 'log': res = Math.log10(num); break;
        case 'ln': res = Math.log(num); break;
        default: return;
    }
    calcCurrentVal = String(Math.round(res * 100000000) / 100000000);
    isCalcResultShown = true;
    updateCalcDisplay();
}

function toggleCalcScientific() {
    const drawer = document.getElementById('calc-sci-drawer');
    const label = document.getElementById('calc-sci-label');
    if (drawer) {
        drawer.classList.toggle('active');
        const isActive = drawer.classList.contains('active');
        if (label) label.innerText = isActive ? 'Standard Mode' : 'Scientific Mode';
    }
}

function toggleCalcHistory() {
    const box = document.getElementById('calc-history-box');
    if (box) {
        box.style.display = box.style.display === 'none' ? 'block' : 'none';
    }
}

// ── Desktop & Laptop Keyboard Typing Listener for Calculator ──
document.addEventListener('keydown', (e) => {
    const tabCalc = document.getElementById('tab-calculator');
    if (!tabCalc || tabCalc.classList.contains('hide')) return;
    // Don't intercept when user is typing in a real text input/textarea
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

    const key = e.key;
    const settings = document.getElementById('calc-settings');
    if (settings?.open) {
        if (key === 'Escape') { settings.open = false; settings.querySelector('summary')?.focus(); e.preventDefault(); }
        return;
    }
    if (/^[0-9]$/.test(key)) {
        e.preventDefault();
        calcInput(key);
        highlightCalcButton(`calc-btn-${key}`);
    } else if (key === '+' || key === '-' || key === '*' || key === '/') {
        e.preventDefault();
        calcInput(key);
        const map = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' };
        highlightCalcButton(`calc-btn-${map[key]}`);
    } else if (key === 'Enter' || key === '=') {
        e.preventDefault();
        calcInput('=');
        highlightCalcButton('calc-btn-eq');
    } else if (key === 'Backspace') {
        e.preventDefault();
        calcInput('BACKSPACE');
        highlightCalcButton('calc-btn-backspace');
    } else if (key === 'Escape' || key.toLowerCase() === 'c') {
        e.preventDefault();
        calcInput('AC');
        highlightCalcButton('calc-btn-ac');
    } else if (key === '.' || key === ',') {
        e.preventDefault();
        calcInput('.');
        highlightCalcButton('calc-btn-dot');
    } else if (key === '%') {
        e.preventDefault();
        calcInput('%');
        highlightCalcButton('calc-btn-percent');
    } else if (key === '(' || key === ')') {
        e.preventDefault();
        calcInput(key);
    }
});

function renderCalcHistory() {
    const list = document.getElementById('calc-history-list');
    if (!list) return;
    if (calcHistory.length === 0) {
        list.innerHTML = '<div style="color:var(--text-muted); font-size:11px;">No history yet</div>';
        return;
    }
    list.innerHTML = calcHistory.slice(0, 10).map(h => `
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:4px;">
            <span style="color:var(--text-secondary);">${escapeHtml(h.expr)}</span>
            <span style="color:var(--accent); font-weight:700;">= ${escapeHtml(h.result)}</span>
        </div>
    `).join('');
}

function clearCalcHistory() {
    calcHistory = [];
    try { localStorage.removeItem('orbit_calc_history'); } catch(e) {}
    renderCalcHistory();
}



// Measure the available keypad area; equal width and height keep every key circular.
let calcLayoutObserver = null;
let calcLayoutFrame = null;
function scheduleCalcLayout() {
    cancelAnimationFrame(calcLayoutFrame);
    calcLayoutFrame = requestAnimationFrame(() => {
        const keypad = document.getElementById('calc-main-keypad');
        const tab = document.getElementById('tab-calculator');
        if (!keypad || !calcIsFitScreen || tab?.classList.contains('hide')) return;
        const gap = parseFloat(getComputedStyle(keypad).gap) || 6;
        const diameter = Math.max(0, Math.floor(Math.min((keypad.clientWidth - gap * 3) / 4, (keypad.clientHeight - gap * 4) / 5)));
        keypad.style.setProperty('--calc-key-size', `${diameter}px`);
    });
}
function initCalcAppearance() {
    const keypad = document.getElementById('calc-main-keypad');
    const wrapper = document.getElementById('calc-theme-wrapper');
    if (!calcLayoutObserver && window.ResizeObserver && keypad && wrapper) {
        calcLayoutObserver = new ResizeObserver(scheduleCalcLayout);
        calcLayoutObserver.observe(keypad);
        calcLayoutObserver.observe(wrapper);
        window.addEventListener('resize', scheduleCalcLayout);
    }
    const input = document.getElementById('calc-wallpaper-input');
    if (input && !input.dataset.bound) {
        input.dataset.bound = 'true';
        input.addEventListener('change', saveCalcWallpaper);
    }
    const revision=calcWallpaperRevision;
    restoreCalcWallpaper(revision);
    scheduleCalcLayout();
}
function chooseCalcWallpaper() {
    const input = document.getElementById('calc-wallpaper-input');
    if (!input) return;
    // Bind at the point of use too, including when settings open before init.
    if (!input.dataset.bound) {
        input.dataset.bound = 'true';
        input.addEventListener('change', saveCalcWallpaper);
    }
    input.click();
}
function applyCalcWallpaper(data) {
    const tab = document.getElementById('tab-calculator');
    if (!tab) return;
    const valid = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(data);
    tab.style.setProperty('--calc-wallpaper', valid ? `url("${data}")` : 'none');
    tab.classList.toggle('calc-has-wallpaper', valid);
    document.getElementById('calc-wallpaper-clear')?.classList.toggle('hide', !valid);
}
// IndexedDB has a separate, larger quota and stores images without bloating chat preferences.
let calcImageDB=null,calcImageWrites=Promise.resolve();
function calcWallpaperDB(){
    if(typeof indexedDB==='undefined')return Promise.reject(new Error('Image storage unavailable'));
    if(!calcImageDB)calcImageDB=new Promise((resolve,reject)=>{
        const request=indexedDB.open('orbit-calculator-images',1);
        const timer=setTimeout(()=>reject(new Error('Image storage unavailable')),3000);
        request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('images'))request.result.createObjectStore('images');};
        request.onsuccess=()=>{clearTimeout(timer);resolve(request.result);};
        request.onerror=request.onblocked=()=>{clearTimeout(timer);reject(new Error('Image storage unavailable'));};
    }).catch(error=>{calcImageDB=null;throw error;});
    return calcImageDB;
}
async function calcWallpaperStorage(action,value){
    const execute=async()=>{
        const db=await calcWallpaperDB();
        return new Promise((resolve,reject)=>{
            const tx=db.transaction('images',action==='get'?'readonly':'readwrite'),store=tx.objectStore('images');
            const request=action==='get'?store.get('wallpaper'):action==='delete'?store.delete('wallpaper'):store.put(value,'wallpaper');
            tx.oncomplete=()=>resolve(request.result);tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Image storage unavailable'));
        });
    };
    const result=calcImageWrites.then(execute,execute);calcImageWrites=result.catch(()=>{});return result;
}
async function restoreCalcWallpaper(revision){
    let legacy='';try{legacy=localStorage.getItem('orbit_calc_wallpaper')||'';}catch(_){}
    try{
        const image=await calcWallpaperStorage('get');
        if(revision!==calcWallpaperRevision)return;
        applyCalcWallpaper(legacy||image);
        if(legacy){await calcWallpaperStorage('put',legacy);if(revision===calcWallpaperRevision)try{localStorage.removeItem('orbit_calc_wallpaper');}catch(_){}}
    }catch(_){if(revision===calcWallpaperRevision)applyCalcWallpaper(legacy);}
}
let calcWallpaperRevision = 0;
async function saveCalcWallpaper(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const revision = ++calcWallpaperRevision;
    let objectUrl = null;
    try {
        if (!(file.type.startsWith('image/') || (!file.type && /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name)))) throw new Error('Choose an image file.');
        if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image smaller than 20 MB.');
        objectUrl = URL.createObjectURL(file);
        const image = new Image();
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('This image could not be opened. Try a JPG, PNG or WebP photo.'));
            image.src = objectUrl;
        });
        const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Image processing is unavailable on this browser.');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        // Cap local storage usage; mobile photos can otherwise exceed its quota.
        let data = canvas.toDataURL('image/jpeg', .8);
        if (data.length > 700000) data = canvas.toDataURL('image/jpeg', .55);
        if (data.length > 700000) {
            const smaller = document.createElement('canvas');
            smaller.width = Math.max(1, Math.round(canvas.width * .65));
            smaller.height = Math.max(1, Math.round(canvas.height * .65));
            smaller.getContext('2d').drawImage(canvas, 0, 0, smaller.width, smaller.height);
            data = smaller.toDataURL('image/jpeg', .55);
        }
        if (!data.startsWith('data:image/jpeg;base64,')) throw new Error('This browser could not convert the image.');
        if (revision !== calcWallpaperRevision) return;
        let saved=false;
        try{await calcWallpaperStorage('put',data);saved=true;try{localStorage.removeItem('orbit_calc_wallpaper');}catch(_){}}
        catch(_){try{localStorage.setItem('orbit_calc_wallpaper',data);saved=true;}catch(_){}}
        if(revision!==calcWallpaperRevision)return;
        applyCalcWallpaper(data);
        showToast(saved?'Calculator wallpaper saved.':'Wallpaper applied for this session. Your browser is blocking saved images.',saved?'success':'info');
    } catch (error) {
        if (revision !== calcWallpaperRevision) return;
        console.warn('[Orbit Calculator] Wallpaper could not be saved:', error);
        showToast(error.message || 'Could not save the wallpaper. Try a smaller image.', 'error');
    } finally { if (objectUrl) URL.revokeObjectURL(objectUrl); }
}
function clearCalcWallpaper() {
    ++calcWallpaperRevision;
    calcWallpaperStorage('delete').catch(()=>{});
    try { localStorage.removeItem('orbit_calc_wallpaper'); } catch (_) {}
    applyCalcWallpaper('');
}
