import React, { useState } from 'react';
import { useUserStore } from '../store/userStore';
import { motion } from 'framer-motion';
import { X, ShoppingCart, Zap, Star, Shield } from 'lucide-react';
import { doc, setDoc, serverTimestamp, increment } from 'firebase/firestore';
import { db } from '../firebase';

const SHOP_ITEMS = [
  { id: 'rainbow', name: 'Rainbow Skin', cost: 100, type: 'skin', icon: <Star className="text-pink-500" /> },
  { id: 'chrome', name: 'Chrome Skin', cost: 150, type: 'skin', icon: <Shield className="text-gray-400" /> },
  { id: 'neon', name: 'Neon Glow', cost: 200, type: 'skin', icon: <Zap className="text-green-400" /> },
];

export function Shop({ onClose }: { onClose: () => void }) {
  const { user, profile, checkProfile } = useUserStore();
  const [buyingCoins, setBuyingCoins] = useState(false);
  const [error, setError] = useState('');

  const handleBuySkin = async (itemId: string, cost: number) => {
    if (!user || !profile) return;
    if ((profile.coins || 0) < cost) {
      setError('Not enough coins!');
      return;
    }
    
    if (profile.ownedSkins?.includes(itemId)) {
      setError('Skin already owned!');
      return;
    }

    try {
      // Optimistic or direct update
      const ref = doc(db, 'users', user.uid);
      await setDoc(ref, {
        coins: increment(-cost),
        ownedSkins: [...(profile.ownedSkins || []), itemId],
        updatedAt: serverTimestamp()
      }, { merge: true });
      await checkProfile(user);
    } catch (e) {
      console.error(e);
      setError('Purchase failed.');
    }
  };

  const handleEquipSkin = async (itemId: string) => {
    if (!user || !profile) return;
    try {
      const ref = doc(db, 'users', user.uid);
      await setDoc(ref, { skin: itemId, updatedAt: serverTimestamp() }, { merge: true });
      await checkProfile(user);
    } catch (e) {
      console.error(e);
    }
  };

  const handleBuyCoins = async () => {
    if (!user) return;
    setBuyingCoins(true);
    setError('');
    try {
      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid })
      });
      const data = await res.json();
      if (data.url) {
        window.open(data.url, '_blank');
      } else if (data.error) {
        setError(data.error);
      }
    } catch (e) {
      setError('Failed to initiate checkout.');
    } finally {
      setBuyingCoins(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="bg-gray-900 border border-gray-700/50 p-6 rounded-2xl w-full max-w-lg shadow-2xl relative"
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors">
          <X size={24} />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <ShoppingCart className="text-blue-400" size={28} />
          <h2 className="text-2xl font-bold text-white tracking-tight">Shop</h2>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 text-red-200 p-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        {!user ? (
          <div className="text-center py-10">
             <p className="text-gray-400 mb-4">Sign in to buy coins and skins.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between bg-gray-800/80 p-4 rounded-xl mb-6 border border-gray-700/50">
              <div>
                <p className="text-sm text-gray-400">Your Coins</p>
                <p className="text-2xl font-bold text-yellow-500">{profile?.coins || 0} 🟡</p>
              </div>
              <button
                onClick={handleBuyCoins}
                disabled={buyingCoins}
                className="px-4 py-2 bg-gradient-to-r from-yellow-600 to-amber-500 text-white font-bold rounded-lg shadow-lg hover:shadow-yellow-500/25 transition-all active:scale-95 disabled:opacity-50"
              >
                {buyingCoins ? 'Loading...' : 'Get Coins ($5)'}
              </button>
            </div>

            <div className="space-y-3">
              <h3 className="text-lg font-medium text-gray-300">Cosmetic Skins</h3>
              {SHOP_ITEMS.map((item) => {
                const isOwned = profile?.ownedSkins?.includes(item.id);
                const isEquipped = profile?.skin === item.id;
                return (
                  <div key={item.id} className="flex items-center justify-between p-3 bg-gray-800 border border-gray-700 rounded-xl hover:border-gray-600 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center">
                        {item.icon}
                      </div>
                      <div>
                        <h4 className="font-semibold text-white">{item.name}</h4>
                        {!isOwned && <p className="text-sm text-yellow-500">{item.cost} 🟡</p>}
                      </div>
                    </div>
                    <div>
                      {isEquipped ? (
                        <span className="px-3 py-1 bg-green-500/20 text-green-400 text-sm font-medium rounded-full border border-green-500/30">
                          Equipped
                        </span>
                      ) : isOwned ? (
                        <button
                          onClick={() => handleEquipSkin(item.id)}
                          className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          Equip
                        </button>
                      ) : (
                        <button
                          onClick={() => handleBuySkin(item.id, item.cost)}
                          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg shadow-lg hover:shadow-blue-500/25 transition-all"
                        >
                          Buy
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        
        <div className="mt-6 pt-4 border-t border-gray-800">
           <p className="text-xs text-center text-gray-500">
             Purchases require Stripe setup. Open the .env file and set your keys.
           </p>
        </div>
      </motion.div>
    </motion.div>
  );
}
