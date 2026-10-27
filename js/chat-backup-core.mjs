// Encrypted, ordered archive records. No account credentials or raw private keys.
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
export const BACKUP_LIMIT=160*1024*1024,CHUNK_SIZE=768*1024;
const b64=bytes=>{let value='';for(let i=0;i<bytes.length;i+=16384)value+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(value);};
const unb64=value=>{if(typeof value!=='string'||value.length>3*1024*1024||!(/^[A-Za-z0-9+/]*={0,2}$/).test(value))throw Error('Invalid archive data');return Uint8Array.from(atob(value),c=>c.charCodeAt(0));};
async function derive(pass,salt,usage){
 if(typeof pass!=='string'||pass.length<20||pass.length>256)throw Error('Use a backup passphrase of 20 to 256 characters');
 const material=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',iterations:600000,salt},material,{name:'AES-GCM',length:256},false,[usage]);
}
export async function createBackup(records,passphrase,owner,progress=()=>{}){
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const header={format:'orbit-chat-backup',version:1,cipher:'AES-256-GCM',kdf:'PBKDF2-SHA256',iterations:600000,salt:b64(salt),id:crypto.randomUUID(),owner,created_at:new Date().toISOString()};
 const headerText=JSON.stringify(header),key=await derive(passphrase,salt,'encrypt'),parts=[headerText+'\n'];
 let sequence=0,total=0;
 async function append(value){
  const plain=enc.encode(JSON.stringify(value));if(plain.length>2*1024*1024)throw Error('Archive record exceeds the size limit');
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(headerText+'|'+sequence)},key,plain));
  plain.fill(0);const line=JSON.stringify({sequence,iv:b64(iv),data:b64(data)})+'\n';total+=line.length;
  if(total>BACKUP_LIMIT)throw Error('Backup exceeds 160 MB. Select one chat or turn off media and export again.');
  parts.push(line);sequence++;progress(sequence,total);
 }
 for await(const record of records){if(!record||record.kind==='end')throw Error('Invalid backup record');await append(record);}
 await append({kind:'end',records:sequence});
 return new Blob(parts,{type:'application/vnd.orbit.backup'});
}
export async function readBackup(blob,passphrase,owner,consume,progress=()=>{}){
 if(!blob||blob.size>BACKUP_LIMIT||blob.size<100)throw Error('Invalid backup size (maximum 160 MB)');
 const reader=blob.stream().pipeThrough(new TextDecoderStream()).getReader();
 let pending='',headerText=null,key,sequence=0,ended=false,total=0;
 async function line(value){
  if(value.length>3*1024*1024)throw Error('Archive record exceeds the size limit');
  if(headerText===null){
   const h=JSON.parse(value);
   if(h.format!=='orbit-chat-backup'||h.version!==1||h.cipher!=='AES-256-GCM'||h.kdf!=='PBKDF2-SHA256'||h.iterations!==600000||h.owner!==owner||typeof h.id!=='string'||h.id.length!==36)throw Error('Unsupported backup or different Orbit account');
   const salt=unb64(h.salt);if(salt.length!==16)throw Error('Invalid archive salt');
   headerText=value;key=await derive(passphrase,salt,'decrypt');return;
  }
  if(ended)throw Error('Unexpected data after the archive footer');
  const item=JSON.parse(value);if(item.sequence!==sequence)throw Error('Archive records are missing or reordered');
  const iv=unb64(item.iv);if(iv.length!==12)throw Error('Invalid archive nonce');
  let plain;
  try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:enc.encode(headerText+'|'+sequence)},key,unb64(item.data)));}
  catch{throw Error('Incorrect backup passphrase or the archive was changed');}
  try{const record=JSON.parse(dec.decode(plain));if(record.kind==='end'){if(record.records!==sequence)throw Error('Invalid archive footer');ended=true;}else await consume(record);}
  finally{plain.fill(0);}
  sequence++;progress(sequence,total);
 }
 try{
  while(true){const next=await reader.read();if(next.done)break;total+=next.value.length;pending+=next.value;
   let split;while((split=pending.indexOf('\n'))>=0){const value=pending.slice(0,split);pending=pending.slice(split+1);if(!value)throw Error('Invalid empty record');await line(value);}
   if(pending.length>3*1024*1024)throw Error('Archive record exceeds the size limit');
  }
  if(pending||!ended)throw Error('Backup is incomplete');
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export const backupBase64=b64;
export const backupBytes=unb64;

