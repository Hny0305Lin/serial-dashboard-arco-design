import { test, expect } from '@playwright/test';

test('混合组件下：活跃列表排序 + 点击定位 + 高亮', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'monitorCanvasLayoutV1',
      JSON.stringify({ version: 1, canvasState: { offsetX: 0, offsetY: 0, scale: 1 }, widgets: [] })
    );
    sessionStorage.removeItem('monitorTerminalLogsV1');
  });

  await page.goto('/#/monitor');

  await page.getByRole('button', { name: '添加组件' }).click();
  const menu1 = page.locator('.arco-dropdown-menu');
  await expect(menu1).toBeVisible();
  const addTerminal = menu1.locator('[data-monitor-add-widget="terminal"]');
  await expect(addTerminal).toBeVisible();
  await addTerminal.click();
  await expect(page.locator('[data-monitor-widget-id]')).toHaveCount(1);
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }

  await page.getByRole('button', { name: '添加组件' }).click();
  const menu2 = page.locator('.arco-dropdown-menu');
  await expect(menu2).toBeVisible();
  const addForwarding = menu2.locator('[data-monitor-add-widget="forwarding"]');
  await expect(addForwarding).toBeVisible();
  await addForwarding.evaluate((el: any) => el.click());
  await expect(page.locator('[data-monitor-widget-id]')).toHaveCount(2);

  const ids = await page.$$eval('[data-monitor-widget-id]', (els) => els.map(el => el.getAttribute('data-monitor-widget-id')).filter(Boolean) as string[]);
  expect(ids.length).toBeGreaterThanOrEqual(2);
  const terminalId = ids[0];
  const forwardingId = ids[1];

  await page.waitForFunction(() => !!(window as any).__monitorTest);

  const now = Date.now();
  await page.evaluate(({ terminalId, forwardingId, now }) => {
    const api = (window as any).__monitorTest;
    if (!api) throw new Error('missing __monitorTest');
    api.setWidgetLastRxAt(forwardingId, now - 1200);
    api.setWidgetLastRxAt(terminalId, now);
  }, { terminalId, forwardingId, now });

  const maybeDialog = page.getByRole('dialog');
  if (await maybeDialog.isVisible({ timeout: 800 }).catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(maybeDialog).toBeHidden();
  }

  const activeBtn = page.getByRole('button', { name: '活跃组件' });
  await activeBtn.evaluate((el: any) => {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  });
  const menuItems = page.locator('.arco-dropdown-menu-item').filter({ hasText: '·' });
  await expect(menuItems.first()).toBeVisible();
  await expect(menuItems).toHaveCount(2);

  const firstText = await menuItems.nth(0).innerText();
  const secondText = await menuItems.nth(1).innerText();
  expect(firstText).toContain('终端');
  expect(secondText).toContain('转发');

  await menuItems.nth(1).evaluate((el: any) => el.click());

  const highlighted = page.locator(`[data-monitor-widget-id="${forwardingId}"][data-monitor-highlight="1"]`);
  await expect(highlighted).toBeVisible();

  const top = await page.evaluate((id) => {
    const el = document.querySelector(`[data-monitor-widget-id="${id}"]`) as HTMLElement | null;
    if (!el) return null;
    return el.getBoundingClientRect().top;
  }, forwardingId);
  expect(top).not.toBeNull();
  expect(top as number).toBeGreaterThan(0);
  expect(top as number).toBeLessThan(400);
});
