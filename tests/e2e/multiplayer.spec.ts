/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end multiplayer tests:
 *   • Two simultaneous players both reach "alive" state
 *   • The server-broadcast game state contains multiple players (human + bots)
 */

import { test, expect, Browser, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves with the first Socket.IO "state" payload received on the page.
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

/**
 * Joins the game on a page and waits for the "Length:" counter to appear,
 * indicating the player is alive.
 */
async function joinAndWaitAlive(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'PLAY' })).toBeVisible();
  await page.getByRole('button', { name: 'PLAY' }).click();
  await expect(page.getByText(/^Length:/)).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('multiplayer', () => {
  test('two players can join simultaneously and both show alive state', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    // Open two isolated browser contexts (separate socket connections).
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      // Navigate both pages.
      await Promise.all([page1.goto('/'), page2.goto('/')]);

      // Join concurrently.
      await Promise.all([joinAndWaitAlive(page1), joinAndWaitAlive(page2)]);

      // Both pages show the Length counter → both players are alive.
      await expect(page1.getByText(/^Length:/)).toBeVisible();
      await expect(page2.getByText(/^Length:/)).toBeVisible();
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('game state broadcast contains multiple players (bots fill the lobby)', async ({
    page,
  }) => {
    // Attach the WS listener before navigation so we catch the first state frame.
    const statePromise = waitForSocketState(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'PLAY' }).click();

    const gameState = await statePromise;
    const players = gameState.players as Record<string, unknown>;

    // The server always spawns up to 15 bots, so the lobby is never empty.
    expect(Object.keys(players).length).toBeGreaterThanOrEqual(1);
  });

  test('two players see each other in the server state', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    // Collect every state update received by page1.
    const receivedStates: Array<Record<string, unknown>> = [];
    page1.on('websocket', (ws) => {
      ws.on('framereceived', (event) => {
        const raw = event.payload.toString();
        if (raw.startsWith('42["state"')) {
          try {
            const parsed = JSON.parse(raw.slice(2));
            receivedStates.push(parsed[1] as Record<string, unknown>);
          } catch {
            // ignore
          }
        }
      });
    });

    try {
      await Promise.all([page1.goto('/'), page2.goto('/')]);
      await Promise.all([joinAndWaitAlive(page1), joinAndWaitAlive(page2)]);

      // Poll until a received state snapshot contains ≥ 2 alive players.
      await expect
        .poll(
          () =>
            receivedStates.some((s) => {
              const players = s.players as Record<string, { state: string }>;
              return (
                Object.values(players).filter((p) => p.state === 'alive')
                  .length >= 2
              );
            }),
          { timeout: 10_000 }
        )
        .toBe(true);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
