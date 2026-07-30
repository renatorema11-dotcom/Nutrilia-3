'use client';

import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, User, db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export type UserRole = 'patient' | 'nutritionist' | null;

interface AuthContextType {
  role: UserRole;
  user: User | null;
  login: (role: UserRole, isNewUser?: boolean) => void;
  loginWithGoogle: (preferredRole?: UserRole) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<UserRole>(null);
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();

  useEffect(() => {
    const savedRole = localStorage.getItem('mockRole') as UserRole;
    if (savedRole && savedRole !== role) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRole(savedRole);
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Fetch or create user doc in Firestore
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            const data = userSnap.data();
            if (data.role) {
              setRole(data.role as UserRole);
              localStorage.setItem('mockRole', data.role);
            }
          }
        } catch (err) {
          console.error('Error fetching user document:', err);
        }
      }
    });

    return () => unsubscribe();
  }, [role]);

  const login = (newRole: UserRole, isNewUser?: boolean) => {
    setRole(newRole);
    if (newRole) {
      localStorage.setItem('mockRole', newRole);
      if (newRole === 'patient' && isNewUser) {
        router.push('/onboarding');
      } else {
        router.push(`/${newRole}`);
      }
    }
  };

  const loginWithGoogle = async (preferredRole: UserRole = 'patient') => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const googleUser = result.user;
      setUser(googleUser);

      // Check if user exists in Firestore
      const userRef = doc(db, 'users', googleUser.uid);
      const userSnap = await getDoc(userRef);
      let assignedRole = preferredRole || 'patient';

      if (userSnap.exists()) {
        const data = userSnap.data();
        if (data.role) {
          assignedRole = data.role as UserRole;
        }
      } else {
        // Save new user to Firestore
        await setDoc(userRef, {
          id: googleUser.uid,
          email: googleUser.email,
          displayName: googleUser.displayName,
          photoURL: googleUser.photoURL,
          role: assignedRole,
          createdAt: new Date().toISOString()
        });
      }

      setRole(assignedRole);
      if (assignedRole) {
        localStorage.setItem('mockRole', assignedRole);
        router.push(`/${assignedRole}`);
      }
    } catch (error) {
      console.error('Google Sign-In failed:', error);
      throw error;
    }
  };

  const logout = () => {
    signOut(auth).catch((err) => console.error('Sign out error:', err));
    setUser(null);
    setRole(null);
    localStorage.removeItem('mockRole');
    localStorage.removeItem('mockPatientData');
    localStorage.removeItem('mockSavedPlans');
    localStorage.removeItem('mockFoodDiary');
    router.push('/login');
  };

  return (
    <AuthContext.Provider value={{ role, user, login, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
