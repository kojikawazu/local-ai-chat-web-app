import { test, expect } from '@playwright/test';

test('ブラウザコンソールエラーを確認', async ({ page }) => {
  const consoleMessages: string[] = [];
  const consoleErrors: string[] = [];

  page.on('console', (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    consoleMessages.push(text);
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleErrors.push(text);
    }
  });

  page.on('pageerror', (error) => {
    consoleErrors.push(`[pageerror] ${error.message}`);
  });

  await page.goto('/');

  // ページが完全にロードされるまで待つ
  await expect(page.getByText('Welcome to Nordic.')).toBeVisible({
    timeout: 10000,
  });

  // テキスト入力を試みる
  const textarea = page.locator('textarea');
  await textarea.click();
  await textarea.pressSequentially('test123', { delay: 50 });

  // 少し待つ
  await page.waitForTimeout(1000);

  const value = await textarea.inputValue();
  const isDisabled = await page.locator('button[type="submit"]').isDisabled();

  console.log('=== TEXTAREA VALUE ===');
  console.log('Value:', JSON.stringify(value));
  console.log('Button disabled:', isDisabled);
  console.log('=== CONSOLE ERRORS ===');
  consoleErrors.forEach((e) => console.log(e));
  console.log('=== ALL CONSOLE MESSAGES ===');
  consoleMessages.forEach((m) => console.log(m));

  // React stateを直接チェック
  const reactState = await page.evaluate(() => {
    const textarea = document.querySelector('textarea');
    if (!textarea) return 'textarea not found';

    // React fiber を探す
    const fiberKey = Object.keys(textarea).find((key) =>
      key.startsWith('__reactFiber')
    );
    const propsKey = Object.keys(textarea).find((key) =>
      key.startsWith('__reactProps')
    );
    const internalKey = Object.keys(textarea).find((key) =>
      key.startsWith('__reactInternalInstance')
    );

    return {
      fiberKey,
      propsKey,
      internalKey,
      allKeys: Object.keys(textarea).filter((k) => k.startsWith('__react')),
      domValue: textarea.value,
      hasOnChange: propsKey
        ? typeof (textarea as Record<string, unknown>)[propsKey] === 'object' &&
          'onChange' in
            ((textarea as Record<string, unknown>)[propsKey] as object)
        : false,
    };
  });

  console.log('=== REACT STATE ===');
  console.log(JSON.stringify(reactState, null, 2));
});
