import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import * as pgp from '../assets/vendor/openpgp.min.mjs';
import {createOrbitCryptoEngine} from '../js/e2ee-core.mjs';
let a,b,c,ra,rb,rc,wire;
const passA='synthetic-only-recovery-passphrase-A',passB='synthetic-only-recovery-passphrase-B';
const ctx={id:'33333333-3333-4333-8333-333333333333',sender_id:'11111111-1111-4111-8111-111111111111',room:'synthetic-room',revision:1};
before(async()=>{a=createOrbitCryptoEngine(pgp);b=createOrbitCryptoEngine(pgp);c=createOrbitCryptoEngine(pgp);ra=await a.generate(ctx.sender_id,passA);rb=await b.generate('22222222-2222-4222-8222-222222222222',passB);rc=await c.generate('44444444-4444-4444-8444-444444444444','synthetic-only-recovery-passphrase-C');wire=await a.encrypt(ctx,{type:'text',text:'Confidential synthetic text'},[ra,rb]);});
test('signed encryption hides plaintext and supports only the actual recipients',async()=>{
 assert.equal((await b.decrypt(ctx,wire.ciphertext,ra)).text,'Confidential synthetic text');
 assert.equal((await a.decrypt(ctx,wire.ciphertext,ra)).text,'Confidential synthetic text');
 assert.ok(!wire.ciphertext.includes('Confidential synthetic text'));
 await assert.rejects(c.decrypt(ctx,wire.ciphertext,ra));
});
test('sender signatures and conversation/message/revision binding reject substitution and replay',async()=>{
 await assert.rejects(b.decrypt(ctx,wire.ciphertext,{...rc,user_id:ra.user_id}));
 for(const change of [{room:'other-room'},{id:'55555555-5555-4555-8555-555555555555'},{revision:2}])await assert.rejects(b.decrypt({...ctx,...change},wire.ciphertext,ra));
});
test('altered encrypted message data fails instead of returning unverified content',async()=>{
 const bad=wire.ciphertext.replace(/\n([A-Za-z0-9+/]{40,})/,(_,row)=>'\n'+(row[0]==='A'?'B':'A')+row.slice(1));
 assert.notEqual(bad,wire.ciphertext);await assert.rejects(b.decrypt(ctx,bad,ra));
});
test('encrypted backup recovers keys, rejects wrong passwords and binds the account',async()=>{
 const recovered=createOrbitCryptoEngine(pgp);
 assert.ok(!JSON.stringify(rb.backup).includes('PRIVATE KEY'));assert.ok(!JSON.stringify(rb.backup).includes(passB));
 await assert.rejects(recovered.unlock(rb.user_id,rb,rb.backup,'wrong-but-long-synthetic-passphrase'));
 await assert.rejects(recovered.unlock(ra.user_id,rb,rb.backup,passB));
 await assert.rejects(recovered.unlock(rb.user_id,rb,{...rb.backup,iterations:1},passB));
 await recovered.unlock(rb.user_id,rb,rb.backup,passB);
 assert.equal((await recovered.decrypt(ctx,wire.ciphertext,ra)).text,'Confidential synthetic text');
 recovered.lock();await assert.rejects(recovered.decrypt(ctx,wire.ciphertext,ra));
});
test('encrypted files require their signed parent digest and authentic sender',async()=>{
 const input=new TextEncoder().encode('Private synthetic file'),file=await a.encryptFile(input,[ra,rb]);
 assert.deepEqual(await b.decryptFile(file.ciphertext,file.digest,ra),input);
 const bad=file.ciphertext.slice();bad[Math.floor(bad.length/2)]^=1;
 await assert.rejects(b.decryptFile(bad,file.digest,ra));
 await assert.rejects(b.decryptFile(file.ciphertext,file.digest,{...rc,user_id:ra.user_id}));
 await assert.rejects(c.decryptFile(file.ciphertext,file.digest,ra));
});
test('key fingerprints and sender recovery copies are mandatory',async()=>{
 await assert.rejects(a.encrypt(ctx,{type:'text',text:'x'},[rb]));
 await assert.rejects(a.encrypt(ctx,{type:'text',text:'x'},[ra,{...rb,fingerprint:'0'.repeat(64)}]));
 assert.deepEqual(Object.keys(a.status()).sort(),['fingerprint','user_id']);
});
