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
} from './src/shared/types.ts';
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

const PORT = 3000;

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

function spawnOrb(x?: number, y?: number, value?: number, color?: string, force = false) {
  if (!force && Object.keys(state.orbs).length >= MAX_ORBS) return;
  const id = uuidv4();
  
  let type: 'standard' | 'magnet' | 'shield' | 'double' = 'standard';
  let orbVal = value;
  let orbColor = color;

  if (value === undefined) {
    const rand = Math.random();
    if (rand < 0.03) {
      type = 'magnet';
      orbVal = 3;
      orbColor = '#9d4edd'; // neon purple-violet
    } else if (rand < 0.06) {
      type = 'shield';
      orbVal = 3;
      orbColor = '#00f0ff'; // neon cyan
    } else if (rand < 0.09) {
      type = 'double';
      orbVal = 3;
      orbColor = '#ffb703'; // glowing gold
    } else if (rand < 0.20) {
      type = 'standard';
      orbVal = 5; // Large orb
      orbColor = color ?? COLORS[Math.floor(Math.random() * COLORS.length)];
    } else {
      type = 'standard';
      orbVal = 1;
      orbColor = color ?? COLORS[Math.floor(Math.random() * COLORS.length)];
    }
  }

  const newOrb: Orb = {
    id,
    x: x ?? (Math.random() - 0.5) * WORLD_SIZE,
    y: y ?? (Math.random() - 0.5) * WORLD_SIZE,
    value: orbVal ?? 1,
    color: orbColor ?? COLORS[Math.floor(Math.random() * COLORS.length)],
    type,
  };

  state.orbs[id] = newOrb;

  if (io) {
    io.emit('orb_spawn', newOrb);
  }
}

// Initial orbs
for (let i = 0; i < 150; i++) {
  spawnOrb();
}

let snakeCounter = 1;

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Send the active list of orbs initially
  socket.emit('init_orbs', state.orbs);

  // Handle Latency Check
  socket.on('ping_measure', (callback) => {
    if (typeof callback === 'function') {
      callback();
    }
  });

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
      magnetTime: 0,
      shieldTime: 0,
      doubleTime: 0,
      kills: 0,
      killStreak: 0,
    };

    socket.emit('init', socket.id);
  });

  socket.on('update_state', (data: { 
    segments: any[], 
    score: number, 
    currentAngle: number, 
    isBoosting: boolean, 
    state: string,
    killerId?: string | null,
    killerName?: string | null
  }) => {
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

        // Broadcast kill feed event!
        let killerNameStr = data.killerName || 'a space hazard';
        if (data.killerId) {
          const killerPlayer = state.players[data.killerId];
          if (killerPlayer) {
            killerPlayer.kills += 1;
            killerPlayer.killStreak += 1;
            killerPlayer.score += 20; // reward killer physically!
            killerNameStr = killerPlayer.name;
            io.emit('kill_feed', {
              victim: player.name,
              victimColor: player.color,
              killer: killerNameStr,
              killerColor: killerPlayer.color,
              streak: killerPlayer.killStreak,
              killerId: data.killerId
            });
          } else {
            io.emit('kill_feed', { victim: player.name, victimColor: player.color, killer: killerNameStr });
          }
        } else {
          io.emit('kill_feed', { victim: player.name, victimColor: player.color, killer: killerNameStr });
        }
        player.killStreak = 0; // reset streak
      }
    }
  });

  socket.on('collect_orb', (orbId: string) => {
    const orb = state.orbs[orbId];
    if (orb) {
      const player = state.players[socket.id];
      if (player && player.state === 'alive') {
        if (orb.type === 'magnet') {
          player.magnetTime = 10;
        } else if (orb.type === 'shield') {
          player.shieldTime = 15;
        } else if (orb.type === 'double') {
          player.doubleTime = 10;
        }
      }
      delete state.orbs[orbId];
      io.emit('orb_collect', orbId);
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
  });
});

import { updateBots } from './src/server/bots.ts';

// Game Loop
let lastTimeServer = Date.now();
let tickCountServer = 0;
setInterval(() => {
  const nowServer = Date.now();
  const delta = (nowServer - lastTimeServer) / 1000;
  lastTimeServer = nowServer;

  // Update players (boosting orb drops and powerup decrement timers)
  for (const id in state.players) {
    const player = state.players[id];
    if (player.state === 'alive') {
      if (player.magnetTime > 0) player.magnetTime = Math.max(0, player.magnetTime - delta);
      if (player.shieldTime > 0) player.shieldTime = Math.max(0, player.shieldTime - delta);
      if (player.doubleTime > 0) player.doubleTime = Math.max(0, player.doubleTime - delta);

      if (player.isBoosting) {
        if (Math.random() < 0.1 && player.segments.length > 0) {
          const tail = player.segments[player.segments.length - 1];
          spawnOrb(tail.x, tail.y, 1, player.color, true);
        }
      }
    }
  }

  // AI Bots Update with dynamic kill tracking and orb collections
  updateBots(state, delta, spawnOrb, (victimId, killerId) => {
    const victim = state.players[victimId];
    if (!victim) return;

    let killerNameStr = 'a space hazard';
    let killerColorStr = '#ff0033';
    let streakCount = 0;

    if (killerId) {
      const killer = state.players[killerId];
      if (killer) {
        killer.kills += 1;
        killer.killStreak += 1;
        killer.score += 20; // reward killer player or bot
        killerNameStr = killer.name;
        killerColorStr = killer.color;
        streakCount = killer.killStreak;
      }
    }

    io.emit('kill_feed', {
      victim: victim.name,
      victimColor: victim.color,
      killer: killerNameStr,
      killerColor: killerColorStr,
      streak: streakCount,
      killerId: killerId
    });

    victim.killStreak = 0;
  }, (orbId) => {
    io.emit('orb_collect', orbId);
  });

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
    haz.timeLeft -= delta;
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

  // Broadcast state async and volatile at 20Hz (once every 3 ticks on 60fps loop) to save bandwidth
  tickCountServer++;
  if (tickCountServer % 3 === 0) {
    if (io.engine.clientsCount > 0) {
      const lightweightState = {
        players: state.players,
        leaderboard: state.leaderboard,
        hazards: state.hazards,
        orbs: {}, // Client retains its local state database sync
      };
      setImmediate(() => {
        io.volatile.emit('state', lightweightState);
      });
    }
  }

}, 1000 / TICK_RATE);

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
        success_url: `${process.env.APP_URL || 'http://localhost:3000'}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}?payment=cancelled`,
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
    app.use(express.static('dist'));
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
