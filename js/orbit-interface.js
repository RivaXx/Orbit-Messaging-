// Update conversation rows in place: presence must not refetch or rebuild the feed.
let orbitConversationOwner=null,orbitUnreadEpoch=0,orbitUnreadTimer=null,orbitUnreadRequest=null;
const orbitConversationItems=new Map(),orbitUnreadCounts=new Map(),orbitRecentMessageIds=new Set();
function orbitEnsureConversationOwner(){
 const owner=currentUser?.id||null;if(owner===orbitConversationOwner)return;
 orbitConversationOwner=owner;orbitUnreadEpoch++;orbitConversationItems.clear();orbitUnreadCounts.clear();orbitRecentMessageIds.clear();
}
function orbitConversationAliases(room){try{return [...new Set([room,...resolveRoomAliases(room)])];}catch{return [room];}}
function orbitConversationUnread(room){
 orbitEnsureConversationOwner();const aliases=orbitConversationAliases(room);
 const count=aliases.reduce((total,id)=>total+(orbitUnreadCounts.get(id)||0),0);
 return count || (aliases.some(id=>unreadRoomsSet.has(id))?null:0);
}
function orbitConversationPreview(message,isGroup=false){
 let text=message.is_deleted?'Message deleted':message.type==='call'?'Voice call':message.type==='poll'?'Poll':message.type==='location'?'Location':message.type==='contact'?'Contact':message.text||'';
 if(message.attachments?.length && !text){let attachments=message.attachments;try{if(typeof attachments==='string')attachments=JSON.parse(attachments);}catch{attachments=[];}
  const photos=Array.isArray(attachments)?attachments.filter(a=>a?.type==='image').length:0;
  text=photos?`${photos} photo${photos===1?'':'s'}`:'Attachment';}
 if(!text)text='Message';
 return isGroup&&message.sender_id!==currentUser?.id&&message.username?`${message.username}: ${text}`:message.sender_id===currentUser?.id?`You: ${text}`:text;
}
function orbitRenderConversationCard(card,item){
 orbitEnsureConversationOwner();orbitConversationItems.set(item.roomId,{...item});
 const count=orbitConversationUnread(item.roomId),muted=(window.OrbitChatSelect?.getMutedRooms()||[]).some(id=>orbitConversationAliases(item.roomId).includes(id));
 const isUnread=count===null||count>0||item.isUnread;
 const presence=item.isGroup?item.presenceDisplay:orbitChatPresence(item.peerUserId)||(localStorage.getItem('orbit_privacy_last_seen')==='nobody'?'Last seen hidden':'Last seen unavailable');
 card.dataset.roomId=item.roomId;card.dataset.peerId=item.peerUserId||'';card.dataset.group=String(!!item.isGroup);
 card.classList.toggle('orbit-chat-unread',!!isUnread);
 card.innerHTML=`<div class="c-av-wrap">${item.avatarHtml||'<i class="fa-solid fa-comments"></i>'}</div><div class="c-info-wrap"><div class="c-top-row"><span class="c-name">${escapeHtml(item.title)}</span><span class="c-time">${escapeHtml(item.timeDisplay||'')}</span></div><div class="c-preview-row"><span class="c-last-msg">${escapeHtml(item.msgPreview||'Message')}</span><span class="orbit-chat-markers">${muted?'<i class="fa-solid fa-bell-slash" title="Muted"></i>':''}${item.isPinned?'<i class="fa-solid fa-thumbtack" title="Pinned"></i>':''}<span class="orbit-chat-count${isUnread?'':' hide'}" aria-label="${count?`${count} unread messages`:'Unread messages'}">${count?count>99?'99+':count:'•'}</span></span></div><div class="c-presence-line${presence==='Online'?' is-online':''}">${escapeHtml(presence)}</div></div>`;
}
function orbitRefreshChatPresence(){
 if(document.hidden)return;
 document.querySelectorAll('#main-chats-list [data-peer-id]').forEach(card=>{
  if(card.dataset.group==='true')return;const status=card.querySelector('.c-presence-line');if(!status)return;
  const text=orbitChatPresence(card.dataset.peerId)||(localStorage.getItem('orbit_privacy_last_seen')==='nobody'?'Last seen hidden':'Last seen unavailable');
  if(status.textContent!==text)status.textContent=text;status.classList.toggle('is-online',text==='Online');
 });
}
function orbitRefreshUnreadRows(){
 document.querySelectorAll('#main-chats-list [data-room-id]').forEach(card=>{const item=orbitConversationItems.get(card.dataset.roomId);if(!item)return;
  const count=orbitConversationUnread(item.roomId);item.isUnread=count!==0;
  card.classList.toggle('orbit-chat-unread',item.isUnread);const badge=card.querySelector('.orbit-chat-count');if(badge){badge.textContent=count?count>99?'99+':String(count):'•';badge.classList.toggle('hide',!item.isUnread);badge.setAttribute('aria-label',count?`${count} unread messages`:'Unread messages');}
 });
 if(typeof updateTabUnreadBadges==='function')updateTabUnreadBadges();
 const tabBadge=document.getElementById('tab-unread-chats');if(tabBadge){const rooms=new Set([...unreadRoomsSet].map(room=>orbitConversationAliases(room).sort()[0]));tabBadge.textContent=rooms.size>99?'99+':String(rooms.size);tabBadge.classList.toggle('hide',rooms.size===0);tabBadge.setAttribute('aria-label',`${rooms.size} unread conversations`);}
}
async function orbitRefreshUnreadCounts(){
 orbitEnsureConversationOwner();if(!orbitConversationOwner||!navigator.onLine)return;
 if(orbitUnreadRequest)return orbitUnreadRequest;
 const owner=orbitConversationOwner,epoch=orbitUnreadEpoch;
 const task=(async()=>{await Promise.resolve();try{const client=await ensureSupabase();const {data,error}=await client.rpc('orbit_unread_counts');
  if(error||!Array.isArray(data)||currentUser?.id!==owner||epoch!==orbitUnreadEpoch)return;
  orbitUnreadCounts.clear();unreadRoomsSet.clear();
  data.forEach(row=>{const count=Number(row.unread_count);if(typeof row.room==='string'&&Number.isFinite(count)&&count>0){orbitUnreadCounts.set(row.room,count);unreadRoomsSet.add(row.room);}});
  orbitRefreshUnreadRows();
 }catch(_){}finally{if(orbitUnreadRequest===task)orbitUnreadRequest=null;if(currentUser?.id===owner&&epoch!==orbitUnreadEpoch)orbitScheduleUnreadRefresh();}})();
 orbitUnreadRequest=task;return task;
}
function orbitScheduleUnreadRefresh(){clearTimeout(orbitUnreadTimer);orbitUnreadTimer=setTimeout(()=>orbitRefreshUnreadCounts(),700);}
function orbitReceiveConversationMessage(message){
 orbitEnsureConversationOwner();if(!message?.id||orbitRecentMessageIds.has(message.id))return;
 orbitRecentMessageIds.add(message.id);if(orbitRecentMessageIds.size>500)orbitRecentMessageIds.delete(orbitRecentMessageIds.values().next().value);
 const visible=typeof isOrbitChatVisible==='function'&&isOrbitChatVisible(message.room);
 if(message.sender_id!==currentUser?.id&&!visible){orbitUnreadCounts.set(message.room,(orbitUnreadCounts.get(message.room)||0)+1);unreadRoomsSet.add(message.room);orbitUnreadEpoch++;}
 const aliases=orbitConversationAliases(message.room);
 const cards=Array.from(document.querySelectorAll('#main-chats-list [data-room-id]'));
 const card=cards.find(row=>aliases.includes(row.dataset.roomId));
 if(card){const item=orbitConversationItems.get(card.dataset.roomId);if(item){item.msgPreview=orbitConversationPreview(message,item.isGroup);item.timeDisplay=orbitFormatMessageTime(message.created_at);item.isUnread=orbitConversationUnread(item.roomId)!==0;orbitRenderConversationCard(card,item);
  if(!item.isPinned&&!window.isInChatSelectionMode?.()){const firstUnpinned=cards.find(row=>!orbitConversationItems.get(row.dataset.roomId)?.isPinned);if(firstUnpinned&&firstUnpinned!==card)firstUnpinned.before(card);}}}
 else if(!visible&&typeof loadMainChats==='function'){clearTimeout(orbitReceiveConversationMessage.timer);orbitReceiveConversationMessage.timer=setTimeout(()=>loadMainChats(),250);}
 orbitRefreshUnreadRows();orbitScheduleUnreadRefresh();
}
function orbitClearConversationUnread(room){
 orbitEnsureConversationOwner();orbitConversationAliases(room).forEach(id=>{orbitUnreadCounts.delete(id);unreadRoomsSet.delete(id);});orbitUnreadEpoch++;orbitRefreshUnreadRows();
}
function orbitAttachConnectivity(){const badge=document.getElementById('orbit-connectivity'),slot=document.getElementById('orbit-banner-connection');if(badge&&slot&&badge.parentElement!==slot)slot.append(badge);}
function orbitUpdateVisualActivity(){document.body.classList.toggle('orbit-page-hidden',document.hidden);}
document.addEventListener('DOMContentLoaded',()=>{orbitAttachConnectivity();orbitUpdateVisualActivity();});
document.addEventListener('visibilitychange',()=>{orbitUpdateVisualActivity();if(!document.hidden){orbitRefreshChatPresence();orbitRefreshUnreadCounts();}});
setInterval(()=>{if(!document.hidden){orbitRefreshChatPresence();if(currentUser)orbitRefreshUnreadCounts();if(document.querySelector('.liquid-tab-btn.active')?.dataset.tab==='global')renderGlobalUsersDOM(Array.from(globalUsersMap.values()));}},45000);
