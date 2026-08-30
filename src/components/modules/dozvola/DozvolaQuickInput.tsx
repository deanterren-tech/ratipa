import React, { useState } from 'react'
import { UserProfile } from '../../../types'
import { useFirebase, database } from '../../../firebase'
import { ref, push, set } from 'firebase/database'
import { Sparkles, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import DozvolaAIAssistant from './DozvolaAIAssistant'

interface DozvolaQuickInputProps {
  user: UserProfile;
  dozvolsData: Record<string, any>;
  customTypesOrder: string[];
  customTypes: Record<string, any>;
  knownFleetCars: Record<string, any>;
  onOpenEditPermit?: (item: any, prefilledChanges?: any) => void;
}

export default function DozvolaQuickInput({
  user,
  dozvolsData,
  customTypesOrder,
  customTypes,
  knownFleetCars,
  onOpenEditPermit,
}: DozvolaQuickInputProps) {
  const [quickText, setQuickText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const logAction = (type: string, number: string, action: string, meta: string) => {
    if (!useFirebase) return;
    const logist = localStorage.getItem('ratipa_auth_user') || "Система";
    push(ref(database, 'dozvolsHistoryV4'), {
      time: new Date().toLocaleString("ru-RU"),
      logist,
      doc: `${type} №${number}`,
      action,
      meta
    });
  };

  const handleQuickAdd = async () => {
    const text = quickText.trim();
    if (!text) return;

    setIsProcessing(true);

    // Extract numbers: sequences of 3-8 digits, separated by space/comma/newline
    const numbers = text
      .split(/[\s,;]+/)
      .map(n => n.trim())
      .filter(n => n && /^\d{3,8}$/.test(n));

    if (numbers.length === 0) {
      setIsProcessing(false);
      return;
    }

    const type = customTypesOrder.length > 0
      ? (customTypes[customTypesOrder[0]]?.name || "RUS")
      : "RUS";

    let addedCount = 0;
    for (const num of numbers) {
      // Check if already exists
      const exists = Object.values(dozvolsData).some((d: any) => {
        const dbNum = String(d.number || d.permitNumber || '').replace(/[^0-9]/g, '');
        return dbNum === num;
      });
      if (exists) continue;

      if (useFirebase) {
        const newKey = push(ref(database, 'dozvolsRegistryV4')).key;
        if (newKey) {
          await set(ref(database, `dozvolsRegistryV4/${newKey}`), {
            id: newKey,
            type,
            number: num,
            status: "office",
            issueDate: new Date().toISOString().split('T')[0],
            car: "",
            comment: "Быстрый ввод",
            isCopy: false,
          });
          logAction(type, num, "Быстрый ввод", `Статус: В офисе`);
          addedCount++;
        }
      }
    }

    setQuickText('');
    setIsProcessing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleQuickAdd();
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/50 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3">
        <Sparkles className="h-4 w-4 text-[#3765F6] shrink-0" />
        <input
          type="text"
          value={quickText}
          onChange={(e) => setQuickText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Быстрый ввод: вставьте список номеров дозволов"
          disabled={isProcessing}
          className="flex-1 bg-slate-50/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition disabled:opacity-50"
        />
        {isProcessing ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400 shrink-0" />
        ) : (
          <button
            onClick={handleQuickAdd}
            className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-4 min-h-[36px] py-2 rounded-xl transition shadow-xs cursor-pointer shrink-0"
          >
            Добавить
          </button>
        )}
        {user.permissions.dozvola === "write" && (
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition cursor-pointer shrink-0"
            title="Расширенный режим"
          >
            {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Расширенный</span>
          </button>
        )}
      </div>
      {showAdvanced && (
        <div className="border-t border-slate-100">
          <DozvolaAIAssistant
            user={user}
            dozvolsData={dozvolsData}
            customTypesOrder={customTypesOrder}
            customTypes={customTypes}
            knownFleetCars={knownFleetCars}
            onOpenEditPermit={onOpenEditPermit}
          />
        </div>
      )}
    </div>
  );
}