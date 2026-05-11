import { create } from 'zustand';
import { GameState } from '../shared/types';

interface GameStore {
  ws: WebSocket | null;
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

export const useGameStore = create<GameStore>((set, get) => ({
  ws: null,
  gameState: null,
  playerId: null,
  connect: () => {
    if (get().ws) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      console.log('Connected to server');
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'init') {
        set({ playerId: msg.id });
      } else if (msg.type === 'state') {
        globalGameState.current = msg.data;
        const now = Date.now();
        if (now - lastUiUpdate > 100) {
          set({ gameState: msg.data });
          lastUiUpdate = now;
        }
      }
    };

    ws.onclose = () => {
      console.log('Disconnected from server');
      set({ ws: null, playerId: null });
      setTimeout(() => get().connect(), 2000);
    };

    set({ ws });
  },
  joinGame: (options?) => {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'join', ...options }));
    }
  },
  sendPlayerState: (data) => {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'update_state', ...data }));
    }
  },
  sendCollectOrb: (orbId) => {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'collect_orb', orbId }));
    }
  },
}));
