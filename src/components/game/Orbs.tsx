import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { globalGameState } from '../../store/gameStore';
import { localCollectedOrbs } from './utils';

export function Orbs() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    if (!meshRef.current) return;
    const gs = globalGameState.current;
    if (!gs) return;

    let i = 0;
    const time = Date.now() * 0.005;
    for (const orbId in gs.orbs) {
      if (localCollectedOrbs.has(orbId)) continue;
      const orb = gs.orbs[orbId];
      dummy.position.set(orb.x, orb.y, 0.5);
      
      let scale = orb.value >= 5 ? 2.5 : 1.0;
      let actualColor = orb.color;

      if (orb.type === 'magnet') {
        actualColor = '#9d4edd';
        scale = 1.6 + Math.sin(time + i) * 0.3;
      } else if (orb.type === 'shield') {
        actualColor = '#00f0ff';
        scale = 1.6 + Math.sin(time * 1.2 + i) * 0.3;
      } else if (orb.type === 'double') {
        actualColor = '#ffb703';
        scale = 1.6 + Math.sin(time * 0.8 + i) * 0.3;
      }

      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      const finalColor = actualColor.startsWith('data:image') ? '#ffffff' : (actualColor === 'rainbow' || actualColor === 'chrome' ? '#ffffff' : (actualColor === 'neon' ? '#39ff14' : actualColor));
      colorObj.set(finalColor);
      meshRef.current.setColorAt(i, colorObj);
      i++;
    }
    meshRef.current.count = i;
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[null as any, null as any, 1000]} castShadow receiveShadow frustumCulled={false}>
      <sphereGeometry args={[0.5, 16, 16]} />
      <meshStandardMaterial
        roughness={0.4}
        metalness={0.1}
        toneMapped={false}
        onBeforeCompile={(shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `
            #include <emissivemap_fragment>
            totalEmissiveRadiance += diffuseColor.rgb * 2.5;
            `
          );
        }}
      />
    </instancedMesh>
  );
}
