import { expect } from '@playwright/test'

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

export async function openNewSheet(page) {
  await page.goto('/spreadsheet')
  await expect(page.locator('#root')).toBeVisible()

  // Home.vue renders "New Spreadsheet" in two places — the empty-state
  // call-to-action and the topbar action. On a fresh test_site both are
  // in the DOM at once, which trips Playwright's strict-mode locator.
  // Either button fires the same emit('new'), so clicking the first one
  // is functionally equivalent.
  await page.getByRole('button', { name: /^New Spreadsheet$/ }).first().click()

  await expect(page.locator('.sn-topbar-right')).toBeVisible({ timeout: 15_000 })
}
