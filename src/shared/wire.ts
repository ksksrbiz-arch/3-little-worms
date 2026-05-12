/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Compact binary encoding for per-socket AOI snapshots.
 *
 * Layout (little-endian):
 *   header
 *     u8  version                       (== SNAPSHOT_BINARY_VERSION)
 *     u32 tickSeq
 *     u32 serverTimeMs
 *     u16 lastInputSeq
 *     u16 selfWireId                    (0xFFFF if no self in this snapshot)
 *
 *   id table (server → wire id mapping is *snapshot-local* so receivers can
 *   decode without negotiation):
 *     u16 stringIdCount
 *     repeat stringIdCount:
 *       u8  byteLen
 *       u8[byteLen] utf-8 bytes
 *
 *   color palette (so each entity only spends 1 byte on color):
 *     u8  colorCount
 *     repeat colorCount:
 *       u8  byteLen
 *       u8[byteLen] utf-8 bytes
 *
 *   players:
 *     u16 playerCount
 *     repeat playerCount:
 *       u16 wireId
 *       u8  nameLen
 *       u8[nameLen] name (utf-8)
 *       u8  colorIdx
 *       u8  state         (0=alive, 1=dead, 2=spectating)
 *       u8  flags         (bit0 = isBoosting)
 *       u16 score         (clamped to 0..65535)
 *       i16 angleFixed    (radians * SNAPSHOT_ANGLE_SCALE, wrapped)
 *       u16 segCount
 *       repeat segCount:
 *         i16 x  (world units * SNAPSHOT_FIXED_POINT_SCALE)
 *         i16 y
 *
 *   orbs:
 *     u16 orbCount
 *     repeat orbCount:
 *       u16 wireId
 *       i16 x
 *       i16 y
 *       u8  value          (clamped to 0..255)
 *       u8  colorIdx
 *
 *   hazards:
 *     u16 hazardCount
 *     repeat hazardCount:
 *       u16 wireId
 *       i16 x
 *       i16 y
 *       u16 radiusFixed    (world units * SNAPSHOT_FIXED_POINT_SCALE)
 *       u8  state          (0=warning, 1=active)
 *       i16 timeLeftMs     (clamped to ±32 s)
 */

import {
  SNAPSHOT_BINARY_VERSION,
  SNAPSHOT_FIXED_POINT_SCALE,
  SNAPSHOT_ANGLE_SCALE,
  type Snapshot,
  type SnapshotPlayer,
  type SnapshotOrb,
  type SnapshotHazard,
  type PlayerState,
} from './types';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8');

const NO_SELF = 0xffff;

function clampI16(v: number): number {
  if (v > 32767) return 32767;
  if (v < -32768) return -32768;
  return v | 0;
}

function clampU16(v: number): number {
  if (v > 65535) return 65535;
  if (v < 0) return 0;
  return v | 0;
}

function clampU8(v: number): number {
  if (v > 255) return 255;
  if (v < 0) return 0;
  return v | 0;
}

function fixedXY(v: number): number {
  return clampI16(Math.round(v * SNAPSHOT_FIXED_POINT_SCALE));
}

function fixedAngle(v: number): number {
  // wrap angle into [-pi, pi]
  let a = v;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return clampI16(Math.round(a * SNAPSHOT_ANGLE_SCALE));
}

function stateToByte(s: PlayerState): number {
  return s === 'alive' ? 0 : s === 'dead' ? 1 : 2;
}

function byteToState(b: number): PlayerState {
  return b === 0 ? 'alive' : b === 1 ? 'dead' : 'spectating';
}

function encodeString(view: DataView, bytes: Uint8Array, offset: number, str: string): number {
  const encoded = TEXT_ENCODER.encode(str);
  const len = Math.min(encoded.length, 255);
  view.setUint8(offset, len);
  bytes.set(encoded.subarray(0, len), offset + 1);
  return offset + 1 + len;
}

function readString(view: DataView, bytes: Uint8Array, offset: number): { value: string; next: number } {
  const len = view.getUint8(offset);
  const value = TEXT_DECODER.decode(bytes.subarray(offset + 1, offset + 1 + len));
  return { value, next: offset + 1 + len };
}

function utf8Len(str: string): number {
  return Math.min(TEXT_ENCODER.encode(str).length, 255);
}

function buildIndex<T>(items: T[], key: (t: T) => string): { table: string[]; index: Map<string, number> } {
  const index = new Map<string, number>();
  const table: string[] = [];
  for (const it of items) {
    const k = key(it);
    if (!index.has(k)) {
      index.set(k, table.length);
      table.push(k);
    }
  }
  return { table, index };
}

export function encodeSnapshot(snap: Snapshot): ArrayBuffer {
  // 1) Build id and color tables (snapshot-local; small because AOI keeps counts low).
  const idItems: string[] = [];
  const seenIds = new Set<string>();
  const pushId = (id: string) => {
    if (!seenIds.has(id)) {
      seenIds.add(id);
      idItems.push(id);
    }
  };
  for (const p of snap.players) pushId(p.id);
  for (const o of snap.orbs) pushId(o.id);
  for (const h of snap.hazards) pushId(h.id);
  if (snap.selfId) pushId(snap.selfId);

  const idIndex = new Map<string, number>();
  idItems.forEach((id, i) => idIndex.set(id, i));

  const colorTable = buildIndex(
    [
      ...snap.players.map((p) => ({ c: p.color })),
      ...snap.orbs.map((o) => ({ c: o.color })),
    ],
    (e) => e.c
  );

  // 2) Compute total byte size up front to allocate exactly once.
  let size = 0;
  size += 1 + 4 + 4 + 2 + 2; // header
  size += 2; // id count
  for (const id of idItems) size += 1 + utf8Len(id);
  size += 1; // color count
  for (const c of colorTable.table) size += 1 + utf8Len(c);

  size += 2; // player count
  for (const p of snap.players) {
    size += 2 + 1 + utf8Len(p.name) + 1 + 1 + 1 + 2 + 2 + 2 + p.segments.length * 4;
  }

  size += 2; // orb count
  size += snap.orbs.length * (2 + 2 + 2 + 1 + 1);

  size += 2; // hazard count
  size += snap.hazards.length * (2 + 2 + 2 + 2 + 1 + 2);

  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let off = 0;

  // Header
  view.setUint8(off, SNAPSHOT_BINARY_VERSION); off += 1;
  view.setUint32(off, snap.tickSeq >>> 0, true); off += 4;
  view.setUint32(off, snap.serverTimeMs >>> 0, true); off += 4;
  view.setUint16(off, clampU16(snap.lastInputSeq), true); off += 2;
  view.setUint16(off, snap.selfId ? (idIndex.get(snap.selfId) ?? NO_SELF) : NO_SELF, true); off += 2;

  // Id table
  view.setUint16(off, idItems.length, true); off += 2;
  for (const id of idItems) off = encodeString(view, bytes, off, id);

  // Color table
  view.setUint8(off, clampU8(colorTable.table.length)); off += 1;
  for (const c of colorTable.table) off = encodeString(view, bytes, off, c);

  // Players
  view.setUint16(off, snap.players.length, true); off += 2;
  for (const p of snap.players) {
    view.setUint16(off, idIndex.get(p.id)!, true); off += 2;
    off = encodeString(view, bytes, off, p.name);
    view.setUint8(off, clampU8(colorTable.index.get(p.color)!)); off += 1;
    view.setUint8(off, stateToByte(p.state)); off += 1;
    view.setUint8(off, p.isBoosting ? 1 : 0); off += 1;
    view.setUint16(off, clampU16(Math.floor(p.score)), true); off += 2;
    view.setInt16(off, fixedAngle(p.currentAngle), true); off += 2;
    view.setUint16(off, clampU16(p.segments.length), true); off += 2;
    for (const seg of p.segments) {
      view.setInt16(off, fixedXY(seg.x), true); off += 2;
      view.setInt16(off, fixedXY(seg.y), true); off += 2;
    }
  }

  // Orbs
  view.setUint16(off, snap.orbs.length, true); off += 2;
  for (const o of snap.orbs) {
    view.setUint16(off, idIndex.get(o.id)!, true); off += 2;
    view.setInt16(off, fixedXY(o.x), true); off += 2;
    view.setInt16(off, fixedXY(o.y), true); off += 2;
    view.setUint8(off, clampU8(o.value)); off += 1;
    view.setUint8(off, clampU8(colorTable.index.get(o.color)!)); off += 1;
  }

  // Hazards
  view.setUint16(off, snap.hazards.length, true); off += 2;
  for (const h of snap.hazards) {
    view.setUint16(off, idIndex.get(h.id)!, true); off += 2;
    view.setInt16(off, fixedXY(h.x), true); off += 2;
    view.setInt16(off, fixedXY(h.y), true); off += 2;
    view.setUint16(off, clampU16(Math.round(h.radius * SNAPSHOT_FIXED_POINT_SCALE)), true); off += 2;
    view.setUint8(off, h.state === 'active' ? 1 : 0); off += 1;
    view.setInt16(off, clampI16(Math.round(h.timeLeft * 1000)), true); off += 2;
  }

  return buffer;
}

export function decodeSnapshot(buffer: ArrayBuffer | ArrayBufferView): Snapshot {
  const view = ArrayBuffer.isView(buffer)
    ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new DataView(buffer);
  const bytes = ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer);
  let off = 0;

  const version = view.getUint8(off); off += 1;
  if (version !== SNAPSHOT_BINARY_VERSION) {
    throw new Error(`Unsupported snapshot version: ${version}`);
  }
  const tickSeq = view.getUint32(off, true); off += 4;
  const serverTimeMs = view.getUint32(off, true); off += 4;
  const lastInputSeq = view.getUint16(off, true); off += 2;
  const selfWireId = view.getUint16(off, true); off += 2;

  const idCount = view.getUint16(off, true); off += 2;
  const idTable: string[] = [];
  for (let i = 0; i < idCount; i++) {
    const r = readString(view, bytes, off);
    idTable.push(r.value);
    off = r.next;
  }

  const colorCount = view.getUint8(off); off += 1;
  const colorTable: string[] = [];
  for (let i = 0; i < colorCount; i++) {
    const r = readString(view, bytes, off);
    colorTable.push(r.value);
    off = r.next;
  }

  const playerCount = view.getUint16(off, true); off += 2;
  const players: SnapshotPlayer[] = [];
  for (let i = 0; i < playerCount; i++) {
    const wireId = view.getUint16(off, true); off += 2;
    const nameR = readString(view, bytes, off); off = nameR.next;
    const colorIdx = view.getUint8(off); off += 1;
    const stateByte = view.getUint8(off); off += 1;
    const flags = view.getUint8(off); off += 1;
    const score = view.getUint16(off, true); off += 2;
    const angleFixed = view.getInt16(off, true); off += 2;
    const segCount = view.getUint16(off, true); off += 2;
    const segments = new Array<{ x: number; y: number }>(segCount);
    for (let s = 0; s < segCount; s++) {
      const x = view.getInt16(off, true); off += 2;
      const y = view.getInt16(off, true); off += 2;
      segments[s] = { x: x / SNAPSHOT_FIXED_POINT_SCALE, y: y / SNAPSHOT_FIXED_POINT_SCALE };
    }
    players.push({
      id: idTable[wireId],
      name: nameR.value,
      color: colorTable[colorIdx],
      score,
      currentAngle: angleFixed / SNAPSHOT_ANGLE_SCALE,
      isBoosting: (flags & 1) !== 0,
      state: byteToState(stateByte),
      segments,
    });
  }

  const orbCount = view.getUint16(off, true); off += 2;
  const orbs: SnapshotOrb[] = new Array(orbCount);
  for (let i = 0; i < orbCount; i++) {
    const wireId = view.getUint16(off, true); off += 2;
    const x = view.getInt16(off, true); off += 2;
    const y = view.getInt16(off, true); off += 2;
    const value = view.getUint8(off); off += 1;
    const colorIdx = view.getUint8(off); off += 1;
    orbs[i] = {
      id: idTable[wireId],
      x: x / SNAPSHOT_FIXED_POINT_SCALE,
      y: y / SNAPSHOT_FIXED_POINT_SCALE,
      value,
      color: colorTable[colorIdx],
    };
  }

  const hazardCount = view.getUint16(off, true); off += 2;
  const hazards: SnapshotHazard[] = new Array(hazardCount);
  for (let i = 0; i < hazardCount; i++) {
    const wireId = view.getUint16(off, true); off += 2;
    const x = view.getInt16(off, true); off += 2;
    const y = view.getInt16(off, true); off += 2;
    const radiusFixed = view.getUint16(off, true); off += 2;
    const stateByte = view.getUint8(off); off += 1;
    const timeLeftMs = view.getInt16(off, true); off += 2;
    hazards[i] = {
      id: idTable[wireId],
      x: x / SNAPSHOT_FIXED_POINT_SCALE,
      y: y / SNAPSHOT_FIXED_POINT_SCALE,
      radius: radiusFixed / SNAPSHOT_FIXED_POINT_SCALE,
      state: stateByte === 1 ? 'active' : 'warning',
      timeLeft: timeLeftMs / 1000,
    };
  }

  return {
    tickSeq,
    serverTimeMs,
    lastInputSeq,
    selfId: selfWireId === NO_SELF ? null : idTable[selfWireId] ?? null,
    players,
    orbs,
    hazards,
  };
}
