#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = path.join(root, 'docs/assets/img/demo.gif');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dbt-sugar-gif-'));
const PORT = 4398;
const SIZE = { width: 1280, height: 760 };
const BASE = `http://127.0.0.1:${PORT}`;

function playground() {
  const child = spawn(process.execPath, ['test/playground/run.js', '--no-open', '--slow', '4', '--port', String(PORT)], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve) => {
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('is open at')) resolve(child);
    });
  });
}

async function tour(page) {
  const pause = (ms) => page.waitForTimeout(ms);
  await page.goto(`${BASE}/`);
  await page.waitForSelector('#walker svg');
  await page.waitForFunction(() => /RUNNING/.test(document.getElementById('status').textContent) && document.querySelectorAll('#running td.mono').length > 0, null, { timeout: 60000 });
  await pause(2500);
  await page.locator('[data-expand="running"]').click();
  await pause(1800);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'FAILED', null, { timeout: 60000 });
  await pause(3200);
  await page.locator('#tips .tip').first().click();
  await pause(1800);
  await page.keyboard.press('Escape');
  await pause(400);
  await page.getByRole('tab', { name: /Diff/ }).click();
  await pause(2200);
  await page.locator('[data-change="model.jaffle_shop.orders"]').click();
  await pause(1800);
  await page.getByRole('button', { name: 'Breaking', exact: true }).click();
  await pause(1200);
  await page.locator('#diff-copy').click();
  await pause(1200);
  await page.getByRole('button', { name: 'All', exact: true }).first().click();
  await pause(400);
  await page.locator('#where').click();
  await pause(900);
  await page.locator('#pop-search').pressSequentially('fixture', { delay: 120 });
  await pause(700);
  await page.locator('#pop-body .proj-row').first().click();
  await pause(1800);
  await page.locator('[data-build="base"]').click();
  await page.waitForSelector('#diff-list .change', { timeout: 60000 });
  await pause(2500);
  await page.getByRole('tab', { name: 'Live' }).click();
  await pause(1500);
}

const server = await playground();
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, recordVideo: { dir: work, size: SIZE } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await context.newPage();
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'body::after { display: none !important; }';
      document.head.append(style);
    });
  });
  await tour(page);
  const video = await page.video().path();
  await context.close();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const palette = path.join(work, 'palette.png');
  const filters = 'fps=6,scale=880:-1:flags=lanczos';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', `${filters},palettegen=max_colors=64:stats_mode=diff`, palette]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', palette, '-lavfi', `${filters} [x]; [x][1:v] paletteuse=dither=none:diff_mode=rectangle`, target]);
  console.log(`demo: ${path.relative(root, target)} (${(fs.statSync(target).size / 1e6).toFixed(1)} MB)`);
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(work, { recursive: true, force: true });
}
