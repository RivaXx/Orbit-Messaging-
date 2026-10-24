// Exact rational arithmetic for decimal inputs; scientific functions use Math.
// Work limits keep malformed expressions from monopolizing the UI thread.
const OrbitCalcMath=(()=>{
 const abs=n=>n<0n?-n:n;
 function rat(n,d=1n){if(!d)throw Error('Cannot divide by zero');if(d<0n){n=-n;d=-d;}let a=abs(n),b=d;while(b){[a,b]=[b,a%b];}n/=a||1n;d/=a||1n;if(n.toString().length+d.toString().length>4096)throw Error('Result exceeds calculator range');return {n,d};}
 function number(s){const m=String(s).match(/^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i);if(!m)throw Error('Invalid number');const exponent=Number(m[3]||0);if(Math.abs(exponent)>308)throw Error('Number exceeds calculator range');const parts=m[2].split('.'),digits=(parts[0]||'0')+(parts[1]||'');let scale=(parts[1]?.length||0)-exponent;return scale>=0?rat(BigInt((m[1]||'')+digits),10n**BigInt(scale)):rat(BigInt((m[1]||'')+digits)*10n**BigInt(-scale));}
 function numeric(x){const v=Number(format(x));if(!Number.isFinite(v))throw Error('Result exceeds calculator range');return v;}
 function op(a,b,kind){
  if(kind==='+')return rat(a.n*b.d+b.n*a.d,a.d*b.d);
  if(kind==='-')return rat(a.n*b.d-b.n*a.d,a.d*b.d);
  if(kind==='*')return rat(a.n*b.n,a.d*b.d);
  if(kind==='/')return rat(a.n*b.d,a.d*b.n);
  if(kind==='^'){
   if(b.d===1n){if(abs(b.n)>512n)throw Error('Exponent exceeds calculator range');if(a.n===0n&&b.n<=0n)throw Error('Undefined power');const p=abs(b.n);if(BigInt(a.n.toString().length+a.d.toString().length)*p>4096n)throw Error('Result exceeds calculator range');return b.n<0n?rat(a.d**p,a.n**p):rat(a.n**p,a.d**p);}
   const value=a.n<0n&&b.d%2n===1n?Math.pow(-numeric(a),numeric(b))*(abs(b.n)%2n===1n?-1:1):Math.pow(numeric(a),numeric(b));if(!Number.isFinite(value))throw Error('Power has no finite real result');return number(value.toPrecision(15));
  }throw Error('Unknown operator');
 }
 function format(x){
  if(!x.n)return '0';const sign=x.n<0n?'-':'',n=abs(x.n),d=x.d;
  let exponent=n.toString().length-d.toString().length;
  if(exponent>=0?n<d*10n**BigInt(exponent):n*10n**BigInt(-exponent)<d)exponent--;
  if(exponent>308||exponent< -308)throw Error('Result exceeds calculator range');
  const shift=14-exponent,scaledN=shift>=0?n*10n**BigInt(shift):n,scaledD=shift>=0?d:d*10n**BigInt(-shift);
  let digits=scaledN/scaledD;if((scaledN%scaledD)*2n>=scaledD)digits++;
  let text=digits.toString();if(text.length>15){exponent++;text=text.slice(0,15);}
  if(exponent>=15||exponent< -6){const mantissa=(text[0]+'.'+text.slice(1)).replace(/\.?0+$/,'');return sign+mantissa+'e'+(exponent>=0?'+':'')+exponent;}
  const point=exponent+1;let result=point<=0?'0.'+'0'.repeat(-point)+text:point>=text.length?text+'0'.repeat(point-text.length):text.slice(0,point)+'.'+text.slice(point);
  if(result.includes('.'))result=result.replace(/0+$/,'').replace(/\.$/,'');return sign+result;
 }
 function parse(source,answer=null){
  source=String(source).replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');
  if(!source.trim()||source.length>512)throw Error('Enter a shorter expression');
  if(/\d\s+\d/.test(source))throw Error('Missing operator');
  const tokens=[];let pos=0;
  while(pos<source.length){if(answer&&source.slice(pos,pos+3)==='Ans'){tokens.push({answer});pos+=3;continue;}if(/\s/.test(source[pos])){pos++;continue;}const m=source.slice(pos).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);if(m){if(tokens.at(-1)?.value)throw Error('Missing operator');tokens.push({value:m[0]});pos+=m[0].length;}else if('+-*/^()%'.includes(source[pos]))tokens.push(source[pos++]);else throw Error('Invalid character');if(tokens.length>256)throw Error('Expression is too long');}
  let i=0,depth=0;
  function expr(min=0){
   if(++depth>32)throw Error('Too many nested operations');let left,t=tokens[i++];
   if(t==='+'||t==='-'){left={kind:'unary',sign:t,child:expr(3)};}
   else if(t==='('){left=expr(0);if(tokens[i++]!==')')throw Error('Close the parentheses');left={kind:'group',child:left};}
   else if(t?.answer){left={kind:'rational',value:t.answer};}
   else if(t?.value){left={kind:'number',value:t.value};}else throw Error('Enter a number');
   while(i<tokens.length){t=tokens[i];if(t==='%'){if(5<min)break;i++;left={kind:'percent',child:left};continue;}
    const implicit=t==='('||!!t?.value,kind=implicit?'*':t,precedence={'+':1,'-':1,'*':2,'/':2,'^':4}[kind];
    if(!precedence||precedence<min)break;if(!implicit)i++;
    left={kind:'binary',op:kind,left,right:expr(kind==='^'?precedence:precedence+1)};
   }depth--;return left;
  }
  const tree=expr();if(i!==tokens.length)throw Error('Unexpected token');return tree;
 }
 function evaluate(tree){
  if(tree.kind==='rational')return tree.value;
  if(tree.kind==='number')return number(tree.value);
  if(tree.kind==='group')return evaluate(tree.child);
  if(tree.kind==='unary'){const x=evaluate(tree.child);return tree.sign==='-'?rat(-x.n,x.d):x;}
  if(tree.kind==='percent')return op(evaluate(tree.child),number('100'),'/');
  const left=evaluate(tree.left);let right=evaluate(tree.right);
  // Addition/subtraction percentages are relative to the left subtotal.
  let percent=tree.right;while(['group','unary'].includes(percent.kind))percent=percent.child;
  if(['+','-'].includes(tree.op)&&percent.kind==='percent')right=op(left,right,'*');
  return op(left,right,tree.op);
 }
 function print(tree){if(tree.kind==='number')return tree.value;if(tree.kind==='rational')return format(tree.value);if(tree.kind==='group')return '('+print(tree.child)+')';if(tree.kind==='unary')return '('+tree.sign+print(tree.child)+')';if(tree.kind==='percent')return print(tree.child)+'%';return '('+print(tree.left)+tree.op+print(tree.right)+')';}
 const calculate=(source,answer=null)=>evaluate(parse(source,answer));
 return {parse,evaluate,calculate,format,number,op,numeric,print};
})();

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
 if(calcCurrentVal==='Error'){output.textContent=calcErrorMessage||'Invalid calculation';return;}
 if(!calcPreviewEnabled||isCalcResultShown||!calcBuffer)return;
 try{if(calcBuffer)output.textContent='= '+OrbitCalcMath.format(OrbitCalcMath.calculate(calcBuffer,calcCarry?.value));}catch(_){}
}

let calcHistory = (() => {
    try {
        const stored = localStorage.getItem('orbit_calc_history');
        if (stored) {const rows=JSON.parse(stored);if(Array.isArray(rows))return rows.filter(row=>row&&typeof row.expr==='string'&&typeof row.result==='string'&&row.expr.length<=1024&&row.result.length<=64).slice(0,30);}
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
    const angleButton=document.getElementById('calc-angle-mode');if(angleButton){angleButton.textContent=calcAngleMode.toUpperCase();angleButton.setAttribute('aria-label','Angle mode: '+(calcAngleMode==='deg'?'degrees':'radians'));}
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
        btnAc.onclick=()=>calcInput(showSeparateAc?'AC':'CE');
    }
}

function evaluateCalcExpression(rawExpr){return OrbitCalcMath.numeric(OrbitCalcMath.calculate(rawExpr));}
let calcReplaceEntry=false,calcCarry=null,calcErrorMessage='',calcBuffer='',calcRepeat=null,calcAngleMode=localStorage.getItem('orbit_calc_angle')==='rad'?'rad':'deg';
function calcTail(){
 let end=calcBuffer.length,start=end;if(!end)return {start:0,text:'0'};
 if(calcBuffer[end-1]==='%')start--;
 if(calcBuffer[start-1]===')'){let depth=1;start-=2;while(start>=0&&depth){if(calcBuffer[start]===')')depth++;if(calcBuffer[start]==='(')depth--;start--;}start++;}
 else {const m=calcBuffer.slice(0,start).match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i);if(!m)return {start:end,text:'0',missing:true};start-=m[0].length;}
 if(start>0&&calcBuffer[start-1]==='-'&&(start===1||/[+*/^(\-]/.test(calcBuffer[start-2])))start--;
 return {start,text:calcBuffer.slice(start)};
}
function syncCalcEntry(){
 calcExpression=calcBuffer.replaceAll('Ans',calcCarry?.display||'Ans');
 if(!calcBuffer){calcCurrentVal='0';return;}
 const tail=calcTail();if(tail.missing){if(calcBuffer.endsWith('('))calcCurrentVal='0';return;}
 if(/^[+-]?(?:\d*\.?\d*)(?:e[+-]?\d+)?$/i.test(tail.text))calcCurrentVal=tail.text;
 else try{calcCurrentVal=OrbitCalcMath.format(OrbitCalcMath.calculate(tail.text,calcCarry?.value));}catch(_){calcCurrentVal='0';}
}
function calcFailure(error){calcErrorMessage=error.message;calcCurrentVal='Error';isCalcResultShown=true;calcRepeat=null;const el=document.getElementById('calc-answer-preview');if(el)el.textContent=error.message||'Invalid calculation';}
function calcInput(value){
 if(value==='CE'){if(isCalcResultShown){calcInput('AC');return;}calcBuffer=calcBuffer.slice(0,calcTail().start)+'0';calcReplaceEntry=true;calcRepeat=null;syncCalcEntry();updateCalcDisplay();return;}
 if(value==='AC'){calcBuffer='';calcCarry=null;calcRepeat=null;calcCurrentVal='0';calcExpression='';isCalcResultShown=false;updateCalcDisplay();return;}
 if(value==='='){
  try{
   let source=calcBuffer||calcCurrentVal||'0',tree;
   if(isCalcResultShown&&calcCurrentVal!=='Error'&&calcRepeat){tree={kind:'binary',op:calcRepeat.op,left:calcCarry?{kind:'rational',value:calcCarry.value}:{kind:'number',value:calcCurrentVal},right:calcRepeat.right};source=calcCurrentVal+' '+calcRepeat.op+' '+calcRepeat.label;}
   else {tree=OrbitCalcMath.parse(source,calcCarry?.value);calcRepeat=tree.kind==='binary'?{op:tree.op,right:tree.right,label:OrbitCalcMath.print(tree.right)}:null;}
   const exactResult=OrbitCalcMath.evaluate(tree),result=OrbitCalcMath.format(exactResult);
   source=source.replaceAll('Ans',calcCarry?.display||'Ans');calcCarry={value:exactResult,display:result};
   calcHistory.unshift({expr:source,result,time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})});calcHistory=calcHistory.slice(0,30);
   try{localStorage.setItem('orbit_calc_history',JSON.stringify(calcHistory));}catch(_){}
   calcExpression=source+' =';calcCurrentVal=result;calcBuffer=result;isCalcResultShown=true;renderCalcHistory();updateCalcDisplay();
  }catch(error){calcFailure(error);updateCalcDisplay();}return;
 }
 if(calcCurrentVal==='Error'){calcBuffer='';calcCarry=null;calcRepeat=null;calcCurrentVal='0';calcExpression='';isCalcResultShown=false;}
 if(value==='BACKSPACE'){
  calcBuffer=isCalcResultShown?'':calcBuffer.slice(0,-1);
 }else if(value==='+/-'){
  const tail=calcTail();if(!tail.missing&&tail.text!=='0')calcBuffer=calcBuffer.slice(0,tail.start)+(/^-?(?:\d*\.?\d+)(?:e[+-]?\d+)?$/i.test(tail.text)?(tail.text.startsWith('-')?tail.text.slice(1):'-'+tail.text):'(-('+tail.text+'))');
 }else if(value==='%'){
  if(!calcTail().missing&&calcBuffer&&!calcBuffer.endsWith('%'))calcBuffer+='%';
 }else if(['+','-','*','/','^'].includes(value)){
  if(isCalcResultShown&&calcCarry)calcBuffer='Ans';
  if(!calcBuffer)calcBuffer='0';
  if(/[+*/^\-]$/.test(calcBuffer)){
   if(value==='-'&&!calcBuffer.endsWith('-'))calcBuffer+='-';
   else calcBuffer=calcBuffer.replace(/[+*/^\-]+$/,value);
  }else if(!calcBuffer.endsWith('('))calcBuffer+=value;
  else if(value==='-')calcBuffer+='-';
 }else if(value==='('){
  if(isCalcResultShown)calcBuffer='';
  if(/[\d)%]$/.test(calcBuffer))calcBuffer+='*';calcBuffer+='(';
 }else if(value===')'){
  if((calcBuffer.match(/\(/g)||[]).length>(calcBuffer.match(/\)/g)||[]).length&&!calcTail().missing)calcBuffer+=')';
 }else if(value==='.'||/^\d$/.test(value)){
  if(isCalcResultShown)calcBuffer='';else if(calcReplaceEntry)calcBuffer=calcBuffer.slice(0,calcTail().start);
  if(/[)%]$/.test(calcBuffer))calcBuffer+='*';
  let tail=calcTail();
  if(value==='.'){
   if(!tail.missing&&/[.e]/i.test(tail.text))return;
   calcBuffer+=tail.missing||!calcBuffer?'0.':'.';
  }else{
   if(!tail.missing&&tail.text.replace(/[^0-9]/g,'').length>=16)return;
   if(tail.text==='0'&&!tail.missing)calcBuffer=calcBuffer.slice(0,tail.start)+value;else calcBuffer+=value;
  }
 }else return;
 if(calcBuffer.length>512)calcBuffer=calcBuffer.slice(0,512);
 calcRepeat=null;calcReplaceEntry=false;isCalcResultShown=false;syncCalcEntry();updateCalcDisplay();
}
function toggleCalcAngle(){calcAngleMode=calcAngleMode==='deg'?'rad':'deg';try{localStorage.setItem('orbit_calc_angle',calcAngleMode);}catch(_){}const button=document.getElementById('calc-angle-mode');if(button){button.textContent=calcAngleMode.toUpperCase();button.setAttribute('aria-label','Angle mode: '+(calcAngleMode==='deg'?'degrees':'radians'));}}
function calcSciOp(operation){
 if(calcCurrentVal==='Error'){calcBuffer='';calcCarry=null;calcCurrentVal='0';isCalcResultShown=false;}
 if(operation==='pow'){calcInput('^');return;}
 if(operation==='mc'){calcMemory=0;showToast('Memory cleared');return;}
 if(operation==='mr'){if(isCalcResultShown)calcBuffer='';const tail=calcTail();calcBuffer=calcBuffer.slice(0,tail.start)+String(calcMemory);calcReplaceEntry=true;isCalcResultShown=false;syncCalcEntry();updateCalcDisplay();return;}
 try{
  const tail=calcTail();if(tail.missing&&operation!=='pi')throw Error('Enter a number first');
  const exact=OrbitCalcMath.calculate(tail.text),num=OrbitCalcMath.numeric(exact);let result;
  if(operation==='m+'||operation==='m-'){calcMemory=OrbitCalcMath.format(OrbitCalcMath.op(OrbitCalcMath.number(String(calcMemory)),exact,operation==='m+'?'+':'-'));showToast('Memory: '+calcMemory);return;}
  if(operation==='inv')result=OrbitCalcMath.op(OrbitCalcMath.number('1'),exact,'/');
  else if(operation==='sq')result=OrbitCalcMath.op(exact,exact,'*');
  else{
   const angle=calcAngleMode==='deg'?(num%360)*Math.PI/180:num;
   let value;
   switch(operation){
    case 'pi':value=Math.PI;break;
    case 'sin':value=Math.sin(angle);break;
    case 'cos':value=Math.cos(angle);break;
    case 'tan':if(Math.abs(Math.cos(angle))<1e-14)throw Error('Tangent is undefined at this angle');value=Math.tan(angle);break;
    case 'sqrt':if(num<0)throw Error('Square root requires a nonnegative number');value=Math.sqrt(num);break;
    case 'log':case 'ln':if(num<=0)throw Error('Logarithms require a positive number');value=operation==='log'?Math.log10(num):Math.log(num);break;
    default:return;
   }
   if(!Number.isFinite(value))throw Error('Result exceeds calculator range');
   if(['sin','cos','tan'].includes(operation)&&Math.abs(value)<1e-15)value=0;
   result=OrbitCalcMath.number(value.toPrecision(15));
  }
  if(isCalcResultShown)calcBuffer='';
  const formatted=OrbitCalcMath.format(result);calcBuffer=calcBuffer.slice(0,calcTail().start)+(formatted.startsWith('-')?'('+formatted+')':formatted);
  calcRepeat=null;calcReplaceEntry=true;isCalcResultShown=false;syncCalcEntry();updateCalcDisplay();
 }catch(error){calcFailure(error);updateCalcDisplay();}
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
    if(e.ctrlKey||e.metaKey||e.altKey||e.isComposing||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)||document.activeElement?.isContentEditable)return;
    if(typeof currentCalcSubmode!=='undefined'&&currentCalcSubmode!=='calc')return;

    const key = e.key;
    if((key==='Enter'||key===' ')&&document.activeElement?.tagName==='BUTTON')return;
    const settings = document.getElementById('calc-settings');
    if (settings?.open) {
        if (key === 'Escape') { settings.open = false; settings.querySelector('summary')?.focus(); e.preventDefault(); }
        return;
    }
    if (/^[0-9]$/.test(key)) {
        e.preventDefault();
        calcInput(key);
        highlightCalcButton(`calc-btn-${key}`);
    } else if (key === '+' || key === '-' || key === '*' || key === '/' || key === '^') {
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
