// Server-side RSS aggregation avoids client CORS proxies and their ten-story limits.
const feeds={global:'https://feeds.bbci.co.uk/news/world/rss.xml',india:'https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml',tech:'https://feeds.bbci.co.uk/news/technology/rss.xml',finance:'https://feeds.bbci.co.uk/news/business/rss.xml',entertainment:'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml',sports:'https://feeds.bbci.co.uk/sport/rss.xml'};
// Decode escaped feed markup before stripping tags; never return HTML as summary text.
const entities=s=>s.replace(/&(amp|quot|apos|lt|gt|nbsp);/gi,(_,x)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[x.toLowerCase()])).replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>{const value=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return value>0&&value<=0x10ffff?String.fromCodePoint(value):' ';});
function unpack(value){let text=String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1');for(let i=0;i<3;i++)text=entities(text);return text;}
const decode=value=>unpack(value).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const guardian={global:'world',india:'world/india',tech:'technology',finance:'business',entertainment:'culture',sports:'sport'};
const url=s=>{try{const u=new URL(decode(s));return /^https?:$/.test(u.protocol)?u.href:'';}catch{return '';}};
function parseFeed(xml,category,publisher){
 return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,100).map(([,block])=>{
  const read=name=>decode(block.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i'))?.[1]);
  let title=read('title');const source=read('source')||publisher;if(publisher==='Google News')title=title.replace(/\s+[–-]\s+[^–-]+$/,'');
  const link=url(read('link')),date=Date.parse(read('pubDate'));
  if(!title||!link||!Number.isFinite(date)||date>Date.now()+300000||date<Date.now()-7*86400000)return null;
  const attr=(tag,key)=>tag.match(new RegExp('\\b'+key+'=["\']([^"\']+)["\']','i'))?.[1]||'';
  const candidates=[...block.matchAll(/<(?:media:(?:thumbnail|content)|enclosure)\b[^>]*>/gi)].map(([tag])=>({src:attr(tag,'url'),width:Number(attr(tag,'width'))||320,type:attr(tag,'type'),medium:attr(tag,'medium')})).filter(image=>!image.type||image.type.startsWith('image/')).filter(image=>image.medium!=='video').sort((a,b)=>Math.abs(a.width-640)-Math.abs(b.width-640));
  const description=unpack(block.match(/<description(?:\s[^>]*)?>([\s\S]*?)<\/description>/i)?.[1]);
  const img=candidates.map(image=>url(image.src)).find(Boolean)||url(description.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1]);
  return {id:category+'_'+encodeURIComponent(link),title,source,pubDate:new Date(date).toISOString(),img,body:read('description').slice(0,700)||title,link,category};
 }).filter(Boolean);
}
async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const category=String(req.query?.category||'global');if(!Object.hasOwn(feeds,category))return res.status(400).json({error:'Unknown category'});
 const results=await Promise.allSettled([[feeds[category],category==='india'?'Hindustan Times':category==='sports'?'BBC Sport':'BBC News'],[category==='india'?'https://www.thehindu.com/news/national/feeder/default.rss':'https://www.theguardian.com/'+guardian[category]+'/rss',category==='india'?'The Hindu':'The Guardian']].map(async([feed,publisher])=>{
  const r=await fetch(feed,{signal:AbortSignal.timeout(6500),headers:{'User-Agent':'OrbitNews/1.0','Accept':'application/rss+xml,application/xml'}});if(!r.ok)throw Error('Feed unavailable');const xml=await r.text();if(xml.length>2000000)throw Error('Feed too large');return parseFeed(xml,category,publisher);
 }));
 // Prefer real publisher articles with their own images. The client retains an outage fallback.
 const publisherItems=results.slice(0,2).flatMap(r=>r.status==='fulfilled'?r.value:[]);
 const imageItems=publisherItems.filter(row=>row.img);
 const pool=imageItems.length>=20?imageItems:results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
 const seen=new Set(),items=pool.sort((a,b)=>Date.parse(b.pubDate)-Date.parse(a.pubDate)).filter(row=>{const key=row.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');if(seen.has(key))return false;seen.add(key);return true;}).slice(0,60);
 if(!items.length)return res.status(503).json({error:'Live headlines unavailable'});
 res.setHeader('Cache-Control','public, s-maxage=60, stale-while-revalidate=120');return res.status(200).json({items,fetchedAt:new Date().toISOString(),sources:results.filter(r=>r.status==='fulfilled').length});
}
module.exports=handler;module.exports.parseFeed=parseFeed;
