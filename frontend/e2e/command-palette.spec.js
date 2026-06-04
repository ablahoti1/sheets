import { test, expect } from '@playwright/test'
import { openNewSheet, pressShortcut, MOD } from './helpers.js'

test.describe('command palette', () => {
  test('Cmd/Ctrl+K opens the palette, Escape closes it', async ({ page }) => {
    await openNewSheet(page)

    await pressShortcut(page, `${MOD}+K`)

    const palette = page.getByRole('dialog')
    await expect(palette).toBeVisible({ timeout: 5_000 })

    const search = palette.getByRole('combobox').or(palette.locator('input[type="text"], input:not([type])')).first()
    await search.fill('export')

    await page.keyboard.press('Escape')
    await expect(palette).toBeHidden({ timeout: 5_000 })
  })
})
