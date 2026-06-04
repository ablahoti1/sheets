import { test, expect } from '@playwright/test'
import { openNewSheet, pressShortcut, MOD } from './helpers.js'

test.describe('modals', () => {
  test('filter toolbar button toggles the filter overlay', async ({ page }) => {
    await openNewSheet(page)

    // frappe-ui's Button derives its accessible name from `label`, not from
    // `tooltip`, so this icon-only button has no accessible-name role match.
    // Select by the underlying icon class instead. The toolbar's filter
    // button is rendered via FeatherIcon → `<svg class="feather feather-filter">`.
    const filterBtn = page.locator('.sn-toolbar button:has(svg.feather-filter)').first()
    await filterBtn.click()
    await expect(page.locator('.sn-filter-overlay')).toBeVisible()

    await filterBtn.click()
    await expect(page.locator('.sn-filter-overlay')).toBeHidden()
  })

  test('Cmd/Ctrl+F opens the Find & Replace panel; Esc closes it', async ({ page }) => {
    await openNewSheet(page)

    await pressShortcut(page, `${MOD}+F`)
    const panel = page.locator('.fr-panel')
    await expect(panel).toBeVisible({ timeout: 5_000 })
    await expect(panel.getByText(/Find\s*&\s*Replace/i)).toBeVisible()

    await panel.getByRole('button').first().click()
    await expect(panel).toBeHidden({ timeout: 5_000 })
  })

  test('Share button opens the share dialog', async ({ page }) => {
    await openNewSheet(page)

    await page.getByRole('button', { name: /^Share/ }).click()

    // frappe-ui's Dialog surfaces the title via a `data-dialog="..."`
    // attribute on the overlay — more stable than getByRole+getByText,
    // which races the slot/portal mount on the share dialog. The title
    // is the canonical "Sharing \"<sheet-name>\"" string.
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('[data-dialog^="Sharing"]')).toBeVisible({ timeout: 5_000 })

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 5_000 })
  })
})
