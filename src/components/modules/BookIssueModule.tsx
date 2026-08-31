import { UserProfile } from "../../types";
import { BookOpen } from "lucide-react";

export default function BookIssueModule({ user }: { user: UserProfile }) {
  return (
    <div className="w-full h-full min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-sm w-full flex flex-col items-center text-center gap-5 select-none">
        {/* Icon */}
        <div className="w-20 h-20 rounded-2xl bg-slate-100 border border-slate-200/60 flex items-center justify-center shadow-sm">
          <BookOpen size={36} className="text-slate-400" strokeWidth={1.5} />
        </div>

        {/* Title */}
        <div className="space-y-1.5">
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            Книга выдачи
          </h2>
          <p className="text-xs text-slate-400 font-medium leading-relaxed max-w-xs">
            Модуль находится в разработке. Здесь будет таблица учёта выдачи
            документов, ключей и материальных ценностей.
          </p>
        </div>

        {/* Development badge */}
        <div className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-50 border border-amber-200/60 rounded-xl text-xs font-semibold text-amber-700">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
          </span>
          В разработке
        </div>
      </div>
    </div>
  );
}