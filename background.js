importScripts('write-lease.js', 'bookmark-core.js', 'bm-core.js', 'backup-worker.js', 'sync-core.js', 'sync-worker.js', 'editor-worker.js', 'automation-worker.js');

let taskTail = Promise.resolve();
function queueTask(fn) { const task = taskTail.then(fn).finally(() => typeof refreshAutomationAlarm==='function' ? refreshAutomationAlarm().catch(console.error) : undefined); taskTail = task.catch(() => {}); return task; }
// A failed archival upload must not prevent sync from checking its own safeguards.
// Keep both operations serial: they share bookmark identity and recovery state.
async function runScheduledTasks() {
  let backupError;
  try { await maybeBackup(); } catch (error) { backupError = error; }
  await maybeSync();
  if (backupError) throw backupError;
}
const internal = (sender) => sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!internal(sender) || !message?.type) return;
  const fn = async () => {
    if (message.type === 'AUTOMATION_STATUS') return automationStatus();
    if (message.type.startsWith('EDITOR_')) return editorAction(message);
    if (message.type.startsWith('SYNC_')) return syncAction(message);
    if (message.type.startsWith('BACKUP_')) return backupAction(message);
    if (message.type === 'BOOKMARK_REMOVE') {
      const policy=await chrome.storage.local.get(['backupMode','lastDeleteSnapshotAt']);
      // 🔴 连着删一批时只留一份「删除前」副本：要的是整批之前那个状态，
      //    每条都拍既慢（一份 800 多条的完整快照）又没有意义，第 2 份起记的都是删了一半的样子。
      await snapshotBeforeDelete('删除前');
      return message.tree ? chrome.bookmarks.removeTree(message.id) : chrome.bookmarks.remove(message.id);
    }
    if (message.type === 'IDENTITY_MAP') return ensureIdentity();
    if (message.type === 'WRITE_ACQUIRE') return WriteLease.acquire(message.owner || 'ai', message.ms);
    if (message.type === 'WRITE_RENEW') return WriteLease.renew(message.id, message.ms);
    if (message.type === 'WRITE_RELEASE') return WriteLease.release(message.id);
    if (message.type === 'WRITE_STATUS') return WriteLease.read();
    // 🔴 附属数据一律走这里合并写，🚫 页面别再整包 set —— 两个页面同时开着就会互相覆盖。
    // 这条消息排在 queueTask 串行链上，所以「读→合并→写」中间插不进别人。
    if (message.type === 'META_MERGE_WRITE') {
      const { meta: current = {} } = await chrome.storage.local.get('meta');
      const merged = BmCore.mergeMetaWrite(message.base, message.mine, current);
      await chrome.storage.local.set({ meta: merged });
      return merged;
    }
    if (message.type === 'ICON_FETCH') return remoteIcon(message.host);
    if (message.type === 'APP_READY') { await ensureBackupAlarm(); return runScheduledTasks(); }
    throw Error('未知操作');
  };
  const result = message.type === 'ICON_FETCH' ? fn() : queueTask(fn);
  result.then(data => respond({ok:true,data}), error => respond({ok:false,error:error.message || String(error)}));
  return true;
});

chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(console.error);
chrome.runtime.onInstalled.addListener(() => queueTask(async()=>{ await ensureBackupAlarm(); await runScheduledTasks(); }).catch(console.error));
chrome.runtime.onStartup.addListener(() => queueTask(async()=>{ await ensureBackupAlarm(); await runScheduledTasks(); }).catch(console.error));
chrome.alarms.onAlarm.addListener(alarm => { if (['daily-bookmark-backup','bookmark-task-due'].includes(alarm.name)) queueTask(runScheduledTasks).catch(console.error); });
chrome.sidePanel.onClosed?.addListener(({windowId}) => chrome.storage.session.set({['editorOpen:'+windowId]:false}));
chrome.sidePanel.onOpened?.addListener(({windowId}) => chrome.storage.session.set({['editorOpen:'+windowId]:true}));

// Fetch images from an extension worker, with host permissions for redirects.
// Share in-flight requests and cap concurrency to avoid hundreds of simultaneous requests.
const iconCache = new Map(); let iconActive = 0; const iconWaiters=[];
async function iconBytes(host) {
  if (iconActive >= 6) await new Promise(resolve=>iconWaiters.push(resolve));
  iconActive++;
  try {
    const response=await fetch('https://www.google.com/s2/favicons?domain='+encodeURIComponent(host)+'&sz=64',{signal:AbortSignal.timeout(8000),credentials:'omit'});
    if (!response.ok) return null;
    const mime=response.headers.get('content-type') || '';
    if (!/^image\/(png|jpeg|webp|gif|x-icon|vnd.microsoft.icon)/i.test(mime)) return null;
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length>262144) return null;
    let binary=''; for(const b of bytes) binary+=String.fromCharCode(b);
    return {encoded:btoa(binary),mime:mime.split(';')[0]};
  } catch { return null; }
  finally { iconActive--; iconWaiters.shift()?.(); }
}
let defaultIcon;
function remoteIcon(host) {
  if(typeof host!=='string'||host.length>253||!/^([a-z0-9-]+\.)+[a-z0-9-]+$/i.test(host)||/\.local$/i.test(host)||/^(\d+\.){3}\d+$/.test(host)) return null;
  if(!iconCache.has(host)) {
    if(iconCache.size>1500)iconCache.clear();
    iconCache.set(host,(async()=>{
      defaultIcon ||= iconBytes('no-such-domain-for-default-icon.invalid');
      const [ref,icon]=await Promise.all([defaultIcon,iconBytes(host)]);
      return icon && icon.encoded!==ref?.encoded ? `data:${icon.mime};base64,${icon.encoded}` : null;
    })());
  }
  return iconCache.get(host);
}
