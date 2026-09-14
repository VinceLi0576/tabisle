// 🔴 chrome.permissions.request() 只在「用户手势那一刻」有效：前面只要有一个 await，
// 手势就没了，直接抛 This function must be called during a user gesture（260914 实测过报错原文）。
// 这类 bug 运行时才炸、而且只在没授权过的那几家上炸，所以用静态检查把形状钉住。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const raw = fs.readFileSync(path.join(__dirname, '..', 'ai-setup.js'), 'utf8');
// 🔴 先把注释剥掉再查：这条规矩本身就要写在注释里解释，注释里的「await」不该被当成代码
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('申请权限之前不许先 await 别的（那一下手势就用掉了）', () => {
  const i = raw.indexOf('function ensureHost');
  const body = raw.slice(i, raw.indexOf('\n  }', i));
  assert.doesNotMatch(body, /await\s+chrome\.permissions\.contains/,
    '先 contains 再 request 正是踩过的那个坑：contains 的 await 会吃掉手势');
  assert.match(body, /chrome\.permissions\.request/, '要真的去申请');
  assert.doesNotMatch(body, /async function ensureHost/,
    'ensureHost 自己不能是 async —— 一 async 化调用方就容易在前面加 await');
});

test('两个按钮的点击处理里，ensureHost 前面不许出现 await', () => {
  for (const id of ['ai-save', 'ai-test']) {
    const i = src.indexOf(`$('${id}').onclick`);
    assert.ok(i > 0, '找得到 ' + id);
    const upto = src.indexOf('ensureHost(', i);
    assert.ok(upto > i, id + ' 里要调 ensureHost');
    const before = src.slice(i, upto);
    assert.doesNotMatch(before, /\bawait\b/, id + ' 的点击处理里，ensureHost 之前出现了 await，手势会丢');
  }
});
