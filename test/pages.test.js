'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const pages = { '.': '/', triage: '/triage/', spec: '/spec/', pd: '/pd/' };

function strings(dir) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, dir, 'strings.js'), 'utf8') + '\nthis.strings = strings;', context);
  return context.strings;
}

test('every text on a page has a Chinese and an English version', () => {
  for (const [dir, page] of Object.entries(pages)) {
    const html = fs.readFileSync(path.join(root, dir, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(root, dir, 'game.js'), 'utf8');
    const table = strings(dir);
    // The page fills these in itself from a function.
    const dynamic = new Set([...script.matchAll(/textContent = custom \? t\.\w+\((?:[\w.]+)\) : t\.(\w+)/g)].map(m => m[1]));
    for (const [, key] of html.matchAll(/data-text="(\w+)"/g)) {
      for (const language of ['zh', 'en']) {
        if (!dynamic.has(key)) assert.equal(typeof table[language][key], 'string', `${page} ${language} ${key}`);
        else assert.ok(key in table[language], `${page} ${language} ${key}`);
      }
    }
    for (const [, key] of script.matchAll(/\bt\.(\w+)/g)) {
      for (const language of ['zh', 'en']) assert.ok(key in table[language], `${page} ${language} t.${key}`);
    }
    assert.deepEqual(Object.keys(table.en).sort(), Object.keys(table.zh).sort(), `${page} languages cover the same keys`);
  }
});

test('every element a page script writes to exists on the page', () => {
  for (const [dir, page] of Object.entries(pages)) {
    const html = fs.readFileSync(path.join(root, dir, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(root, dir, 'game.js'), 'utf8');
    for (const id of new Set([...script.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]))) {
      assert.ok(new RegExp(`id="${id}"`).test(html), `${page} #${id}`);
    }
    assert.match(html, /<html lang="(zh-CN|en)">/);
  }
});
