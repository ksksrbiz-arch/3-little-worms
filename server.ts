/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import express from 'express';
import { createServer as createViteServer } from 'vite';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import type {
  GameState,
  Player,
  Orb,
  PlayerStateUpdatePayload,
  Snapshot,
  SnapshotPlayer,
  SnapshotOrb,
  SnapshotHazard,
  InputPacket,
} from './src/shared/types.ts';
import {
  WORLD_SIZE,
  BASE_SPEED,
  BOOST_SPEED,
  TICK_RATE,
  MAX_ORBS,
  INITIAL_LENGTH,
  SEGMENT_SPACING,
  TURN_SPEED,
  BROADCAST_INTERVAL_MS,
  AOI_RADIUS,
} from './src/shared/types.ts';
import { buildSpatialHashes, type WorldHashes } from './src/server/SpatialHash.ts';
import { encodeSnapshot } from './src/shared/wire.ts';
import Stripe from 'stripe';

const app = express();
app.use(express.json());
const httpServer = createServer(app);

let stripeClient: Stripe | null = null;
export function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

function getPort(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return 3000;
  const port = Number(value);
  return port > 0 && port <= 65535 ? port : 3000;
}

const PORT = getPort(process.env.PORT);
const GCLOUD_DEPLOY_URL =
  process.env.GCLOUD_DEPLOY_URL || 'https://service-3-little-worms-167345356687.us-west2.run.app';
const APP_URL =
  process.env.APP_URL ||
  (process.env.NODE_ENV === 'production' ? GCLOUD_DEPLOY_URL : `http://localhost:${PORT}`);

const COLORS = [
  '#ff7eb3', // vibrant pink
  '#ffb86c', // vibrant orange
  '#f1fa8c', // vibrant yellow
  '#50fa7b', // vibrant green
  '#8be9fd', // vibrant blue
  '#bd93f9', // vibrant purple
];

const state: GameState = {
  players: {},
  orbs: {},
  leaderboard: [],
  hazards: {},
};

// Hard upper bound on total orbs in the world. Death drops are spawned with
// force=true (bypassing MAX_ORBS), and with many simultaneous bot/player
// deaths the count can grow without bound, ballooning network payloads and
// overflowing the client's pre-allocated InstancedMesh buffer, which kills
// the WebGL render loop and freezes the game.
const HARD_ORB_LIMIT = 1000;

function spawnOrb(x?: number, y?: number, value?: number, color?: string, force = false) {
  const total = Object.keys(state.orbs).length;
  if (total >= HARD_ORB_LIMIT) return;
  if (!force && total >= MAX_ORBS) return;
  const id = uuidv4();
  if (value === undefined) {
    value = Math.random() < 0.1 ? 5 : 1; // 10% chance to be large orb
  }
  state.orbs[id] = {
    id,
    x: x ?? (Math.random() - 0.5) * WORLD_SIZE,
    y: y ?? (Math.random() - 0.5) * WORLD_SIZE,
    value,
    color: color ?? COLORS[Math.floor(Math.random() * COLORS.length)],
  };
}

// Initial orbs
for (let i = 0; i < 150; i++) {
  spawnOrb();
}

let snakeCounter = 1;

// Per-socket runtime state for input prediction & snapshot delivery.
type ClientRuntime = {
  lastInputSeq: number;
  // last input applied to this player; the server resamples it each tick when
  // server-authoritative movement is enabled (currently behind the client opt-in).
  pendingAngleTarget: number | null;
  pendingBoost: boolean;
};
const clientRuntime: Map<string, ClientRuntime> = new Map();

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  clientRuntime.set(socket.id, { lastInputSeq: 0, pendingAngleTarget: null, pendingBoost: false });

  socket.on('join', (options?: { name?: string, color?: string }) => {
    const name = options?.name || `Snake-${snakeCounter++}`;
    const color = options?.color || COLORS[Math.floor(Math.random() * COLORS.length)];
    const startX = (Math.random() - 0.5) * (WORLD_SIZE - 20);
    const startY = (Math.random() - 0.5) * (WORLD_SIZE - 20);
    const angle = Math.random() * Math.PI * 2;

    const segments = [];
    for (let i = 0; i < INITIAL_LENGTH; i++) {
      segments.push({
        x: startX - Math.cos(angle) * i * SEGMENT_SPACING,
        y: startY - Math.sin(angle) * i * SEGMENT_SPACING,
      });
    }

    state.players[socket.id] = {
      id: socket.id,
      name,
      color,
      segments,
      score: INITIAL_LENGTH,
      isBoosting: false,
      state: 'alive',
      currentAngle: angle,
      inputs: { left: false, right: false, boost: false },
    };
    socket.emit('init', socket.id);
    socket.emit('state', state);
  });

  socket.on('update_state', (data: PlayerStateUpdatePayload) => {
    const player = state.players[socket.id];
    if (player && player.state === 'alive') {
      player.segments = data.segments;
      player.score = data.score;
      player.currentAngle = data.currentAngle;
      player.isBoosting = data.isBoosting;
      
      if (data.state === 'dead') {
        player.state = 'dead';
        // Drop orbs
        player.segments.forEach((seg, i) => {
          if (i % 2 === 0) spawnOrb(seg.x, seg.y, 1, player.color, true);
        });
      }
    }
  });

  // Server-authoritative input event (Step 3). Clients that opt into the
  // new prediction/reconciliation model send these instead of `update_state`.
  // The actual server-side snake movement loop is intentionally not yet
  // wired up to consume these (full migration is a follow-up); we record the
  // most recent input so the upcoming authoritative simulator can resample
  // it at the fixed tick rate, and we already echo `lastInputSeq` back in
  // every snapshot so client-side reconciliation can be developed against
  // a stable wire format today.
  socket.on('input', (data: InputPacket) => {
    const rt = clientRuntime.get(socket.id);
    if (!rt) return;
    if (typeof data?.seq !== 'number' || typeof data?.angleTarget !== 'number') return;
    if (data.seq <= rt.lastInputSeq) return; // ignore out-of-order/stale
    rt.lastInputSeq = data.seq >>> 0;
    rt.pendingAngleTarget = data.angleTarget;
    rt.pendingBoost = !!data.boost;
  });

  socket.on('collect_orb', (orbId: string) => {
    if (state.orbs[orbId]) {
      delete state.orbs[orbId];
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    const player = state.players[socket.id];
    if (player && player.state === 'alive') {
      // Drop orbs
      player.segments.forEach((seg, i) => {
        if (i % 2 === 0) spawnOrb(seg.x, seg.y, 1, player.color, true);
      });
    }
    delete state.players[socket.id];
    clientRuntime.delete(socket.id);
  });
});

import { updateBots } from './src/server/bots.ts';

// ---------------------------------------------------------------------------
// Game Loop — fixed-step simulation accumulator with catch-up clamp (Step 1),
// followed by a separate broadcast loop at BROADCAST_INTERVAL_MS (~20 Hz).
// ---------------------------------------------------------------------------
//
// The simulation `setInterval` still fires roughly at TICK_RATE Hz, but after
// a long event-loop stall (GC pause, sync work in another handler) we must
// NOT try to catch up by replaying every missed step — that would teleport
// snakes across the screen. Instead we clamp to at most MAX_CATCHUP_STEPS
// fixed steps per wakeup; any leftover wall-clock time is discarded with a
// rate-limited warning.
const TICK_INTERVAL_MS = 1000 / TICK_RATE;
const FIXED_DT = TICK_INTERVAL_MS / 1000; // seconds per simulation step
const MAX_CATCHUP_STEPS = 3;
let tickAccumulatorMs = 0;
let lastTickWallMs = Date.now();
let tickSeq = 0;
let lastCatchupWarnMs = 0;
let latestHashes: WorldHashes = buildSpatialHashes(state);

function runSimulationStep(dt: number) {
  // Update players (just for boosting orb drops)
  for (const id in state.players) {
    const player = state.players[id];
    if (player.state === 'alive' && player.isBoosting) {
      if (Math.random() < 0.1 && player.segments.length > 0) {
        const tail = player.segments[player.segments.length - 1];
        spawnOrb(tail.x, tail.y, 1, player.color, true);
      }
    }
  }

  // Build per-tick spatial hashes once and share with the AI pass and the
  // broadcast loop's AOI queries.
  latestHashes = buildSpatialHashes(state);

  // AI Bots Update
  updateBots(state, dt, spawnOrb, latestHashes);

  // Spawn random orbs
  if (Math.random() < 0.2) {
    spawnOrb();
  }

  // Hazards
  if (Math.random() < 0.005 && Object.keys(state.hazards).length < 5) {
    const id = uuidv4();
    state.hazards[id] = {
      id,
      x: (Math.random() - 0.5) * WORLD_SIZE * 0.8,
      y: (Math.random() - 0.5) * WORLD_SIZE * 0.8,
      radius: 10 + Math.random() * 15,
      state: 'warning',
      timeLeft: 3
    };
  }

  for (const id in state.hazards) {
    const haz = state.hazards[id];
    haz.timeLeft -= dt;
    if (haz.timeLeft <= 0) {
      if (haz.state === 'warning') {
        haz.state = 'active';
        haz.timeLeft = 5 + Math.random() * 10;
      } else {
        delete state.hazards[id];
      }
    }
  }

  // Update leaderboard
  state.leaderboard = Object.values(state.players)
    .filter(p => p.state === 'alive')
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(p => ({ id: p.id, name: p.name, score: Math.floor(p.score), color: p.color }));
}

// ---------------------------------------------------------------------------
// Binary AOI snapshot construction (Step 6 wire format) — reuses the
// per-tick spatial hashes so we don't rebuild them per-socket.
// ---------------------------------------------------------------------------
function buildSnapshotForSocket(
  socketId: string,
  hashes: WorldHashes,
  serverTimeMs: number,
  currentTickSeq: number,
): Snapshot {
  const self = state.players[socketId];
  const headX = self?.segments[0]?.x ?? 0;
  const headY = self?.segments[0]?.y ?? 0;

  // Players inside the AOI: any player with at least one segment in range.
  const playerIds = new Set<string>();
  if (self) playerIds.add(socketId);
  for (const hit of hashes.segmentHash.query(headX, headY, AOI_RADIUS)) {
    playerIds.add(hit.id);
  }

  const players: SnapshotPlayer[] = [];
  for (const pid of playerIds) {
    const p = state.players[pid];
    if (!p) continue;
    players.push({
      id: p.id,
      name: p.name,
      color: p.color,
      score: p.score,
      currentAngle: p.currentAngle,
      isBoosting: p.isBoosting,
      state: p.state,
      segments: p.segments,
    });
  }

  const orbIds = new Set<string>();
  for (const hit of hashes.orbHash.query(headX, headY, AOI_RADIUS)) orbIds.add(hit.id);
  const orbs: SnapshotOrb[] = [];
  for (const oid of orbIds) {
    const o = state.orbs[oid];
    if (o) orbs.push({ id: o.id, x: o.x, y: o.y, value: o.value, color: o.color });
  }

  const hazards: SnapshotHazard[] = [];
  for (const hazId in state.hazards) {
    const h = state.hazards[hazId];
    const dx = h.x - headX;
    const dy = h.y - headY;
    if (dx * dx + dy * dy < (AOI_RADIUS + h.radius) * (AOI_RADIUS + h.radius)) {
      hazards.push({ id: h.id, x: h.x, y: h.y, radius: h.radius, state: h.state, timeLeft: h.timeLeft });
    }
  }

  const rt = clientRuntime.get(socketId);
  return {
    tickSeq: currentTickSeq,
    serverTimeMs,
    lastInputSeq: rt?.lastInputSeq ?? 0,
    selfId: self ? socketId : null,
    players,
    orbs,
    hazards,
  };
}

setInterval(() => {
  const nowServer = Date.now();
  const elapsed = nowServer - lastTickWallMs;
  lastTickWallMs = nowServer;
  tickAccumulatorMs += elapsed;

  // Catch-up clamp: never simulate more than MAX_CATCHUP_STEPS fixed steps
  // in a single wakeup, even if elapsed is huge after a stall.
  const maxAccumMs = MAX_CATCHUP_STEPS * TICK_INTERVAL_MS;
  if (tickAccumulatorMs > maxAccumMs) {
    if (nowServer - lastCatchupWarnMs > 5000) {
      console.warn(
        `Tick loop catch-up clamped: ${tickAccumulatorMs.toFixed(0)}ms accumulated, ` +
        `discarding ${(tickAccumulatorMs - maxAccumMs).toFixed(0)}ms.`
      );
      lastCatchupWarnMs = nowServer;
    }
    tickAccumulatorMs = maxAccumMs;
  }

  while (tickAccumulatorMs >= TICK_INTERVAL_MS) {
    runSimulationStep(FIXED_DT);
    tickAccumulatorMs -= TICK_INTERVAL_MS;
    tickSeq = (tickSeq + 1) >>> 0;
  }
}, TICK_INTERVAL_MS);

// Broadcast loop — emits a per-socket area-of-interest payload at ~20 Hz.
// Other snakes are always included so cross-world collisions/leaderboard work
// even when players are far apart; orbs and hazards (the bulk of the bandwidth
// in a populated world) are filtered to within AOI_RADIUS of each player's
// head. Spectators / not-yet-joined sockets get a leaderboard-only payload.
// Each socket also receives a binary `snap` frame (Step 6) for clients that
// have migrated to the new wire format; legacy clients keep consuming `state`.
setInterval(() => {
  if (io.engine.clientsCount === 0) return;

  // Pre-compute the alive-player snapshot once per broadcast — this is the
  // same set every recipient sees so we can share the object reference.
  const alivePlayers: Record<string, Player> = {};
  for (const id in state.players) {
    const p = state.players[id];
    if (p.state === 'alive') {
      alivePlayers[id] = p;
    }
  }

  const nowServer = Date.now();
  const sockets = io.sockets.sockets;
  for (const [, socket] of sockets) {
    const self = state.players[socket.id];
    if (!self || self.state !== 'alive' || self.segments.length === 0) {
      // Spectator / pre-join: send a minimal payload so the leaderboard works.
      socket.volatile.emit('state', {
        players: alivePlayers,
        orbs: {},
        leaderboard: state.leaderboard,
        hazards: {},
      } as GameState);
      // Still ship a binary `snap` (without a self) so clients on the new
      // wire path see the alive-player list and can render the leaderboard.
      try {
        const snap = buildSnapshotForSocket(socket.id, latestHashes, nowServer, tickSeq);
        socket.emit('snap', encodeSnapshot(snap));
      } catch (err) {
        console.warn('Failed to encode snapshot for socket', socket.id, err);
      }
      continue;
    }

    const head = self.segments[0];
    const nearbyOrbs: Record<string, Orb> = {};
    for (const orb of latestHashes.orbHash.query(head.x, head.y, AOI_RADIUS)) {
      const o = state.orbs[orb.id];
      if (o) nearbyOrbs[orb.id] = o;
    }

    const nearbyHazards: GameState['hazards'] = {};
    for (const hazId in state.hazards) {
      const haz = state.hazards[hazId];
      const dx = haz.x - head.x;
      const dy = haz.y - head.y;
      // Include hazards whose blast area touches the AOI ring.
      if (dx * dx + dy * dy < (AOI_RADIUS + haz.radius) * (AOI_RADIUS + haz.radius)) {
        nearbyHazards[hazId] = haz;
      }
    }

    socket.volatile.emit('state', {
      players: alivePlayers,
      orbs: nearbyOrbs,
      leaderboard: state.leaderboard,
      hazards: nearbyHazards,
    } as GameState);

    // Binary `snap` (Step 6). Note: `socket.volatile.emit` silently drops
    // binary frames in this socket.io v4 setup, so we use plain `socket.emit`
    // and rely on the BROADCAST_INTERVAL_MS throttle for back-pressure.
    try {
      const snap = buildSnapshotForSocket(socket.id, latestHashes, nowServer, tickSeq);
      socket.emit('snap', encodeSnapshot(snap));
    } catch (err) {
      console.warn('Failed to encode snapshot for socket', socket.id, err);
    }
  }
}, BROADCAST_INTERVAL_MS);

async function startServer() {
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/api/stripe/create-checkout-session', async (req, res) => {
    try {
      const { userId } = req.body;
      const stripe = getStripe();
      
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: '1000 Neon Coins',
                description: 'Currency for Neon Snake shop',
              },
              unit_amount: 500, // $5.00
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        // In a real app we'd verify the domain dynamically and pass userId to metadata
        success_url: `${APP_URL}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${APP_URL}?payment=cancelled`,
        metadata: {
          userId: userId
        }
      });

      res.json({ url: session.url });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to create checkout session. Ensure STRIPE_SECRET_KEY is set.' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist', {
      maxAge: '1y',
      immutable: true,
      setHeaders: (res, filePath) => {
        if (!filePath.includes('/assets/')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }));
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
