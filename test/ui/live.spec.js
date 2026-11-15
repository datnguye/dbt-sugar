import { expect, test } from '@playwright/test';

test('a run in progress shows phases, progress, running nodes, the queue and the mascot', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#live')).toContainText('LIVE');
  await expect(page.locator('#command')).toContainText('dbt build');
  await expect(page.locator('#phases')).toContainText('Parse');
  await expect(page.locator('#phases .phase.live').first()).toBeVisible();
  await expect(page.locator('#count')).toContainText('/53');
  await expect(page.locator('body')).toHaveClass(/busy/);
  await expect(page.locator('#running')).toContainText('locations');
  await expect(page.locator('#next')).toContainText('orders');
  await expect(page.locator('#walker svg')).toHaveAttribute('aria-label', /Pixel dinosaur mascot, (worried|peek)/);
  await expect(page.locator('#hint')).toBeHidden();
});

test('the page fits the window; panels open in a scrolling popup', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#running')).toContainText('locations');
  const fit = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight, footer: document.querySelector('footer').getBoundingClientRect().bottom }));
  expect(fit.x).toBeLessThanOrEqual(0);
  expect(fit.y).toBeLessThanOrEqual(0);
  expect(fit.footer).toBeLessThanOrEqual(900);

  await page.locator('#tips .tip').nth(1).click();
  await expect(page.locator('#pop')).toBeVisible();
  await expect(page.locator('#pop-title')).toHaveText('Suggestions');
  await expect(page.locator('#pop-body details[open]').first()).toBeVisible();
  await page.locator('#pop-close').click();
  await expect(page.locator('#pop')).toBeHidden();

  await page.locator('[data-expand="next"]').click();
  await expect(page.locator('#pop-body')).toContainText('more queued');
  await page.keyboard.press('Escape');
  await expect(page.locator('#pop')).toBeHidden();

  await page.locator('[data-copy="command"]').click();
  await expect(page.locator('[data-copy="command"]')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^dbt build --profiles-dir /);
  await expect(page.locator('#command-row')).toHaveCSS('display', 'flex');

  await page.locator('#copy').click();
  await expect(page.locator('#copy')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^In the dbt project at /);

  await page.locator('[data-expand="log"]').click();
  const pop = page.locator('#pop');
  await expect(pop.locator('#pop-body .log .info').first()).toBeVisible();
  await pop.getByRole('button', { name: 'Warn', exact: true }).click();
  await expect(pop.locator('#pop-body .log .warn').first()).toBeVisible();
  await expect(pop.locator('#pop-body .log .info')).toHaveCount(0);
  await pop.getByRole('button', { name: 'Error', exact: true }).click();
  await expect(pop.locator('#pop-body')).toContainText('No log lines');
  await pop.getByRole('button', { name: 'All', exact: true }).click();
  await expect(pop.locator('#pop-body .log .info').first()).toBeVisible();
  const scrolls = await page.evaluate(() => { const b = document.getElementById('pop-body'); return b.scrollHeight > b.clientHeight; });
  expect(scrolls).toBe(true);
  await page.mouse.click(5, 5);
  await expect(pop).toBeHidden();
});

test('the mascot preview switch and runs switcher work', async ({ page }) => {
  await page.goto('/?mascot=success');
  await expect(page.locator('#walker svg')).toHaveAttribute('aria-label', 'Pixel dinosaur mascot, success');
  await expect(page.locator('#mood')).toContainText('Too cool');
  await page.setViewportSize({ width: 390, height: 844 });
  const phone = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    runningTop: document.getElementById('rn').getBoundingClientRect().top,
    button: document.querySelector('.btn').getBoundingClientRect().height
  }));
  expect(phone.overflow).toBeLessThanOrEqual(0);
  expect(phone.runningTop).toBeLessThan(844);
  expect(phone.button).toBeGreaterThanOrEqual(44);
});

test('an empty project explains how to turn on the OTel log', async ({ page }) => {
  await page.goto('http://127.0.0.1:4378/');
  await expect(page.locator('#hint')).toContainText('DBT_OTEL_FILE_NAME');
  await expect(page.locator('#when')).toHaveText('no dbt run seen yet');
  await expect(page.locator('body')).not.toHaveClass(/busy/);
  await expect(page.locator('#walker svg')).toHaveAttribute('aria-label', 'Pixel dinosaur mascot, waiting');
  await expect(page.locator('#tips')).toContainText('Suspiciously sweet');
});

test('the Diff tab compares the base manifest with the working tree', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#diff');
  await expect(page.getByRole('tab', { name: /Diff/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#live-view')).toBeHidden();
  await expect(page.locator('#diff-counts')).toContainText('breaking2');
  await expect(page.locator('#diff-list .change')).toHaveCount(3);
  await expect(page.locator('#diff-detail')).toContainText('enforced contract changes');
  await page.locator('[data-change="model.jaffle_shop.orders"]').click();
  await expect(page.locator('#diff-detail')).toContainText('order_items_subtotal');
  await page.getByRole('button', { name: 'Breaking', exact: true }).click();
  await expect(page.locator('#diff-list .change')).toHaveCount(2);
  await expect(page.locator('#diff-impact')).toContainText('customers');
  await page.locator('#diff-copy').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('dbt build --select fct_customer_segment_orders+ orders+ raw_orders+');
  await page.locator('[data-expand="change"]').click();
  await expect(page.locator('#pop-title')).toHaveText('Diff detail');
  await page.keyboard.press('Escape');
  const fit = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  expect(fit).toBeLessThanOrEqual(0);
  await page.getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('#live-view')).toBeVisible();
  await expect(page).not.toHaveURL(/#diff/);
});

test('the Diff tab picks the base and compare branches from git', async ({ page }) => {
  await page.goto('/#diff');
  await expect(page.locator('#diff-base')).toHaveValue('main');
  await expect(page.locator('#diff-base')).toBeEnabled();
  await expect(page.locator('#diff-head')).toHaveValue('worktree');
  await expect(page.locator('#diff-head option').first()).toHaveText('feature/numeric-types · working tree');
  await expect(page.locator('#diff-head option')).toContainText(['feature/numeric-types · working tree', 'feature/numeric-types', 'main']);
  await expect(page.locator('#diff-status')).toContainText('main@');
});

test('the project switcher scales: one line in the header, a searchable list in a popup', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#where')).toContainText('jaffle');
  await expect(page.locator('#where')).toContainText('@feature/numeric-types');
  await expect(page.locator('#where')).toContainText('2 projects');
  await page.locator('#where').click();
  await expect(page.locator('#pop-title')).toHaveText('Projects (2)');
  await expect(page.locator('#pop-search')).toBeFocused();
  await expect(page.locator('#pop-body .proj-row')).toHaveCount(2);
  await page.locator('#pop-search').fill('add-agg');
  await expect(page.locator('#pop-body .proj-row')).toHaveCount(1);
  await page.locator('#pop-body .proj-row').click();
  await expect(page.locator('#pop')).toBeHidden();
  await expect(page.locator('#where')).toContainText('sugar_fixture');
  await expect(page.locator('#status')).toHaveText('PASSED');
  await page.getByRole('tab', { name: /Diff/ }).click();
  await expect(page.locator('#diff-head')).toContainText('feature/add-agg-orders · working tree');
  await expect(page.locator('[data-build="base"]')).toHaveText('Generate');
  await expect(page.locator('#diff-build-cmd')).toContainText('dbt parse --target-path ');
});
