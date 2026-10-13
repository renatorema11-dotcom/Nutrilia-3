'use client';

import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, User, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, sendPasswordResetEmail } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { postJson } from '@/lib/api-client';

export type UserRole = 'patient' | 'nutritionist' | null;
/** Situação do cadastro da nutricionista. Paciente e conta antiga de nutricionista contam como aprovados. */
export type ApprovalStatus = 'approved' | 'pending' | 'rejected';

function approvalFrom(data: { role?: unknown; approval?: unknown } | undefined): ApprovalStatus {
  return data?.role === 'nutritionist' && (data.approval === 'pending' || data.approval === 'rejected') ? data.approval : 'approved';
}

interface AuthContextType {
  role: UserRole;
  user: User | null;
  /** true depois que o Firebase informou se há sessão (e o papel foi lido). */
  ready: boolean;
  /** O perfil pede troca da senha temporária. */
  mustChangePassword: boolean;
  /** Nutricionista recém-cadastrada fica "pending" até o responsável pelo NutriAli aprovar. */
  approval: ApprovalStatus;
  /** Envia o e-mail para criar uma senha nova. */
  sendPasswordReset: (email: string) => Promise<void>;
  login: (role: UserRole, isNewUser?: boolean) => void;
  loginWithGoogle: (preferredRole?: UserRole) => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, name: string, role: UserRole, extraData?: any) => Promise<void>;
  logout: () => void;
  updateUserProfilePhoto: (newPhotoURL: string, newDisplayName?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Apaga do navegador o que o app guardou da pessoa (rascunhos, diário, dica do dia).
 * Dado de saúde não fica no aparelho depois que ela sai. O idioma escolhido continua.
 */
function clearLocalAppData() {
  try {
    for (const storage of [localStorage, sessionStorage]) {
      for (let i = storage.length - 1; i >= 0; i--) {
        const key = storage.key(i);
        if (key && /^(mock|completedMeals|daily_tip_|nutri_)/.test(key)) storage.removeItem(key);
      }
    }
  } catch {
    // navegador sem armazenamento (modo privado)
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<UserRole>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [approval, setApproval] = useState<ApprovalStatus>('approved');
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // O papel salvo no navegador é só um palpite inicial; quem confirma é o Firebase.
    const savedRole = localStorage.getItem('mockRole') as UserRole;
    if (savedRole) {
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
            setMustChangePassword(!!data.mustChangePassword);
            setApproval(approvalFrom(data));
            if (data.role) {
              setRole(data.role as UserRole);
              localStorage.setItem('mockRole', data.role);
            }
          }
        } catch (err) {
          console.error('Error fetching user document:', err);
        }
      } else {
        // Sem sessão no Firebase, o papel salvo no navegador não vale mais, nem os dados guardados no aparelho.
        setRole(null);
        setMustChangePassword(false);
        setApproval('approved');
        clearLocalAppData();
      }
      setReady(true);
    });

    return () => unsubscribe();
  }, []);

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
        setApproval(approvalFrom(data));
      } else {
        isNewUser = true;
        // Nutricionista nova entra "em análise": a tela seguinte pede o CRN e o responsável aprova.
        const pending = assignedRole === 'nutritionist';
        await setDoc(userRef, {
          id: googleUser.uid,
          email: googleUser.email,
          displayName: googleUser.displayName,
          photoURL: googleUser.photoURL,
          role: assignedRole,
          ...(pending ? { approval: 'pending' } : {}),
          createdAt: new Date().toISOString()
        });
        setApproval(pending ? 'pending' : 'approved');
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
        setApproval(approvalFrom(data));
        if (userRole) {
          localStorage.setItem('mockRole', userRole);
          if (data.mustChangePassword) {
            router.push('/patient/change-password');
          } else {
            router.push(`/${userRole}`);
          }
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
      // Nutricionista nova entra "em análise" (as regras do banco só aceitam assim); o responsável aprova depois.
      const pending = role === 'nutritionist';
      const userData = {
        id: result.user.uid,
        email,
        displayName: name,
        role,
        ...extraData,
        ...(pending ? { approval: 'pending' } : {}),
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
        // O prontuário nasce só com nome e e-mail. Idade, peso, altura e objetivo o paciente informa
        // na triagem logo em seguida (o servidor grava): nada de valores inventados.
        const patientRef = doc(db, 'patients', result.user.uid);
        const patientData = {
          id: result.user.uid,
          name,
          email,
          createdAt: now,
          measurements: [],
          currentPlan: null,
          pastPlans: []
        };
        await setDoc(patientRef, removeUndefined(patientData));
      }

      if (pending) {
        // Registra o pedido e avisa o responsável por e-mail. Se falhar agora, a tela "em análise" tenta de novo.
        await postJson('/api/nutritionist/approval', {}).catch((notifyError) => console.warn('Aviso de cadastro pendente:', notifyError));
      }
      setApproval(pending ? 'pending' : 'approved');
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

  const updateUserProfilePhoto = async (newPhotoURL: string, newDisplayName?: string) => {
    const currentUser = auth.currentUser || user;
    if (!currentUser) return;

    const nameToSave = newDisplayName !== undefined && newDisplayName.trim() !== '' 
      ? newDisplayName 
      : (currentUser.displayName || '');

    try {
      if (auth.currentUser) {
        try {
          await updateProfile(auth.currentUser, {
            photoURL: newPhotoURL,
            displayName: nameToSave
          });
        } catch (profileErr: any) {
          // If photoURL is too long for Firebase Auth profile attribute (auth/invalid-profile-attribute),
          // fall back to updating displayName only on Auth user object while storing photoURL in Firestore
          console.warn('Firebase Auth updateProfile photoURL warning:', profileErr?.message || profileErr);
          await updateProfile(auth.currentUser, {
            displayName: nameToSave
          }).catch(() => {});
        }
      }

      const userRef = doc(db, 'users', currentUser.uid);
      await setDoc(userRef, {
        photoURL: newPhotoURL,
        displayName: nameToSave,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      if (role === 'patient') {
        const patientRef = doc(db, 'patients', currentUser.uid);
        await setDoc(patientRef, {
          photoURL: newPhotoURL,
          name: nameToSave
        }, { merge: true }).catch(() => {});
      }

      setUser((prev) => {
        if (!prev) return null;
        return Object.assign(Object.create(Object.getPrototypeOf(prev)), prev, {
          photoURL: newPhotoURL,
          displayName: nameToSave
        });
      });
    } catch (err) {
      console.error('Error updating profile photo:', err);
      throw err;
    }
  };

  const sendPasswordReset = async (email: string) => {
    // O e-mail e a página de troca de senha saem em português.
    auth.languageCode = 'pt-BR';
    await sendPasswordResetEmail(auth, email);
  };

  const logout = () => {
    signOut(auth).catch((err) => console.error('Sign out error:', err));
    setUser(null);
    setRole(null);
    setMustChangePassword(false);
    setApproval('approved');
    clearLocalAppData();
    router.push('/login');
  };

  return (
    <AuthContext.Provider value={{ role, user, ready, mustChangePassword, approval, sendPasswordReset, login, loginWithGoogle, loginWithEmail, registerWithEmail, logout, updateUserProfilePhoto }}>
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
