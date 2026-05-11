# Phase 0: Payload-First Security TDD
1. Data Invariants:
- A user document can only be created or modified by the authenticated user it belongs to.
- A score record must contain a valid userId that matches the authenticated user creating it.
- A snake skin or theme modification must be string and valid.

2. Dirty Dozen Payloads:
- p1: Create user with wrong auth UID
- p2: Update user bypassing restricted keys
- p3: Create user without required schema fields
- p4: Value poisoning - skin is an integer
- p5: Create leaderboard record with someone else's userId
- p6: Create leaderboard record with missing score
- p7: Create leaderboard record with string score
- p8: Time played is string instead of number
- p9: Update a leaderboard record out of bounds
- p10: Delete someone else's user profile
- p11: Update system fields createdAt
- p12: Blank read / get someone else's user profile if PII exists (Here no PII, public profile accessible).
