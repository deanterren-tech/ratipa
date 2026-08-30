import React from 'react';
import { FileQuestion, ArrowLeft } from 'lucide-react';

interface NotFoundPageProps {
  onNavigate?: (module: string) => void;
}

export default function NotFoundPage({ onNavigate }: NotFoundPageProps) {
  return (
    <div className="w-full h-full min-h-[60vh] flex items-center justify-center p-6 select-none">
      <div className="max-w-sm w-full flex flex-col items-center text-center gap-5">
        {/* Icon */}
        <div className="w-20 h-20 rounded-2xl bg-slate-100 border border-slate-200/60 flex items-center justify-center shadow-sm">
          <FileQuestion size={36} className="text-slate-400" strokeWidth={1.5} />
        </div>

        {/* Title */}
        <div className="space-y-1.5">
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            Страница не найдена
          </h2>
          <p className="text-xs text-slate-400 font-medium leading-relaxed max-w-xs">
            Модуль с таким адресом не существует или был перемещён.
            Проверьте правильность ссылки или вернитесь на главную.
          </p>
        </div>

        {/* Action */}
        {onNavigate && (
          <button
            onClick={() => onNavigate('dashboard')}
            className="inline-flex items-center gap-2 px-5 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-sm transition cursor-pointer border border-transparent"
          >
            <ArrowLeft size={14} strokeWidth={2} />
            <span>На главную</span>
          </button>
        )}
      </div>
    </div>
  );
}