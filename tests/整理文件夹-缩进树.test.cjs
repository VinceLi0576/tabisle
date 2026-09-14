// 整理文件夹改成一棵缩进的树（老徐 260914）：
//   ①「太密了」「可以宽一点，也可以高一点」⇒ 块放大、每级各一档宽高，🚫 不再是一个写死的 height
//   ②「不要一级二级给它拆出来，类似 Markdown 一样缩进」⇒ 一棵递归的树，🚫 不再是「一级那排＋二级那排」
//   ③「底部『还没有子文件夹的组』直接在一级分组里标上」⇒ 底部那一段删掉，标记回到每一行
//   ④「上下拖拉拽更方便」⇒ 一列到底、落点按纵向中线判，🚫 不再横铺、🚫 不再按左右
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const p = (f) => require('node:path').join(__dirname, '..', f);
// 🔴 app.js 里有 https:// 这类字符串，🚫 别用「// 到行尾」那种粗暴剥法 —— 只剥整行注释
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => (l.trimStart().startsWith('//') ? '' : l)).join('\n');
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const appRaw = fs.readFileSync(p('app.js'), 'utf8');
const app = stripJs(appRaw);
const css = stripCss(fs.readFileSync(p('style.css'), 'utf8'));
const html = fs.readFileSync(p('newtab.html'), 'utf8');
const render = app.match(/function renderOrganize\(\) \{([\s\S]*?)\n  \}\n/)[1];
const rule = (sel) => {
  const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : '';
};

test('② 渲染出来的是一棵递归的树：根一层 .ftree，子夹装进自己的 .fkids', () => {
  assert.match(render, /root\.className = 'frow ftree'/, '没有树根那一层');
  assert.match(render, /const build = \(f, parentId, lv, into\) =>/, '不是递归建树');
  assert.match(render, /subs\.forEach\(\(sf\) => build\(sf, f\.id, lv \+ 1, kids\)\)/, '子夹没有递归进下一层');
  assert.match(render, /kids\.className = 'frow fkids'/, '子夹没有自己的容器 ⇒ 缩不出层级');
  assert.match(render, /node\.appendChild\(kids\)/, '子夹容器没挂在父节点里面 ⇒ 折父夹折不掉子夹');
});

test('② 一级二级不再拆成两段：旧的分段标题和分段容器全没了', () => {
  for (const gone of ['二级文件夹', 'fgrp', 'fdrops', 'forg-deeper', 'appendRow', 'hasSubs', 'noSubs']) {
    assert.ok(!app.includes(gone), `renderOrganize 还留着旧的分段做法：${gone}`);
    assert.ok(!css.includes(gone), `样式里还留着旧的分段做法：${gone}`);
  }
});

test('③ 底部「还没有子文件夹的组」那一段没了，信息回到每一行上', () => {
  assert.ok(!app.includes('还没有子文件夹的组'), '底部那一段还在');
  assert.match(render, /个有子文件夹/, '一级分组那行没有汇总「几个有子夹」');
  assert.match(app, /subs \? `<u class="c-sub">\$\{subs\} 个子夹<\/u>` : '<u class="c-sub none">无子夹<\/u>'/,
    '每块没有标「有几个子夹 / 无子夹」');
  assert.match(app, /subs\s*\n?\s*\? `<button type="button" class="ftwist"/, '有没有子夹没体现成展开三角');
});

test('① 一块里要能看见五样：名字 · 几条书签 · 几个子夹 · 有没有说明 · 有没有锁', () => {
  const chip = app.match(/function fchipEl\(f, parentId, lv, open\) \{([\s\S]*?)\n  \}\n/)[1];
  assert.match(chip, /class="title">\$\{esc\(f\.title/, '没显示名字');
  assert.match(chip, /const direct = \(f\.children \|\| \[\]\)\.filter\(\(k\) => k\.url\)\.length/, '没数这一夹的书签');
  assert.match(chip, /class="c-url">\$\{direct\} 条/, '没显示几条书签');
  assert.match(chip, /const subs = orgSubs\(f\)\.length/, '没数子夹');
  assert.match(chip, /const note = folderNote\(f\.id\)/, '没读文件夹说明');
  assert.match(chip, /class="fnote"[\s\S]*?class="fnote none">没写说明/, '没说明的那块没标出来');
  assert.match(chip, /folderLockedByTitle\(f\.title\) \? '<em class="lk"/, '锁没显示');
});

test('① 宽高按层级分档 —— 🔴 不再是一个写死的 height 管所有块', () => {
  const base = rule('.fchip');
  assert.ok(!/(^|;)\s*height:\s*\d/.test(base), '还写死了 height，块高就又被一刀切了');
  assert.match(base, /min-height: var\(--fh/, '最小高度不是按层级变量来的');
  assert.match(base, /min-width: min\(var\(--fmin/, '最小宽度不是按层级变量来的');
  const levels = [1, 2, 3, 4].map((lv) => rule(`.fchip[data-lv="${lv}"]`));
  levels.forEach((r, i) => {
    assert.match(r, /--fh:\s*\d+px/, `第 ${i + 1} 级没给自己的最小高度`);
    assert.match(r, /--fmin:\s*\d+px/, `第 ${i + 1} 级没给自己的最小宽度`);
  });
  const fh = levels.map((r) => Number(r.match(/--fh:\s*(\d+)px/)[1]));
  const fw = levels.map((r) => Number(r.match(/--fmin:\s*(\d+)px/)[1]));
  assert.equal(new Set(fh).size, 4, `四级的最小高度只有 ${new Set(fh).size} 种 ⇒ 还是一刀切：${fh}`);
  assert.equal(new Set(fw).size, 4, `四级的最小宽度只有 ${new Set(fw).size} 种 ⇒ 还是一刀切：${fw}`);
  assert.ok(fh[0] > 56, `一级块才 ${fh[0]}px，老徐说的是「可以高一点」`);
  assert.ok(fh[0] > fh[1] && fh[1] > fh[2] && fh[2] > fh[3], `越往里越该收，现在是 ${fh}`);
  assert.ok(fw[0] >= 400, `一级块最小宽才 ${fw[0]}px，老徐说的是「可以宽一点」`);
});

test('② 缩进像 Markdown：子夹整体右移一层 ＋ 左边一条竖线连着', () => {
  const k = rule('.fkids');
  assert.match(k, /margin:[^;]*var\(--find/, '子夹那层没有往右缩的缩进量');
  assert.match(k, /border-left:\s*2px solid/, '缩进处没有那条竖线 ⇒ 看不出是同一支');
});

test('④ 一列到底：🚫 不许再 flex-wrap 横铺成一排排', () => {
  const r = rule('.frow');
  assert.match(r, /flex-direction: column/, '整理页又横铺了 —— 老徐要的是按顺序上下拖');
  assert.ok(!/flex-wrap/.test(r), '.frow 还带着 flex-wrap ⇒ 会排成一排排');
});

test('④ 落点提示是上下两条横线，判 before/after 也按纵向中线', () => {
  const marks = css.match(/\.fchip\.drop-before::before, \.fchip\.drop-after::after \{([^}]*)\}/)[1];
  assert.match(marks, /left: -2px; right: -2px/, '落点线还是竖着的 ⇒ 跟上下顺序对不上');
  assert.match(marks, /height:\s*3px/, '落点线没有高度 ⇒ 是竖条不是横条');
  assert.match(css, /\.fchip\.drop-before::before \{ top:/, '前插提示没画在上边');
  assert.match(css, /\.fchip\.drop-after::after \{ bottom:/, '后插提示没画在下边');
  const branch = app.match(/if \(drag\.el\.classList\.contains\('fchip'\)\) \{([\s\S]*?)\n    \}/)[1];
  assert.ok(!/side\(chip, false\)/.test(branch), '还在按左右判落点 ⇒ 上下拖会插错位置');
  assert.match(branch, /pos: side_\(chip\)/, '没改成按纵向中线判 before/after');
  assert.match(branch, /const row = t\.closest\('\.frow'\)/, '拖到空白处没有兜底的「放进这一层」');
});

test('④ 拖拽仍然只认 .fchip、仍然只调 store.move —— 数据那头一点没动', () => {
  assert.match(app, /c\.className = 'fchip'/, '块不带 fchip 类了 ⇒ 拖拽那条分支整个失效');
  assert.match(app, /c\.draggable = true/, '块不可拖了');
  assert.match(app, /await store\.move\(d\.id, \{ parentId: tg\.parentId, index \}\)/, '落子的写法被动过了');
});

test('四种宽度都不横向溢出：靠的是这几条，🚫 别删', () => {
  assert.match(rule('.organize'), /max-width: min\(1400px, 100%\)/, '整块没封顶 ⇒ 3840 上会拉成一条');
  assert.match(rule('.fchip'), /box-sizing: border-box/, '不算内边距 ⇒ width:100% 必溢出');
  assert.ok(!/content-box/.test(rule('.fchip')), '后面又被 content-box 盖回去了 ⇒ 等于没写');
  assert.match(rule('.fchip'), /min-width: min\(var\(--fmin, \d+px\), 100%\)/,
    '最小宽度没用 min(…,100%) 兜住 ⇒ 窄屏 + 深层缩进必溢出');
  assert.match(rule('.fchip .title'), /text-overflow: ellipsis/, '长夹名不省略 ⇒ 会把块撑破');
  for (const sel of ['.frow', '.fnode', '.fchip .fmain', '.fchip .fline', '.fchip .fmeta']) {
    assert.match(rule(sel), /min-width: 0/, `${sel} 少了 min-width:0 ⇒ flex 子项撑不回去`);
  }
  assert.match(css, /@media \(max-width: 1100px\) \{[\s\S]*?\.fkids \{ margin-left: 12px/, '窄屏没把缩进收窄');
});

test('展开折起：三角只管开合，🚫 不许顺手跳走；另外有全部展开/全部折起', () => {
  const click = app.match(/\$\('#organize'\)\.addEventListener\('click', \(e\) => \{([\s\S]*?)\n  \}\);/)[1];
  const iAll = click.indexOf('data-orgall'), iTw = click.indexOf('ftwist'), iOpen = click.indexOf('openDetail(');
  assert.ok(iAll >= 0 && iTw >= 0, '没有全部展开/折起，或没有三角开合');
  // 260914 老徐改了点块的行为：从「跳回首页找那个夹」改成「右边开详情」。三角和全展仍要排在它前面。
  assert.ok(iAll < iOpen && iTw < iOpen, '三角/全部展开排在开详情后面 ⇒ 点一下就开侧栏了，根本折不了');
  assert.match(click, /orgFold\.set\(id, orgOpen\(id, lv\)\)/, '三角没记住开合状态');
  assert.match(app, /const orgOpen = \(id, lv\) => \(orgFold\.has\(id\) \? !orgFold\.get\(id\) : lv <= 1\)/,
    '默认不是「一级展开、二级及以下折起」');
});

test('只动了整理页：首页卡片 / 左栏 / 侧边栏那几套没被顺手改', () => {
  for (const sel of ['.card', '.tile', '.body', '.side-item', '.sub-head']) {
    assert.ok(css.includes(sel), `${sel} 的样式不见了 —— 这轮不该碰它`);
  }
  assert.match(app, /function cardEl\(f, opts = \{\}\) \{/, 'cardEl 被动了');
  assert.match(app, /function noteCardEl\(/, 'noteCardEl 被动了');
  assert.match(html, /<section class="organize" id="organize" hidden><\/section>/, '整理页的容器被改了');
});
