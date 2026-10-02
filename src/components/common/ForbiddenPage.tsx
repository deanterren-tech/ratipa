import React from 'react';
import { ShieldX } from 'lucide-react';

interface ForbiddenPageProps {
  onNavigate?: (module: string) => void;
}

export default function ForbiddenPage({ onNavigate }: ForbiddenPageProps) {
  return (
    <div className="w-full h-full min-h-[60vh] flex items-center justify-center p-6 select-none">
      <div className="max-w-sm w-full flex flex-col items-center text-center gap-5">
        <div className="w-20 h-20 rounded-2xl bg-rose-50 border border-rose-200/60 flex items-center justify-center shadow-sm">
          <ShieldX size={36} className="text-rose-400" strokeWidth={1.5} />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">Нет доступа</h2>
          <p className="text-xs text-slate-400 font-medium leading-relaxed max-w-xs">
            У вашей учётной записи нет прав для просмотра этого раздела.
            Обратитесь к администратору для получения доступа.
          </p>
        </div>
        {onNavigate && (
          <button
            onClick={() => onNavigate('dashboard')}
            className="inline-flex items-center gap-2 px-5 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-sm transition cursor-pointer"
          >
            На главную
          </button>
        )}
      </div>
    </div>
  );
}