import React from "react";
import { AlertTriangle, X } from "lucide-react";
import {CarConflict} from '../../utils/carConflictHandler'
import { BackButton } from '../../ui/components'

interface Props {
  isOpen: boolean;
  conflicts: CarConflict[];
  onResolve: (resolution: 'keepOld' | 'acceptNew' | 'merge') => void;
  onClose: () => void;
}

export const CarConflictModal: React.FC<Props> = ({ isOpen, conflicts, onResolve, onClose }) => {
  if (!isOpen) return null;

  return (
    <div data-scroll-lock="modal" data-mobile-fullscreen className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-1 min-w-0">
            <BackButton onClose={onClose} />
            <div className="flex items-start gap-3 min-w-0">
              <div className="p-2 rounded-lg shrink-0 bg-amber-50 text-amber-600">
                <AlertTriangle className="w-4 h-4" aria-hidden="true" />
              </div>
              <h2 className="text-sm font-semibold text-[#121316] pt-0.5">Обнаружен конфликт данных</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="hidden md:inline-flex items-center justify-center min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 -mr-2 -mt-1 rounded-lg text-[#9CA3AF] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316] cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mb-4">
          {conflicts.map((c) => (
            <div key={c.field} className="mb-2">
              <strong>{c.field}:</strong> Старое значение: "{c.oldValue}", Новое: "{c.newValue}"
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={() => onResolve('keepOld')} className="px-4 py-2 bg-gray-200 rounded">Оставить старое</button>
          <button onClick={() => onResolve('acceptNew')} className="px-4 py-2 bg-[var(--accent)] text-[var(--accent-on)] rounded">Принять новое</button>
          <button onClick={() => onResolve('merge')} className="px-4 py-2 bg-[var(--accent-ui)] text-[var(--accent-on)] rounded">Объединить</button>
        </div>
      </div>
    </div>
  );
};