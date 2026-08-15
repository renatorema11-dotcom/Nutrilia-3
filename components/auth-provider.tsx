'use client';

import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, User, db, createUserWithEmailAndPassword, signInWithEmailAndPassword } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export type UserRole = 'patient' | 'nutritionist' | null;

interface AuthContextType {
  role: UserRole;
  user: User | null;
  login: (role: UserRole, isNewUser?: boolean) => void;
  loginWithGoogle: (preferredRole?: UserRole) => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, name: string, role: UserRole, extraData?: any) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<UserRole>(null);
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const savedRole = localStorage.getItem('mockRole') as UserRole;
    if (savedRole && savedRole !== role) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRole(savedRole);
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
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

      const userRef = doc(db, 'users', googleUser.uid);
      const userSnap = await getDoc(userRef);
      let assignedRole: UserRole = preferredRole || 'patient';

      let isNewUser = false;
      if (userSnap.exists()) {
        const data = userSnap.data();
        if (data.role) {
          assignedRole = data.role as UserRole;
        }
      } else {
        isNewUser = true;
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
        if (isNewUser && assignedRole === 'patient') {
          router.push('/onboarding');
        } else {
          router.push(`/${assignedRole}`);
        }
      }
    } catch (error) {
      console.error('Google Sign-In failed:', error);
      throw error;
    }
  };

  const loginWithEmail = async (email: string, password: string) => {
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      const userRef = doc(db, 'users', result.user.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const data = userSnap.data();
        const userRole = data.role as UserRole;
        setRole(userRole);
        if (userRole) {
          localStorage.setItem('mockRole', userRole);
          router.push(`/${userRole}`);
        }
      } else {
        throw new Error('User data not found');
      }
    } catch (error) {
      console.error('Email login failed:', error);
      throw error;
    }
  };

  const registerWithEmail = async (email: string, password: string, name: string, role: UserRole, extraData?: any) => {
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      const userRef = doc(db, 'users', result.user.uid);
      const now = new Date().toISOString();
      const userData = {
        id: result.user.uid,
        email,
        displayName: name,
        role,
        ...extraData,
        createdAt: now
      };
      
      const removeUndefined = (obj: any): any => {
        if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(removeUndefined);
        const cleaned: any = {};
        for (const [key, value] of Object.entries(obj)) {
          if (value !== undefined) cleaned[key] = removeUndefined(value);
        }
        return cleaned;
      };

      await setDoc(userRef, removeUndefined(userData));

      if (role === 'patient') {
        const patientRef = doc(db, 'patients', result.user.uid);
        const patientData = {
          id: result.user.uid,
          name,
          email,
          age: 30,
          weight: 70,
          height: 168,
          objective: 'Saúde Geral',
          createdAt: now,
          measurements: [{
            date: now.split('T')[0],
            weight: 70,
            height: 168
          }],
          currentPlan: null,
          pastPlans: []
        };
        await setDoc(patientRef, removeUndefined(patientData));
      }

      setRole(role);
      if (role) {
        localStorage.setItem('mockRole', role);
        if (role === 'patient') {
          router.push('/onboarding');
        } else {
          router.push(`/${role}`);
        }
      }
    } catch (error) {
      console.error('Email registration failed:', error);
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
    <AuthContext.Provider value={{ role, user, login, loginWithGoogle, loginWithEmail, registerWithEmail, logout }}>
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
