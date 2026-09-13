// Local deadlines are deliberately excluded from backup/sync data.
function automationJitter() { return 30000 + crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * 270000; }
async function automationStatus() {
  const d=await chrome.storage.local.get(['automationSchedule','backupMode','backupAuto','backupIntervalHours','backupIntervalDays','lastBackupAt','syncAuto','lastSyncAt','webdav','pendingCloudBackup','lastCloudAttemptAt','restoreInProgress','syncInProgress']);
  const now=Date.now(),saved=d.automationSchedule||{},next={},result={};
  const paused=!!(d.restoreInProgress||d.syncInProgress),cloud=modeOf(d)==='webdav'&&!!d.webdav?.enabled;
  const specs={backup:{enabled:modeOf(d)!=='local'&&d.backupAuto!==false,period:intervalOf(d)*3600e3,anchor:d.lastBackupAt},sync:{enabled:cloud&&!!d.syncAuto,period:15*60e3,anchor:d.lastSyncAt},retry:{enabled:cloud&&!!d.pendingCloudBackup,period:5*60e3,anchor:d.lastCloudAttemptAt,identity:d.pendingCloudBackup}};
  for(const [kind,s] of Object.entries(specs)) {
    const state=paused?'paused':s.enabled?'waiting':'off';
    if(state!=='waiting'){result[kind]={state,nextAt:null};continue;}
    const signature=JSON.stringify([s.period,s.anchor||null,s.identity||null]);
    let entry=saved[kind];
    if(!entry||entry.signature!==signature||!Number.isFinite(entry.at)) {
      const anchor=Date.parse(s.anchor);
      entry={signature,at:Math.max(now,Number.isFinite(anchor)?anchor+s.period:now)+automationJitter()};
    } else if(now-entry.at>60000) {
      // A missed alarm after sleep/restart gets one fresh, persisted stagger.
      entry={signature,at:now+automationJitter()};
    }
    next[kind]=entry;result[kind]={state,nextAt:entry.at};
  }
  if(JSON.stringify(saved)!==JSON.stringify(next))await chrome.storage.local.set({automationSchedule:next});
  return result;
}
async function refreshAutomationAlarm() {
  const status=await automationStatus(),times=Object.values(status).map(s=>s.nextAt).filter(Number.isFinite);
  const name='bookmark-task-due';
  if(!times.length){await chrome.alarms.clear(name);return;}
  // Chrome may delay alarms. The UI shows a planned time, never a success claim.
  const when=Math.max(Date.now()+500,Math.min(...times));
  const current=await chrome.alarms.get(name);
  if(!current||Math.abs(current.scheduledTime-when)>1000)await chrome.alarms.create(name,{when});
}

async function deferFailedAutomation() {
  const {automationSchedule={}}=await chrome.storage.local.get('automationSchedule');
  const now=Date.now();let changed=false;
  for(const kind of ['backup','retry'])if(automationSchedule[kind]?.at<=now){automationSchedule[kind].at=now+300000+automationJitter();changed=true;}
  if(changed)await chrome.storage.local.set({automationSchedule});
}
