/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { useEffect, useRef, useState, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { globalGameState, mobileInputs } from '../store/gameStore';
import { WORLD_SIZE, TURN_SPEED, BOOST_SPEED, BASE_SPEED, type GameState, type Point, type PlayerStateUpdatePayload } from '../shared/types';
import * as THREE from 'three';
import { Sphere, Grid } from '@react-three/drei';

import { Snake } from './game/Snake';
import { Orbs } from './game/Orbs';
import { DeathExplosions } from './game/DeathExplosions';
import { BackgroundDust } from './game/BackgroundDust';
import { Hazards } from './game/Hazards';
import { localCollectedOrbs } from './game/utils';

import { useUserStore } from '../store/userStore';
import { audioManager } from '../lib/audio';
import { getCachedTexture } from '../lib/textureCache';

// Run client prediction at 60 FPS while capping large frame gaps to avoid catch-up spirals.
const TARGET_FRAME_TIME = 1 / 60;
const MAX_FRAME_DELTA = 1 / 30;
const ORB_COLLECT_RADIUS_SQ = 4;
const PLAYER_COLLISION_RADIUS_SQ = 2.25;
const MIN_LENGTH = 10;
const HAZARD_COLLISION_PADDING = 0.8;

const THEMES: Record<string, { bg: string, cell: string, section: string }> = {
  default: { bg: '#0a0a0a', cell: '#1e3a8a', section: '#3b82f6' },
  cyberpunk: { bg: '#050210', cell: '#e0165c', section: '#00f0ff' },
  matrix: { bg: '#000000', cell: '#003b00', section: '#00ff41' },
  synthwave: { bg: '#0f0524', cell: '#7c3aed', section: '#f472b6' }
};

type GameSceneProps = {
  gameState: GameState | null;
  playerId: string | null;
  sendPlayerState: (data: PlayerStateUpdatePayload) => void;
  sendCollectOrb: (orbId: string) => void;
};

function distanceSquared(a: Point, b: Point) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function clampToBoundary(point: Point, boundary: number) {
  return {
    x: Math.max(-boundary, Math.min(boundary, point.x)),
    y: Math.max(-boundary, Math.min(boundary, point.y)),
  };
}

function createPlayerStatePayload(
  segments: Point[],
  score: number,
  currentAngle: number,
  isBoosting: boolean,
  state: PlayerStateUpdatePayload['state']
): PlayerStateUpdatePayload {
  return {
    segments,
    score,
    currentAngle,
    isBoosting,
    state,
  };
}

export function GameScene({ gameState, playerId, sendPlayerState, sendCollectOrb }: GameSceneProps) {
  const { profile } = useUserStore();
  const { camera, size } = useThree();
  const isNarrowView = size.width < 640;
  const inputs = useRef({ left: false, right: false, boost: false });
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const frameAccumulator = useRef(0);
  const [lightTarget] = useState(() => new THREE.Object3D());

  const localPlayerRef = useRef<{
    active: boolean;
    segments: Point[];
    score: number;
    currentAngle: number;
    isBoosting: boolean;
    wasBoosting: boolean;
    lastSendTime: number;
  }>({
    active: false,
    segments: [],
    score: 10,
    currentAngle: 0,
    isBoosting: false,
    wasBoosting: false,
    lastSendTime: 0,
  });

  const getCameraZ = (score: number) => {
    if (isNarrowView) {
      return Math.min(70, Math.max(38, 34 + score * 0.35));
    }
    return Math.min(45, Math.max(20, 20 + score * 0.2));
  };

  useEffect(() => {
    globalGameState.current = gameState;
  }, [gameState]);

  useEffect(() => {
    const player = playerId && gameState ? gameState.players[playerId] : null;
    const head = player?.state === 'alive' ? player.segments[0] : null;
    if (!player || !head) return;

    camera.position.set(head.x, head.y, getCameraZ(player.score));
    camera.lookAt(head.x, head.y, 0);
  }, [camera, gameState, isNarrowView, playerId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') && !inputs.current.left) { inputs.current.left = true; }
      if ((e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') && !inputs.current.right) { inputs.current.right = true; }
      if ((e.key === ' ' || e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') && !inputs.current.boost) { inputs.current.boost = true; }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if ((e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') && inputs.current.left) { inputs.current.left = false; }
      if ((e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') && inputs.current.right) { inputs.current.right = false; }
      if ((e.key === ' ' || e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') && inputs.current.boost) { inputs.current.boost = false; }
    };

    const handleBlur = () => {
      inputs.current = { left: false, right: false, boost: false };
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      audioManager.stopBoost();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  useFrame((state, rawDelta) => {
    // Accumulate variable render time and advance movement in fixed 60 FPS steps.
    frameAccumulator.current += Math.min(rawDelta, MAX_FRAME_DELTA);
    if (frameAccumulator.current < TARGET_FRAME_TIME) return;
    const delta = TARGET_FRAME_TIME;
    frameAccumulator.current = Math.max(0, frameAccumulator.current - TARGET_FRAME_TIME);

    const gs = globalGameState.current;
    if (!gs || !playerId) return;
    
    const serverPlayer = gs.players[playerId];
    if (serverPlayer && serverPlayer.state === 'alive') {
      
      // Initialize from server if not active
      if (!localPlayerRef.current.active && serverPlayer.segments.length > 0) {
        localPlayerRef.current.active = true;
        localPlayerRef.current.segments = [...serverPlayer.segments];
        localPlayerRef.current.score = serverPlayer.score;
        localPlayerRef.current.currentAngle = serverPlayer.currentAngle;
        const head = serverPlayer.segments[0];
        camera.position.set(head.x, head.y, getCameraZ(serverPlayer.score));
        camera.lookAt(head.x, head.y, 0);
      }

      if (!localPlayerRef.current.active) return;

      // Local movement logic
      if (inputs.current.left || mobileInputs.left) localPlayerRef.current.currentAngle += TURN_SPEED * delta;
      if (inputs.current.right || mobileInputs.right) localPlayerRef.current.currentAngle -= TURN_SPEED * delta;
      
      localPlayerRef.current.isBoosting = (inputs.current.boost || mobileInputs.boost) && localPlayerRef.current.score > 10;
      const speed = localPlayerRef.current.isBoosting ? BOOST_SPEED : BASE_SPEED;
      
      const head = { ...localPlayerRef.current.segments[0] };
      head.x += Math.cos(localPlayerRef.current.currentAngle) * speed * delta;
      head.y += Math.sin(localPlayerRef.current.currentAngle) * speed * delta;

      const boundedHead = clampToBoundary(head, WORLD_SIZE / 2);
      head.x = boundedHead.x;
      head.y = boundedHead.y;

      localPlayerRef.current.segments.unshift(head);

      if (localPlayerRef.current.isBoosting) {
        localPlayerRef.current.score -= 2 * delta;
        if (localPlayerRef.current.score <= MIN_LENGTH) {
          localPlayerRef.current.isBoosting = false;
          localPlayerRef.current.score = MIN_LENGTH;
        }
      }

      const targetLength = Math.floor(localPlayerRef.current.score);
      while (localPlayerRef.current.segments.length > targetLength) {
        localPlayerRef.current.segments.pop();
      }

      // Check orb collisions
      for (const orbId in gs.orbs) {
        if (localCollectedOrbs.has(orbId)) continue;
        const orb = gs.orbs[orbId];
        if (distanceSquared(head, orb) < ORB_COLLECT_RADIUS_SQ) {
          localPlayerRef.current.score += orb.value;
          localCollectedOrbs.add(orbId);
          delete gs.orbs[orbId]; // predict locally
          sendCollectOrb(orbId);
          audioManager.playCollect();
          if (navigator.vibrate) navigator.vibrate(10);
        }
      }

      // Cleanup localCollectedOrbs occasionally
      if (Math.random() < 0.05) {
        for (const id of localCollectedOrbs) {
          if (!gs.orbs[id]) localCollectedOrbs.delete(id);
        }
      }

      // Check player collisions
      let collided = false;
      for (const otherId in gs.players) {
        if (otherId === playerId) continue;
        const other = gs.players[otherId];
        if (other.state !== 'alive') continue;
        for (const seg of other.segments) {
          if (distanceSquared(head, seg) < PLAYER_COLLISION_RADIUS_SQ) {
            collided = true;
            break;
          }
        }
        if (collided) break;
      }

      if (!collided && gs.hazards) {
        for (const hazId in gs.hazards) {
          const haz = gs.hazards[hazId];
          if (haz.state === 'active') {
            const hazardCollisionRadius = haz.radius + HAZARD_COLLISION_PADDING;
            if (distanceSquared(head, haz) < hazardCollisionRadius * hazardCollisionRadius) {
              localPlayerRef.current.score -= 20 * delta;
              if (localPlayerRef.current.score <= MIN_LENGTH) {
                collided = true;
                break;
              }
            }
          }
        }
      }

      const isBoostingNow = localPlayerRef.current.isBoosting;
      const wasBoosting = localPlayerRef.current.wasBoosting;
      if (isBoostingNow && !wasBoosting) {
        audioManager.startBoost();
      } else if (!isBoostingNow && wasBoosting) {
        audioManager.stopBoost();
      }
      localPlayerRef.current.wasBoosting = isBoostingNow;

      if (collided) {
        audioManager.stopBoost();
        audioManager.playDeath();
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        localPlayerRef.current.active = false;
        sendPlayerState(createPlayerStatePayload(
          localPlayerRef.current.segments,
          localPlayerRef.current.score,
          localPlayerRef.current.currentAngle,
          false,
          'dead'
        ));
        return;
      }

      // Overwrite global state for local rendering
      gs.players[playerId].segments = localPlayerRef.current.segments;
      gs.players[playerId].score = localPlayerRef.current.score;
      gs.players[playerId].currentAngle = localPlayerRef.current.currentAngle;
      gs.players[playerId].isBoosting = localPlayerRef.current.isBoosting;

      // Send state to server at 20Hz
      const now = Date.now();
      if (now - localPlayerRef.current.lastSendTime > 50) {
        sendPlayerState(createPlayerStatePayload(
          localPlayerRef.current.segments,
          localPlayerRef.current.score,
          localPlayerRef.current.currentAngle,
          localPlayerRef.current.isBoosting,
          'alive'
        ));
        localPlayerRef.current.lastSendTime = now;
      }

      const targetZ = getCameraZ(localPlayerRef.current.score);
      
      // Smooth camera follow predicted head
      camera.position.x += (head.x - camera.position.x) * 10 * delta;
      camera.position.y += (head.y - camera.position.y) * 10 * delta;
      camera.position.z += (targetZ - camera.position.z) * 4 * delta;
      camera.lookAt(camera.position.x, camera.position.y, 0);

      // Make the directional light follow the camera to keep shadows crisp
      if (lightRef.current) {
        lightRef.current.position.set(camera.position.x + 10, camera.position.y - 10, 30);
        lightTarget.position.set(camera.position.x, camera.position.y, 0);
      }
    } else {
      localPlayerRef.current.active = false;
    }
  });

  const activeTheme = profile?.theme && THEMES[profile.theme] ? THEMES[profile.theme] : THEMES.default;
  const customBgTexture = useMemo(() => {
    if (profile?.customBackground && profile.customBackground.startsWith('data:image')) {
      return getCachedTexture(profile.customBackground, (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(5, 5); // Tile the texture
      });
    }
    return null;
  }, [profile?.customBackground]);

  if (!gameState) return null;

  return (
    <>
      <ambientLight intensity={0.4} />
      
      <directionalLight
        ref={lightRef}
        target={lightTarget}
        castShadow
        intensity={2}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-near={0.1}
        shadow-camera-far={100}
        shadow-bias={-0.001}
      />
      <primitive object={lightTarget} />

      {/* Ground plane to receive shadows */}
      <mesh receiveShadow position={[0, 0, -0.2]}>
        <planeGeometry args={[WORLD_SIZE, WORLD_SIZE]} />
        <meshStandardMaterial color={customBgTexture ? '#ffffff' : activeTheme.bg} map={customBgTexture || undefined} />
      </mesh>

      {!customBgTexture && (
        <Grid
          position={[0, 0, -0.1]}
          rotation={[Math.PI / 2, 0, 0]}
          args={[WORLD_SIZE, WORLD_SIZE]}
          cellSize={1}
          cellThickness={0.5}
          cellColor={activeTheme.cell}
          sectionSize={10}
          sectionThickness={1}
          sectionColor={activeTheme.section}
          fadeDistance={100}
          fadeStrength={1}
        />
      )}

      {playerId && (
        <>
          <Orbs />
          <DeathExplosions />
          <BackgroundDust WORLD_SIZE={WORLD_SIZE} />
          <Hazards />

          {Object.values(gameState.players).map((player) => {
            if (player.state !== 'alive' || player.segments.length === 0) return null;
            return (
              <Snake
                key={player.id}
                playerId={player.id}
                color={player.color}
                isLocal={player.id === playerId}
                name={player.name}
              />
            );
          })}
        </>
      )}
    </>
  );
}
