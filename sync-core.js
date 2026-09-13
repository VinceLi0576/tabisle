// Original TabIsle three-way merge. No floccus source is incorporated.
(function(root){
  const BK=root.BookmarkCore||(typeof require==='function'?require('./bookmark-core.js'):null);
  const equal=(a,b)=>BK.stableStringify(a)===BK.stableStringify(b);
  const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
  const flat=s=>BK.flatten(s?.children||[]);
  const content=n=>n?{title:n.title,url:n.url,parent:n.parent}:undefined;
  function align(local,reference){
    if(!reference)return clone(local);
    const map=new Map(),used=new Set();
    for(const [uid,n]of BK.plan(local,reference).match){map.set(n.uid,uid);used.add(uid);}
    // Pair remaining identical occurrences one-to-one; never collapse intentional duplicates.
    for(const n of flat(local))if(!map.has(n.uid)){
      const r=flat(reference).find(r=>!used.has(r.uid)&&r.path===n.path&&r.url===n.url);
      if(r){map.set(n.uid,r.uid);used.add(r.uid);}
    }
    const walk=nodes=>nodes.map(n=>({...n,uid:map.get(n.uid)||n.uid,...(n.children?{children:walk(n.children)}:{})}));
    return {...clone(local),children:walk(local.children),folderState:Object.fromEntries(Object.entries(local.folderState||{}).map(([uid,v])=>[map.get(uid)||uid,v]))};
  }
  function merge(base,inputLocal,remote,choices={},tombstones=[]){
    BK.validate(inputLocal);if(base)BK.validate(base);if(remote)BK.validate(remote);
    let local=align(inputLocal,base||remote);
    if(base&&remote){
      // Match arrivals delivered by browser account sync against new remote entities only.
      const known=new Set(flat(base).map(n=>n.uid));
      const newRemote=flat(remote).filter(n=>!known.has(n.uid));
      const localFlat=flat(local),remap=new Map(),used=new Set(localFlat.map(n=>n.uid));
      for(const n of localFlat)if(!known.has(n.uid)&&!newRemote.some(r=>r.uid===n.uid)){
        const matches=newRemote.filter(r=>!used.has(r.uid)&&r.path===n.path&&r.url===n.url);
        if(matches.length===1){remap.set(n.uid,matches[0].uid);used.add(matches[0].uid);}
      }
      const walk=nodes=>nodes.map(n=>({...n,uid:remap.get(n.uid)||n.uid,...(n.children?{children:walk(n.children)}:{})}));
      local={...local,children:walk(local.children),folderState:Object.fromEntries(Object.entries(local.folderState||{}).map(([k,v])=>[remap.get(k)||k,v]))};
    }
    const B=new Map(flat(base).map(n=>[n.uid,n])),L=new Map(flat(local).map(n=>[n.uid,n])),R=new Map(flat(remote).map(n=>[n.uid,n]));
    const conflicts=[],nodes=new Map(),forced=new Map();
    function conflict(id,path,field,l,r){const choice=choices[id];conflicts.push({id,path,field,local:clone(l),remote:clone(r),choice:['local','remote'].includes(choice)?choice:null,...(field==='位置'?{localLabel:L.get(l)?.path||'书签栏',remoteLabel:R.get(r)?.path||'书签栏'}:field==='排序'?{localLabel:(l||[]).map(id=>L.get(id)?.title||id).join(' → '),remoteLabel:(r||[]).map(id=>R.get(id)?.title||id).join(' → ')}:{})});return clone(choice==='remote'?r:l);}
    function value(b,l,r,id,path,field){if(equal(l,r))return clone(l);if(equal(l,b))return clone(r);if(equal(r,b))return clone(l);return conflict(id,path,field,l,r);}
    const branch=(map,uid)=>{const n=map.get(uid);if(!n)return undefined;return {...content(n),children:[...map.values()].filter(x=>x.parent===uid).map(x=>({uid:x.uid,...branch(map,x.uid)}))};};
    for(const uid of new Set([...B.keys(),...L.keys(),...R.keys()])){
      const b=B.get(uid),l=L.get(uid),r=R.get(uid),path=(l||r||b).path;let n;
      if(forced.has(uid)&&(!l||!r)){n=forced.get(uid)==='local'?l:r;}
      else if(!l||!r){
        const present=l||r;
        if(!b)n=present;
        else if(!present)n=undefined;
        else if(equal(branch(B,uid),branch(l?L:R,uid)))n=undefined;
        else n=conflict(uid+':presence',path,'删除与修改',l?content(l):undefined,r?content(r):undefined);
        if(n)n={...present,...n};
      }else{
        if(('url' in l)!==('url' in r))throw Error('同步标识对应了不同类型，请重新检查备份');
        n={...l};for(const k of ['title','url','parent'])n[k]=value(b?.[k],l[k],r[k],uid+':'+k,path,{title:'名称',url:'网址',parent:'位置'}[k]);
      }
      if(n&&!b&&tombstones.some(t=>t.uid===uid||(t.path===n.path&&t.url===n.url))){
        const keep=conflict(uid+':return',path,'可能是旧同步回流，也可能是重新收藏','保留','移除');if(keep==='移除')n=undefined;
      }
      if(n){
        nodes.set(uid,{...n,uid});
        if(n.children&&(!l||!r)){
          const side=l?'local':'remote',present=l?L:R,absent=l?R:L;
          const keepChildren=parent=>{for(const child of present.values())if(child.parent===parent){if(!absent.has(child.uid))forced.set(child.uid,side);keepChildren(child.uid);}};
          keepChildren(uid);
        }
      }
    }
    // Choosing a folder deletion also removes descendants that have not moved out.
    let removed=true;while(removed){removed=false;for(const [uid,n]of nodes)if(n.parent&&!nodes.has(n.parent)){nodes.delete(uid);removed=true;}}
    for(const n of nodes.values()){
      const seen=new Set([n.uid]);let parent=n.parent;
      while(parent){if(seen.has(parent))throw Error('两端移动合并后形成文件夹循环，请先调整其中一端的位置');seen.add(parent);parent=nodes.get(parent)?.parent;}
    }
    function order(parent){
      const kids=[...nodes.values()].filter(n=>n.parent===parent),ids=new Set(kids.map(n=>n.uid));
      const seq=map=>[...map.values()].filter(n=>n.parent===parent&&ids.has(n.uid)).map(n=>n.uid);
      const b=seq(B),l=seq(L),r=seq(R),common=new Set(b.filter(x=>l.includes(x)&&r.includes(x)));
      const bc=b.filter(x=>common.has(x)),lc=l.filter(x=>common.has(x)),rc=r.filter(x=>common.has(x));
      let primary=equal(lc,bc)?r:equal(rc,bc)?l:equal(lc,rc)?r:conflict(parent+':order',nodes.get(parent)?.path||'书签栏','排序',l,r);
      const out=[...primary],secondary=equal(primary,l)?r:l;
      for(let i=0;i<secondary.length;i++){const id=secondary[i];if(out.includes(id))continue;const next=secondary.slice(i+1).find(x=>out.includes(x));out.splice(next?out.indexOf(next):out.length,0,id);}
      for(const id of ids)if(!out.includes(id))out.push(id);
      return out.map(uid=>{const n=nodes.get(uid);return {uid,title:n.title,...(n.dateAdded?{dateAdded:n.dateAdded}:{}),...(typeof n.url==='string'?{url:n.url}:{children:order(uid)})};});
    }
    function object(b,l,r,path){
      if(equal(l,r))return clone(l);if(equal(l,b))return clone(r);if(equal(r,b))return clone(l);
      if(l&&r&&typeof l==='object'&&typeof r==='object'&&!Array.isArray(l)&&!Array.isArray(r)){
        const out={};for(const k of new Set([...Object.keys(b||{}),...Object.keys(l),...Object.keys(r)])){const v=object(b?.[k],l[k],r[k],path+'/'+k);if(v!==undefined)out[k]=v;}return out;
      }
      if(Array.isArray(l)&&Array.isArray(r)&&l.every(x=>typeof x==='string')&&r.every(x=>typeof x==='string')){
        const old=Array.isArray(b)?b:[];return [...new Set([...l,...r])].filter(x=>!old.includes(x)||(l.includes(x)&&r.includes(x))).sort();
      }
      return conflict('meta:'+path,path,'附属字段',l,r);
    }
    const tagMap=s=>Object.fromEntries((s?.meta.tags||[]).map(t=>[t.id,t]));
    const meta={items:object(base?.meta.items,local.meta.items,remote?.meta.items||{},'备注')||{},groups:object(base?.meta.groups,local.meta.groups,remote?.meta.groups||{},'分组')||{},tags:Object.values(object(base?tagMap(base):undefined,tagMap(local),tagMap(remote),'标签')||{})};
    const snapshot={...clone(local),children:order(''),meta};
    // Display and folding preferences stay per-device during sync; full backups still migrate them.
    BK.validate(snapshot);
    return {snapshot,local,conflicts,unresolved:conflicts.filter(c=>!c.choice).length,tombstones:[...tombstones,...[...B.values()].filter(n=>!nodes.has(n.uid)).map(n=>({uid:n.uid,path:n.path,url:n.url}))].slice(-1000)};
  }
  root.SyncCore={merge,align,equal};if(typeof module!=='undefined')module.exports=root.SyncCore;
})(globalThis);
