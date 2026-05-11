/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { GameState, INITIAL_LENGTH, Player, SEGMENT_SPACING } from '../shared/types';

interface GameStore {
  socket: Socket | null;
  isConnected: boolean;
  gameState: GameState | null;
  playerId: string | null;
  connect: () => void;
  joinGame: (options?: { name?: string, color?: string }) => void;
  sendPlayerState: (data: any) => void;
  sendCollectOrb: (orbId: string) => void;
}

export const globalGameState: { current: GameState | null } = { current: null };
export const mobileInputs = { left: false, right: false, boost: false };
const MAX_OPTIMISTIC_ORBS = 150;
let lastUiUpdate = 0;
let pendingJoinRequested = false;
let pendingJoinOptions: { name?: string, color?: string } | undefined;
let lastJoinOptions: { name?: string, color?: string } | undefined;

function emitJoin(socket: Socket) {
  if (!pendingJoinRequested) return;
  socket.emit('join', pendingJoinOptions);
  pendingJoinRequested = false;
  pendingJoinOptions = undefined;
}

function createLocalPlayer(id: string, options?: { name?: string, color?: string }): Player {
  const angle = 0;
  const segments = Array.from({ length: INITIAL_LENGTH }, (_, i) => ({
    x: -Math.cos(angle) * i * SEGMENT_SPACING,
    y: -Math.sin(angle) * i * SEGMENT_SPACING,
  }));

  return {
    id,
    name: options?.name || 'Snake',
    color: options?.color || '#50fa7b',
    segments,
    score: INITIAL_LENGTH,
    isBoosting: false,
    state: 'alive',
    currentAngle: angle,
    inputs: { left: false, right: false, boost: false },
  };
}

export const useGameStore = create<GameStore>((set, get) => ({
  socket: null,
  isConnected: false,
  gameState: null,
  playerId: null,
  connect: () => {
    if (get().socket) return;
    
    const socket = io();

    socket.on('connect', () => {
      console.log('Connected to server');
      set({ isConnected: true });
      emitJoin(socket);
    });

    socket.on('disconnect', () => {
      set({ isConnected: false });
    });

    socket.on('init', (id: string) => {
      set({ playerId: id });
    });

    socket.on('state', (state: GameState) => {
      const currentId = get().playerId;
      if (currentId && !state.players[currentId]) {
        const currentPlayer = get().gameState?.players[currentId] || createLocalPlayer(currentId, lastJoinOptions);
        const visibleOrbs = Object.fromEntries(Object.entries(state.orbs).slice(0, MAX_OPTIMISTIC_ORBS));
        state = {
          ...state,
          players: { [currentId]: currentPlayer },
          orbs: visibleOrbs,
        };
      }
      globalGameState.current = state;
      const now = Date.now();
      if (now - lastUiUpdate > 100) { // Throttle React updates to 10Hz
        set({ gameState: state });
        lastUiUpdate = now;
      }
    });

    set({ socket, isConnected: socket.connected });
  },
  joinGame: (options?: { name?: string, color?: string }) => {
    const { socket } = get();
    pendingJoinRequested = true;
    pendingJoinOptions = options;
    lastJoinOptions = options;

    if (!socket) {
      get().connect();
      return;
    }

    if (socket.connected) {
      const id = socket.id;
      if (id) {
        const state = globalGameState.current || get().gameState || { players: {}, orbs: {}, leaderboard: [], hazards: {} };
        const visibleOrbs = Object.fromEntries(Object.entries(state.orbs).slice(0, MAX_OPTIMISTIC_ORBS));
        if (!state.players[id]) {
          const nextState = {
            ...state,
            players: { [id]: createLocalPlayer(id, options) },
            orbs: visibleOrbs,
          };
          globalGameState.current = nextState;
          set({ playerId: id, gameState: nextState });
        } else {
          set({ playerId: id });
        }
      }
      emitJoin(socket);
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
}));
