const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function fixture(){const c=vm.createContext({console,Date,Map,Set,currentUser:{id:'sender'},allRoomsMap:new Map(),document:{getElementById:()=>null,addEventListener(){}},window:{addEventListener(){}},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,escapeHtml:String});vm.runInContext(read('js/chat/chat-feed.js'),c);return c;}
test('ticks require recipient confirmation; sender reads and legacy flags never fake a read',()=>{
 const c=fixture(),base={id:'m',sender_id:'sender',room:'room',status:'sent'};
 assert.match(c.getTickIconHtml(base),/tick-sent/);
 assert.match(c.getTickIconHtml({...base,is_read:true,status:'read',read_by:['sender']}),/tick-sent/);
 assert.match(c.getTickIconHtml({...base,delivered_to:['peer']}),/tick-delivered/);
 assert.match(c.getTickIconHtml({...base,read_by:['peer']}),/tick-read/);
 assert.match(c.getTickIconHtml({...base,status:'queued',read_by:['peer']}),/sending-tick/);
});
test('group receipts wait for every other participant',()=>{
 const c=fixture();c.allRoomsMap.set('room',{participants:['sender','a','b']});const msg={id:'m',sender_id:'sender',room:'room'};
 assert.match(c.getTickIconHtml({...msg,delivered_to:['a']}),/tick-sent/);
 assert.match(c.getTickIconHtml({...msg,delivered_to:['a','b'],read_by:['a']}),/tick-delivered/);
 assert.match(c.getTickIconHtml({...msg,read_by:['a','b']}),/tick-read/);
});
test('old history cannot regress receipts and account changes do not inherit them',()=>{
 const c=fixture();vm.runInContext(read('js/chat/message-controls.js'),c);
 const msg={id:'m',type:'text',sender_id:'sender',read_by:['peer']};c.orbitNormalizeMessage(msg);
 assert.deepEqual(Array.from(c.orbitNormalizeMessage({...msg,read_by:[]}).read_by),['peer']);
 c.currentUser={id:'different'};assert.equal(c.orbitNormalizeMessage({...msg,read_by:[]}).read_by.length,0);
});
test('multiline composer caps height and scrolls excess text without changing the draft',()=>{
 const c=fixture();let tall;const input={style:{},scrollHeight:240,value:'A long message\n'.repeat(30),closest:()=>({classList:{toggle:(_key,v)=>tall=v}})};
 const original=input.value;c.handleInputResize(input);assert.equal(input.style.height,'120px');assert.equal(input.style.overflowY,'auto');assert.equal(tall,true);assert.equal(input.value,original);
 input.scrollHeight=24;c.handleInputResize(input);assert.equal(input.style.overflowY,'hidden');assert.equal(tall,false);
});
