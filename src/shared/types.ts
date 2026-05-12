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

// Per-client AOI snapshot delivered via the `snap` socket event. Carries only
// entities within the recipient's viewport plus a small buffer.
export type Snapshot = {
  tickSeq: number;
  serverTimeMs: number;
  lastInputSeq: number;
  selfId: string | null;
  players: SnapshotPlayer[];
  orbs: SnapshotOrb[];
  hazards: SnapshotHazard[];
};

export type SnapshotPlayer = {
  id: string;
  name: string;
  color: string;
  score: number;
  currentAngle: number;
  isBoosting: boolean;
  state: PlayerState;
  segments: Point[];
};

export type SnapshotOrb = {
  id: string;
  x: number;
  y: number;
  value: number;
  color: string;
};

export type SnapshotHazard = {
  id: string;
  x: number;
  y: number;
  radius: number;
  state: 'warning' | 'active';
  timeLeft: number;
};

// Client → server tiny input packet (replaces the legacy `update_state`
// emit). Sent at the client's render rate; the server samples its
// per-tick angle/boost from the most recent input.
export type InputPacket = {
  seq: number;       // monotonically increasing per client
  angleTarget: number; // desired heading in radians
  boost: boolean;
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

// Visible segment radius in world units (matches the renderer in
// src/components/game/Snake.tsx). The collision radius is intentionally
// slightly smaller so head-vs-body kills feel forgiving despite lag — the
// "lenient detection" rule from the architecture spec.
export const SEGMENT_VISUAL_RADIUS = 0.6;
export const HITBOX_SCALE_FACTOR = 0.85;
export const SEGMENT_HITBOX_RADIUS = SEGMENT_VISUAL_RADIUS * HITBOX_SCALE_FACTOR;
export const HEAD_HITBOX_RADIUS = 0.8 * HITBOX_SCALE_FACTOR;

// Slither.io-style network tuning
// Server simulates at TICK_RATE (60 Hz) but broadcasts state at the lower
// BROADCAST_RATE (20 Hz) to bound bandwidth. The client interpolates between
// snapshots to hide the cadence.
export const BROADCAST_RATE = 20; // Hz
export const BROADCAST_INTERVAL_MS = Math.round(1000 / BROADCAST_RATE); // 50ms
// Alias used by the binary `snap` wire path.
export const SNAPSHOT_RATE = BROADCAST_RATE;

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

// Binary snapshot wire format flags (src/shared/wire.ts).
export const SNAPSHOT_BINARY_VERSION = 1;
export const SNAPSHOT_FIXED_POINT_SCALE = 100; // 1 world unit = 100 wire units (i16 → ±327.67 units, easily covers WORLD_SIZE)
export const SNAPSHOT_ANGLE_SCALE = 10000; // i16 fixed-point for angle in radians
