/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import {
  GameState,
  INITIAL_LENGTH,
  Player,
  PlayerStateUpdatePayload,
  Point,
  SEGMENT_SPACING,
} from '../shared/types';

interface GameStore {
  socket: Socket | null;
  isConnected: boolean;
  gameState: GameState | null;
  playerId: string | null;
  connect: () => void;
  joinGame: (options?: { name?: string, color?: string }) => void;
  sendPlayerState: (data: PlayerStateUpdatePayload) => void;
  sendCollectOrb: (orbId: string) => void;
}

export const globalGameState: { current: GameState | null } = { current: null };
export const mobileInputs = { left: false, right: false, boost: false };

/**
 * Snapshot buffer for client-side prediction / interpolation. The render loop
 * (GameScene) consumes the latest server-authoritative head position for the
 * local player to perform "lenient validation" reconciliation:
 *   - If server head is within RECONCILE_SNAP_THRESHOLD of the predicted head
 *     it is smoothly nudged toward the server position.
 *   - Otherwise the prediction is snapped to the server position.
 *
 * `seq` is bumped on every received snapshot so consumers can detect that a
 * fresh snapshot arrived without subscribing to the socket.
 */
export type Snapshot = {
  receivedAt: number;
  state: GameState;
};
export const snapshotBuffer: { prev: Snapshot | null; latest: Snapshot | null; seq: number } = {
  prev: null,
  latest: null,
  seq: 0,
};
export const localServerView: {
  seq: number;
  head: Point | null;
  segments: Point[] | null;
  currentAngle: number | null;
  score: number | null;
} = { seq: 0, head: null, segments: null, currentAngle: null, score: null };

// Keep optimistic joins light enough for mobile/parallel E2E while still showing nearby collectibles.
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

function limitOptimisticOrbs(orbs: GameState['orbs']) {
  const visibleOrbs: GameState['orbs'] = {};
  let count = 0;
  for (const id in orbs) {
    visibleOrbs[id] = orbs[id];
    count++;
    if (count >= MAX_OPTIMISTIC_ORBS) break;
  }
  return visibleOrbs;
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
      const now = Date.now();

      // Capture server-authoritative view of the local player BEFORE we
      // overwrite it with the optimistic snapshot below. GameScene uses this
      // for lenient-validation reconciliation against its predicted head.
      if (currentId) {
        const serverSelf = state.players[currentId];
        if (serverSelf && serverSelf.state === 'alive' && serverSelf.segments.length > 0) {
          localServerView.seq++;
          localServerView.head = { x: serverSelf.segments[0].x, y: serverSelf.segments[0].y };
          localServerView.segments = serverSelf.segments.map(s => ({ x: s.x, y: s.y }));
          localServerView.currentAngle = serverSelf.currentAngle;
          localServerView.score = serverSelf.score;
        }
      }

      if (currentId && !state.players[currentId]) {
        const currentPlayer = get().gameState?.players[currentId] || createLocalPlayer(currentId, lastJoinOptions);
        state = {
          ...state,
          players: { [currentId]: currentPlayer },
          orbs: limitOptimisticOrbs(state.orbs),
        };
      }

      // Slide the snapshot buffer (prev, latest) for interpolation/reconciliation.
      snapshotBuffer.prev = snapshotBuffer.latest;
      snapshotBuffer.latest = { receivedAt: now, state };
      snapshotBuffer.seq++;

      globalGameState.current = state;
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
        if (!state.players[id]) {
          const nextState = {
            ...state,
            players: { [id]: createLocalPlayer(id, options) },
            orbs: limitOptimisticOrbs(state.orbs),
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
