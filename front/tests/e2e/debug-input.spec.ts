import { test, expect } from '@playwright/test';

test.skip(!!process.env.CI, 'デバッグ用テストはCI環境ではスキップ');
test.describe('デバッグ: 入力テスト', () => {
  test('方法1: pressSequentially', async ({ page }) => {
    await page.goto('/');
    const textarea = page.locator('textarea');
    await textarea.click();
    await textarea.pressSequentially('abc');
    const value = await textarea.inputValue();
    console.log('pressSequentially value:', JSON.stringify(value));
    const sendButton = page.locator('button[type="submit"]');
    const isDisabled = await sendButton.isDisabled();
    console.log('pressSequentially button disabled:', isDisabled);
  });

  test('方法2: fill', async ({ page }) => {
    await page.goto('/');
    const textarea = page.locator('textarea');
    await textarea.fill('abc');
    const value = await textarea.inputValue();
    console.log('fill value:', JSON.stringify(value));
    const sendButton = page.locator('button[type="submit"]');
    const isDisabled = await sendButton.isDisabled();
    console.log('fill button disabled:', isDisabled);
  });

  test('方法3: keyboard.insertText', async ({ page }) => {
    await page.goto('/');
    const textarea = page.locator('textarea');
    await textarea.click();
    await page.keyboard.insertText('abc');
    const value = await textarea.inputValue();
    console.log('insertText value:', JSON.stringify(value));
    const sendButton = page.locator('button[type="submit"]');
    const isDisabled = await sendButton.isDisabled();
    console.log('insertText button disabled:', isDisabled);
  });

  test('方法4: keyboard.type', async ({ page }) => {
    await page.goto('/');
    const textarea = page.locator('textarea');
    await textarea.click();
    await page.keyboard.type('abc');
    const value = await textarea.inputValue();
    console.log('keyboard.type value:', JSON.stringify(value));
    const sendButton = page.locator('button[type="submit"]');
    const isDisabled = await sendButton.isDisabled();
    console.log('keyboard.type button disabled:', isDisabled);
  });

  test('方法5: dispatchEvent with InputEvent', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
      textarea.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )!.set!;
      nativeSetter.call(textarea, 'abc');
      textarea.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: 'abc',
        })
      );
    });
    const textarea = page.locator('textarea');
    const value = await textarea.inputValue();
    console.log('InputEvent value:', JSON.stringify(value));
    const sendButton = page.locator('button[type="submit"]');
    const isDisabled = await sendButton.isDisabled();
    console.log('InputEvent button disabled:', isDisabled);
  });

  test('方法6: React内部props直接呼び出し', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
      textarea.focus();
      // React fiber/propsを探す
      const reactPropsKey = Object.keys(textarea).find((key) =>
        key.startsWith('__reactProps')
      );
      console.log('React props key:', reactPropsKey);
      if (reactPropsKey) {
        const props = (textarea as Record<string, unknown>)[reactPropsKey] as {
          onChange?: (e: { target: { value: string } }) => void;
        };
        console.log('Has onChange:', !!props.onChange);
        if (props.onChange) {
          props.onChange({ target: { value: 'abc' } });
        }
      }
    });
    await page.waitForTimeout(200);
    const textarea = page.locator('textarea');
    const value = await textarea.inputValue();
    console.log('React props value:', JSON.stringify(value));
    const sendButton = page.locator('button[type="submit"]');
    const isDisabled = await sendButton.isDisabled();
    console.log('React props button disabled:', isDisabled);
  });
});
