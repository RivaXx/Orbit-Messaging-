'use strict';
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const root=require('node:path').join(__dirname,'..');
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024});
const findings=[];
function scan(text,label){
 for(const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[]){
  try{const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));if(claims.role==='service_role')findings.push(label+': privileged Supabase JWT');}catch(_){}
 }
 for(const [name,pattern] of [
  ['Supabase secret key',/sb_secret_[A-Za-z0-9_-]{20,}/],
  ['GitHub access token',/gh[pousr]_[A-Za-z0-9]{36,}/],
  ['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]
 ])if(pattern.test(text))findings.push(label+': '+name);
}
for(const file of git(['ls-files','-z']).split('\0').filter(Boolean)){
 if(/(?:^|\/)\.env(?:\.|$)/i.test(file)&&!/(?:example|sample|template)$/i.test(file))findings.push(file+': environment file tracked');
 if(/\.(?:pem|key|p12|pfx)$/i.test(file))findings.push(file+': credential file tracked');
 scan(fs.readFileSync(require('node:path').join(root,file),'utf8'),file);
}
if(process.argv.includes('--history'))scan(git(['log','--all','-p','--format=','--','.']), 'Git history');
if(findings.length){console.error([...new Set(findings)].join('\n'));process.exitCode=1;}
else console.log('No supported secret patterns found'+(process.argv.includes('--history')?' in tracked files and fetched Git history.':' in tracked files.'));
// This is a guard for common credentials, not a complete security audit.
