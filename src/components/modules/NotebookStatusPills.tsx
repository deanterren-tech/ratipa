import React from 'react';

type NoteStatus = 'baza' | 'reis' | 'none';

interface NotebookStatusPillsProps {
  status?: NoteStatus;
  onChange: (status: NoteStatus) => void;
}

const LABELS: Record<NoteStatus, string> = {
  baza: 'На базе',
  reis: 'В рейсе',
  none: 'Без статуса',
};

/**
 * Пилот декомпозиции: вынесен из PlanDohodModule (блок статусов авто в блокноте).
 * Чисто презентационный — только рисует 3 кнопки, вызывает onChange.
 */
export default function NotebookStatusPills({ status, onChange }: NotebookStatusPillsProps) {
  const active = status || 'none';
  return (
    <div className="flex bg-slate-50 border border-slate-200/50 p-0.5 rounded-lg text-[9px] font-semibold w-full select-none">
      {(['baza', 'reis', 'none'] as NoteStatus[]).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={`flex-1 py-0.5 text-center rounded-md transition cursor-pointer text-[9px] ${
            active === s
              ? s === 'baza'
                ? 'bg-emerald-500 text-white shadow-sm font-bold'
                : s === 'reis'
                  ? 'bg-sky-500 text-white shadow-sm font-bold'
                  : 'bg-white text-slate-600 border border-slate-200/40 shadow-sm font-bold'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          {LABELS[s]}
        </button>
      ))}
    </div>
  );
}
