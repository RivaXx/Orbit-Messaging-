import * as pgp from '../assets/vendor/openpgp.min.mjs';
import {createOrbitCryptoEngine} from './e2ee-core.mjs';
const engine=createOrbitCryptoEngine(pgp);
const allowed=new Set(['generate','unlock','encrypt','decrypt','encryptFile','decryptFile','lock','status']);
// Private keys live only in this worker. Serialize operations so account changes
// cannot race a key generation or recovery operation.
let lane=Promise.resolve();
self.onmessage=({data})=>{
 lane=lane.then(async()=>{
  const {id,method,args}=data||{};
  if(!Number.isSafeInteger(id)||!allowed.has(method)||!Array.isArray(args))return;
  try{self.postMessage({id,result:await engine[method](...args)});}
  catch(error){self.postMessage({id,error:String(error?.message||'Encryption operation failed')});}
 }).catch(()=>{});
};
