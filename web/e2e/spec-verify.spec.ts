import { test, expect } from '@playwright/test'

/**
 * Visual + crash verification of the build-spec rewrite across all tabs.
 * Captures a screenshot per surface for review; asserts the key spec'd
 * elements render and nothing white-screens.
 */
test('every tab renders the build-spec UI without crashing', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))

  await page.goto('/')

  // Shell (§1.6): cao brand + LIVE indicator
  await expect(page.getByText('cao', { exact: true })).toBeVisible()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  // Runs (§2)
  await expect(page.getByTestId('run-board')).toBeVisible()
  await expect(page.getByTestId('start-run')).toBeVisible()
  await page.waitForTimeout(2500) // let rosters + statuses settle
  await page.screenshot({ path: 'test-results/spec-runs.png', fullPage: true })

  // Agents (§4) master-detail
  await page.getByRole('tab', { name: 'Agents' }).click()
  await expect(page.getByText('Sessions', { exact: true })).toBeVisible()
  // open the first session in the rail → detail card + terminal preview
  const firstSession = page.locator('[data-testid^="rename-cao-"]').first()
  if (await firstSession.count()) {
    await firstSession.locator('xpath=ancestor::div[1]').click({ position: { x: 10, y: 10 } }).catch(() => {})
  }
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'test-results/spec-agents.png', fullPage: true })

  // Flows (§5)
  await page.getByRole('tab', { name: 'Flows' }).click()
  await expect(page.getByRole('heading', { name: 'Flows' })).toBeVisible()
  await page.screenshot({ path: 'test-results/spec-flows.png', fullPage: true })

  // Home + Settings — just assert no crash
  await page.getByRole('tab', { name: 'Home' }).click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'test-results/spec-home.png', fullPage: true })
  await page.getByRole('tab', { name: 'Settings' }).click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'test-results/spec-settings.png', fullPage: true })

  expect(errors, `page errors: ${errors.join('\n')}`).toHaveLength(0)
})
