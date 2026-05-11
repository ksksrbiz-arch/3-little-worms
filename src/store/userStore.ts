import { create } from 'zustand';
import { auth, db } from '../firebase';
import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut, User } from 'firebase/auth';
import { googleProvider } from '../firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getCached, setCached } from '../lib/dynamicCache';

const PROFILE_CACHE_TTL_MS = 60_000;

interface UserProfile {
  displayName: string;
  avatarUrl: string;
  skin: string;
  theme: string;
  coins?: number;
  ownedSkins?: string[];
  customBackground?: string;
}

interface UserStore {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  checkProfile: (u: User) => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
}

export const useUserStore = create<UserStore>((set, get) => ({
  user: null,
  profile: null,
  loading: true,
  signIn: async () => {
    try {
      const res = await signInWithPopup(auth, googleProvider);
      await get().checkProfile(res.user);
    } catch (e) {
      console.error(e);
    }
  },
  signOut: async () => {
    await fbSignOut(auth);
  },
  checkProfile: async (u: User) => {
    const cacheKey = `profile:${u.uid}`;
    const ref = doc(db, 'users', u.uid);
    const snap = await getCached(cacheKey, PROFILE_CACHE_TTL_MS, () => getDoc(ref));
    if (!snap.exists()) {
      const newProfile = {
        displayName: u.displayName || 'Player',
        avatarUrl: u.photoURL || '',
        skin: 'default',
        theme: 'default',
        coins: 0,
        ownedSkins: ['default'],
      };
      await setDoc(ref, {
        ...newProfile,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      set({ profile: newProfile });
    } else {
      set({ profile: snap.data() as UserProfile });
    }
  },
  updateProfile: async (updates: Partial<UserProfile>) => {
    const { user, profile } = get();
    if (!user || !profile) return;
    const ref = doc(db, 'users', user.uid);
    const newProfile = { ...profile, ...updates };
    await setDoc(ref, {
      ...newProfile,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    setCached(`profile:${user.uid}`, { exists: () => true, data: () => newProfile }, PROFILE_CACHE_TTL_MS);
    set({ profile: newProfile });
  }
}));

onAuthStateChanged(auth, async (u) => {
  if (u) {
    useUserStore.setState({ user: u });
    await useUserStore.getState().checkProfile(u);
  } else {
    useUserStore.setState({ user: null, profile: null });
  }
  useUserStore.setState({ loading: false });
});
