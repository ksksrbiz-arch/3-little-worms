import express from 'express';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import {
  GameState,
  Player,
  Orb,
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

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

const PORT = 3000;

const COLORS = [
  '#ff7eb3',
  '#ffb86c',
  '#f1fa8c',
  '#50fa7b',
  '#8be9fd',
  '#bd93f9',
];

const state: GameState = {
  players: {},
  orbs: {},
  leaderboard: [],
  hazards: {},
};

function spawnOrb(x?: number, y?: number, value?: number, color?: string, force = false) {
  if (!force && Object.keys(state.orbs).length >= MAX_ORBS) return;
  const id = crypto.randomUUID();
  if (value === undefined) {
    value = Math.random() < 0.1 ? 5 : 1;
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

// Track WebSocket → player ID
const connections = new Map<WebSocket, string>();

function broadcast(data: unknown) {
  const json = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const playerId = connections.get(ws);

      if (msg.type === 'join') {
        const name = msg.name || `Snake-${snakeCounter++}`;
        const color = msg.color || COLORS[Math.floor(Math.random() * COLORS.length)];
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

        const id = crypto.randomUUID();
        connections.set(ws, id);

        state.players[id] = {
          id,
          name,
          color,
          segments,
          score: INITIAL_LENGTH,
          isBoosting: false,
          state: 'alive',
          currentAngle: angle,
          inputs: { left: false, right: false, boost: false },
        };

        ws.send(JSON.stringify({ type: 'init', id }));

      } else if (msg.type === 'update_state' && playerId) {
        const player = state.players[playerId];
        if (player && player.state === 'alive') {
          player.segments = msg.segments;
          player.score = msg.score;
          player.currentAngle = msg.currentAngle;
          player.isBoosting = msg.isBoosting;

          if (msg.state === 'dead') {
            player.state = 'dead';
            player.segments.forEach((seg: { x: number; y: number }, i: number) => {
              if (i % 2 === 0) spawnOrb(seg.x, seg.y, 1, player.color, true);
            });
          }
        }
      } else if (msg.type === 'collect_orb' && playerId) {
        if (state.orbs[msg.orbId]) {
          delete state.orbs[msg.orbId];
        }
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    const playerId = connections.get(ws);
    if (playerId) {
      const player = state.players[playerId];
      if (player && player.state === 'alive') {
        player.segments.forEach((seg, i) => {
          if (i % 2 === 0) spawnOrb(seg.x, seg.y, 1, player.color, true);
        });
      }
      delete state.players[playerId];
      connections.delete(ws);
    }
  });
});

import { updateBots } from './src/server/bots.ts';

// Game Loop
let lastTimeServer = Date.now();
setInterval(() => {
  const nowServer = Date.now();
  const delta = (nowServer - lastTimeServer) / 1000;
  lastTimeServer = nowServer;

  // Boosting orb drops for human players
  for (const id in state.players) {
    const player = state.players[id];
    if (player.state === 'alive' && player.isBoosting) {
      if (Math.random() < 0.1 && player.segments.length > 0) {
        const tail = player.segments[player.segments.length - 1];
        spawnOrb(tail.x, tail.y, 1, player.color, true);
      }
    }
  }

  // AI Bots Update
  updateBots(state, delta, spawnOrb);

  // Spawn random orbs
  if (Math.random() < 0.2) {
    spawnOrb();
  }

  // Hazards
  if (Math.random() < 0.005 && Object.keys(state.hazards).length < 5) {
    const id = crypto.randomUUID();
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

  // Broadcast state
  if (wss.clients.size > 0) {
    broadcast({ type: 'state', data: state });
  }

}, 1000 / TICK_RATE);

async function startServer() {
  app.get('/api/health', (_req, res) => {
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
                description: 'Currency for 3 Little Worms shop',
              },
              unit_amount: 500,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${process.env.APP_URL || 'http://localhost:3000'}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}?payment=cancelled`,
        metadata: { userId },
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
