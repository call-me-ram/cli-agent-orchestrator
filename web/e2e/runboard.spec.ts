import { test, expect } from '@playwright/test'

/**
 * Live end-to-end validation of the non-technical orchestration flow against
 * a REAL cao-server (localhost:9889) with a REAL claude agent:
 *
 *   open dashboard → Start a run → describe goal → launch → watch the board
 *   narrate live status over SSE → verify the work happened → end the run.
 *
 * Requires: cao-server running, claude CLI installed, code_supervisor profile.
 */

test.describe('Runs board (non-technical flow)', () => {
  test('dashboard loads with the Runs board as the front door', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('run-board')).toBeVisible()
    await expect(page.getByTestId('start-run')).toBeVisible()
    // No raw jargon on the default surface.
    await expect(page.getByText('Each run is a team of AI agents')).toBeVisible()
  })

  test('SSE status stream is connected (no status polling)', async ({ page }) => {
    const statusPolls: string[] = []
    page.on('request', req => {
      if (/\/terminals\/[a-f0-9]{8}$/.test(req.url())) statusPolls.push(req.url())
    })
    await page.goto('/')
    await expect(page.getByText('Live', { exact: true })).toBeVisible()
    // Let the page-load one-shot seeds (one GET per newly-seen terminal)
    // finish before counting — they are allowed; POLLING is not.
    await page.waitForTimeout(2_500)
    const before = statusPolls.length
    await page.waitForTimeout(7_000)
    // 7 quiet seconds must add no status requests.
    expect(statusPolls.length).toBe(before)
  })

  test('wizard walks through goal → planner → launch and the board narrates a live run', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('start-run').click()
    await expect(page.getByTestId('start-run-wizard')).toBeVisible()

    // Step 1: the goal, in plain words.
    await page.getByTestId('wizard-goal').fill(
      'Create a file named cao_ui_e2e.txt containing exactly UIRUNOK in the current directory, then stop. Do not delegate; do it yourself.'
    )
    await page.getByTestId('wizard-folder').fill('/tmp/cao-ui-e2e-run')
    await page.getByTestId('wizard-next').click()

    // Step 2: pick the planner (default preselected).
    await expect(page.getByText('leads the run')).toBeVisible()
    await page.getByTestId('wizard-next').click()

    // Step 3: confirm + launch.
    await expect(page.getByText('Ready to launch')).toBeVisible()
    await page.getByTestId('wizard-launch').click()

    // The run card appears and narrates the planner's life cycle live (SSE).
    const runCard = page.locator('[data-testid^="run-cao-"]').first()
    await expect(runCard).toBeVisible({ timeout: 120_000 })
    await expect(runCard.getByText(/The planner/)).toBeVisible({ timeout: 60_000 })

    // The planner must visibly reach "working" and then settle — live, no reload.
    await expect(runCard.getByText('The planner is working…')).toBeVisible({ timeout: 120_000 })
    await expect(
      runCard.getByText(/The planner (finished its last task|is ready for instructions)/)
    ).toBeVisible({ timeout: 240_000 })

    // End the run from the UI.
    const runId = (await runCard.getAttribute('data-testid'))!.replace('run-', '')
    await page.getByTestId(`delete-${runId}`).click()
    await page.getByRole('button', { name: 'End run' }).click()
    await expect(page.getByTestId(`run-${runId}`)).toHaveCount(0, { timeout: 60_000 })
  })
})
