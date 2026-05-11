# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: health.spec.ts >> health endpoint >> GET /api/health returns 200 with {status:"ok"}
- Location: tests/e2e/health.spec.ts:9:3

# Error details

```
Error: apiRequestContext.get: getaddrinfo EAI_AGAIN service-3-little-worms-167345356687.us-west2.run.app
Call log:
  - → GET https://service-3-little-worms-167345356687.us-west2.run.app/api/health
    - user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.15 Safari/537.36
    - accept: */*
    - accept-encoding: gzip,deflate,br

```

# Test source

```ts
  1  | /**
  2  |  * @license
  3  |  * SPDX-License-Identifier: Apache-2.0
  4  |  */
  5  | 
  6  | import { test, expect } from '@playwright/test';
  7  | 
  8  | test.describe('health endpoint', () => {
  9  |   test('GET /api/health returns 200 with {status:"ok"}', async ({ request }) => {
> 10 |     const response = await request.get('/api/health');
     |                                    ^ Error: apiRequestContext.get: getaddrinfo EAI_AGAIN service-3-little-worms-167345356687.us-west2.run.app
  11 |     expect(response.ok()).toBeTruthy();
  12 |     const body = await response.json();
  13 |     expect(body).toEqual({ status: 'ok' });
  14 |   });
  15 | });
  16 | 
```