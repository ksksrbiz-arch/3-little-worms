/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end tests covering the single-player game UI flow:
 *   • Page load & static elements
 *   • Join-game interaction
 *   • WebSocket / Socket.IO connection
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a Promise that resolves with the parsed Socket.IO "state" payload
 * the first time it is received on the given page's WebSocket connection.
 *
 * Socket.IO v4 over WebSocket sends frames with the prefix `42["event",data]`.
 */
function waitForSocketState(page: Page): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    page.on('websocket', (ws) => {
      ws.on('framereceived', (event) => {
        const raw = event.payload.toString();
        if (raw.startsWith('42["state"')) {
          try {
            const parsed = JSON.parse(raw.slice(2));
            resolve(parsed[1] as Record<string, unknown>);
          } catch {
            // ignore malformed frames
          }
        }
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Page-load & static UI
// ---------------------------------------------------------------------------

test.describe('page load', () => {
  test('page title is set', async ({ page }) => {
    await page.goto('/');
    // The app sets its own document title via the HTML template.
    await expect(page).toHaveTitle(/.+/);
  });

  test('NEON.SNAKE heading is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'NEON.SNAKE' })).toBeVisible();
  });

  test('JOIN ARENA overlay is shown before joining', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'JOIN ARENA' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'PLAY' })).toBeVisible();
  });

  test('Sign In button is present when not authenticated', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('New Tab button is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /New Tab/i })).toBeVisible();
  });

  test('GLOBAL TOP 10 leaderboard panel is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('GLOBAL TOP 10')).toBeVisible();
  });

  test('no critical JavaScript errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    // Give the Three.js canvas a moment to initialise.
    await page.waitForTimeout(3_000);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Joining the game
// ---------------------------------------------------------------------------

test.describe('joining game', () => {
  test('clicking PLAY hides the overlay and shows Length counter', async ({ page }) => {
    await page.goto('/');
    // Wait for Socket.IO to connect before clicking PLAY.
    await expect(page.getByRole('button', { name: 'PLAY' })).toBeVisible();
    await page.getByRole('button', { name: 'PLAY' }).click();

    // Overlay should disappear.
    await expect(page.getByRole('heading', { name: 'JOIN ARENA' })).not.toBeVisible();

    // "Length: N" counter should appear in the top bar.
    await expect(page.getByText(/^Length:/)).toBeVisible();
  });

  test('3-D canvas element is rendered', async ({ page }) => {
    await page.goto('/');
    // The Three.js scene renders into a <canvas> element injected by
    // @react-three/fiber inside the root div.
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('Socket.IO emits state after joining', async ({ page }) => {
    // Register the WebSocket listener *before* navigating so no frames are missed.
    const statePromise = waitForSocketState(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'PLAY' }).click();

    // The server broadcasts state at 60 Hz, so we should receive it quickly.
    const gameState = await statePromise;
    expect(gameState).toHaveProperty('players');
    expect(gameState).toHaveProperty('orbs');
    expect(gameState).toHaveProperty('leaderboard');
    expect(gameState).toHaveProperty('hazards');
  });
});
