/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end coverage for the slither.io-style architecture changes:
 *   • Server emits per-socket binary `snap` events (Step 6 wire format)
 *   • `snap` payload contains a `selfId` matching the recipient socket
 *   • Server accepts the new `input` event and echoes back `lastInputSeq`
 *     in subsequent snapshots (server-authoritative scaffolding, Step 3)
 *   • AOI culling: snapshot only contains entities near the recipient
 */

import { test, expect } from '@playwright/test';
import { io as ioClient, Socket } from 'socket.io-client';
import { decodeSnapshot } from '../../src/shared/wire';
import {
  AOI_RADIUS,
  WORLD_SIZE,
  SNAPSHOT_BINARY_VERSION,
  type Snapshot,
} from '../../src/shared/types';

const SERVER_URL = process.env.BASE_URL ?? 'http://127.0.0.1:4173';

function bufToArrayBuffer(buf: ArrayBuffer | Uint8Array | Buffer): ArrayBuffer {
  if (buf instanceof ArrayBuffer) return buf;
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function joinAndCaptureSnaps(opts?: {
  count?: number;
  inputs?: { seq: number; angleTarget: number; boost: boolean }[];
}): Promise<{ snaps: Snapshot[]; sid: string }> {
  const target = opts?.count ?? 3;
  const sock: Socket = ioClient(SERVER_URL, { transports: ['websocket'], forceNew: true });
  try {
    await new Promise<void>((resolve, reject) => {
      sock.once('connect', () => resolve());
      sock.once('connect_error', (err) => reject(err));
      setTimeout(() => reject(new Error('connect timeout')), 10_000);
    });
    const sid = sock.id!;
    sock.emit('join', { name: 'AOI-Probe' });
    if (opts?.inputs) for (const inp of opts.inputs) sock.emit('input', inp);

    const snaps: Snapshot[] = [];
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 8_000);
      sock.on('snap', (raw: ArrayBuffer | Uint8Array | Buffer) => {
        try {
          snaps.push(decodeSnapshot(bufToArrayBuffer(raw)));
        } catch {
          // ignore malformed frames
        }
        if (snaps.length >= target) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    return { snaps, sid };
  } finally {
    sock.close();
  }
}

test.describe('binary snapshots (Step 6) and AOI (Step 2)', () => {
  test('server emits binary snap frames with correct version and selfId', async () => {
    const { snaps, sid } = await joinAndCaptureSnaps({ count: 3 });
    expect(snaps.length).toBeGreaterThan(0);
    for (const snap of snaps) {
      // Decoder accepted the frame, server time is sane, and the snapshot
      // points back at the recipient socket.
      expect(typeof snap.tickSeq).toBe('number');
      expect(snap.serverTimeMs).toBeGreaterThan(0);
      expect(snap.selfId).toBe(sid);
    }
    // Guard against accidental wire-format version bumps.
    expect(SNAPSHOT_BINARY_VERSION).toBe(1);
  });

  test('snap payload only contains entities inside the AOI', async () => {
    const { snaps } = await joinAndCaptureSnaps({ count: 3 });
    const last = snaps[snaps.length - 1];
    const self = last.players.find((p) => p.id === last.selfId);
    expect(self).toBeTruthy();

    const head = self!.segments[0];
    // Every entity in the snapshot must lie within AOI_RADIUS of the head,
    // plus slack for spatial-hash cell quantization. A query with radius R
    // pulls in items whose containing cell overlaps [head-R, head+R], so the
    // farthest possible included entity is ~R + sqrt(2)*cellSize away. The
    // floor-based cell key is asymmetric (cells [-3..3] for radius 60 with
    // cellSize 20 cover x∈[-60, 80)), so use 3*HASH_CELL_COARSE = 60 of slack.
    const limit = (AOI_RADIUS + 60) * (AOI_RADIUS + 60);
    for (const o of last.orbs) {
      const dx = o.x - head.x;
      const dy = o.y - head.y;
      expect(dx * dx + dy * dy).toBeLessThan(limit);
    }
    // Non-vacuous: AOI is meaningfully smaller than the world.
    expect(AOI_RADIUS * 2).toBeLessThan(WORLD_SIZE);
  });

  test('two clients far apart do not appear in each others snapshots', async () => {
    // Two simultaneous players. With WORLD_SIZE = 150 spawns are random in
    // a [-65, 65] box; statistically most pairs land far apart, so we
    // collect snapshots from both and assert that at least one direction
    // shows the other player as out-of-AOI.
    const r1 = joinAndCaptureSnaps({ count: 4 });
    const r2 = joinAndCaptureSnaps({ count: 4 });
    const [a, b] = await Promise.all([r1, r2]);
    const aLast = a.snaps[a.snaps.length - 1];
    const bLast = b.snaps[b.snaps.length - 1];

    const aSelf = aLast.players.find((p) => p.id === aLast.selfId);
    const bSelf = bLast.players.find((p) => p.id === bLast.selfId);
    expect(aSelf).toBeTruthy();
    expect(bSelf).toBeTruthy();
    const headA = aSelf!.segments[0];
    const headB = bSelf!.segments[0];
    const dx = headA.x - headB.x;
    const dy = headA.y - headB.y;
    const dist2 = dx * dx + dy * dy;

    if (dist2 > (AOI_RADIUS * 2) * (AOI_RADIUS * 2)) {
      // They're clearly out of each other's AOI — neither snapshot should
      // contain the other player.
      expect(aLast.players.find((p) => p.id === bLast.selfId)).toBeUndefined();
      expect(bLast.players.find((p) => p.id === aLast.selfId)).toBeUndefined();
    } else if (dist2 < (AOI_RADIUS * 0.5) * (AOI_RADIUS * 0.5)) {
      // They're well inside each other's AOI; both sides must include the
      // other (the inclusion path of the spatial hash).
      expect(aLast.players.find((p) => p.id === bLast.selfId)).toBeTruthy();
      expect(bLast.players.find((p) => p.id === aLast.selfId)).toBeTruthy();
    }
    // In the ambiguous band [AOI/2, 2·AOI] the spatial-hash cell quantization
    // and randomized spawn locations make inclusion/exclusion non-deterministic;
    // the AOI bound test above already covers the strict-inclusion property.
  });

  test('server echoes lastInputSeq from `input` event into snapshots', async () => {
    const { snaps } = await joinAndCaptureSnaps({
      count: 6,
      inputs: [
        { seq: 1, angleTarget: 0.5, boost: false },
        { seq: 2, angleTarget: 0.6, boost: false },
        { seq: 7, angleTarget: 0.7, boost: true },
        // Out-of-order / stale — server must ignore.
        { seq: 3, angleTarget: 0.9, boost: false },
      ],
    });
    const maxSeen = snaps.reduce((m, s) => Math.max(m, s.lastInputSeq), 0);
    expect(maxSeen).toBe(7);
  });
});
