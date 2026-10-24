const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(){const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{setProperty(){}},classList:{add(){},remove(){},contains:()=>false},setAttribute(){},innerText:'',textContent:''});return nodes.get(id);};const c=vm.createContext({Date,console,document:{getElementById:node,addEventListener(){}},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},window:{},setTimeout(){},clearTimeout(){},showToast(){},escapeHtml:String});vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/calculator.js'),'utf8'),c);return {c,node,math:vm.runInContext('OrbitCalcMath',c),run:sequence=>{for(const key of sequence)c.calcInput(key);return vm.runInContext('calcCurrentVal',c);},value:()=>vm.runInContext('calcCurrentVal',c)};}
test('exact decimal arithmetic, precedence, powers and contextual percentage rules',()=>{
 const {math}=fixture();const examples={'0.1+0.2':'0.3','(1/3)*3':'1','2+3*4':'14','(2+3)*4':'20','2^3^2':'512','-2^2':'-4','(-2)^2':'4','2^-3':'0.125','(-8)^(1/3)':'-2','(-8)^(2/3)':'4','200+10%':'220','200-10%':'180','200*10%':'20','200/10%':'2000','(100+100)+10%':'220','100+10%+10%':'121','2(3+4)':'14','(2+3)(4+5)':'45','1e-10*1e10':'1','2.':'2','0.00000001/100':'1e-10'};
 for(const [expr,expected] of Object.entries(examples))assert.equal(math.format(math.calculate(expr)),expected,expr);
});
test('invalid expressions, division by zero and unbounded work fail explicitly',()=>{
 const {math}=fixture();for(const bad of ['1/0','0/0','0^0','1+','(2+3','2..3','2 3','1oops+2','2;3','2^999999','('.repeat(40)+'1'+')'.repeat(40)])assert.throws(()=>math.calculate(bad),undefined,bad);
});
test('real key sequences preserve parentheses, decimal reset, sign entry and operator correction',()=>{
 for(const [keys,result] of [[['2','*','(','3','+','4',')','='],'14'],[['2','+','*','3','='],'6'],[['5','*','-','2','='],'-10'],[['5','+/-','2','='],'-52'],[['1','+','2','=', '.', '5','='],'0.5'],[['2','0','0','+','1','0','%','='],'220'],[['1','/','0','=','7','='],'7']]){const f=fixture();assert.equal(f.run(keys),result,keys.join(' '));}
});
test('repeat equals, carry precision and scientific notation remain usable',()=>{
 const f=fixture();assert.equal(f.run(['1','/','3','=','*','3','=']),'1');
 f.run(['AC']);assert.equal(f.run(['2','+','3','=','=', '=']),'11');
 f.run(['AC']);assert.equal(f.run(['2','0','0','+','1','0','%','=','=',]),'242');
 f.run(['AC']);assert.equal(f.run(['1','0','^','2','0','=','/','1','0','^','2','0','=']),'1');
});
test('scientific degree/radian modes, domains and memory arithmetic',()=>{
 const f=fixture();f.run(['3','0']);f.c.calcSciOp('sin');assert.equal(f.value(),'0.5');
 f.run(['AC','9','0']);f.c.calcSciOp('tan');assert.equal(f.value(),'Error');
 f.run(['AC','9','+/-']);f.c.calcSciOp('sqrt');assert.equal(f.value(),'Error');
 f.run(['AC','0']);f.c.calcSciOp('ln');assert.equal(f.value(),'Error');
 f.run(['AC','.','1']);f.c.calcSciOp('m+');f.run(['AC','.','2']);f.c.calcSciOp('m+');f.run(['AC']);f.c.calcSciOp('mr');assert.equal(f.value(),'0.3');
 f.c.toggleCalcAngle();f.run(['AC']);f.c.calcSciOp('pi');f.c.calcInput('/');f.c.calcInput('2');f.c.calcInput('=');f.c.calcSciOp('sin');assert.ok(Math.abs(Number(f.value())-1)<1e-14);
});
test('live preview and equals share the same evaluator without recording preview history',()=>{
 const f=fixture();f.run(['.','1','+','.','2']);assert.equal(f.node('calc-answer-preview').textContent,'= 0.3');assert.equal(vm.runInContext('calcHistory.length',f.c),0);assert.equal(f.run(['=']),'0.3');assert.equal(vm.runInContext('calcHistory.length',f.c),1);
});
test('scientific transformations and clear-entry preserve the pending operation',()=>{
 const f=fixture();f.run(['2','+','9']);f.c.calcSciOp('sqrt');assert.equal(f.run(['=']),'5');
 f.run(['AC','9']);f.c.calcSciOp('sqrt');assert.equal(f.run(['2','=']),'2');
 f.run(['AC','2','+','9','CE','3','=']);assert.equal(f.value(),'5');
 f.run(['AC','5','-','(','-','2',')','=','=']);assert.equal(f.value(),'9');
});
test('deterministic integer cases agree with an independent arithmetic oracle',()=>{
 const {math}=fixture();let seed=12345;for(let i=0;i<400;i++){
  seed=(seed*1664525+1013904223)>>>0;const a=seed%10000;seed=(seed*1664525+1013904223)>>>0;const b=seed%10000,c=i%37;
  assert.equal(Number(math.format(math.calculate(`(${a}+${b})*${c}-${a}`))),(a+b)*c-a);
 }
});
function toolsFixture(){const f=fixture();f.c.window.addEventListener=()=>{};f.c.document.querySelectorAll=()=>[];f.c.setInterval=()=>0;vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/tools.js'),'utf8'),f.c);return f;}
test('date arithmetic clamps month ends and leap days; date differences never have negative components',()=>{
 const f=toolsFixture();const date=f.c.parseCalcDate('2025-01-31');assert.equal(f.c.shiftCalcMonths(date,1).toISOString().slice(0,10),'2025-02-28');assert.equal(f.c.shiftCalcMonths(f.c.parseCalcDate('2024-02-29'),12).toISOString().slice(0,10),'2025-02-28');
 f.node('date-diff-start').value='2025-01-31';f.node('date-diff-end').value='2025-03-01';f.c.calculateDateDiff();assert.equal(f.node('date-diff-days-total').innerText,'29 days');assert.match(f.node('date-diff-breakdown').innerText,/0 years, 1 months, 1 days/);
 f.node('date-diff-start').value='2024-03-09';f.node('date-diff-end').value='2024-03-11';f.c.calculateDateDiff();assert.equal(f.node('date-diff-days-total').innerText,'2 days');
 assert.throws(()=>f.c.parseCalcDate('2025-02-29'));f.c.initDateCalculator();
});
test('conversions retain precision and reject invalid or nonfinite quantities',()=>{
 const f=toolsFixture();f.node('converter-from-val').value='0.00000001';f.node('converter-from-unit').value='m';f.node('converter-to-unit').value='cm';f.c.convertUnits();assert.equal(Number(f.node('converter-to-val').innerText),0.000001);
 f.node('converter-from-val').value='12oops';f.c.convertUnits();assert.equal(f.node('converter-to-val').innerText,'—');
 vm.runInContext("currentConverterCategory='temp'",f.c);f.node('converter-from-val').value='-274';f.node('converter-from-unit').value='c';f.node('converter-to-unit').value='k';f.c.convertUnits();assert.equal(f.node('converter-to-val').innerText,'—');
});

test('69 plus corrected to multiply preserves the operand and returns 138',()=>{
 const f=fixture();assert.equal(f.run(['6','9','+']),'69');assert.equal(f.run(['*']),'69');
 assert.equal(f.node('calc-expr-display').innerText,'69*');assert.equal(f.run(['2','=']),'138');
 f.run(['AC','1','/','0','=']);assert.equal(f.run(['+','2','=']),'2');
});
