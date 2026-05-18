/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { GameScene } from './components/GameScene';
import { useGameStore } from './store/gameStore';
import { UI } from './components/UI';

class ErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) { console.error(error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: 'red', background: 'white', padding: '20px', zIndex: 9999, position: 'absolute', inset: 0 }}>
          <h1>Something went wrong.</h1>
          <pre>{this.state.error?.message}</pre>
          <pre>{this.state.error?.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const connect = useGameStore(state => state.connect);

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <ErrorBoundary>
      <div className="w-screen h-screen bg-black overflow-hidden relative">
        <Canvas
          shadows
          camera={{ position: [0, 0, 50], fov: 60 }}
          dpr={[1, 1.5]}
          gl={{ antialias: false, powerPreference: "high-performance" }}
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
        <UI />
      </div>
    </ErrorBoundary>
  );
}
