// Server-side RSS aggregation avoids client CORS proxies and their ten-story limits.
const feeds={global:'https://feeds.bbci.co.uk/news/world/rss.xml',india:'https://feeds.bbci.co.uk/news/world/asia/india/rss.xml',tech:'https://feeds.bbci.co.uk/news/technology/rss.xml',finance:'https://feeds.bbci.co.uk/news/business/rss.xml',entertainment:'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml',sports:'https://feeds.bbci.co.uk/sport/rss.xml'};
const topics={global:'world when:1d',india:'India when:1d',tech:'technology artificial intelligence when:1d',finance:'finance markets when:1d',entertainment:'entertainment cinema music when:1d',sports:'sports cricket football when:1d'};
const decode=s=>String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ').replace(/&(amp|quot|apos|lt|gt);/g,(_,x)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[x])).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(0x10ffff,Number(n)))).replace(/\s+/g,' ').trim();
const url=s=>{try{const u=new URL(decode(s));return /^https?:$/.test(u.protocol)?u.href:'';}catch{return '';}};
function parseFeed(xml,category,publisher){
 return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,100).map(([,block])=>{
  const read=name=>decode(block.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i'))?.[1]);
  let title=read('title');const source=read('source')||publisher;if(publisher==='Google News')title=title.replace(/\s+[–-]\s+[^–-]+$/,'');
  const link=url(read('link')),date=Date.parse(read('pubDate'));
  if(!title||!link||!Number.isFinite(date)||date>Date.now()+300000||date<Date.now()-7*86400000)return null;
  const img=url(block.match(/<media:(?:thumbnail|content)[^>]*\burl=["']([^"']+)["']/i)?.[1]);
  return {id:category+'_'+encodeURIComponent(link),title,source,pubDate:new Date(date).toISOString(),img,body:read('description').slice(0,700)||title,link,category};
 }).filter(Boolean);
}
async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const category=String(req.query?.category||'global');if(!Object.hasOwn(feeds,category))return res.status(400).json({error:'Unknown category'});
 const google='https://news.google.com/rss/search?'+new URLSearchParams({q:topics[category],hl:category==='india'?'en-IN':'en-US',gl:category==='india'?'IN':'US',ceid:category==='india'?'IN:en':'US:en'});
 const results=await Promise.allSettled([[feeds[category],category==='sports'?'BBC Sport':'BBC News'],[google,'Google News']].map(async([feed,publisher])=>{
  const r=await fetch(feed,{signal:AbortSignal.timeout(6500),headers:{'User-Agent':'OrbitNews/1.0','Accept':'application/rss+xml,application/xml'}});if(!r.ok)throw Error('Feed unavailable');const xml=await r.text();if(xml.length>2000000)throw Error('Feed too large');return parseFeed(xml,category,publisher);
 }));
 const seen=new Set(),items=results.flatMap(r=>r.status==='fulfilled'?r.value:[]).sort((a,b)=>Date.parse(b.pubDate)-Date.parse(a.pubDate)).filter(row=>{const key=row.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');if(seen.has(key))return false;seen.add(key);return true;}).slice(0,60);
 if(!items.length)return res.status(503).json({error:'Live headlines unavailable'});
 res.setHeader('Cache-Control','public, s-maxage=60, stale-while-revalidate=120');return res.status(200).json({items,fetchedAt:new Date().toISOString(),sources:results.filter(r=>r.status==='fulfilled').length});
}
module.exports=handler;module.exports.parseFeed=parseFeed;
