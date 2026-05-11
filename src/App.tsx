/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { GameScene } from './components/GameScene';
import { useGameStore } from './store/gameStore';
import { UI } from './components/UI';

export default function App() {
  const { connect } = useGameStore();
  const [isMobileView, setIsMobileView] = useState(false);

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px), (pointer: coarse)');
    const updateMobileView = () => setIsMobileView(query.matches);

    updateMobileView();
    query.addEventListener('change', updateMobileView);
    return () => query.removeEventListener('change', updateMobileView);
  }, []);

  return (
    <div className="w-screen h-[100dvh] bg-black overflow-hidden relative">
      <Canvas
        shadows={!isMobileView}
        camera={{ position: [0, 0, 50], fov: 60 }}
        dpr={isMobileView ? [1, 1] : [1, 1.5]}
        gl={{
          antialias: false,
          powerPreference: isMobileView ? "default" : "high-performance",
          stencil: false,
        }}
      >
        <color attach="background" args={['#050505']} />
        <GameScene />
        {!isMobileView && (
          <EffectComposer>
            <Bloom
              luminanceThreshold={1.5}
              mipmapBlur
              intensity={1.5}
            />
          </EffectComposer>
        )}
      </Canvas>
      <UI />
    </div>
  );
}
