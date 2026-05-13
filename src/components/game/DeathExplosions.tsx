import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { globalGameState } from '../../store/gameStore';

export function DeathExplosions() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);
  const prevDead = useRef<Set<string>>(new Set());
  
  const particles = useRef<Array<{
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, maxLife: number,
    color: string, scale: number
  }>>([]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const gs = globalGameState.current;
    if (!gs) return;
    
    const currentDead = new Set<string>();
    for (const id in gs.players) {
      const p = gs.players[id];
      if (p.state === 'dead') {
        currentDead.add(id);
        if (!prevDead.current.has(id) && p.segments && p.segments.length > 0) {
          const head = p.segments[0];
          for(let i=0; i<50; i++) {
             const angle = Math.random() * Math.PI * 2;
             const speed = 10 + Math.random() * 20;
             particles.current.push({
               x: head.x, y: head.y, z: 0.5,
               vx: Math.cos(angle) * speed,
               vy: Math.sin(angle) * speed,
               vz: (Math.random() - 0.5) * 10,
               life: 0,
               maxLife: 0.5 + Math.random() * 0.8,
               color: p.color,
               scale: 0.5 + Math.random()
             });
          }
        }
      }
    }
    prevDead.current = currentDead;

    let pCount = 0;
    for (let i = particles.current.length - 1; i >= 0; i--) {
      const p = particles.current[i];
      p.life += delta;
      if (p.life >= p.maxLife) {
        particles.current[i] = particles.current[particles.current.length - 1];
        particles.current.pop();
        continue;
      }
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.z += p.vz * delta;
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.vz *= 0.92;
      p.scale *= 0.95;

      if (pCount < 1000) {
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(pCount, dummy.matrix);
        
        const lifeRatio = p.life / p.maxLife;
        const actualColor = p.color.startsWith('data:image') ? '#ffffff' : (p.color === 'rainbow' || p.color === 'chrome' ? '#ffffff' : (p.color === 'neon' ? '#39ff14' : p.color));
        colorObj.set(actualColor).multiplyScalar(2.0 * (1.0 - lifeRatio));
        meshRef.current.setColorAt(pCount, colorObj);
        
        pCount++;
      }
    }
    
    meshRef.current.count = pCount;
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[null as any, null as any, 1000]} frustumCulled={false}>
      <sphereGeometry args={[0.4, 8, 8]} />
      <meshBasicMaterial 
        color="#ffffff" 
        transparent 
        blending={THREE.AdditiveBlending} 
        depthWrite={false} 
        toneMapped={false} 
      />
    </instancedMesh>
  );
}
