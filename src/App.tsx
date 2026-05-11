/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { Suspense, lazy, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { GameScene } from './components/GameScene';
import { useGameStore } from './store/gameStore';

const UI = lazy(() => import('./components/UI').then((module) => ({ default: module.UI })));

function LoadingOverlay() {
  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
      <div className="flex flex-col items-center gap-4 text-white">
        <div className="h-14 w-14 rounded-full border-4 border-white/20 border-t-cyan-300 animate-spin shadow-[0_0_25px_rgba(34,211,238,0.8)]" />
        <div className="text-sm font-mono tracking-[0.35em] text-cyan-100 animate-pulse">LOADING</div>
      </div>
    </div>
  );
}

export default function App() {
  const { connect } = useGameStore();

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <div className="w-screen h-screen bg-black overflow-hidden relative">
      <Canvas
        shadows
        camera={{ position: [0, 0, 50], fov: 60 }}
        dpr={[1, 1.5]}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        performance={{ min: 0.6 }}
      >
        <color attach="background" args={['#050505']} />
        <GameScene />
        <EffectComposer>
          <Bloom
            luminanceThreshold={1.5}
            mipmapBlur
            intensity={1.5}
          />
        </EffectComposer>
      </Canvas>
      <Suspense fallback={<LoadingOverlay />}>
        <UI />
      </Suspense>
    </div>
  );
}
