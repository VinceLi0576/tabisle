const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function background({backup=async()=>{},sync=async()=>{}}={}) {
  const listeners={},events=[],errors=[];
  const event=name=>({addListener:fn=>{listeners[name]=fn;}});
  const context=vm.createContext({
    importScripts(){}, console:{error:e=>errors.push(e)},
    maybeBackup:async()=>{events.push('backup');return backup();},
    maybeSync:async()=>{events.push('sync');return sync();},
    ensureBackupAlarm:async()=>events.push('alarm'),
    chrome:{runtime:{id:'test',getURL:()=> 'chrome-extension://test/',onMessage:event('message'),onInstalled:event('install'),onStartup:event('startup')},alarms:{onAlarm:event('alarm')},sidePanel:{setPanelBehavior:async()=>{}}}
  });
  vm.runInContext(fs.readFileSync(require.resolve('../background.js'),'utf8'),context);
  return {listeners,events,errors,drain:()=>vm.runInContext('taskTail',context)};
}
test('all automatic entry points still check sync when archival backup fails',async()=>{
  for(const trigger of ['install','startup','alarm','message']) {
    const b=background({backup:async()=>{throw Error('archive unavailable');}});
    let response;
    if(trigger==='message')b.listeners.message({type:'APP_READY'},{id:'test',url:'chrome-extension://test/newtab.html'},r=>{response=r;});
    else if(trigger==='alarm')b.listeners.alarm({name:'daily-bookmark-backup'});
    else b.listeners[trigger]();
    await b.drain();
    assert.deepEqual(b.events.filter(e=>e!=='alarm'),['backup','sync'],trigger);
    if(trigger==='message'){assert.equal(response.ok,false);assert.equal(response.error,'archive unavailable');}
    else assert.equal(b.errors[0].message,'archive unavailable');
  }
});
test('sync waits for backup settlement and scheduled runs never overlap',async()=>{
  let release;
  const b=background({backup:()=>new Promise(r=>{release=r;})});
  b.listeners.alarm({name:'daily-bookmark-backup'});
  b.listeners.alarm({name:'daily-bookmark-backup'});
  await new Promise(setImmediate);assert.deepEqual(b.events,['backup']);
  release();await new Promise(setImmediate);assert.deepEqual(b.events,['backup','sync','backup']);
  release();await b.drain();assert.deepEqual(b.events,['backup','sync','backup','sync']);
});
test('sync failure is reported and does not poison subsequent scheduled runs',async()=>{
  let failed=true;
  const b=background({sync:async()=>{if(failed)throw Error('sync safeguard refused');}});
  b.listeners.alarm({name:'daily-bookmark-backup'});await b.drain();
  assert.equal(b.errors[0].message,'sync safeguard refused');failed=false;
  b.listeners.alarm({name:'daily-bookmark-backup'});await b.drain();
  assert.deepEqual(b.events,['backup','sync','backup','sync']);
});
