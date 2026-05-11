/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { useGameStore, mobileInputs } from '../store/gameStore';
import { useUserStore } from '../store/userStore';
import { motion, AnimatePresence } from 'framer-motion';
import { ExternalLink, Trophy, ArrowLeft, ArrowRight, Zap, User, Settings, LogOut, ShoppingCart, Sparkles } from 'lucide-react';
import { lazy, Suspense, useEffect, useState, useRef } from 'react';
import { db } from '../firebase';
import { doc, setDoc, serverTimestamp, getDocs, collection, query, orderBy, limit } from 'firebase/firestore';
import { audioManager } from '../lib/audio';
import { getCached, invalidateCached } from '../lib/dynamicCache';

const Shop = lazy(() => import('./Shop').then((module) => ({ default: module.Shop })));
const AICreator = lazy(() => import('./AICreator').then((module) => ({ default: module.AICreator })));
const LEADERBOARD_CACHE_KEY = 'leaderboard:top10';
const LEADERBOARD_CACHE_TTL_MS = 30_000;

function ModalFallback() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="h-10 w-10 rounded-full border-4 border-white/20 border-t-white animate-spin" />
    </div>
  );
}

export function UI() {
  const { gameState, playerId, joinGame } = useGameStore();

  const player = playerId && gameState ? gameState.players[playerId] : null;
  const isAlive = player?.state === 'alive';
  const isDead = player?.state === 'dead';

  const { user, profile, loading, signIn, signOut, updateProfile } = useUserStore();
  const [showSettings, setShowSettings] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [showAICreator, setShowAICreator] = useState(false);
  const [globalLeaderboard, setGlobalLeaderboard] = useState<any[]>([]);
  const [localName, setLocalName] = useState('');
  useEffect(() => {
    if (profile) setLocalName(profile.displayName);
  }, [profile]);

  // Joystick state
  const joyRef = useRef<HTMLDivElement>(null);
  const [joyPos, setJoyPos] = useState({ x: 0, y: 0 });

  const handleJoyMove = (e: React.PointerEvent) => {
    if (!joyRef.current) return;
    const rect = joyRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    
    const distance = Math.hypot(dx, dy);
    const maxDist = rect.width / 2; // radius
    const clampedDist = Math.min(distance, maxDist);
    const angle = Math.atan2(dy, dx);
    
    const joyX = Math.cos(angle) * clampedDist;
    const joyY = Math.sin(angle) * clampedDist;
    setJoyPos({ x: joyX, y: joyY });
    
    mobileInputs.left = joyX < -15;
    mobileInputs.right = joyX > 15;
  };

  const handleJoyEnd = () => {
    setJoyPos({ x: 0, y: 0 });
    mobileInputs.left = false;
    mobileInputs.right = false;
  };

  useEffect(() => {
    // Fetch global leaderboard
    const fetchLeaderboard = async () => {
      try {
        const data = await getCached(LEADERBOARD_CACHE_KEY, LEADERBOARD_CACHE_TTL_MS, async () => {
          const q = query(collection(db, 'leaderboard'), orderBy('score', 'desc'), limit(10));
          const snap = await getDocs(q);
          return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        });
        setGlobalLeaderboard(data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchLeaderboard();
    const int = setInterval(fetchLeaderboard, 30000); // 30s
    return () => clearInterval(int);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      // In a real app, a Stripe Webhook handles the actual database update to prevent spoofing.
      // For this demo, we can optimistically grant the coins.
      if (user && profile) {
        const ref = doc(db, 'users', user.uid);
        // Clean URL to prevent refresh granting multiple
        window.history.replaceState({}, '', window.location.pathname);
        // Grant 1000 coins (this is an insecure client-side grant for demo purposes)
        setDoc(ref, { coins: (profile.coins || 0) + 1000, updatedAt: serverTimestamp() }, { merge: true })
          .then(() => useUserStore.getState().checkProfile(user))
          .catch(e => console.error(e));
        alert('Payment successful! 1000 Coins added.');
      }
    } else if (params.get('payment') === 'cancelled') {
        window.history.replaceState({}, '', window.location.pathname);
    }
  }, [user, profile]);

  const handleJoinGame = () => {
    audioManager.init();
    if (profile) {
      joinGame({ name: profile.displayName, color: profile.skin === 'default' ? undefined : profile.skin });
    } else {
      joinGame();
    }
  };

  useEffect(() => {
    if (isDead && player && user) {
      // Save score
      const scoreId = `${user.uid}_${Date.now()}`;
      setDoc(doc(db, 'leaderboard', scoreId), {
        userId: user.uid,
        score: Math.floor(player.score),
        timePlayed: Math.floor((Date.now() - 0) / 1000), // simplified
        name: player.name,
        color: player.color,
        createdAt: serverTimestamp(),
      })
        .then(() => invalidateCached(LEADERBOARD_CACHE_KEY))
        .catch(err => {
          const errInfo = {
            error: err instanceof Error ? err.message : String(err),
            operationType: 'create',
            path: 'leaderboard'
          };
          console.error(JSON.stringify(errInfo));
        });
    }
  }, [isDead]);

  const handleOpenNewTab = () => {
    window.open(window.location.href, '_blank');
  };

  useEffect(() => {
    const disablePinchZoom = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    };
    document.addEventListener('touchmove', disablePinchZoom, { passive: false });
    return () => {
      document.removeEventListener('touchmove', disablePinchZoom);
    };
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4">
      {/* Top Bar */}
      <div className="flex justify-between items-start pointer-events-auto relative">
        <div className="flex flex-col gap-2 z-10">
          <h1 className="text-3xl font-black text-white tracking-tighter" style={{ textShadow: '0 0 10px rgba(255,255,255,0.5)' }}>
            NEON.SNAKE
          </h1>
          {isAlive && (
            <div className="text-xl font-mono text-white/80 font-bold">
              Length: {Math.floor(player.score)}
            </div>
          )}
        </div>
        
        {/* Controls Hint */}
        <div className="absolute left-1/2 -translate-x-1/2 top-0 flex gap-2 opacity-80 pointer-events-none hidden sm:flex">
          <div className="flex items-center gap-2 text-xs font-mono text-white bg-white/5 px-3 py-1.5 rounded-full backdrop-blur-sm border border-white/10">
            <span className="font-bold bg-white/20 px-1.5 py-0.5 rounded text-white">A</span>
            <span className="font-bold bg-white/20 px-1.5 py-0.5 rounded text-white">D</span>
            <span className="text-white/70 uppercase tracking-wider text-[10px]">Turn</span>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-white bg-white/5 px-3 py-1.5 rounded-full backdrop-blur-sm border border-white/10">
            <span className="font-bold bg-white/20 px-1.5 py-0.5 rounded text-white">SPACE</span>
            <span className="text-white/70 uppercase tracking-wider text-[10px]">Boost</span>
          </div>
        </div>

        <div className="flex items-center gap-4 z-10">
          <button
            onClick={handleOpenNewTab}
            className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white text-sm font-bold transition-colors"
          >
            <ExternalLink size={16} />
            <span className="hidden sm:inline">New Tab</span>
          </button>
          
          {user ? (
            <div className="flex items-center gap-2">
              <button title="AI Studio" onClick={() => setShowAICreator(true)} className="p-2 bg-purple-500/20 hover:bg-purple-500/40 border border-purple-500/50 rounded-full text-purple-400 transition-colors pointer-events-auto shadow-[0_0_15px_rgba(168,85,247,0.2)]">
                <Sparkles size={20} />
              </button>
              <button onClick={() => setShowShop(true)} className="p-2 bg-yellow-500/20 hover:bg-yellow-500/40 border border-yellow-500/50 rounded-full text-yellow-400 transition-colors pointer-events-auto shadow-[0_0_15px_rgba(234,179,8,0.2)]">
                <ShoppingCart size={20} />
              </button>
              <button onClick={() => setShowSettings(!showSettings)} className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors pointer-events-auto">
                <Settings size={20} />
              </button>
            </div>
          ) : (
            <button
              onClick={signIn}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded-full text-white text-sm font-bold transition-colors"
            >
              <User size={16} />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </div>

      {/* Leaderboard */}
      {(!isAlive || globalLeaderboard.length > 0) && (
        <div className="absolute top-20 right-4 w-64 bg-black/40 backdrop-blur-md rounded-2xl p-4 border border-white/10 pointer-events-auto max-h-[50vh] overflow-y-auto">
          <div className="flex items-center gap-2 mb-4 text-white/80 font-semibold">
            <Trophy size={18} className="text-yellow-400" />
            <h2>GLOBAL TOP 10</h2>
          </div>
          <div className="flex flex-col gap-2">
            {globalLeaderboard.map((entry, i) => (
              <div key={entry.id} className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2 truncate">
                  <span className="text-white/40 w-4">{i + 1}.</span>
                  <span style={{ color: entry.color?.startsWith('data:') ? '#a855f7' : entry.color }} className="font-medium truncate max-w-[120px]">
                    {entry.userId === user?.uid ? 'You' : entry.name}
                  </span>
                </div>
                <span className="font-mono text-white/80">{entry.score}</span>
              </div>
            ))}
            {globalLeaderboard.length === 0 && (
              <div className="text-white/40 text-xs text-center py-2">No global scores yet</div>
            )}
          </div>
        </div>
      )}

      {/* Shop Modal */}
      <AnimatePresence>
        {showShop && (
          <Suspense fallback={<ModalFallback />}>
            <Shop onClose={() => setShowShop(false)} />
          </Suspense>
        )}
      </AnimatePresence>

      {/* AI Creator Modal */}
      <AnimatePresence>
        {showAICreator && (
          <Suspense fallback={<ModalFallback />}>
            <AICreator onClose={() => setShowAICreator(false)} />
          </Suspense>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-auto bg-black/80 backdrop-blur-md z-50"
          >
            <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-md text-white">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Profile Settings</h2>
                <button onClick={() => setShowSettings(false)} className="text-white/50 hover:text-white">✕</button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-white/50 mb-1">Display Name</label>
                  <input 
                    type="text" 
                    value={localName} 
                    onChange={(e) => setLocalName(e.target.value)}
                    onBlur={() => { if (localName !== profile?.displayName) updateProfile({ displayName: localName }) }}
                    className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm text-white/50 mb-1">Background Theme</label>
                  <select 
                    value={profile?.theme || 'default'}
                    onChange={(e) => updateProfile({ theme: e.target.value })}
                    className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 outline-none focus:border-blue-500 transition-colors"
                  >
                    <option value="default">Default</option>
                    <option value="cyberpunk">Cyberpunk</option>
                    <option value="matrix">Matrix</option>
                    <option value="synthwave">Synthwave</option>
                  </select>
                </div>
              </div>
              
              <button 
                onClick={() => { signOut(); setShowSettings(false); }}
                className="mt-8 w-full py-3 bg-red-500/20 text-red-500 hover:bg-red-500/30 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
              >
                <LogOut size={18} />
                Sign Out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Menus */}
      {(!player || isDead) && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute inset-0 flex items-center justify-center pointer-events-auto bg-black/60 backdrop-blur-sm z-50"
        >
          <div className="bg-zinc-900/90 p-8 rounded-3xl border border-white/10 shadow-2xl max-w-md w-full flex flex-col items-center gap-6">
            {isDead && (
              <div className="text-center">
                <h2 className="text-4xl font-black text-red-500 mb-2">YOU DIED</h2>
                <p className="text-white/60">Final Length: {Math.floor(player.score)}</p>
              </div>
            )}
            
            {!isDead && (
              <div className="text-center">
                <h2 className="text-3xl font-black text-white mb-2">JOIN ARENA</h2>
                <p className="text-white/60 text-sm">Steer with A/D or Left/Right. Space to boost.</p>
              </div>
            )}
            
            <button
              onClick={handleJoinGame}
              className="w-full py-4 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-colors active:scale-95 text-xl select-none"
            >
              {isDead ? 'RESPAWN' : 'PLAY'}
            </button>
          </div>
        </motion.div>
      )}

      {/* Mobile Controls */}
      {isAlive && (
        <div className="absolute inset-x-0 bottom-4 pointer-events-none flex justify-between px-8 sm:hidden z-40 select-none touch-none pb-8">
          {/* Joystick */}
          <div 
            ref={joyRef}
            className="w-32 h-32 bg-white/5 active:bg-white/10 backdrop-blur-md rounded-full border border-white/20 touch-none pointer-events-auto relative flex items-center justify-center opacity-70"
            onPointerDown={(e) => { e.preventDefault(); handleJoyMove(e); }}
            onPointerMove={(e) => { e.preventDefault(); if (e.buttons > 0) handleJoyMove(e); }}
            onPointerUp={(e) => { e.preventDefault(); handleJoyEnd(); }}
            onPointerLeave={(e) => { e.preventDefault(); handleJoyEnd(); }}
            onPointerCancel={(e) => { e.preventDefault(); handleJoyEnd(); }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div 
              className="w-12 h-12 bg-white/50 rounded-full shadow-[0_0_15px_rgba(255,255,255,0.5)] pointer-events-none transition-transform duration-75"
              style={{ transform: `translate(${joyPos.x}px, ${joyPos.y}px)` }}
            />
          </div>
          
          {/* Boost */}
          <button
            className="w-24 h-24 bg-yellow-500/20 active:bg-yellow-500/50 backdrop-blur-md rounded-full flex items-center justify-center text-yellow-500 pointer-events-auto border border-yellow-500/50 touch-none select-none self-end mb-4 shadow-[0_0_20px_rgba(234,179,8,0.3)]"
            onPointerDown={(e) => { e.preventDefault(); mobileInputs.boost = true; if (navigator.vibrate) navigator.vibrate(15); }}
            onPointerUp={(e) => { e.preventDefault(); mobileInputs.boost = false; }}
            onPointerLeave={(e) => { e.preventDefault(); mobileInputs.boost = false; }}
            onPointerCancel={(e) => { e.preventDefault(); mobileInputs.boost = false; }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <Zap size={40} className="fill-yellow-500" />
          </button>
        </div>
      )}
    </div>
  );
}
