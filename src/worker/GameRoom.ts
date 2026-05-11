import {
  GameState,
  Player,
  Orb,
  HazardZone,
  LeaderboardEntry,
  WORLD_SIZE,
  MAX_ORBS,
  INITIAL_LENGTH,
  SEGMENT_SPACING,
} from '../shared/types';
import { updateBots } from '../server/bots';

export interface Env {
  GAME_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  STRIPE_SECRET_KEY?: string;
  APP_URL?: string;
  AI_API_KEY?: string;
}

const TICK_MS = 50; // 20 ticks/sec
const COLORS = [
  '#ff7eb3',
  '#ffb86c',
  '#f1fa8c',
  '#50fa7b',
  '#8be9fd',
  '#bd93f9',
];

export class GameRoom {
  private state: DurableObjectState;
  private players: Record<string, Player> = {};
  private orbs: Record<string, Orb> = {};
  private hazards: Record<string, HazardZone> = {};
  private leaderboard: LeaderboardEntry[] = [];
  private wsToPlayer: Map<WebSocket, string> = new Map();
  private snakeCounter = 1;
  private lastTick = 0;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      for (let i = 0; i < 150; i++) {
        this.spawnOrb();
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);

    // Ensure the game loop alarm is running
    const existing = await this.state.storage.getAlarm();
    if (!existing) {
      await this.state.storage.setAlarm(Date.now() + TICK_MS);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
      const msg = JSON.parse(text);
      const playerId = this.wsToPlayer.get(ws);

      if (msg.type === 'join') {
        const name = msg.name || `Snake-${this.snakeCounter++}`;
        const color = msg.color || COLORS[Math.floor(Math.random() * COLORS.length)];
        const startX = (Math.random() - 0.5) * (WORLD_SIZE - 20);
        const startY = (Math.random() - 0.5) * (WORLD_SIZE - 20);
        const angle = Math.random() * Math.PI * 2;

        const segments: { x: number; y: number }[] = [];
        for (let i = 0; i < INITIAL_LENGTH; i++) {
          segments.push({
            x: startX - Math.cos(angle) * i * SEGMENT_SPACING,
            y: startY - Math.sin(angle) * i * SEGMENT_SPACING,
          });
        }

        const id = crypto.randomUUID();
        this.wsToPlayer.set(ws, id);

        this.players[id] = {
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
        const player = this.players[playerId];
        if (player && player.state === 'alive') {
          player.segments = msg.segments;
          player.score = msg.score;
          player.currentAngle = msg.currentAngle;
          player.isBoosting = msg.isBoosting;

          if (msg.state === 'dead') {
            player.state = 'dead';
            player.segments.forEach((seg: { x: number; y: number }, i: number) => {
              if (i % 2 === 0) this.spawnOrb(seg.x, seg.y, 1, player.color, true);
            });
          }
        }

      } else if (msg.type === 'collect_orb' && playerId) {
        if (this.orbs[msg.orbId]) {
          delete this.orbs[msg.orbId];
        }
      }
    } catch {
      // Ignore malformed messages
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const playerId = this.wsToPlayer.get(ws);
    if (playerId) {
      const player = this.players[playerId];
      if (player && player.state === 'alive') {
        player.segments.forEach((seg, i) => {
          if (i % 2 === 0) this.spawnOrb(seg.x, seg.y, 1, player.color, true);
        });
      }
      delete this.players[playerId];
      this.wsToPlayer.delete(ws);
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const delta = this.lastTick ? (now - this.lastTick) / 1000 : TICK_MS / 1000;
    this.lastTick = now;

    // Drop orbs from boosting human players
    for (const id in this.players) {
      const player = this.players[id];
      if (player.state === 'alive' && player.isBoosting && !player.isBot) {
        if (Math.random() < 0.1 && player.segments.length > 0) {
          const tail = player.segments[player.segments.length - 1];
          this.spawnOrb(tail.x, tail.y, 1, player.color, true);
        }
      }
    }

    // AI bots
    const gameState: GameState = {
      players: this.players,
      orbs: this.orbs,
      leaderboard: this.leaderboard,
      hazards: this.hazards,
    };
    updateBots(gameState, delta, this.spawnOrb.bind(this));

    // Spawn random orbs
    if (Math.random() < 0.2) {
      this.spawnOrb();
    }

    // Spawn hazards
    if (Math.random() < 0.005 && Object.keys(this.hazards).length < 5) {
      const id = crypto.randomUUID();
      this.hazards[id] = {
        id,
        x: (Math.random() - 0.5) * WORLD_SIZE * 0.8,
        y: (Math.random() - 0.5) * WORLD_SIZE * 0.8,
        radius: 10 + Math.random() * 15,
        state: 'warning',
        timeLeft: 3,
      };
    }

    for (const id in this.hazards) {
      const haz = this.hazards[id];
      haz.timeLeft -= delta;
      if (haz.timeLeft <= 0) {
        if (haz.state === 'warning') {
          haz.state = 'active';
          haz.timeLeft = 5 + Math.random() * 10;
        } else {
          delete this.hazards[id];
        }
      }
    }

    // Update leaderboard
    this.leaderboard = Object.values(this.players)
      .filter(p => p.state === 'alive')
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(p => ({ id: p.id, name: p.name, score: Math.floor(p.score), color: p.color }));

    // Broadcast state to all connected WebSockets
    const activeSockets = this.state.getWebSockets();
    if (activeSockets.length > 0) {
      const payload = JSON.stringify({
        type: 'state',
        data: {
          players: this.players,
          orbs: this.orbs,
          leaderboard: this.leaderboard,
          hazards: this.hazards,
        },
      });
      for (const ws of activeSockets) {
        try {
          ws.send(payload);
        } catch {
          // Client already gone
        }
      }
    }

    // Schedule the next tick
    await this.state.storage.setAlarm(Date.now() + TICK_MS);
  }

  private spawnOrb(x?: number, y?: number, value?: number, color?: string, force = false): void {
    if (!force && Object.keys(this.orbs).length >= MAX_ORBS) return;
    const id = crypto.randomUUID();
    this.orbs[id] = {
      id,
      x: x ?? (Math.random() - 0.5) * WORLD_SIZE,
      y: y ?? (Math.random() - 0.5) * WORLD_SIZE,
      value: value ?? (Math.random() < 0.1 ? 5 : 1),
      color: color ?? COLORS[Math.floor(Math.random() * COLORS.length)],
    };
  }
}
