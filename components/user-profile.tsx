'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui';
import { Camera, Save, User as UserIcon, Loader2, Check } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, updateProfile } from '@/lib/firebase';
import Image from 'next/image';

export function UserProfile() {
  const { user, role, updateUserProfilePhoto } = useAuth();
  const [name, setName] = useState(user?.displayName || '');
  const [photoURL, setPhotoURL] = useState(user?.photoURL || '');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Salvo!');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [prevUser, setPrevUser] = useState(user);
  if (user !== prevUser) {
    setPrevUser(user);
    setName(user?.displayName || '');
    setPhotoURL(user?.photoURL || '');
  }

  const compressImage = (file: File, maxDim = 350, quality = 0.85): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = document.createElement('img');
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          if (width > height) {
            if (width > maxDim) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            }
          } else {
            if (height > maxDim) {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', quality));
          } else {
            resolve(e.target?.result as string);
          }
        };
        img.onerror = () => resolve(e.target?.result as string);
        img.src = e.target?.result as string;
      };
      reader.onerror = () => {
        resolve('');
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLoading(true);
      setSuccess(false);
      try {
        const compressedDataUrl = await compressImage(file, 350, 0.85);
        if (!compressedDataUrl) return;
        setPhotoURL(compressedDataUrl);
        if (user && updateUserProfilePhoto) {
          await updateUserProfilePhoto(compressedDataUrl, name);
          setStatusMessage('Foto de perfil definida com sucesso!');
          setSuccess(true);
          setTimeout(() => setSuccess(false), 3500);
        }
      } catch (err) {
        console.error('Error updating profile photo:', err);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setLoading(true);
    setSuccess(false);

    try {
      if (updateUserProfilePhoto) {
        await updateUserProfilePhoto(photoURL, name);
      }
      setStatusMessage('Perfil salvo com sucesso!');
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
      }, 3500);
    } catch (error) {
      console.error('Error updating profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const hasValidPhoto = Boolean(photoURL && photoURL.trim());

  return (
    <Card className="w-full max-w-2xl mx-auto shadow-sm">
      <CardHeader>
        <CardTitle className="text-2xl text-slate-800">Meu Perfil</CardTitle>
        <CardDescription>
          Gerencie suas informações pessoais e foto de perfil.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-8">
          <div className="flex flex-col items-center gap-4">
            <div className="relative group">
              <div className="w-32 h-32 rounded-full overflow-hidden bg-slate-100 border-4 border-white shadow-lg flex items-center justify-center relative">
                {hasValidPhoto ? (
                  <Image 
                    src={photoURL} 
                    alt="Perfil" 
                    fill 
                    className="object-cover" 
                    referrerPolicy="no-referrer"
                    unoptimized
                  />
                ) : (
                  <UserIcon className="w-16 h-16 text-slate-300" />
                )}
                
                <div 
                  className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                  title="Clique para enviar nova foto de perfil"
                >
                  <Camera className="w-8 h-8 text-white" />
                </div>
              </div>
              
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept="image/*" 
                className="hidden" 
              />
            </div>
            
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-full transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
              {hasValidPhoto ? 'Alterar Foto de Perfil' : 'Adicionar Foto de Perfil'}
            </button>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium text-slate-700">
                Nome Completo
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-3 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all"
                placeholder="Seu nome"
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={user?.email || ''}
                className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 outline-none cursor-not-allowed"
                disabled
              />
              <p className="text-xs text-slate-500">O email não pode ser alterado.</p>
            </div>
            
            <div className="space-y-2">
              <label htmlFor="role" className="text-sm font-medium text-slate-700">
                Tipo de Conta
              </label>
              <input
                id="role"
                type="text"
                value={role === 'patient' ? 'Paciente' : 'Nutricionista'}
                className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 outline-none cursor-not-allowed"
                disabled
              />
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-6 py-3 rounded-xl font-medium transition-colors disabled:opacity-70"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : success ? (
                <>
                  <Check className="w-5 h-5" />
                  {statusMessage}
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  Salvar Alterações
                </>
              )}
            </button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
