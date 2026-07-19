import React from 'react';

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`glass-card overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-6 border-b border-white/20 ${className}`}>{children}</div>;
}

export function CardTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <h3 className={`text-lg font-bold text-slate-800 ${className}`}>{children}</h3>;
}

export function CardContent({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-6 ${className}`}>{children}</div>;
}

export function Button({ 
  children, 
  onClick, 
  type = 'button',
  variant = 'primary',
  className = '',
  disabled = false
}: { 
  children: React.ReactNode; 
  onClick?: () => void; 
  type?: 'button' | 'submit' | 'reset';
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  className?: string;
  disabled?: boolean;
}) {
  const baseStyle = "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none px-4 py-2";
  const variants = {
    primary: "bg-teal-600 text-white hover:bg-teal-700 focus:ring-teal-500 shadow-md shadow-teal-600/20",
    secondary: "bg-white/40 text-teal-700 hover:bg-white/60 focus:ring-teal-500 shadow-sm border border-white/50",
    outline: "border border-white/50 bg-white/30 text-slate-700 hover:bg-white/50 focus:ring-teal-500",
    ghost: "text-slate-600 hover:bg-white/40 hover:text-slate-900 focus:ring-slate-500",
    danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-md shadow-red-600/20",
  };

  return (
    <button 
      type={type} 
      onClick={onClick} 
      disabled={disabled}
      className={`${baseStyle} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Input({
  id,
  label,
  type = 'text',
  placeholder,
  value,
  onChange,
  className = '',
  required = false
}: {
  id: string;
  label?: string;
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      {label && <label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}</label>}
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        required={required}
        className="w-full rounded-lg bg-white/80 border border-white/50 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 shadow-sm transition-shadow"
      />
    </div>
  );
}

export function Badge({ children, variant = 'default' }: { children: React.ReactNode, variant?: 'default' | 'success' | 'warning' }) {
  const variants = {
    default: "bg-white/40 border border-white/50 text-slate-700",
    success: "bg-teal-100 border border-teal-200 text-teal-800",
    warning: "bg-amber-100 border border-amber-200 text-amber-800"
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shadow-sm ${variants[variant]}`}>
      {children}
    </span>
  );
}
