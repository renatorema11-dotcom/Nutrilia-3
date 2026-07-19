'use client';

import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export type UserRole = 'patient' | 'nutritionist' | null;

interface AuthContextType {
  role: UserRole;
  login: (role: UserRole, isNewUser?: boolean) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<UserRole>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Simple mock persistence
    const savedRole = localStorage.getItem('mockRole') as UserRole;
    if (savedRole && savedRole !== role) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRole(savedRole);
    }
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

  const logout = () => {
    setRole(null);
    localStorage.removeItem('mockRole');
    localStorage.removeItem('mockPatientData');
    router.push('/login');
  };

  return (
    <AuthContext.Provider value={{ role, login, logout }}>
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
