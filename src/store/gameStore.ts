/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { GameState, Player } from '../shared/types';

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
let lastUiUpdate = 0;
let pendingJoinRequested = false;
let pendingJoinOptions: { name?: string, color?: string } | undefined;

function emitJoin(socket: Socket) {
  if (!pendingJoinRequested) return;
  socket.emit('join', pendingJoinOptions);
  pendingJoinRequested = false;
  pendingJoinOptions = undefined;
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

    if (!socket) {
      get().connect();
      return;
    }

    if (socket.connected) {
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
