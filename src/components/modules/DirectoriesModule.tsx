import React, { useState, useEffect, useMemo } from 'react';
import { useDialog } from '../DialogProvider';
import { useToast } from '../ToastProvider';
import { dbService, directoryService } from '../../firebase';
import { BookOpen, Plus, Trash2, Save, X } from 'lucide-react';
import { UserProfile } from '../../types';

interface DirectoriesModuleProps {
  user: UserProfile;
}

type DirKey = 'vehicleBrands' | 'trailerBrands' | 'dispatchers' | 'rateGroups' | 'statusTypes' | 'directions';

const TABS: { key: DirKey; label: string; fields: { f: string; label: string; ph?: string }[]; idField: string; nameField: string }[] = [
  { key: 'vehicleBrands', label: 'Марки тягачей', idField: 'key', nameField: 'name',
    fields: [{ f: 'name', label: 'Название', ph: 'Mercedes' }] },
  { key: 'trailerBrands', label: 'Марки прицепов', idField: 'key', nameField: 'name',
    fields: [{ f: 'name', label: 'Название', ph: 'Kögel' }] },
  { key: 'dispatchers', label: 'Диспетчеры', idField: 'id', nameField: 'name',
    fields: [{ f: 'name', label: 'Имя', ph: 'Сергей' }, { f: 'color', label: 'Цвет (hex)', ph: '#70FC8E' }] },
  { key: 'rateGroups', label: 'Группы ставок', idField: 'id', nameField: 'name',
    fields: [
      { f: 'name', label: 'Название', ph: 'Стандарт' },
      { f: 'rate', label: 'Ставка €/км', ph: '0.125' },
      { f: 'perDiemRate', label: 'Суточные €', ph: '35' },
      { f: 'comment', label: 'Коммент', ph: '' },
    ] },
  { key: 'statusTypes', label: 'Статусы', idField: 'id', nameField: 'label',
    fields: [
      { f: 'label', label: 'Название', ph: 'На базе' },
      { f: 'color', label: 'Цвет', ph: '#22c55e' },
      { f: 'category', label: 'Категория', ph: 'park|trip|archive' },
    ] },
  { key: 'directions', label: 'Направления', idField: 'id', nameField: 'label',
    fields: [{ f: 'label', label: 'Название', ph: 'RUS-BY' }] },
];

export default function DirectoriesModule({ user }: DirectoriesModuleProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<DirKey>('vehicleBrands');
  const [items, setItems] = useState<any[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const tab = useMemo(() => TABS.find((t) => t.key === activeTab)!, [activeTab]);

  useEffect(() => {
    const getter = {
      vehicleBrands: directoryService.getVehicleBrands,
      trailerBrands: directoryService.getTrailerBrands,
      dispatchers: directoryService.getDispatchers,
      rateGroups: directoryService.getRateGroups,
      statusTypes: directoryService.getStatusTypes,
      directions: directoryService.getDirections,
    }[activeTab];
    const unsub = getter((list: any[]) => setItems(list || []));
    return unsub;
  }, [activeTab]);

  const resetDraft = () => setDraft({});

  const handleSave = () => {
    const rec: any = { ...draft };
    // normalize numeric fields
    if (tab.key === 'rateGroups') {
      rec.rate = parseFloat(rec.rate || '0') || 0;
      rec.perDiemRate = rec.perDiemRate ? parseFloat(rec.perDiemRate) : null;
    }
    const idVal = (rec[tab.idField] || '').toString().trim();
    if (!idVal && tab.idField === 'key') {
      rec.key = (rec.name || '').toString().toUpperCase().replace(/\s+/g, '_');
    } else if (!idVal) {
      rec[tab.idField] = 'dir_' + Date.now().toString();
    }
    directoryService.saveDirItem(tab.key, rec, user.name, user.role);
    toast('Сохранено в справочник', 'success');
    resetDraft();
  };

  const handleDelete = async (it: any) => {
    const idv = it[tab.idField] || it.id;
    if (await showConfirm(`Удалить «${it[tab.nameField] || idv}» из справочника?`)) {
      directoryService.deleteDirItem(tab.key, idv, user.name, user.role);
      toast('Удалено', 'success');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <BookOpen className="w-5 h-5 text-[#3765F6]" />
          <h1 className="text-lg font-bold text-slate-800">Справочники</h1>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setActiveTab(t.key); resetDraft(); }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === t.key
                  ? 'bg-[#3765F6] text-white shadow'
                  : 'bg-white/70 text-slate-600 hover:bg-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Add form */}
        <div className="bg-white/80 backdrop-blur rounded-2xl border border-slate-200/50 p-4 mb-4 shadow-sm">
          <div className="text-[11px] font-bold text-slate-500 uppercase mb-2">Добавить / изменить</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {tab.fields.map((f) => (
              <input
                key={f.f}
                value={draft[f.f] || ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.f]: e.target.value }))}
                placeholder={f.label}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 outline-none focus:border-[#3765F6]"
              />
            ))}
          </div>
          <button
            onClick={handleSave}
            className="mt-3 inline-flex items-center gap-1.5 bg-[#3765F6] text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-[#2a4fd0]"
          >
            <Save className="w-3.5 h-3.5" /> Сохранить
          </button>
        </div>

        {/* List */}
        <div className="bg-white/80 backdrop-blur rounded-2xl border border-slate-200/50 overflow-hidden shadow-sm">
          <div className="divide-y divide-slate-100">
            {items.length === 0 && (
              <div className="p-6 text-center text-xs text-slate-400">Пусто</div>
            )}
            {items.map((it) => (
              <div key={it[tab.idField] || it.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800 truncate">
                    {it[tab.nameField] || it[tab.idField]}
                  </div>
                  {tab.key === 'rateGroups' && (
                    <div className="text-[10px] text-slate-400">
                      €{it.rate}/км{it.perDiemRate ? ` · суточные €${it.perDiemRate}` : ''}
                    </div>
                  )}
                  {tab.key === 'dispatchers' && it.color && (
                    <span className="inline-block w-3 h-3 rounded-full mt-1" style={{ background: it.color }} />
                  )}
                </div>
                <button
                  onClick={() => handleDelete(it)}
                  className="text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
