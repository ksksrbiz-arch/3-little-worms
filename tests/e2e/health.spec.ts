/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { test, expect } from '@playwright/test';

test.describe('health endpoint', () => {
  test('GET /api/health returns 200 with {status:"ok"}', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toEqual({ status: 'ok' });
  });
});
