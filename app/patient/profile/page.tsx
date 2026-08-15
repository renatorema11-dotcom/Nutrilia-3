'use client';

import { UserProfile } from '@/components/user-profile';

export default function PatientProfilePage() {
  return (
    <div className="w-full h-full flex flex-col p-2 md:p-6 pb-24">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">Meu Perfil</h1>
        <p className="text-slate-600">Atualize seus dados pessoais e foto de perfil.</p>
      </div>
      
      <UserProfile />
    </div>
  );
}
