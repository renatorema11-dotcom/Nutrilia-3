'use client';

import { useState, useEffect, useRef } from 'react';
import { Globe, Check, ChevronDown, Search, Sparkles } from 'lucide-react';

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
}

export const LANGUAGES: Language[] = [
  { code: 'pt', name: 'Português', nativeName: 'Português (Brasil)', flag: '🇧🇷' },
  { code: 'en', name: 'Inglês', nativeName: 'English (US)', flag: '🇺🇸' },
  { code: 'es', name: 'Espanhol', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Francês', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Alemão', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italiano', nativeName: 'Italiano', flag: '🇮🇹' },
  { code: 'zh-CN', name: 'Chinês', nativeName: '中文 (简体)', flag: '🇨🇳' },
  { code: 'ja', name: 'Japonês', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'ar', name: 'Árabe', nativeName: 'العربية', flag: '🇦🇪' },
  { code: 'ru', name: 'Russo', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'hi', name: 'Híndi', nativeName: 'हिन्दी', flag: '🇮🇳' },
];

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const nameEQ = name + '=';
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
}

function setGoogtransCookie(targetCode: string) {
  if (typeof window === 'undefined') return;
  const isDefault = targetCode === 'pt';
  const expires = isDefault ? 'Expires=Thu, 01 Jan 1970 00:00:01 GMT;' : '';
  const val = isDefault ? '' : `/pt/${targetCode}`;

  const host = window.location.hostname;

  // Set cookies on root path and domains silently
  const doc = document;
  doc.cookie = `googtrans=${val}; path=/; ${expires}`;
  if (host) {
    doc.cookie = `googtrans=${val}; path=/; domain=${host}; ${expires}`;
    doc.cookie = `googtrans=${val}; path=/; domain=.${host}; ${expires}`;
  }
}

export function LanguageSelector({ className = '' }: { className?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLang, setSelectedLang] = useState<Language>(LANGUAGES[0]);

  // Sync initial language from client storage after mount to prevent hydration mismatch
  useEffect(() => {
    const rawSaved = localStorage.getItem('app_language') || getCookie('googtrans')?.split('/')?.pop();
    if (rawSaved && typeof rawSaved === 'string') {
      const savedCode = rawSaved.toLowerCase();
      const found = LANGUAGES.find((l) => (l.code || '').toLowerCase() === savedCode);
      if (found) {
        setSelectedLang(found);
      }
    }
  }, []);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Initialize Google Translate
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const initWidget = () => {
      try {
        // @ts-ignore
        if (window.google && window.google.translate && window.google.translate.TranslateElement) {
          if (!document.querySelector('.goog-te-combo')) {
            // @ts-ignore
            new window.google.translate.TranslateElement(
              {
                pageLanguage: 'pt',
                includedLanguages: LANGUAGES.map((l) => l.code).join(','),
                autoDisplay: false,
              },
              'google_translate_element'
            );
          }
        }
      } catch (err) {
        console.warn('Google translate init warning:', err);
      }
    };

    // @ts-ignore
    window.googleTranslateElementInit = initWidget;

    if (!document.getElementById('google-translate-script')) {
      const script = document.createElement('script');
      script.id = 'google-translate-script';
      script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
      script.async = true;
      script.onerror = () => {
        console.warn('Google translate script failed to load.');
      };
      document.body.appendChild(script);
    } else {
      initWidget();
    }

    // Check if we need to apply saved language to combo once loaded & continuously hide banner
    const checkTimer = setInterval(() => {
      if (typeof document !== 'undefined') {
        document.body.style.top = '0px';
        
        // Hide Google top banner elements if injected
        const bannerFrames = document.querySelectorAll<HTMLElement>(
          '.goog-te-banner-frame, iframe.goog-te-banner-frame, iframe[id*=":1.container"], iframe[src*="translate.google"]'
        );
        bannerFrames.forEach((frame) => {
          if (!frame.closest('#google_translate_element')) {
            frame.style.display = 'none';
            frame.style.visibility = 'hidden';
            frame.style.height = '0px';
            frame.style.width = '0px';
            frame.style.opacity = '0';
            frame.style.pointerEvents = 'none';
          }
        });

        const selectEl = document.querySelector('.goog-te-combo') as HTMLSelectElement;
        if (selectEl && selectedLang.code !== 'pt' && selectEl.value !== selectedLang.code) {
          selectEl.value = selectedLang.code;
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }, 400);

    return () => clearInterval(checkTimer);
  }, [selectedLang.code]);

  const changeLanguage = (lang: Language) => {
    setSelectedLang(lang);
    setIsOpen(false);
    setSearchQuery('');
    if (typeof window !== 'undefined') {
      localStorage.setItem('app_language', lang.code);
    }

    setGoogtransCookie(lang.code);

    // Trigger update in google translate combo if available
    const selectEl = document.querySelector('.goog-te-combo') as HTMLSelectElement;
    if (selectEl) {
      selectEl.value = lang.code;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      selectEl.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Force page reload if combo isn't attached yet so cookie takes effect
      window.location.reload();
    }
  };

  const queryLower = (searchQuery || '').toLowerCase();
  const filteredLanguages = LANGUAGES.filter(
    (l) =>
      (l.name || '').toLowerCase().includes(queryLower) ||
      (l.nativeName || '').toLowerCase().includes(queryLower) ||
      (l.code || '').toLowerCase().includes(queryLower)
  );

  return (
    <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
      {/* Hidden Google Translate container - completely invisible */}
      <div
        id="google_translate_element"
        className="absolute opacity-0 pointer-events-none w-0 h-0 overflow-hidden"
        aria-hidden="true"
      />

      {/* Styled Language Selector Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="group inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/90 hover:bg-white border border-slate-200/90 hover:border-teal-500/40 shadow-sm hover:shadow-md text-slate-700 hover:text-teal-900 transition-all duration-200 text-xs font-semibold cursor-pointer backdrop-blur-md"
        aria-label="Selecionar Idioma"
      >
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 group-hover:bg-teal-50 text-sm leading-none shrink-0 transition-colors">
          {selectedLang.flag}
        </span>
        <span className="tracking-tight text-slate-800 group-hover:text-teal-900 font-medium">
          {selectedLang.name}
        </span>
        <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase bg-slate-100 px-1.5 py-0.5 rounded-md group-hover:bg-teal-100/60 group-hover:text-teal-700 transition-colors">
          {selectedLang.code.split('-')[0]}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 group-hover:text-teal-600 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-teal-600' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-white/95 backdrop-blur-xl shadow-2xl border border-slate-100 p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="px-3 py-2 flex items-center justify-between border-b border-slate-100/80 mb-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-teal-50 flex items-center justify-center text-teal-600">
                <Globe className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-bold text-slate-800 tracking-tight">Idioma do Sistema</span>
            </div>
            <Sparkles className="w-3.5 h-3.5 text-teal-500/60" />
          </div>

          {/* Quick Filter Search */}
          <div className="relative px-1 mb-2">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar idioma..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 focus:bg-white border border-slate-200/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-slate-700 placeholder-slate-400 transition-all"
            />
          </div>

          {/* Language Options List */}
          <div className="max-h-60 overflow-y-auto px-0.5 space-y-1 custom-scrollbar">
            {filteredLanguages.length > 0 ? (
              filteredLanguages.map((lang) => {
                const isSelected = selectedLang.code === lang.code;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => changeLanguage(lang)}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-teal-500/10 text-teal-900 font-semibold border border-teal-500/20 shadow-xs'
                        : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900 font-normal'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-base leading-none shrink-0">{lang.flag}</span>
                      <div className="flex flex-col items-start truncate">
                        <span className="truncate leading-tight">{lang.name}</span>
                        <span className="text-[10px] text-slate-400 font-normal truncate">
                          {lang.nativeName}
                        </span>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-teal-600 flex items-center justify-center shrink-0 ml-2 shadow-xs">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </button>
                );
              })
            ) : (
              <div className="py-4 text-center text-xs text-slate-400">Nenhum idioma encontrado</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
