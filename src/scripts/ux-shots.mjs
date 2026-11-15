#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'ux-shots');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

function playground(port, extra = []) {
  const child = spawn(process.execPath, ['test/playground/run.js', '--no-open', '--frozen', '--port', String(port), ...extra], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  return waitFor(`http://127.0.0.1:${port}/api/state`).then(() => child);
}

async function waitFor(url) {
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${url} never answered`);
}

const errors = [];
const shots = [];
async function shot(page, name, options = {}) {
  const file = path.join(out, `${name}.png`);
  await page.waitForTimeout(400);
  await (options.locator ?? page).screenshot({ path: file, fullPage: options.fullPage ?? false, animations: 'disabled' });
  shots.push(file);
}

async function popup(page, label, open) {
  await open();
  await page.locator('#pop').waitFor();
  await shot(page, label);
  await page.keyboard.press('Escape');
}

const browser = await chromium.launch();
const server = await playground(4399);
const empty = await playground(4398, ['--empty']);

try {
  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (msg) => msg.type() === 'error' && errors.push(`${label}: ${msg.text()}`));
    page.on('pageerror', (err) => errors.push(`${label}: ${err.message}`));
    await page.goto('http://127.0.0.1:4399/');
    await page.locator('#running').getByText('locations', { exact: true }).waitFor();
    await shot(page, `${label}-01-live`, { fullPage: label === 'phone' });
    await popup(page, `${label}-02-running`, () => page.locator('[data-expand="running"]').click());
    await popup(page, `${label}-03-next`, () => page.locator('[data-expand="next"]').click());
    await popup(page, `${label}-04-tips`, () => page.locator('#tips .tip').first().click());
    await popup(page, `${label}-05-log`, () => page.locator('[data-expand="log"]').click());
    await popup(page, `${label}-06-projects`, () => page.locator('#where').click());
    const older = await page.locator('#run-select option').nth(1).getAttribute('value');
    await page.selectOption('#run-select', older);
    await shot(page, `${label}-07-past-run`, { fullPage: label === 'phone' });
    await page.goto('http://127.0.0.1:4399/#diff');
    await page.locator('#diff-list .change').first().waitFor();
    await shot(page, `${label}-08-diff`, { fullPage: label === 'phone' });
    await page.getByRole('button', { name: 'Breaking', exact: true }).click();
    await shot(page, `${label}-09-diff-breaking`, { fullPage: label === 'phone' });
    await popup(page, `${label}-10-diff-detail`, () => page.locator('[data-expand="change"]').click());
    await popup(page, `${label}-11-diff-impact`, () => page.locator('[data-expand="impact"]').click());
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.locator('#where').click();
    await page.locator('#pop-search').fill('fixture');
    await page.locator('#pop-body .proj-row').first().click();
    await page.locator('[data-build="base"]').waitFor();
    await shot(page, `${label}-12-diff-missing`);
    await context.close();
  }

  const quiet = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const reduced = await quiet.newPage();
  await reduced.goto('http://127.0.0.1:4399/');
  await reduced.locator('#running').getByText('locations', { exact: true }).waitFor();
  await shot(reduced, 'reduced-motion');
  await quiet.close();

  const blank = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const none = await blank.newPage();
  await none.goto('http://127.0.0.1:4398/');
  await none.locator('#hint').waitFor();
  await shot(none, 'empty-project');
  await blank.close();

  const moods = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const mood = await moods.newPage();
  for (const name of ['waiting', 'running', 'worried', 'alarmed', 'success', 'failed']) {
    await mood.goto(`http://127.0.0.1:4399/?mascot=${name}`);
    await mood.locator('#walker svg').waitFor();
    await shot(mood, `mascot-${name}`, { locator: mood.locator('.stage') });
  }
  await moods.close();
} finally {
  await browser.close();
  server.kill('SIGINT');
  empty.kill('SIGINT');
}

fs.writeFileSync(path.join(out, 'console-errors.txt'), errors.join('\n'));
console.log(`${shots.length} screenshots in ${path.relative(root, out)}/, ${errors.length} console errors`);
for (const error of errors) console.log(`  ${error}`);
