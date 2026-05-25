/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { GameState, Player, Orb } from '../shared/types';

interface GameStore {
  socket: Socket | null;
  gameState: GameState | null;
  playerId: string | null;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'failed';
  ping: number;
  connect: () => void;
  joinGame: (options?: { name?: string, color?: string }) => void;
  sendPlayerState: (data: any) => void;
  sendCollectOrb: (orbId: string) => void;
  reconnect: () => void;
}

export const globalGameState: { current: GameState | null } = { current: null };
export const mobileInputs = { left: false, right: false, boost: false, active: false, angle: 0 };
let lastUiUpdate = 0;

function hasStateChanged(a: GameState | null, b: GameState | null): boolean {
  if (!a || !b) return true;
  
  if (Object.keys(a.players).length !== Object.keys(b.players).length) return true;
  if (Object.keys(a.orbs).length !== Object.keys(b.orbs).length) return true;
  if (a.leaderboard.length !== b.leaderboard.length) return true;
  if (Object.keys(a.hazards).length !== Object.keys(b.hazards).length) return true;
  
  for (const id in a.players) {
    const p1 = a.players[id];
    const p2 = b.players[id];
    if (!p2) return true;
    if (p1.score !== p2.score) return true;
    if (p1.state !== p2.state) return true;
    if (p1.isBoosting !== p2.isBoosting) return true;
    if (p1.currentAngle !== p2.currentAngle) return true;
    if (p1.magnetTime !== p2.magnetTime) return true;
    if (p1.shieldTime !== p2.shieldTime) return true;
    if (p1.doubleTime !== p2.doubleTime) return true;
    if (p1.kills !== p2.kills) return true;
    if (p1.killStreak !== p2.killStreak) return true;
    
    if (p1.segments.length !== p2.segments.length) return true;
    if (p1.segments.length > 0 && p2.segments.length > 0) {
      if (p1.segments[0].x !== p2.segments[0].x || p1.segments[0].y !== p2.segments[0].y) {
        return true;
      }
    }
  }
  
  for (let i = 0; i < a.leaderboard.length; i++) {
    if (a.leaderboard[i].id !== b.leaderboard[i].id) return true;
    if (a.leaderboard[i].score !== b.leaderboard[i].score) return true;
  }
  
  for (const id in a.hazards) {
    const h1 = a.hazards[id];
    const h2 = b.hazards[id];
    if (!h2) return true;
    if (h1.state !== h2.state || h1.x !== h2.x || h1.y !== h2.y) return true;
  }
  
  return false;
}

export const useGameStore = create<GameStore>((set, get) => ({
  socket: null,
  gameState: null,
  playerId: null,
  connectionStatus: 'disconnected',
  ping: 0,
  connect: () => {
    if (get().socket) return;
    
    set({ connectionStatus: 'connecting' });
    
    const socket = io({
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });

    let pingTimer: any = null;

    socket.on('connect', () => {
      console.log('Connected to server');
      set({ connectionStatus: 'connected' });
      
      // Measure RTT regularly
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (!socket.connected) return;
        const start = Date.now();
        // Fallback for generic ping measuring
        socket.emit('ping_measure', () => {
          const rtt = Date.now() - start;
          set({ ping: rtt });
        });
      }, 3000);
    });

    socket.on('disconnect', (reason) => {
      console.log('Disconnected from server:', reason);
      set({ connectionStatus: 'disconnected', ping: 0 });
      if (pingTimer) clearInterval(pingTimer);
    });

    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      set({ connectionStatus: 'failed' });
    });

    socket.on('reconnect_attempt', (attempt) => {
      console.log(`Reconnection attempt #${attempt}`);
      set({ connectionStatus: 'reconnecting' });
    });

    socket.on('reconnect_failed', () => {
      console.error('Reconnection failed completely');
      set({ connectionStatus: 'failed' });
    });

    socket.on('init', (id: string) => {
      set({ playerId: id });
    });

    socket.on('init_orbs', (orbs: Record<string, Orb>) => {
      if (globalGameState.current) {
        globalGameState.current.orbs = orbs;
      } else {
        globalGameState.current = {
          players: {},
          orbs: orbs,
          leaderboard: [],
          hazards: {},
        };
      }
    });

    socket.on('orb_spawn', (orb: Orb) => {
      if (globalGameState.current) {
        globalGameState.current.orbs[orb.id] = orb;
      }
    });

    socket.on('orb_collect', (orbId: string) => {
      if (globalGameState.current) {
        delete globalGameState.current.orbs[orbId];
      }
    });

    socket.on('state', (state: GameState) => {
      if (!globalGameState.current) {
        globalGameState.current = {
          ...state,
          orbs: {},
        };
      } else {
        const localOrbs = globalGameState.current.orbs;
        globalGameState.current = {
          ...state,
          orbs: localOrbs,
        };
      }
      
      const now = Date.now();
      if (now - lastUiUpdate > 100) { // Throttle React state updates to 10Hz
        const prev = get().gameState;
        if (!prev || hasStateChanged(prev, globalGameState.current)) {
          // Clone high-level structure to return a fresh reference for selectors/reactive updates, but only when actual state changed
          set({ gameState: { ...globalGameState.current } });
        }
        lastUiUpdate = now;
      }
    });

    set({ socket });
  },
  joinGame: (options?: { name?: string, color?: string }) => {
    const { socket } = get();
    if (socket) {
      socket.emit('join', options);
    }
  },
  sendPlayerState: (data) => {
    const { socket } = get();
    if (socket) {
      socket.emit('update_state', data);
    }
  },
  sendCollectOrb: (orbId) => {
    const { socket } = get();
    if (socket) {
      socket.emit('collect_orb', orbId);
    }
  },
  reconnect: () => {
    const { socket } = get();
    if (socket) {
      socket.close();
    }
    set({ socket: null, connectionStatus: 'disconnected', playerId: null });
    get().connect();
  },
}));
