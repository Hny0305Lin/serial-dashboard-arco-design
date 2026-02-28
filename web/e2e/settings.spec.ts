import { test, expect } from '@playwright/test';

test('设置刷新后不丢失', async ({ page }) => {
  await page.goto('/#/settings');

  await page.getByTestId('settings-send-encoding').getByText('文本').click();

  await page.getByTestId('settings-serial-filter-enabled').click();
  await expect(page.getByTestId('settings-serial-filter-enabled')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('settings-serial-vendorId').fill('1234');
  await page.getByTestId('settings-serial-productId').fill('ABcd');
  await page.getByTestId('settings-serial-interfaceId').fill('02');

  await page.getByTestId('settings-autosend-enabled').click();
  await expect(page.getByTestId('settings-autosend-enabled')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('settings-autosend-encoding').getByText('文本').click();
  await page.getByTestId('settings-autosend-content').fill('AT');

  await page.reload();
  await page.waitForURL(/#\/settings/);

  await expect(page.getByTestId('settings-serial-filter-enabled')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('settings-serial-vendorId')).toHaveValue('1234');
  await expect(page.getByTestId('settings-serial-productId')).toHaveValue('ABCD');
  await expect(page.getByTestId('settings-serial-interfaceId')).toHaveValue('02');

  await expect(page.getByTestId('settings-autosend-enabled')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('settings-autosend-content')).toHaveValue('AT');

  const stored = await page.evaluate(() => window.localStorage.getItem('wsc.appSettings.v1'));
  expect(stored).toContain('"sendEncoding":"utf8"');
  expect(stored).toContain('"vendorId":"1234"');
});

test('Settings 页面无重复 id', async ({ page }) => {
  await page.goto('/#/settings');
  const dup = await page.evaluate(() => {
    const ids = Array.from(document.querySelectorAll<HTMLElement>('[id]'))
      .map((el) => el.id)
      .filter((id) => id && id.trim().length > 0);
    const seen = new Set<string>();
    const dups = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) dups.add(id);
      seen.add(id);
    }
    return Array.from(dups.values());
  });
  expect(dup).toEqual([]);
});
