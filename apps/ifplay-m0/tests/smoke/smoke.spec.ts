import { test, expect } from '@playwright/test';

test.describe('IfPlay M1 浏览器冒烟', () => {
  test('样例选择页列出四款游戏', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="game-card"]')).toHaveCount(4);
    await expect(page.getByText('我在三线城市给外星人修手机')).toBeVisible();
    await expect(page.getByText('在公司厕所偷偷修仙')).toBeVisible();
    await expect(page.getByText('把老板画的饼拖进微波炉炼成年终奖')).toBeVisible();
    await expect(page.getByText('凌晨三点在业主群竞选小区龙王')).toBeVisible();
  });

  test('经营模拟样例：完成一轮到达结局（M0 回归）', async ({ page }) => {
    await page.goto('/');
    await page.getByText('我在三线城市给外星人修手机').click();
    await expect(page.getByText('结束本回合')).toBeVisible();
    for (let i = 0; i < 25; i++) {
      if ((await page.locator('[data-testid="result"]').count()) > 0) break;
      await page.getByRole('button', { name: '结束本回合' }).click();
    }
    await expect(page.locator('[data-testid="result"]')).toBeVisible();
  });

  test('经营模拟样例：刷新后恢复存档（M0 回归）', async ({ page }) => {
    await page.goto('/');
    await page.getByText('我在三线城市给外星人修手机').click();
    await page.getByRole('button', { name: '结束本回合' }).click();
    await expect(page.getByText('2/12')).toBeVisible();
    await page.reload();
    await page.getByText('我在三线城市给外星人修手机').click();
    await expect(page.getByText('2/12')).toBeVisible();
  });

  test('点击时机样例：点击区可交互（M0 回归）', async ({ page }) => {
    await page.goto('/');
    await page.getByText('在公司厕所偷偷修仙').click();
    const tap = page.locator('[data-testid="tap-zone"]');
    await expect(tap).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await tap.click();
      await page.waitForTimeout(120);
    }
    await expect(tap).toBeVisible();
  });

  test('拖拽合成样例：拖拽物品到格子', async ({ page }) => {
    await page.goto('/');
    await page.getByText('把老板画的饼拖进微波炉炼成年终奖').click();
    const item = page.locator('[data-testid="drag-item-boss_pie"]');
    const slot = page.locator('[data-testid="drop-slot-left"]');
    await expect(item).toBeVisible();
    await expect(slot).toBeVisible();

    const ib = await item.boundingBox();
    const sb = await slot.boundingBox();
    await page.mouse.move(ib!.x + ib!.width / 2, ib!.y + ib!.height / 2);
    await page.mouse.down();
    await page.mouse.move(sb!.x + sb!.width / 2, sb!.y + sb!.height / 2, { steps: 12 });
    await page.mouse.up();

    // 左格应显示放入的物品名（大饼）
    await expect(slot.getByText('大饼')).toBeVisible();
  });

  test('剧情问答样例：选择推进剧情', async ({ page }) => {
    await page.goto('/');
    await page.getByText('凌晨三点在业主群竞选小区龙王').click();
    await expect(page.getByTestId('panel')).toBeVisible();
    // 点击第一个选项（发红包热场）
    await page.getByRole('button', { name: '先发个红包热场' }).click();
    // 进入下一节点后应能看到新剧情
    await expect(page.locator('.panel-body')).toContainText('红包一秒被抢光');
  });
});
