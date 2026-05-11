import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { globalGameState } from '../../store/gameStore';

export const Hazards = React.memo(function Hazards() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  const colorActive = useMemo(() => new THREE.Color('#ff0033'), []);
  const colorWarning = useMemo(() => new THREE.Color('#ffaa00'), []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const gs = globalGameState.current;
    if (!gs || !gs.hazards) return;

    uniforms.uTime.value = state.clock.elapsedTime;

    let i = 0;
    for (const id in gs.hazards) {
      const haz = gs.hazards[id];
      dummy.position.set(haz.x, haz.y, 0.05); // Just above grid
      dummy.scale.setScalar(haz.radius);
      // Warning is smaller, grows to full radius? Or full radius but pulse color?
      if (haz.state === 'warning') {
          // pulsing scale in warning
          const pulse = 0.8 + 0.2 * Math.sin(state.clock.elapsedTime * 15);
          dummy.scale.setScalar(haz.radius * pulse);
      }
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      meshRef.current.setColorAt(i, haz.state === 'active' ? colorActive : colorWarning);
      i++;
    }
    meshRef.current.count = i;
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null as any, null as any, 50]} receiveShadow frustumCulled={false}>
      <circleGeometry args={[1, 32]} />
      <meshBasicMaterial 
        transparent 
        opacity={0.3} 
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        onBeforeCompile={(shader) => {
          shader.uniforms.uTime = uniforms.uTime;
          shader.vertexShader = '#define USE_UV\n' + shader.vertexShader;
          shader.fragmentShader = '#define USE_UV\n' + `
            uniform float uTime;
            ${shader.fragmentShader}
          `.replace(
            '#include <color_fragment>',
            `
            #include <color_fragment>
            float dist = length(vUv - 0.5) * 2.0;
            if (dist > 1.0) discard;
            float edge = smoothstep(0.8, 1.0, dist);
            float innerRing = sin(dist * 20.0 - uTime * 5.0) * 0.5 + 0.5;
            diffuseColor.a *= (1.0 - edge) * (0.5 + 0.5 * innerRing);
            `
          );
        }}
      />
    </instancedMesh>
  );
});
