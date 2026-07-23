import React from "react";
import {CarConflict} from '../../utils/carConflictHandler'

interface Props {
  isOpen: boolean;
  conflicts: CarConflict[];
  onResolve: (resolution: 'keepOld' | 'acceptNew' | 'merge') => void;
  onClose: () => void;
}

export const CarConflictModal: React.FC<Props> = ({ isOpen, conflicts, onResolve, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full">
        <h2 className="text-xl font-semibold mb-4">Обнаружен конфликт данных</h2>
        <div className="mb-4">
          {conflicts.map((c) => (
            <div key={c.field} className="mb-2">
              <strong>{c.field}:</strong> Старое значение: "{c.oldValue}", Новое: "{c.newValue}"
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={() => onResolve('keepOld')} className="px-4 py-2 bg-gray-200 rounded">Оставить старое</button>
          <button onClick={() => onResolve('acceptNew')} className="px-4 py-2 bg-blue-600 text-white rounded">Принять новое</button>
          <button onClick={() => onResolve('merge')} className="px-4 py-2 bg-green-600 text-white rounded">Объединить</button>
        </div>
      </div>
    </div>
  );
};
