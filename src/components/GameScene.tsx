/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { useEffect, useRef, useState, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGameStore, globalGameState, mobileInputs } from '../store/gameStore';
import { WORLD_SIZE, TURN_SPEED, BOOST_SPEED, BASE_SPEED } from '../shared/types';
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

const THEMES: Record<string, { bg: string, cell: string, section: string }> = {
  default: { bg: '#0a0a0a', cell: '#1e3a8a', section: '#3b82f6' },
  cyberpunk: { bg: '#050210', cell: '#e0165c', section: '#00f0ff' },
  matrix: { bg: '#000000', cell: '#003b00', section: '#00ff41' },
  synthwave: { bg: '#0f0524', cell: '#7c3aed', section: '#f472b6' }
};

export function GameScene() {
  const gameState = useGameStore(state => state.gameState);
  const playerId = useGameStore(state => state.playerId);
  const sendPlayerState = useGameStore(state => state.sendPlayerState);
  const sendCollectOrb = useGameStore(state => state.sendCollectOrb);
  const { profile } = useUserStore();
  const { camera } = useThree();
  const inputs = useRef({ left: false, right: false, boost: false });
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const [lightTarget] = useState(() => new THREE.Object3D());

  const localPlayerRef = useRef<{
    active: boolean;
    segments: {x: number, y: number}[];
    score: number;
    currentAngle: number;
    isBoosting: boolean;
    wasBoosting: boolean;
    lastSendTime: number;
    magnetTime: number;
    shieldTime: number;
    doubleTime: number;
    kills: number;
    killStreak: number;
  }>({
    active: false,
    segments: [],
    score: 10,
    currentAngle: 0,
    isBoosting: false,
    wasBoosting: false,
    lastSendTime: 0,
    magnetTime: 0,
    shieldTime: 0,
    doubleTime: 0,
    kills: 0,
    killStreak: 0,
  });

  const isLocalDeadRef = useRef(false);
  const lastStateRef = useRef<string | null>(null);

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

  useFrame((state, delta) => {
    const gs = globalGameState.current;
    if (!gs || !playerId) return;
    
    const serverPlayer = gs.players[playerId];
    if (serverPlayer && serverPlayer.state === 'alive') {
      if (lastStateRef.current !== 'alive') {
        isLocalDeadRef.current = false;
      }
      
      // Initialize from server if not active
      if (!localPlayerRef.current.active && !isLocalDeadRef.current && serverPlayer.segments.length > 0) {
        localPlayerRef.current.active = true;
        localPlayerRef.current.segments = [...serverPlayer.segments];
        localPlayerRef.current.score = serverPlayer.score;
        localPlayerRef.current.currentAngle = serverPlayer.currentAngle;
        localPlayerRef.current.magnetTime = serverPlayer.magnetTime || 0;
        localPlayerRef.current.shieldTime = serverPlayer.shieldTime || 0;
        localPlayerRef.current.doubleTime = serverPlayer.doubleTime || 0;
        localPlayerRef.current.kills = serverPlayer.kills || 0;
        localPlayerRef.current.killStreak = serverPlayer.killStreak || 0;
      }

      if (!localPlayerRef.current.active) return;

      // Local movement logic
      if (mobileInputs.active) {
        const targetAngle = mobileInputs.angle;
        let diff = Math.atan2(Math.sin(targetAngle - localPlayerRef.current.currentAngle), Math.cos(targetAngle - localPlayerRef.current.currentAngle));
        const maxTurn = TURN_SPEED * delta;
        if (Math.abs(diff) < maxTurn) {
          localPlayerRef.current.currentAngle = targetAngle;
        } else {
          localPlayerRef.current.currentAngle += Math.sign(diff) * maxTurn;
        }
      } else {
        if (inputs.current.left || mobileInputs.left) localPlayerRef.current.currentAngle += TURN_SPEED * delta;
        if (inputs.current.right || mobileInputs.right) localPlayerRef.current.currentAngle -= TURN_SPEED * delta;
      }
      
      localPlayerRef.current.isBoosting = (inputs.current.boost || mobileInputs.boost) && localPlayerRef.current.score > 10;
      const speed = localPlayerRef.current.isBoosting ? BOOST_SPEED : BASE_SPEED;
      
      const head = { ...localPlayerRef.current.segments[0] };
      head.x += Math.cos(localPlayerRef.current.currentAngle) * speed * delta;
      head.y += Math.sin(localPlayerRef.current.currentAngle) * speed * delta;

      // Boundary check
      const boundary = WORLD_SIZE / 2;
      if (head.x < -boundary) head.x = -boundary;
      if (head.x > boundary) head.x = boundary;
      if (head.y < -boundary) head.y = -boundary;
      if (head.y > boundary) head.y = boundary;

      localPlayerRef.current.segments.unshift(head);

      if (localPlayerRef.current.magnetTime > 0) localPlayerRef.current.magnetTime = Math.max(0, localPlayerRef.current.magnetTime - delta);
      if (localPlayerRef.current.shieldTime > 0) localPlayerRef.current.shieldTime = Math.max(0, localPlayerRef.current.shieldTime - delta);
      if (localPlayerRef.current.doubleTime > 0) localPlayerRef.current.doubleTime = Math.max(0, localPlayerRef.current.doubleTime - delta);

      if (localPlayerRef.current.isBoosting) {
        localPlayerRef.current.score -= 2 * delta;
        if (localPlayerRef.current.score <= 10) {
          localPlayerRef.current.isBoosting = false;
          localPlayerRef.current.score = 10;
        }
      }

      const targetLength = Math.floor(localPlayerRef.current.score);
      while (localPlayerRef.current.segments.length > targetLength) {
        localPlayerRef.current.segments.pop();
      }

      // Local magnet attraction
      if (localPlayerRef.current.magnetTime > 0) {
        for (const orbId in gs.orbs) {
          if (localCollectedOrbs.has(orbId)) continue;
          const orb = gs.orbs[orbId];
          const dx = head.x - orb.x;
          const dy = head.y - orb.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 1.5 && dist < 15) {
            const pullFactor = 15 * delta;
            orb.x += (head.x - orb.x) * (pullFactor / dist);
            orb.y += (head.y - orb.y) * (pullFactor / dist);
          }
        }
      }

      // Check orb collisions
      for (const orbId in gs.orbs) {
        if (localCollectedOrbs.has(orbId)) continue;
        const orb = gs.orbs[orbId];
        const dx = head.x - orb.x;
        const dy = head.y - orb.y;
        if (dx * dx + dy * dy < 4) {
          let multiplier = localPlayerRef.current.doubleTime > 0 ? 2 : 1;
          localPlayerRef.current.score += orb.value * multiplier;

          if (orb.type === 'magnet') {
            localPlayerRef.current.magnetTime = 10;
          } else if (orb.type === 'shield') {
            localPlayerRef.current.shieldTime = 15;
          } else if (orb.type === 'double') {
            localPlayerRef.current.doubleTime = 10;
          }

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
      let killerId: string | null = null;
      let killerName: string = '';
      for (const otherId in gs.players) {
        if (otherId === playerId) continue;
        const other = gs.players[otherId];
        if (other.state !== 'alive') continue;
        for (const seg of other.segments) {
          const dx = head.x - seg.x;
          const dy = head.y - seg.y;
          if (dx * dx + dy * dy < 2.25) {
            collided = true;
            killerId = otherId;
            killerName = other.name;
            break;
          }
        }
        if (collided) break;
      }

      if (collided && localPlayerRef.current.shieldTime > 0) {
        // Shield saves the day! Deplete shield and ignore death
        localPlayerRef.current.shieldTime = 0;
        collided = false;
        localPlayerRef.current.currentAngle += Math.PI * 0.8; // bounce away safely
      }

      if (!collided && gs.hazards) {
        for (const hazId in gs.hazards) {
          const haz = gs.hazards[hazId];
          if (haz.state === 'active') {
            const dx = head.x - haz.x;
            const dy = head.y - haz.y;
            if (dx * dx + dy * dy < (haz.radius + 0.8) * (haz.radius + 0.8)) {
              localPlayerRef.current.score -= 20 * delta;
              if (localPlayerRef.current.score <= 10) {
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
        isLocalDeadRef.current = true;
        
        if (serverPlayer) {
          serverPlayer.state = 'dead';
        }
        
        sendPlayerState({
          segments: localPlayerRef.current.segments,
          score: localPlayerRef.current.score,
          currentAngle: localPlayerRef.current.currentAngle,
          isBoosting: false,
          state: 'dead',
          killerId,
          killerName
        });
        
        lastStateRef.current = 'dead';
        return;
      }

      // Overwrite global state for local rendering only if changed
      if (gs.players[playerId]) {
        const p = gs.players[playerId];
        if (p.segments !== localPlayerRef.current.segments) {
          p.segments = localPlayerRef.current.segments;
        }
        if (p.score !== localPlayerRef.current.score) {
          p.score = localPlayerRef.current.score;
        }
        if (p.currentAngle !== localPlayerRef.current.currentAngle) {
          p.currentAngle = localPlayerRef.current.currentAngle;
        }
        if (p.isBoosting !== localPlayerRef.current.isBoosting) {
          p.isBoosting = localPlayerRef.current.isBoosting;
        }
      }

      // Send state to server at 20Hz
      const now = Date.now();
      if (now - localPlayerRef.current.lastSendTime > 50) {
        sendPlayerState({
          segments: localPlayerRef.current.segments,
          score: localPlayerRef.current.score,
          currentAngle: localPlayerRef.current.currentAngle,
          isBoosting: localPlayerRef.current.isBoosting,
          state: 'alive',
          magnetTime: localPlayerRef.current.magnetTime,
          shieldTime: localPlayerRef.current.shieldTime,
          doubleTime: localPlayerRef.current.doubleTime,
        });
        localPlayerRef.current.lastSendTime = now;
      }

      const targetZ = Math.min(45, Math.max(20, 20 + localPlayerRef.current.score * 0.2));
      
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
      
      lastStateRef.current = 'alive';
    } else {
      localPlayerRef.current.active = false;
      lastStateRef.current = serverPlayer ? serverPlayer.state : null;
    }
  });

  const activeTheme = profile?.theme && THEMES[profile.theme] ? THEMES[profile.theme] : THEMES.default;
  const customBgTexture = useMemo(() => {
    if (profile?.customBackground && profile.customBackground.startsWith('data:image')) {
      const loader = new THREE.TextureLoader();
      const tex = loader.load(profile.customBackground);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(5, 5); // Tile the texture
      return tex;
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
  );
}
