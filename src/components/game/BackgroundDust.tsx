import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { globalGameState } from '../../store/gameStore';

export function BackgroundDust({ WORLD_SIZE }: { WORLD_SIZE: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const particleCount = 500;
  
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const particles = useMemo(() => {
    const temp = [];
    for (let i = 0; i < particleCount; i++) {
        temp.push({
            x: (Math.random() - 0.5) * WORLD_SIZE,
            y: (Math.random() - 0.5) * WORLD_SIZE,
            z: Math.random() * -10, // behind the grid
            speed: 0.1 + Math.random() * 0.3,
            scale: 0.1 + Math.random() * 0.3
        });
    }
    return temp;
  }, [WORLD_SIZE]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    particles.forEach((p, i) => {
        p.z += p.speed * delta * 5;
        if (p.z > 2) {
            p.z = -15;
            p.x = (Math.random() - 0.5) * WORLD_SIZE;
            p.y = (Math.random() - 0.5) * WORLD_SIZE;
        }
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null as any, null as any, particleCount]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.15} blending={THREE.AdditiveBlending} depthWrite={false} />
    </instancedMesh>
  );
}
