// 文件夹颜色改成 8 个带名字的固定色，入口在详情侧栏；左栏点夹只安静设 AI 范围（老徐 260914）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const p = (f) => require('node:path').join(__dirname, '..', f);
const nocomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('8 个带名字的固定色，首页和后台用同一份', () => {
  const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));
  const ew = nocomment(fs.readFileSync(p('editor-worker.js'), 'utf8'));
  // 🔄 260915 老徐给了一套带名字和 RGB 的颜色标准 ⇒ 名字不再是一个字，条目也带上 rgb
  const grab = (s) => [...s.matchAll(/\{\s*c:\s*'(#[0-9A-Fa-f]{6})',\s*n:\s*'([^']+)',\s*rgb:\s*'([^']+)'\s*\}/g)]
    .map((m) => m[1].toUpperCase() + '|' + m[2] + '|' + m[3]);
  const a = grab(app.match(/const FOLDER_COLORS = \[([\s\S]*?)\];/)[1]);
  const b = grab(ew.match(/const FOLDER_COLORS=\[([\s\S]*?)\];/)[1]);
  assert.equal(a.length, 8, '不是 8 个色');
  assert.deepEqual(a, b, '首页和后台两份颜色对不上 ⇒ 侧栏选的色首页认不出来');
  assert.match(app, /const PALETTE = FOLDER_COLORS\.map/, '标签那边没跟着用同一份');
  // 🔴 这八个值是老徐给的标准，🚫 别自己调
  for (const want of ['#002FA7|克莱因蓝|0,47,167', '#81D8D0|蒂芙尼蓝|129,216,208', '#B05923|提香红|176,89,35',
                      '#E60000|中国红|230,0,0', '#900021|勃艮第红|144,0,33', '#FBD26A|申布伦黄|251,210,106',
                      '#8F4B28|凡戴克棕|143,75,40']) {
    assert.ok(a.includes(want), '少了或改了：' + want);
  }
  // 每个 RGB 得跟它自己的十六进制对得上，🚫 别手抄错
  for (const row of a) {
    const [hex, , rgb] = row.split('|');
    const calc = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
    assert.equal(rgb, calc, hex + ' 的 RGB 写错了：' + rgb + ' 该是 ' + calc);
  }
});

test('改颜色走详情侧栏，🚫 不再点首页那根细色条', () => {
  const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));
  assert.ok(!/closest\('\.swatch'\)/.test(app), '色条还是改颜色的入口（老徐：那太难了）');
  const html = fs.readFileSync(p('sidepanel.html'), 'utf8');
  assert.match(html, /id="fp-colors"/, '侧栏没有颜色那一排');
  const sp = nocomment(fs.readFileSync(p('sidepanel.js'), 'utf8'));
  assert.match(sp, /folderPatch\(\{color:o\.c\}\)/, '侧栏选了色不往后台写');
});

test('后台只认这 8 个色，别的一律当成不上色', () => {
  const ew = nocomment(fs.readFileSync(p('editor-worker.js'), 'utf8'));
  const blk = ew.match(/if\(m\.color!==undefined\)\{([\s\S]*?)\n      \}/)[1];
  assert.match(blk, /FOLDER_COLORS\.some\(x=>x\.c\.toLowerCase\(\)===String\(m\.color\)\.toLowerCase\(\)\)/, '没校验颜色值 ⇒ 侧栏传什么就存什么');
  assert.match(blk, /delete g\.color/, '不能取消颜色');
});

test('左栏点文件夹只安静设 AI 范围：🚫 不弹面板、🚫 不写记录', () => {
  // 老徐 260914：「我点左边的时候，不要给我弹出来这些东西，展现出来让我看得见就好了」
  const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));
  assert.match(app, /detail: \{ id: it\.dataset\.id, toggle: true, quiet: true \}/, '左栏那条没标安静');
  // 🔄 260915：「让 AI 看着写一条」那颗随就地编辑框一起退场了（说明改走侧栏填），
  //    所以首页这边只剩左栏那一条安静调用。安静模式本身照旧要能用，下面两条继续钉。
  const ai = nocomment(fs.readFileSync(p('ai.js'), 'utf8'));
  assert.match(ai, /async function setScope\(id, quiet = false\)/, 'setScope 没有安静模式');
  assert.match(ai, /if \(quiet\) return;/, '安静模式没有真的跳过弹面板和写记录');
});
