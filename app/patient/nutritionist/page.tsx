'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/auth-provider';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  getRegisteredNutritionists,
  linkNutritionistToPatient,
  Patient,
  RegisteredNutritionist
} from '@/lib/patients';
import { Card, CardContent, Button, Badge, Input } from '@/components/ui';
import {
  Stethoscope,
  CheckCircle2,
  Search,
  MessageSquare,
  UserCheck,
  Award,
  Phone,
  Mail,
  Loader2,
  RefreshCw,
  Sparkles,
  ShieldCheck,
  Building
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

export default function PatientNutritionistSelectionPage() {
  const { user } = useAuth();
  const [patientData, setPatientData] = useState<Patient | null>(null);
  const [nutritionists, setNutritionists] = useState<RegisteredNutritionist[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('todos');
  const [isChanging, setIsChanging] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [modalNutritionist, setModalNutritionist] = useState<RegisteredNutritionist | null>(null);
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        // Fetch registered nutritionists in the system
        const list = await getRegisteredNutritionists();
        setNutritionists(list);

        // Fetch patient profile from Firestore
        if (user?.uid) {
          const patientSnap = await getDoc(doc(db, 'patients', user.uid));
          if (patientSnap.exists()) {
            setPatientData(patientSnap.data() as Patient);
          } else {
            const userSnap = await getDoc(doc(db, 'users', user.uid));
            if (userSnap.exists()) {
              const uData = userSnap.data();
              if (uData.patientData) {
                setPatientData(uData.patientData as Patient);
              } else if (uData.nutritionistId) {
                setPatientData({
                  id: user.uid,
                  name: uData.displayName || user.displayName || 'Paciente',
                  email: user.email || '',
                  age: 30,
                  weight: 70,
                  height: 170,
                  objective: 'Saúde Geral',
                  createdAt: new Date().toISOString(),
                  measurements: [],
                  nutritionistId: uData.nutritionistId,
                  nutritionistName: uData.nutritionistData?.nutritionistName || uData.nutritionistName
                } as Patient);
              }
            }
          }
        }
      } catch (err) {
        console.error('Erro ao carregar dados do nutricionista:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [user]);

  const handleConfirmSelect = async () => {
    if (!modalNutritionist || !user?.uid) return;
    setSelectingId(modalNutritionist.id);

    try {
      await linkNutritionistToPatient(user.uid, modalNutritionist);
      
      const pName = user.displayName || patientData?.name || 'Paciente';
      const pEmail = user.email || patientData?.email || 'email@paciente.com';

      // Send email notification to nutritionist
      try {
        await fetch('/api/notify-nutritionist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nutritionistId: modalNutritionist.id,
            nutritionistEmail: modalNutritionist.email,
            nutritionistName: modalNutritionist.displayName,
            patientId: user.uid,
            patientName: pName,
            patientEmail: pEmail
          })
        });
      } catch (notifyErr) {
        console.warn('Erro ao notificar nutricionista por e-mail:', notifyErr);
      }

      // Update local state
      setPatientData((prev) => ({
        ...(prev || {
          id: user.uid,
          name: pName,
          email: pEmail,
          age: 30,
          weight: 70,
          height: 170,
          objective: 'Saúde Geral',
          createdAt: new Date().toISOString(),
          measurements: []
        }),
        nutritionistId: modalNutritionist.id,
        nutritionistName: modalNutritionist.displayName,
        nutritionistEmail: modalNutritionist.email,
        nutritionistCRN: modalNutritionist.crn,
        nutritionistPhoto: modalNutritionist.photoURL,
        nutritionistSpecialty: modalNutritionist.specialty
      }));

      setSuccessMsg(`Você contratou ${modalNutritionist.displayName}! Enviaremos um e-mail para ${modalNutritionist.email} com a notificação do seu cadastro.`);
      setIsChanging(false);
      setModalNutritionist(null);
      setTimeout(() => setSuccessMsg(''), 7000);
    } catch (err) {
      console.error('Erro ao vincular nutricionista:', err);
    } finally {
      setSelectingId(null);
    }
  };

  const filteredNutritionists = nutritionists.filter((n) => {
    const searchLower = (search || '').toLowerCase();
    const displayNameLower = (n.displayName || '').toLowerCase();
    const specialtyLower = (n.specialty || '').toLowerCase();
    const crnLower = (n.crn || '').toLowerCase();

    const matchesSearch =
      displayNameLower.includes(searchLower) ||
      specialtyLower.includes(searchLower) ||
      crnLower.includes(searchLower);

    if (selectedCategory === 'todos') return matchesSearch;
    return matchesSearch && specialtyLower.includes((selectedCategory || '').toLowerCase());
  });

  const currentNutritionist = nutritionists.find((n) => n.id === patientData?.nutritionistId) ||
    (patientData?.nutritionistId ? {
      id: patientData.nutritionistId,
      displayName: patientData.nutritionistName || 'Nutricionista Responsável',
      email: patientData.nutritionistEmail || '',
      crn: patientData.nutritionistCRN || 'CRN Ativo',
      specialty: patientData.nutritionistSpecialty || 'Nutrição Clínica',
      photoURL: patientData.nutritionistPhoto || ''
    } : null);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-teal-600" />
        <p className="text-slate-600 font-medium text-sm">Carregando nutricionistas cadastrados...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-24">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200/60 pb-5">
        <div>
          <div className="flex items-center gap-2 text-teal-700 font-semibold text-xs uppercase tracking-wider mb-1">
            <Stethoscope className="w-4 h-4" /> Acompanhamento Profissional
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Meu Nutricionista</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Escolha ou consulte o nutricionista responsável pelo seu acompanhamento alimentar.
          </p>
        </div>

        {currentNutritionist && !isChanging && (
          <Button
            onClick={() => setIsChanging(true)}
            variant="outline"
            className="flex items-center gap-2 border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold"
          >
            <RefreshCw className="w-3.5 h-3.5 text-teal-600" />
            Trocar de Nutricionista
          </Button>
        )}
      </div>

      {/* Success Notification Banner */}
      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl flex items-center justify-between animate-in fade-in duration-300 shadow-sm">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
            <div>
              <p className="font-bold text-sm">{successMsg}</p>
              <p className="text-xs text-emerald-700">Seu perfil foi atualizado no sistema.</p>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 1: Current Linked Nutritionist (If patient has one and is not in changing mode) */}
      {currentNutritionist && !isChanging ? (
        <div className="space-y-6">
          <Card className="border-2 border-teal-500/30 bg-gradient-to-br from-teal-900/5 via-white to-emerald-900/5 shadow-md overflow-hidden relative">
            <div className="absolute top-0 right-0 bg-teal-700 text-white text-[11px] font-bold uppercase tracking-wider px-4 py-1.5 rounded-bl-xl flex items-center gap-1.5 shadow-sm">
              <ShieldCheck className="w-3.5 h-3.5" /> Nutricionista Vinculado
            </div>

            <CardContent className="p-6 sm:p-8">
              <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
                {/* Profile Avatar */}
                <div className="relative w-28 h-28 rounded-2xl overflow-hidden bg-slate-200 border-4 border-white shadow-md shrink-0 flex items-center justify-center">
                  {currentNutritionist.photoURL ? (
                    <Image
                      src={currentNutritionist.photoURL}
                      alt={currentNutritionist.displayName}
                      fill
                      className="object-cover"
                      referrerPolicy="no-referrer"
                      unoptimized
                    />
                  ) : (
                    <div className="w-full h-full bg-teal-700 text-white font-bold text-3xl flex items-center justify-center">
                      {currentNutritionist.displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Details */}
                <div className="flex-1 text-center md:text-left space-y-3">
                  <div>
                    <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mb-1">
                      <h2 className="text-xl font-bold text-slate-800">{currentNutritionist.displayName}</h2>
                      <Badge className="bg-teal-100 text-teal-800 hover:bg-teal-100 border-teal-200">
                        {currentNutritionist.crn || 'CRN Registrado'}
                      </Badge>
                    </div>
                    <p className="text-sm font-semibold text-teal-700 flex items-center justify-center md:justify-start gap-1.5">
                      <Award className="w-4 h-4" />
                      {currentNutritionist.specialty || 'Nutrição Clínica e Esportiva'}
                    </p>
                  </div>

                  {currentNutritionist.bio && (
                    <p className="text-xs text-slate-600 bg-white/60 p-3 rounded-xl border border-slate-100 italic">
                      &quot;{currentNutritionist.bio}&quot;
                    </p>
                  )}

                  <div className="pt-2 flex flex-wrap justify-center md:justify-start gap-4 text-xs text-slate-600">
                    {currentNutritionist.email && (
                      <div className="flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 text-teal-600" />
                        <span>{currentNutritionist.email}</span>
                      </div>
                    )}
                    {currentNutritionist.phone && (
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-teal-600" />
                        <span>{currentNutritionist.phone}</span>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="pt-4 flex flex-wrap justify-center md:justify-start gap-3">
                    <Link href="/patient/chat?tab=nutritionist">
                      <Button className="bg-teal-700 hover:bg-teal-800 text-white font-medium text-xs px-5 py-2.5 rounded-xl flex items-center gap-2 shadow-sm">
                        <MessageSquare className="w-4 h-4" />
                        Conversar no Chat com {currentNutritionist.displayName.split(' ')[0]}
                      </Button>
                    </Link>

                    <Button
                      onClick={() => setIsChanging(true)}
                      variant="outline"
                      className="border-slate-300 hover:bg-slate-100 text-slate-700 text-xs px-4 py-2.5 rounded-xl"
                    >
                      Escolher Outro Profissional
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        /* SECTION 2: List of Registered Nutritionists (For self-registered patients or when changing) */
        <div className="space-y-6">
          {/* Information Callout */}
          <div className="p-5 bg-teal-900/10 border border-teal-500/20 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-700 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5 sm:mt-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-sm">
                  {currentNutritionist ? 'Trocar de Nutricionista Responsável' : 'Selecione seu Nutricionista no Sistema'}
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Abaixo estão listados apenas os nutricionistas cadastrados no NutriAli. Ao escolher um profissional, seu plano alimentar e histórico serão acompanhados diretamente por ele.
                </p>
              </div>
            </div>

            {currentNutritionist && (
              <Button
                onClick={() => setIsChanging(false)}
                variant="ghost"
                className="text-xs text-slate-600 hover:text-slate-800 underline underline-offset-4 shrink-0"
              >
                Manter nutricionista atual
              </Button>
            )}
          </div>

          {/* Search & Filter Controls */}
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white/40 p-3 rounded-2xl border border-white/60 shadow-sm">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                type="text"
                placeholder="Buscar por nome, CRN ou especialidade..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-white text-xs text-slate-800 rounded-xl"
              />
            </div>

            <div className="flex gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
              {['todos', 'esportiva', 'emagrecimento', 'metabólica'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg capitalize transition-colors whitespace-nowrap ${
                    selectedCategory === cat
                      ? 'bg-teal-700 text-white shadow-sm'
                      : 'bg-white/60 text-slate-600 hover:bg-white/80'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Grid of Registered Nutritionists */}
          {filteredNutritionists.length === 0 ? (
            <div className="p-12 text-center bg-white/40 rounded-2xl border border-slate-200/60 space-y-3">
              <Stethoscope className="w-10 h-10 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold text-slate-700">Nenhum nutricionista encontrado</p>
              <p className="text-xs text-slate-500">Tente ajustar a busca por nome ou filtro de especialidade.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {filteredNutritionists.map((nutri) => {
                const isCurrent = currentNutritionist?.id === nutri.id;

                return (
                  <Card
                    key={nutri.id}
                    className={`transition-all hover:shadow-md ${
                      isCurrent
                        ? 'border-2 border-teal-500 bg-teal-50/20'
                        : 'border border-slate-200/80 bg-white'
                    }`}
                  >
                    <CardContent className="p-5 flex flex-col justify-between h-full space-y-4">
                      <div className="flex items-start gap-4">
                        {/* Avatar */}
                        <div className="w-16 h-16 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0 relative flex items-center justify-center">
                          {nutri.photoURL ? (
                            <Image
                              src={nutri.photoURL}
                              alt={nutri.displayName}
                              fill
                              className="object-cover"
                              referrerPolicy="no-referrer"
                              unoptimized
                            />
                          ) : (
                            <div className="w-full h-full bg-teal-700 text-white font-bold text-xl flex items-center justify-center">
                              {nutri.displayName.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>

                        {/* Nutritionist Info */}
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="font-bold text-slate-800 text-base truncate">{nutri.displayName}</h3>
                            {isCurrent && (
                              <Badge className="bg-teal-700 text-white text-[10px] shrink-0">
                                Atual
                              </Badge>
                            )}
                          </div>

                          <p className="text-xs font-semibold text-teal-700 flex items-center gap-1">
                            <Award className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{nutri.specialty || 'Nutrição Geral'}</span>
                          </p>

                          <p className="text-[11px] text-slate-500 font-mono">
                            {nutri.crn || 'CRN Registrado'}
                          </p>
                        </div>
                      </div>

                      {nutri.bio && (
                        <p className="text-xs text-slate-600 line-clamp-2 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                          {nutri.bio}
                        </p>
                      )}

                      {/* Footer Info & Action */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                        <div className="text-[11px] text-slate-500 truncate max-w-[180px]">
                          {nutri.email}
                        </div>

                        <Button
                          onClick={() => setModalNutritionist(nutri)}
                          disabled={isCurrent}
                          className={`text-xs font-semibold py-2 px-4 rounded-xl flex items-center gap-1.5 ${
                            isCurrent
                              ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                              : 'bg-teal-700 hover:bg-teal-800 text-white shadow-sm'
                          }`}
                        >
                          {isCurrent ? (
                            <>
                              <UserCheck className="w-3.5 h-3.5" />
                              Nutricionista Atual
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Contratar / Selecionar
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal */}
      {modalNutritionist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-slate-100 p-6 space-y-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-teal-100 text-teal-800 flex items-center justify-center shrink-0">
                <Stethoscope className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Confirmar Escolha</h3>
                <p className="text-xs text-slate-500">Acompanhamento Nutricional</p>
              </div>
            </div>

            <p className="text-sm text-slate-700">
              Deseja definir <strong>{modalNutritionist.displayName}</strong> ({modalNutritionist.crn || 'CRN Registrado'}) como seu nutricionista responsável no NutriAli?
            </p>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1">
              <div className="flex items-center gap-2">
                <Building className="w-3.5 h-3.5 text-teal-700" />
                <span>Especialidade: <strong>{modalNutritionist.specialty}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-teal-700" />
                <span>Contato: {modalNutritionist.email}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setModalNutritionist(null)}
                className="text-xs border-slate-200 text-slate-600"
                disabled={selectingId !== null}
              >
                Cancelar
              </Button>

              <Button
                onClick={handleConfirmSelect}
                disabled={selectingId !== null}
                className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold px-5 flex items-center gap-2"
              >
                {selectingId ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Vinculando...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Confirmar Seleção
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
