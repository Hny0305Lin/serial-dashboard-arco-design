import { test, expect } from '@playwright/test';

test('混合组件下：活跃列表排序 + 点击定位 + 高亮', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('monitorCanvasLayoutV1');
    sessionStorage.removeItem('monitorTerminalLogsV1');
  });

  await page.goto('/#/monitor');

  await page.getByRole('button', { name: '添加组件' }).click();
  await page.locator('[data-monitor-add-widget="terminal"]').click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '添加组件' }).click();
  await page.locator('[data-monitor-add-widget="forwarding"]').click();
  await page.keyboard.press('Escape');

  const ids = await page.$$eval('[data-monitor-widget-id]', (els) => els.map(el => el.getAttribute('data-monitor-widget-id')).filter(Boolean) as string[]);
  expect(ids.length).toBeGreaterThanOrEqual(2);
  const terminalId = ids[0];
  const forwardingId = ids[1];

  const now = Date.now();
  await page.evaluate(({ terminalId, forwardingId, now }) => {
    const api = (window as any).__monitorTest;
    if (!api) throw new Error('missing __monitorTest');
    api.setWidgetLastRxAt(forwardingId, now - 1200);
    api.setWidgetLastRxAt(terminalId, now);
  }, { terminalId, forwardingId, now });

  await page.getByRole('button', { name: '活跃组件' }).hover();
  const menuItems = page.locator('.arco-dropdown-menu .arco-dropdown-menu-item');
  await expect(menuItems.first()).toBeVisible();
  await expect(menuItems).toHaveCount(2);

  const firstText = await menuItems.nth(0).innerText();
  const secondText = await menuItems.nth(1).innerText();
  expect(firstText).toContain('终端');
  expect(secondText).toContain('转发');

  await menuItems.nth(1).click();

  const highlighted = page.locator(`[data-monitor-widget-id="${forwardingId}"][data-monitor-highlight="1"]`);
  await expect(highlighted).toBeVisible();

  const top = await page.evaluate((id) => {
    const el = document.querySelector(`[data-monitor-widget-id="${id}"]`) as HTMLElement | null;
    if (!el) return null;
    return el.getBoundingClientRect().top;
  }, forwardingId);
  expect(top).not.toBeNull();
  expect(top as number).toBeGreaterThan(0);
  expect(top as number).toBeLessThan(60);
});

