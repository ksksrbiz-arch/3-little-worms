export class SpatialHash<T> {
  private cellSize: number;
  private cells: Map<string, T[]>;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  clear() {
    this.cells.clear();
  }

  private getKey(x: number, y: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }

  insert(x: number, y: number, item: T) {
    const key = this.getKey(x, y);
    if (!this.cells.has(key)) {
      this.cells.set(key, []);
    }
    this.cells.get(key)!.push(item);
  }

  query(x: number, y: number, radius: number): T[] {
    const results: T[] = [];
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = `${cx},${cy}`;
        const cell = this.cells.get(key);
        if (cell) {
          results.push(...cell);
        }
      }
    }
    return results;
  }
}

import type { GameState, Point } from '../shared/types.ts';
import { HASH_CELL_COARSE, HASH_CELL_FINE } from '../shared/types.ts';

export type PlayerHeadEntry = { id: string; score: number; segments: Point[] };
export type SegmentEntry = { id: string; x: number; y: number };
export type OrbEntry = { id: string; x: number; y: number };

export type WorldHashes = {
  playerHeadHash: SpatialHash<PlayerHeadEntry>;
  segmentHash: SpatialHash<SegmentEntry>;
  orbHash: SpatialHash<OrbEntry>;
};

/**
 * Build the per-tick spatial hashes used by both the bot AI and per-socket
 * area-of-interest broadcasting. Building them once per simulation tick and
 * reusing them avoids quadratic neighbour scans as the world fills up.
 */
export function buildSpatialHashes(state: GameState): WorldHashes {
  const playerHeadHash = new SpatialHash<PlayerHeadEntry>(HASH_CELL_COARSE);
  const segmentHash = new SpatialHash<SegmentEntry>(HASH_CELL_FINE);
  const orbHash = new SpatialHash<OrbEntry>(HASH_CELL_COARSE);

  for (const id in state.players) {
    const p = state.players[id];
    if (p.state === 'alive' && p.segments.length > 0) {
      const head = p.segments[0];
      playerHeadHash.insert(head.x, head.y, { id, score: p.score, segments: p.segments });
      for (const seg of p.segments) {
        segmentHash.insert(seg.x, seg.y, { id, x: seg.x, y: seg.y });
      }
    }
  }

  for (const orbId in state.orbs) {
    const orb = state.orbs[orbId];
    orbHash.insert(orb.x, orb.y, { id: orbId, x: orb.x, y: orb.y });
  }

  return { playerHeadHash, segmentHash, orbHash };
}
