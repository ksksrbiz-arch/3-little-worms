import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sphere } from '@react-three/drei';
import * as THREE from 'three';
import { globalGameState } from '../../store/gameStore';

export function Snake({ playerId, color, isLocal }: { playerId: string, color: string, isLocal: boolean }) {
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.Mesh>(null);
  const particlesRef = useRef<THREE.InstancedMesh>(null);

  const getSkinProperties = (c: string) => {
    if (c.startsWith('data:image')) {
      return { color: '#ffffff', roughness: 0.2, metalness: 0.2, isRainbow: false, isCustom: true, customUrl: c };
    }
    switch (c) {
      case 'rainbow': return { color: '#ffffff', roughness: 0.1, metalness: 0.1, isRainbow: true, isCustom: false };
      case 'chrome': return { color: '#ffffff', roughness: 0.0, metalness: 1.0, isRainbow: false, isCustom: false };
      case 'neon': return { color: '#39ff14', roughness: 0.2, metalness: 0.8, isRainbow: false, isCustom: false }; // green neon
      default: return { color: c, roughness: 0.2, metalness: 0.8, isRainbow: false, isCustom: false }; 
    }
  };
  
  const skin = useMemo(() => getSkinProperties(color), [color]);
  const baseColorObj = useMemo(() => new THREE.Color(skin.color), [skin.color]);
  const customTexture = useMemo(() => {
    if (skin.isCustom && skin.customUrl) {
       const loader = new THREE.TextureLoader();
       const tex = loader.load(skin.customUrl);
       tex.wrapS = THREE.RepeatWrapping;
       tex.wrapT = THREE.RepeatWrapping;
       return tex;
    }
    return null;
  }, [skin.customUrl]);
  
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const currentPositions = useRef<{x: number, y: number}[]>([]);
  
  const particleData = useMemo(() => Array.from({ length: 200 }, () => ({
    life: 1, // Start dead
    maxLife: 1,
    velocity: new THREE.Vector3(),
    position: new THREE.Vector3(),
    scale: 1
  })), []);
  const particleIndex = useRef(0);
  const particleSpawnAccumulator = useRef(0);
  const particleColorObj = useMemo(() => new THREE.Color(), []);
  
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uBoost: { value: 0 } }), []);

  useFrame((state, delta) => {
    if (!bodyRef.current || !headRef.current) return;
    const gs = globalGameState.current;
    if (!gs) return;
    
    const player = gs.players[playerId];
    if (!player || player.segments.length === 0) {
      bodyRef.current.count = 0;
      headRef.current.visible = false;
      if (particlesRef.current) particlesRef.current.count = 0;
      return;
    }
    
    headRef.current.visible = true;
    const count = player.segments.length;
    bodyRef.current.count = Math.max(0, count - 1);
    
    while (currentPositions.current.length < count) {
      const idx = currentPositions.current.length;
      currentPositions.current.push({ 
        x: player.segments[idx]?.x || 0, 
        y: player.segments[idx]?.y || 0 
      });
    }

    for (let i = 0; i < count; i++) {
      let targetX = player.segments[i].x;
      let targetY = player.segments[i].y;
      
      const curr = currentPositions.current[i];
      if (isLocal) {
        curr.x = targetX;
        curr.y = targetY;
      } else {
        const dist = Math.abs(targetX - curr.x) + Math.abs(targetY - curr.y);
        if (dist > 10) {
          curr.x = targetX;
          curr.y = targetY;
        } else {
          const lerpFactor = 15;
          curr.x += (targetX - curr.x) * lerpFactor * delta;
          curr.y += (targetY - curr.y) * lerpFactor * delta;
        }
      }
      
      if (i === 0) {
        headRef.current.position.set(curr.x, curr.y, 0.5);
      } else {
        dummy.position.set(curr.x, curr.y, 0.5);
        dummy.updateMatrix();
        bodyRef.current.setMatrixAt(i - 1, dummy.matrix);
      }
    }
    bodyRef.current.instanceMatrix.needsUpdate = true;

    // Glow Uniforms
    uniforms.uTime.value = state.clock.elapsedTime;
    if (isLocal && player.isBoosting) {
      uniforms.uBoost.value = THREE.MathUtils.lerp(uniforms.uBoost.value, 1.0, delta * 15);
    } else {
      uniforms.uBoost.value = THREE.MathUtils.lerp(uniforms.uBoost.value, 0.0, delta * 15);
    }

    // Particles Update
    if (particlesRef.current) {
      let pCount = 0;
      
      if (isLocal && player.isBoosting) {
        particleSpawnAccumulator.current += delta * 180; // 180 particles per second
        const spawnCount = Math.floor(particleSpawnAccumulator.current);
        particleSpawnAccumulator.current -= spawnCount;

        for(let i=0; i<spawnCount; i++) {
          const p = particleData[particleIndex.current];
          p.life = 0;
          p.maxLife = 0.3 + Math.random() * 0.4;
          p.position.set(
            headRef.current.position.x + (Math.random() - 0.5) * 1.5, 
            headRef.current.position.y + (Math.random() - 0.5) * 1.5, 
            0.5 + (Math.random() - 0.5) * 1.5
          );
          // Angle logic: shooting away from movement direction
          const angle = player.currentAngle + Math.PI + (Math.random() - 0.5) * 0.8;
          const speed = 15 + Math.random() * 10;
          p.velocity.set(Math.cos(angle) * speed, Math.sin(angle) * speed, (Math.random() - 0.5) * 8);
          p.scale = Math.random() * 0.4 + 0.2;
          particleIndex.current = (particleIndex.current + 1) % 200;
        }
      } else {
        particleSpawnAccumulator.current = 0;
      }

      for(let i=0; i<200; i++) {
        const p = particleData[i];
        if (p.life < p.maxLife) {
          p.life += delta;
          p.position.addScaledVector(p.velocity, delta);
          p.scale *= 0.92; // shrink faster
          p.velocity.multiplyScalar(0.95); // decelerate

          dummy.position.copy(p.position);
          dummy.scale.setScalar(p.scale);
          dummy.updateMatrix();
          particlesRef.current.setMatrixAt(pCount, dummy.matrix);
          
          const lifeRatio = p.life / p.maxLife;
          particleColorObj.set(color).multiplyScalar(3.0 * (1.0 - lifeRatio));
          particlesRef.current.setColorAt(pCount, particleColorObj);
          pCount++;
        }
      }
      
      particlesRef.current.count = pCount;
      particlesRef.current.instanceMatrix.needsUpdate = true;
      if (particlesRef.current.instanceColor) {
        particlesRef.current.instanceColor.needsUpdate = true;
      }
    }
  });

  const shaderSetup = (shader: any) => {
    shader.uniforms.uBoost = uniforms.uBoost;
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uIsRainbow = { value: skin.isRainbow };
    shader.vertexShader = '#define USE_UV\n' + shader.vertexShader;
    shader.fragmentShader = '#define USE_UV\n' + `
      uniform float uBoost;
      uniform float uTime;
      uniform bool uIsRainbow;
      ${shader.fragmentShader}
    `.replace(
      '#include <emissivemap_fragment>',
      `
      #include <emissivemap_fragment>
      float fresnel = pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 2.0);
      float pulse = 0.5 + 0.5 * sin(uTime * 25.0);
      
      vec3 finalBaseColor = diffuseColor.rgb;
      if (uIsRainbow) {
          float hue = fract(vUv.y * 2.0 - uTime * 0.5);
          vec3 rColor = clamp(abs(mod(hue * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          finalBaseColor = rColor;
          diffuseColor.rgb = rColor;
      }
      
      totalEmissiveRadiance += finalBaseColor * (0.4 + fresnel * 1.5);
      totalEmissiveRadiance += finalBaseColor * (uBoost * (1.5 + pulse * 3.0));
      `
    );
  };

  return (
    <group>
      <Sphere ref={headRef} castShadow receiveShadow args={[0.8, 16, 16]}>
        <meshStandardMaterial
          color={skin.color}
          map={customTexture || undefined}
          roughness={skin.roughness}
          metalness={skin.metalness}
          toneMapped={false}
          onBeforeCompile={shaderSetup}
        />
      </Sphere>
      <instancedMesh ref={bodyRef} args={[null as any, null as any, 2000]} castShadow receiveShadow frustumCulled={false}>
        <sphereGeometry args={[0.6, 16, 16]} />
        <meshStandardMaterial
          color={skin.color}
          map={customTexture || undefined}
          roughness={skin.roughness}
          metalness={skin.metalness}
          toneMapped={false}
          onBeforeCompile={shaderSetup}
        />
      </instancedMesh>
      
      {/* Particles */}
      {isLocal && (
        <instancedMesh ref={particlesRef} args={[null as any, null as any, 200]} frustumCulled={false}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial 
            color="#ffffff" 
            transparent 
            blending={THREE.AdditiveBlending} 
            depthWrite={false} 
            toneMapped={false} 
          />
        </instancedMesh>
      )}
    </group>
  );
}
