/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export type GameState = {
  players: Record<string, Player>;
  orbs: Record<string, Orb>;
  leaderboard: LeaderboardEntry[];
  hazards: Record<string, HazardZone>;
};

export type HazardZone = {
  id: string;
  x: number;
  y: number;
  radius: number;
  state: 'warning' | 'active';
  timeLeft: number;
};

export type PlayerState = 'alive' | 'dead' | 'spectating';

export type Point = {
  x: number;
  y: number;
};

export type Player = {
  id: string;
  name: string;
  color: string;
  segments: Point[];
  score: number;
  isBoosting: boolean;
  state: PlayerState;
  currentAngle: number;
  inputs: { left: boolean; right: boolean; boost: boolean };
  isBot?: boolean;
};

export type PlayerStateUpdatePayload = {
  segments: Point[];
  score: number;
  currentAngle: number;
  isBoosting: boolean;
  state: Extract<PlayerState, 'alive' | 'dead'>;
};

export type Orb = {
  id: string;
  x: number;
  y: number;
  value: number;
  color: string;
};

export type LeaderboardEntry = {
  id: string;
  name: string;
  score: number;
  color: string;
};

export const WORLD_SIZE = 150;
export const BASE_SPEED = 15;
export const BOOST_SPEED = 30;
export const TICK_RATE = 60; // Server simulation Hz (bots, hazards, physics)
export const ORB_SPAWN_RATE = 0.1; // Orbs per tick
export const MAX_ORBS = 300;
export const INITIAL_LENGTH = 10;
export const SEGMENT_SPACING = 0.5;
export const TURN_SPEED = Math.PI * 3; // Radians per second

// Slither.io-style network tuning
// Server broadcasts state at a lower rate than the simulation tick to bound
// bandwidth. The client interpolates between snapshots to hide the cadence.
export const BROADCAST_RATE = 20; // Hz
export const BROADCAST_INTERVAL_MS = Math.round(1000 / BROADCAST_RATE); // 50ms

// Spatial-hash cell sizes used by both bot AI and per-socket relevance
// filtering. Coarse cell for heads/orbs; fine cell for body-segment collisions.
export const HASH_CELL_COARSE = 20;
export const HASH_CELL_FINE = 5;

// Area-of-interest radius (world units) used for per-socket broadcasts. Must
// be comfortably larger than the client's view radius so entities don't pop
// in/out at the screen edge.
export const AOI_RADIUS = 60;

// Client-side render delay for snapshot interpolation (~2 broadcast intervals)
// and the snap threshold for local-player reconciliation.
export const INTERP_DELAY_MS = 100;
export const RECONCILE_SNAP_THRESHOLD = 2; // world units
