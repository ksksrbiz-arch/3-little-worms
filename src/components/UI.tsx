/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { useGameStore, mobileInputs } from '../store/gameStore';
import { useUserStore } from '../store/userStore';
import { motion, AnimatePresence } from 'framer-motion';
import { ExternalLink, Trophy, ArrowLeft, ArrowRight, Zap, User, Settings, LogOut, ShoppingCart, Sparkles, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { db } from '../firebase';
import { doc, setDoc, serverTimestamp, getDocs, collection, query, orderBy, limit } from 'firebase/firestore';
import { Shop } from './Shop';
import { AICreator } from './AICreator';
import { audioManager } from '../lib/audio';

export function UI() {
  const gameState = useGameStore(state => state.gameState);
  const playerId = useGameStore(state => state.playerId);
  const joinGame = useGameStore(state => state.joinGame);
  const socket = useGameStore(state => state.socket);
  const connectionStatus = useGameStore(state => state.connectionStatus);
  const ping = useGameStore(state => state.ping);
  const reconnect = useGameStore(state => state.reconnect);

  interface KillFeedItem {
    id: string;
    victimName: string;
    killerName: string | null;
    streak?: number;
  }

  const [killFeed, setKillFeed] = useState<KillFeedItem[]>([]);
  const paymentProcessed = useRef(false);
  const scoreSavedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!socket) return;

    const handleKill = (data: { victim: string; killer: string | null; streak?: number }) => {
      const newItem: KillFeedItem = {
        id: Math.random().toString(),
        victimName: data.victim,
        killerName: data.killer,
        streak: data.streak
      };
      setKillFeed(prev => [...prev.slice(-4), newItem]);
    };

    socket.on('kill_feed', handleKill);
    return () => {
      socket.off('kill_feed', handleKill);
    };
  }, [socket]);

  useEffect(() => {
    if (killFeed.length > 0) {
      const timer = setTimeout(() => {
        setKillFeed(prev => prev.slice(1));
      }, 4500);
      return () => clearTimeout(timer);
    }
  }, [killFeed]);

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
    setLocalName(profile?.displayName || '');
  }, [profile?.displayName]);

  // Joystick state
  const joyRef = useRef<HTMLDivElement>(null);
  const [joyPos, setJoyPos] = useState({ x: 0, y: 0 });
  const activePointerId = useRef<number | null>(null);

  const handleJoyStart = (e: React.PointerEvent) => {
    if (!joyRef.current) return;
    activePointerId.current = e.pointerId;
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch (err) {}
    handleJoyMove(e);
  };

  const handleJoyMove = (e: React.PointerEvent) => {
    if (!joyRef.current || activePointerId.current !== e.pointerId) return;
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
    
    if (distance > 5) {
      mobileInputs.active = true;
      // Screen space dy is positive-down; world space y is positive-up.
      // Negate dy to convert from screen space to world space direction.
      mobileInputs.angle = Math.atan2(-dy, dx);
    } else {
      mobileInputs.active = false;
    }
    
    // Maintain backward compatibility logic just in case
    mobileInputs.left = joyX < -15;
    mobileInputs.right = joyX > 15;
  };

  const handleJoyEnd = (e: React.PointerEvent) => {
    if (activePointerId.current === e.pointerId) {
      if (joyRef.current) {
        try {
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        } catch (err) {}
      }
      activePointerId.current = null;
      setJoyPos({ x: 0, y: 0 });
      mobileInputs.active = false;
      mobileInputs.left = false;
      mobileInputs.right = false;
    }
  };


  const leaderboardCache = useRef<{ data: any[] | null, expires: number }>({ data: null, expires: 0 });

  useEffect(() => {
    // Fetch global leaderboard
    const fetchLeaderboard = async () => {
      try {
        if (Date.now() < leaderboardCache.current.expires && leaderboardCache.current.data) {
          setGlobalLeaderboard(leaderboardCache.current.data);
          return;
        }
        const q = query(collection(db, 'leaderboard'), orderBy('score', 'desc'), limit(10));
        const snap = await getDocs(q);
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        leaderboardCache.current = { data, expires: Date.now() + 30000 }; // 30s cache
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
    const paymentStatus = params.get('payment');
    if (!paymentStatus) return;
    if (paymentProcessed.current) return;

    if (paymentStatus === 'success') {
      if (user && profile) {
        paymentProcessed.current = true;
        const ref = doc(db, 'users', user.uid);
        
        try {
          window.history.replaceState({}, '', window.location.pathname);
        } catch (e) {
          console.warn('replaceState blocked or failed', e);
        }

        // Grant 1000 coins (this is an insecure client-side grant for demo purposes)
        setDoc(ref, { coins: (profile.coins || 0) + 1000, updatedAt: serverTimestamp() }, { merge: true })
          .then(() => useUserStore.getState().checkProfile(user))
          .catch(e => console.error(e));
        alert('Payment successful! 1000 Coins added.');
      }
    } else if (paymentStatus === 'cancelled') {
      paymentProcessed.current = true;
      try {
        window.history.replaceState({}, '', window.location.pathname);
      } catch (e) {
        console.warn('replaceState blocked or failed', e);
      }
    }
  }, [user?.uid, profile?.coins]);

  const handleJoinGame = () => {
    audioManager.init();
    if (profile) {
      joinGame({ name: profile.displayName, color: profile.skin === 'default' ? undefined : profile.skin });
    } else {
      joinGame();
    }
  };

  const playerRef = useRef(player);
  playerRef.current = player;

  useEffect(() => {
    if (isDead && user) {
      const p = playerRef.current;
      if (!p) return;
      
      const currentScoreKey = `${user.uid}_${Math.floor(p.score)}`;
      if (scoreSavedRef.current === currentScoreKey) return;
      scoreSavedRef.current = currentScoreKey;

      // Save score
      const scoreId = `${user.uid}_${Date.now()}`;
      setDoc(doc(db, 'leaderboard', scoreId), {
        userId: user.uid,
        score: Math.floor(p.score),
        timePlayed: Math.floor((Date.now() - 0) / 1000), // simplified
        name: p.name,
        color: p.color,
        createdAt: serverTimestamp(),
      }).catch(err => {
        const errInfo = {
          error: err instanceof Error ? err.message : String(err),
          operationType: 'create',
          path: 'leaderboard'
        };
        console.error(JSON.stringify(errInfo));
      });
    } else if (!isDead) {
      scoreSavedRef.current = null;
    }
  }, [isDead, user?.uid]);

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
            <div className="flex flex-col gap-1.5">
              <div className="text-xl font-mono text-white/80 font-bold">
                Length: {Math.floor(player.score)}
              </div>
              
              {/* Kills & Streaks HUD */}
              {(player.kills > 0 || player.killStreak > 0) && (
                <div className="flex gap-2">
                  {player.kills > 0 && (
                    <div className="bg-red-500/20 text-red-300 border border-red-500/30 px-2 py-0.5 rounded text-[10px] font-bold font-mono">
                      KILLS: {player.kills}
                    </div>
                  )}
                  {player.killStreak > 1 && (
                    <div className="bg-orange-500/20 text-orange-300 border border-orange-500/30 px-2 py-0.5 rounded text-[10px] font-bold font-mono animate-bounce">
                      STREAK: {player.killStreak} 🔥
                    </div>
                  )}
                </div>
              )}

              {/* Power-up Pills */}
              <div className="flex flex-col sm:flex-row gap-1.5 mt-0.5">
                {player.magnetTime > 0 && (
                  <div className="flex items-center gap-1.5 bg-purple-500/20 text-purple-300 border border-purple-500/40 px-2.5 py-1 rounded-full text-[10px] font-bold font-mono tracking-wide shadow-[0_0_10px_rgba(168,85,247,0.15)] animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping" />
                    <span>MAGNET: {Math.max(0, Math.ceil(player.magnetTime))}s</span>
                  </div>
                )}
                {player.shieldTime > 0 && (
                  <div className="flex items-center gap-1.5 bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 px-2.5 py-1 rounded-full text-[10px] font-bold font-mono tracking-wide shadow-[0_0_10px_rgba(6,182,212,0.15)] animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                    <span>SHIELD: {Math.max(0, Math.ceil(player.shieldTime))}s</span>
                  </div>
                )}
                {player.doubleTime > 0 && (
                  <div className="flex items-center gap-1.5 bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 px-2.5 py-1 rounded-full text-[10px] font-bold font-mono tracking-wide shadow-[0_0_10px_rgba(234,179,8,0.15)] animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-ping" />
                    <span>DOUBLE: {Math.max(0, Math.ceil(player.doubleTime))}s</span>
                  </div>
                )}
              </div>
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

        <div className="flex items-center gap-4 z-10 pointer-events-auto">
          {/* Connection Status Badge */}
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-zinc-900/80 backdrop-blur-md border border-white/10 text-xs font-mono select-none">
            {connectionStatus === 'connected' && (
              <>
                <Wifi size={13} className="text-emerald-400" />
                <span className="text-emerald-400 font-bold tracking-wider">LIVE</span>
                <span className="text-white/20">|</span>
                <span className="text-white/80 font-medium">{ping}ms</span>
              </>
            )}
            {(connectionStatus === 'connecting' || connectionStatus === 'reconnecting') && (
              <>
                <Wifi size={13} className="text-amber-400 animate-pulse" />
                <span className="text-amber-400 font-bold tracking-wider animate-pulse">CONNECTING</span>
              </>
            )}
            {(connectionStatus === 'disconnected' || connectionStatus === 'failed') && (
              <>
                <WifiOff size={13} className="text-rose-400" />
                <span className="text-rose-400 font-bold tracking-wider">OFFLINE</span>
                <span className="text-white/20">|</span>
                <button
                  onClick={reconnect}
                  className="text-white hover:text-blue-400 font-bold tracking-tight underline cursor-pointer transition-colors"
                >
                  RETRY
                </button>
              </>
            )}
          </div>

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
        {showShop && <Shop onClose={() => setShowShop(false)} />}
      </AnimatePresence>

      {/* AI Creator Modal */}
      <AnimatePresence>
        {showAICreator && <AICreator onClose={() => setShowAICreator(false)} />}
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
      <AnimatePresence>
        {(!player || isDead) && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
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
              
              {/* Connection Fallback Message */}
              {(connectionStatus === 'disconnected' || connectionStatus === 'failed') && (
                <div className="text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 px-4 py-2.5 rounded-xl text-center font-semibold font-mono tracking-wide w-full">
                  Disconnected from server.
                  <button onClick={reconnect} className="block mx-auto mt-1 text-white font-bold underline hover:text-blue-400 cursor-pointer transition-colors">
                    Reconnect Now
                  </button>
                </div>
              )}

              <button
                onClick={handleJoinGame}
                disabled={connectionStatus !== 'connected'}
                className="w-full py-4 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-colors active:scale-95 text-xl select-none disabled:bg-white/20 disabled:text-neutral-500 disabled:cursor-not-allowed disabled:scale-100"
              >
                {connectionStatus === 'connected' ? (isDead ? 'RESPAWN' : 'PLAY') : 'WAITING FOR SERVER...'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Controls */}
      {isAlive && (
        <div className="absolute inset-x-0 bottom-4 pointer-events-none flex justify-between px-8 sm:hidden z-40 select-none touch-none pb-8">
          {/* Joystick */}
          <div 
            ref={joyRef}
            className="w-32 h-32 bg-white/5 active:bg-white/10 backdrop-blur-md rounded-full border border-white/20 touch-none pointer-events-auto relative flex items-center justify-center opacity-70"
            onPointerDown={handleJoyStart}
            onPointerMove={handleJoyMove}
            onPointerUp={handleJoyEnd}
            onPointerLeave={handleJoyEnd}
            onPointerCancel={handleJoyEnd}
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

      {/* Kill Feed Overlay */}
      <div className="absolute right-4 bottom-24 sm:bottom-4 flex flex-col gap-1.5 pointer-events-none select-none z-30 max-w-xs">
        <AnimatePresence>
          {killFeed.map(item => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 100, scale: 0.9 }}
              className="bg-black/80 border border-white/10 px-3 py-2 rounded-xl flex items-center justify-between gap-3 text-[11px] font-mono tracking-wide shadow-lg mr-2 max-w-[260px]"
            >
              <div className="flex items-center gap-1.5 truncate">
                {item.killerName ? (
                  <span className="text-red-400 font-bold truncate max-w-[95px]">{item.killerName}</span>
                ) : (
                  <span className="text-zinc-500 font-normal">Grid</span>
                )}
                <span className="text-white/40 text-[9px] uppercase">liq</span>
                <span className="text-yellow-400 font-bold truncate max-w-[95px]">{item.victimName}</span>
              </div>
              <span className="bg-red-500/10 text-red-400 px-1 rounded-md text-[9px] uppercase border border-red-500/20">💥</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
