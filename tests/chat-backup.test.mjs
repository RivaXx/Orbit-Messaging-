import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBackup,readBackup,backupBase64,backupBytes} from '../js/chat-backup-core.mjs';
const pass='a separate long test backup passphrase',owner='account-a';
async function* records(){yield {kind:'manifest'};yield {kind:'message',text:'Private old and encrypted chat content'};yield {kind:'chunk',data:backupBase64(new Uint8Array([0,255,17,88]))};yield {kind:'summary'};}
test('backup encrypts text and media; authenticated restore recovers exact bytes',async()=>{
 const file=await createBackup(records(),pass,owner),text=await file.text(),restored=[];
 assert.ok(!text.includes('Private old'));assert.ok(!text.includes(pass));
 await readBackup(file,pass,owner,r=>restored.push(r));assert.equal(restored[1].text,'Private old and encrypted chat content');assert.deepEqual(backupBytes(restored[2].data),new Uint8Array([0,255,17,88]));
});
test('wrong passphrase and another account cannot restore the archive',async()=>{
 const file=await createBackup(records(),pass,owner);
 await assert.rejects(readBackup(file,'another long but wrong test passphrase',owner,()=>{}),/Incorrect/);
 await assert.rejects(readBackup(file,pass,'account-b',()=>{}),/different Orbit account/);
});
test('changed metadata, modified ciphertext, reordered and truncated records fail closed',async()=>{
 const lines=(await (await createBackup(records(),pass,owner)).text()).trimEnd().split('\n');
 const header=JSON.parse(lines[0]);header.created_at='changed';let altered=[JSON.stringify(header),...lines.slice(1)];
 await assert.rejects(readBackup(new Blob([altered.join('\n')+'\n']),pass,owner,()=>{}),/Incorrect/);
 altered=[...lines];[altered[1],altered[2]]=[altered[2],altered[1]];await assert.rejects(readBackup(new Blob([altered.join('\n')+'\n']),pass,owner,()=>{}),/reordered/);
 await assert.rejects(readBackup(new Blob([lines.slice(0,-1).join('\n')+'\n']),pass,owner,()=>{}),/incomplete/);
 const row=JSON.parse(lines[2]);row.data=(row.data[0]==='A'?'B':'A')+row.data.slice(1);altered=[...lines];altered[2]=JSON.stringify(row);
 await assert.rejects(readBackup(new Blob([altered.join('\n')+'\n']),pass,owner,()=>{}),/Incorrect/);
});
test('archive bounds reject weak passphrases and malicious KDF parameters',async()=>{
 await assert.rejects(createBackup(records(),'short',owner),/20 to 256/);
 const lines=(await (await createBackup(records(),pass,owner)).text()).split('\n'),h=JSON.parse(lines[0]);h.iterations=2**31;lines[0]=JSON.stringify(h);
 await assert.rejects(readBackup(new Blob([lines.join('\n')]),pass,owner,()=>{}),/Unsupported/);
});
