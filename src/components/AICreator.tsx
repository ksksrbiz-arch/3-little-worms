import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Sparkles, Image as ImageIcon, Loader2 } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import { useUserStore } from '../store/userStore';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

async function resizeImage(base64Str: string, maxWidth: number, maxHeight: number, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(base64Str);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = base64Str;
  });
}

export function AICreator({ onClose }: { onClose: () => void }) {
  const { user, profile, checkProfile } = useUserStore();
  const [prompt, setPrompt] = useState('');
  const [type, setType] = useState<'skin' | 'background'>('skin');
  const [generating, setGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!prompt) return;
    setGenerating(true);
    setError('');
    setGeneratedImages([]);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const p = type === 'skin' ? `A seamless repeating texture pattern of: ${prompt}. Colorful, vibrant, suitable for a 3d snake body texture` : `A background space environment of: ${prompt}. Abstract, dark background suitable for a top-down game background`;
      
      const fetchImage = async () => {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: p,
        });
        
        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
              const base64Str = `data:${part.inlineData.mimeType || 'image/jpeg'};base64,${part.inlineData.data}`;
              if (type === 'skin') {
                 return await resizeImage(base64Str, 128, 128, 0.7);
              } else {
                 return await resizeImage(base64Str, 1024, 1024, 0.8);
              }
          }
        }
        throw new Error('No image returned');
      };

      // Generate 2 variations
      const results = await Promise.all([fetchImage(), fetchImage()]);
      setGeneratedImages(results.filter(Boolean) as string[]);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleEquip = async (imgData: string) => {
    if (!user) return;
    try {
      const ref = doc(db, 'users', user.uid);
      if (type === 'skin') {
         await setDoc(ref, { skin: imgData, updatedAt: serverTimestamp() }, { merge: true });
      } else {
         await setDoc(ref, { customBackground: imgData, updatedAt: serverTimestamp() }, { merge: true });
      }
      await checkProfile(user);
      onClose();
    } catch (e: any) {
      setError('Failed to save to profile.');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="bg-gray-900 border border-gray-700 p-6 rounded-2xl w-full max-w-2xl relative shadow-2xl my-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white">
          <X size={24} />
        </button>

        <h2 className="text-2xl font-bold text-white flex items-center gap-2 mb-6">
          <Sparkles className="text-purple-400" /> AI Studio
        </h2>

        {!user ? (
          <p className="text-gray-400 text-center py-8">Please sign in to generate.</p>
        ) : (
          <div className="space-y-6">
            <div className="flex gap-4">
              <button
                onClick={() => setType('skin')}
                className={`flex-1 py-3 rounded-lg font-bold transition-colors ${type === 'skin' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
              >
                Custom Skin
              </button>
              <button
                onClick={() => setType('background')}
                className={`flex-1 py-3 rounded-lg font-bold transition-colors ${type === 'background' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
              >
                Custom Background
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={type === 'skin' ? "e.g. Neon cyberpunk scales..." : "e.g. A vast synthwave grid with distant nebulas..."}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 resize-none h-24"
              />
            </div>

             <button
                onClick={handleGenerate}
                disabled={generating || !prompt.trim()}
                className="w-full py-4 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-bold rounded-xl hover:opacity-90 transition-opacity active:scale-95 disabled:opacity-50 flex justify-center items-center gap-2"
              >
                {generating ? <><Loader2 className="animate-spin" /> Generating...</> : <><Sparkles /> Generate Designs</>}
              </button>

              {error && <p className="text-red-400 text-sm">{error}</p>}

              {generatedImages.length > 0 && (
                 <div className="space-y-4 pt-4 border-t border-gray-800">
                    <h3 className="text-lg font-bold text-white">Select a Design:</h3>
                    <div className="grid grid-cols-2 gap-4">
                       {generatedImages.map((img, i) => (
                          <div key={i} className="flex flex-col gap-2">
                             <img src={img} alt="Generated" className="w-full aspect-square object-cover rounded-xl border border-gray-700 cursor-pointer hover:border-purple-500" onClick={() => handleEquip(img)} />
                             <button onClick={() => handleEquip(img)} className="py-2 bg-gray-800 text-white font-medium rounded-lg hover:bg-gray-700 transition">
                                Equip This
                             </button>
                          </div>
                       ))}
                    </div>
                 </div>
              )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
