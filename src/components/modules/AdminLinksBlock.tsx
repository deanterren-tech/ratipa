import React, {useState, useRef} from 'react'
import {UserProfile, AppSettings, QuickLink, ExternalTab, CurrentPlanningTab, PlanZagruzokTab} from '../../types'
import {ExternalLink, Link, Plus, X, Check, Globe, GripVertical, Table2, FileSpreadsheet} from 'lucide-react'

interface Props {
  user: UserProfile;
  settings: AppSettings | null;
  onSave: (s: AppSettings) => void;
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function DragHandle() {
  return (
    <div className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 p-0.5 rounded transition shrink-0">
      <GripVertical className="w-3.5 h-3.5" />
    </div>
  );
}

export default function AdminLinksBlock({ user, settings, onSave }: Props) {
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [editingLinkTitle, setEditingLinkTitle] = useState('');
  const [editingLinkUrl, setEditingLinkUrl] = useState('');
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // External tabs
  const [extTitle, setExtTitle] = useState('');
  const [extUrl, setExtUrl] = useState('');
  const [editingExtId, setEditingExtId] = useState<string | null>(null);
  const [editingExtTitle, setEditingExtTitle] = useState('');
  const [editingExtUrl, setEditingExtUrl] = useState('');

  // Current Planning tabs
  const [cpTitle, setCpTitle] = useState('');
  const [cpUrl, setCpUrl] = useState('');
  const [editingCpId, setEditingCpId] = useState<string | null>(null);
  const [editingCpTitle, setEditingCpTitle] = useState('');
  const [editingCpUrl, setEditingCpUrl] = useState('');

  // Plan Zagruzok tabs
  const [pzTitle, setPzTitle] = useState('');
  const [pzUrl, setPzUrl] = useState('');
  const [editingPzId, setEditingPzId] = useState<string | null>(null);
  const [editingPzTitle, setEditingPzTitle] = useState('');
  const [editingPzUrl, setEditingPzUrl] = useState('');

  const isWritePermitted = user.role === 'admin' || user.role === 'root_admin' || user.permissions?.settings === 'write';

  // --- Drag handlers ---
  const onDragStart = (idx: number) => setDragIdx(idx);
  const onDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    // Visual feedback would require re-render — we just move on drop
    (e.currentTarget as HTMLElement).style.borderTop = '2px solid #3765F6';
  };
  const onDragLeave = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.borderTop = '';
  };
  const onDrop = <T,>(e: React.DragEvent, toIdx: number, list: T[], setter: (list: T[]) => void) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).style.borderTop = '';
    if (dragIdx === null || dragIdx === toIdx) return;
    setter(moveItem(list, dragIdx, toIdx));
    setDragIdx(null);
  };
  const onDragEnd = () => setDragIdx(null);

  // Quick Links handlers
  const handleAddLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkTitle || !linkUrl || !settings) return;
    const newLink: QuickLink = {
      id: "link_" + Date.now(),
      title: linkTitle.trim(),
      url: linkUrl.trim()
    };
    onSave({ ...settings, quickLinks: [...(settings.quickLinks || []), newLink] });
    setLinkTitle('');
    setLinkUrl('');
  };

  const handleDeleteLink = (id: string) => {
    if (!settings) return;
    onSave({ ...settings, quickLinks: (settings.quickLinks || []).filter(l => l.id !== id) });
  };

  const handleStartEditLink = (link: QuickLink) => {
    setEditingLinkId(link.id);
    setEditingLinkTitle(link.title);
    setEditingLinkUrl(link.url);
  };

  const handleSaveEditLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLinkId || !editingLinkTitle || !editingLinkUrl || !settings) return;
    const updated = (settings.quickLinks || []).map(l =>
      l.id === editingLinkId ? { ...l, title: editingLinkTitle.trim(), url: editingLinkUrl.trim() } : l
    );
    onSave({ ...settings, quickLinks: updated });
    setEditingLinkId(null);
    setEditingLinkTitle('');
    setEditingLinkUrl('');
  };

  const handleReorderLinks = (reordered: QuickLink[]) => {
    if (!settings) return;
    onSave({ ...settings, quickLinks: reordered });
  };

  // External Tabs handlers
  const handleAddExt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!extTitle || !extUrl || !settings) return;
    const newTab = { id: "ext_" + Date.now(), title: extTitle.trim(), url: extUrl.trim() };
    onSave({ ...settings, externalTabs: [...(settings.externalTabs || []), newTab] });
    setExtTitle('');
    setExtUrl('');
  };

  const handleDeleteExt = (id: string) => {
    if (!settings) return;
    onSave({ ...settings, externalTabs: (settings.externalTabs || []).filter(t => t.id !== id) });
  };

  const handleStartEditExt = (tab: ExternalTab) => {
    setEditingExtId(tab.id);
    setEditingExtTitle(tab.title);
    setEditingExtUrl(tab.url);
  };

  const handleSaveEditExt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingExtId || !editingExtTitle || !editingExtUrl || !settings) return;
    const updated = (settings.externalTabs || []).map(t =>
      t.id === editingExtId ? { ...t, title: editingExtTitle.trim(), url: editingExtUrl.trim() } : t
    );
    onSave({ ...settings, externalTabs: updated });
    setEditingExtId(null);
    setEditingExtTitle('');
    setEditingExtUrl('');
  };

  const handleReorderExt = (reordered: ExternalTab[]) => {
    if (!settings) return;
    onSave({ ...settings, externalTabs: reordered });
  };

  // Current Planning Tabs handlers
  const handleAddCp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cpTitle || !cpUrl || !settings) return;
    const newTab: CurrentPlanningTab = { id: "cp_" + Date.now(), name: cpTitle.trim(), sheetUrl: cpUrl.trim() };
    onSave({ ...settings, currentPlanningTabs: [...(settings.currentPlanningTabs || []), newTab] });
    setCpTitle('');
    setCpUrl('');
  };

  const handleDeleteCp = (id: string) => {
    if (!settings) return;
    onSave({ ...settings, currentPlanningTabs: (settings.currentPlanningTabs || []).filter(t => t.id !== id) });
  };

  const handleReorderCp = (reordered: CurrentPlanningTab[]) => {
    if (!settings) return;
    onSave({ ...settings, currentPlanningTabs: reordered });
  };

  // Plan Zagruzok Tabs handlers
  const handleAddPz = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pzTitle || !pzUrl || !settings) return;
    const newTab: PlanZagruzokTab = { id: "pz_" + Date.now(), name: pzTitle.trim(), sheetUrl: pzUrl.trim() };
    onSave({ ...settings, planZagruzokTabs: [...(settings.planZagruzokTabs || []), newTab] });
    setPzTitle('');
    setPzUrl('');
  };

  const handleDeletePz = (id: string) => {
    if (!settings) return;
    onSave({ ...settings, planZagruzokTabs: (settings.planZagruzokTabs || []).filter(t => t.id !== id) });
  };

  const handleReorderPz = (reordered: PlanZagruzokTab[]) => {
    if (!settings) return;
    onSave({ ...settings, planZagruzokTabs: reordered });
  };

  const draggableRow = (idx: number) => ({
    draggable: true,
    onDragStart: () => onDragStart(idx),
    onDragOver: (e: React.DragEvent) => onDragOver(e, idx),
    onDragLeave,
    onDrop: (e: React.DragEvent) => isWritePermitted ? null : null,
    onDragEnd,
  });

  return (
    <div className="space-y-6">
      {/* Quick Links */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm space-y-4 w-full select-none">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-sm font-bold uppercase tracking-tight text-slate-900 flex items-center gap-1.5">
            <Link className="h-4.5 w-4.5 text-slate-500" />
            Виджет быстрых ссылок на Dashboard
          </h2>
          <p className="text-[10px] text-slate-500 font-medium mt-1">
            Ссылки отображаются на главной панели под блоком новостей
          </p>
        </div>

        {isWritePermitted && (
          <form onSubmit={handleAddLink} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-slate-50/50 p-3 rounded-xl border border-slate-200">
            <input type="text" placeholder="Название" required
              value={linkTitle} onChange={e => setLinkTitle(e.target.value)}
              className="px-3 py-2.5 bg-white text-xs rounded-xl border border-slate-200 outline-none focus:border-slate-300 font-bold text-slate-800 transition"
            />
            <input type="url" placeholder="https://..." required
              value={linkUrl} onChange={e => setLinkUrl(e.target.value)}
              className="px-3 py-2.5 bg-white text-xs rounded-xl border border-slate-200 outline-none focus:border-slate-300 font-bold text-slate-800 transition"
            />
            <button type="submit"
              className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm active:scale-95 py-2.5 flex items-center justify-center gap-1.5"
            >
              <Plus size={13} strokeWidth={2.5} /> Добавить
            </button>
          </form>
        )}

        <div className="space-y-1.5 max-h-[250px] overflow-y-auto custom-scrollbar">
          {settings?.quickLinks?.map((link, idx) => {
            const isEditing = editingLinkId === link.id;
            if (isEditing) {
              return (
                <form key={link.id} onSubmit={handleSaveEditLink}
                  className="flex flex-col sm:flex-row gap-1.5 bg-slate-100 p-2 rounded-xl border border-slate-300"
                >
                  <input type="text" value={editingLinkTitle} required
                    onChange={e => setEditingLinkTitle(e.target.value)}
                    className="p-1.5 bg-white text-xs rounded border border-slate-200 font-bold flex-1"
                  />
                  <input type="url" value={editingLinkUrl} required
                    onChange={e => setEditingLinkUrl(e.target.value)}
                    className="p-1.5 bg-white text-xs rounded border border-slate-200 flex-1"
                  />
                  <div className="flex gap-1 justify-end">
                    <button type="submit" className="text-emerald-600 p-1.5 hover:bg-emerald-50 rounded-lg cursor-pointer"><Check size={14} /></button>
                    <button type="button" onClick={() => setEditingLinkId(null)}
                      className="text-slate-400 p-1.5 hover:bg-slate-200 rounded-lg cursor-pointer"><X size={14} /></button>
                  </div>
                </form>
              );
            }
            return (
              <div key={link.id}
                {...draggableRow(idx)}
                onDrop={(e) => { e.preventDefault(); if (dragIdx === null || dragIdx === idx || !settings) return; onSave({ ...settings, quickLinks: moveItem(settings.quickLinks!, dragIdx, idx) }); setDragIdx(null); }}
                className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white border transition group ${dragIdx === idx ? 'border-[#3765F6] ring-2 ring-[#3765F6]/10' : 'border-slate-200/60 hover:border-slate-300'}`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <DragHandle />
                  <ExternalLink size={12} className="text-slate-400 shrink-0" />
                  <a href={link.url} target="_blank" rel="noopener noreferrer"
                    className="text-xs font-semibold text-slate-700 hover:text-slate-900 truncate max-w-[200px] transition"
                  >{link.title}</a>
                </div>
                {isWritePermitted && (
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => handleStartEditLink(link)}
                      className="text-slate-400 hover:text-slate-700 p-1 hover:bg-slate-100 rounded-lg cursor-pointer transition" title="Редактировать">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                    </button>
                    <button onClick={() => handleDeleteLink(link.id)}
                      className="text-slate-400 hover:text-rose-600 p-1 hover:bg-rose-50 rounded-lg cursor-pointer transition" title="Удалить">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {(!settings?.quickLinks || settings.quickLinks.length === 0) && (
            <div className="text-[10px] uppercase font-bold tracking-widest text-slate-400 text-center py-6">Нет ссылок</div>
          )}
        </div>
      </div>

      {/* External Tabs */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm space-y-4 w-full select-none">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-sm font-bold uppercase tracking-tight text-slate-900 flex items-center gap-1.5">
            <Globe className="h-4.5 w-4.5 text-slate-500" />
            Кастомные меню-вкладки на внешние сайты
          </h2>
          <p className="text-[10px] text-slate-500 font-medium mt-1">
            Отображаются в верхнем навигационном меню RATIPA
          </p>
        </div>

        {isWritePermitted && (
          <form onSubmit={handleAddExt} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-slate-50/50 p-3 rounded-xl border border-slate-200">
            <input type="text" placeholder="Название" required
              value={extTitle} onChange={e => setExtTitle(e.target.value)}
              className="px-3 py-2.5 bg-white text-xs rounded-xl border border-slate-200 outline-none focus:border-slate-300 font-bold text-slate-800 transition"
            />
            <input type="url" placeholder="https://..." required
              value={extUrl} onChange={e => setExtUrl(e.target.value)}
              className="px-3 py-2.5 bg-white text-xs rounded-xl border border-slate-200 outline-none focus:border-slate-300 font-bold text-slate-800 transition"
            />
            <button type="submit"
              className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm active:scale-95 py-2.5 flex items-center justify-center gap-1.5"
            >
              <Plus size={13} strokeWidth={2.5} /> Добавить
            </button>
          </form>
        )}

        <div className="space-y-1.5 max-h-[250px] overflow-y-auto custom-scrollbar">
          {(settings?.externalTabs || []).map((tab, idx) => {
            const isEditing = editingExtId === tab.id;
            if (isEditing) {
              return (
                <form key={tab.id} onSubmit={handleSaveEditExt}
                  className="flex flex-col sm:flex-row gap-1.5 bg-slate-100 p-2 rounded-xl border border-slate-300"
                >
                  <input type="text" value={editingExtTitle} required
                    onChange={e => setEditingExtTitle(e.target.value)}
                    className="p-1.5 bg-white text-xs rounded border border-slate-200 font-bold flex-1"
                  />
                  <input type="url" value={editingExtUrl} required
                    onChange={e => setEditingExtUrl(e.target.value)}
                    className="p-1.5 bg-white text-xs rounded border border-slate-200 flex-1"
                  />
                  <div className="flex gap-1 justify-end">
                    <button type="submit" className="text-emerald-600 p-1.5 hover:bg-emerald-50 rounded-lg cursor-pointer"><Check size={14} /></button>
                    <button type="button" onClick={() => setEditingExtId(null)}
                      className="text-slate-400 p-1.5 hover:bg-slate-200 rounded-lg cursor-pointer"><X size={14} /></button>
                  </div>
                </form>
              );
            }
            return (
              <div key={tab.id}
                {...draggableRow(idx)}
                onDrop={(e) => { e.preventDefault(); if (dragIdx === null || dragIdx === idx || !settings) return; onSave({ ...settings, externalTabs: moveItem(settings.externalTabs!, dragIdx, idx) }); setDragIdx(null); }}
                className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white border transition group ${dragIdx === idx ? 'border-[#3765F6] ring-2 ring-[#3765F6]/10' : 'border-slate-200/60 hover:border-slate-300'}`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <DragHandle />
                  <Globe size={12} className="text-slate-400 shrink-0" />
                  <span className="text-xs font-semibold text-slate-700 truncate max-w-[200px]">{tab.title}</span>
                </div>
                {isWritePermitted && (
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => handleStartEditExt(tab)}
                      className="text-slate-400 hover:text-slate-700 p-1 hover:bg-slate-100 rounded-lg cursor-pointer transition" title="Редактировать">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                    </button>
                    <button onClick={() => handleDeleteExt(tab.id)}
                      className="text-slate-400 hover:text-rose-600 p-1 hover:bg-rose-50 rounded-lg cursor-pointer transition" title="Удалить">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {(!settings?.externalTabs || settings.externalTabs.length === 0) && (
            <div className="text-[10px] uppercase font-bold tracking-widest text-slate-400 text-center py-6">Нет вкладок</div>
          )}
        </div>
      </div>

      {/* Current Planning Tabs */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm space-y-4 w-full select-none">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-sm font-bold uppercase tracking-tight text-slate-900 flex items-center gap-1.5">
            <Table2 className="h-4.5 w-4.5 text-slate-500" />
            Вкладки «Текущее планирование»
          </h2>
          <p className="text-[10px] text-slate-500 font-medium mt-1">
            Вкладки отображаются в модуле Текущего планирования
          </p>
        </div>

        {isWritePermitted && (
          <form onSubmit={handleAddCp} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-slate-50/50 p-3 rounded-xl border border-slate-200">
            <input type="text" placeholder="Название вкладки" required
              value={cpTitle} onChange={e => setCpTitle(e.target.value)}
              className="px-3 py-2.5 bg-white text-xs rounded-xl border border-slate-200 outline-none focus:border-slate-300 font-bold text-slate-800 transition"
            />
            <input type="url" placeholder="https://docs.google.com/..." required
              value={cpUrl} onChange={e => setCpUrl(e.target.value)}
              className="px-3 py-2.5 bg-white text-xs rounded-xl border border-slate-200 outline-none focus:border-slate-300 font-bold text-slate-800 transition"
            />
            <button type="submit"
              className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm active:scale-95 py-2.5 flex items-center justify-center gap-1.5"
            >
              <Plus size={13} strokeWidth={2.5} /> Добавить
            </button>
          </form>
        )}

        <div className="space-y-1.5 max-h-[250px] overflow-y-auto custom-scrollbar">
          {(settings?.currentPlanningTabs || []).map((tab, idx) => (
            <div key={tab.id}
              {...draggableRow(idx)}
              onDrop={(e) => { e.preventDefault(); if (dragIdx === null || dragIdx === idx || !settings) return; onSave({ ...settings, currentPlanningTabs: moveItem(settings.currentPlanningTabs!, dragIdx, idx) }); setDragIdx(null); }}
              className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white border transition group ${dragIdx === idx ? 'border-[#3765F6] ring-2 ring-[#3765F6]/10' : 'border-slate-200/60 hover:border-slate-300'}`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <DragHandle />
                <Table2 size={12} className="text-slate-400 shrink-0" />
                <span className="text-xs font-semibold text-slate-700 truncate max-w-[200px]">{tab.name}</span>
              </div>
              {isWritePermitted && (
                <button onClick={() => handleDeleteCp(tab.id)}
                  className="text-slate-400 hover:text-rose-600 p-1 hover:bg-rose-50 rounded-lg cursor-pointer transition shrink-0" title="Удалить">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                </button>
              )}
            </div>
          ))}
          {(!settings?.currentPlanningTabs || settings.currentPlanningTabs.length === 0) && (
            <div className="text-[10px] uppercase font-bold tracking-widest text-slate-400 text-center py-6">Нет вкладок</div>
          )}
        </div>
      </div>

      {/* Plan Zagruzok Tabs */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm space-y-4 w-full select-none">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-sm font-bold uppercase tracking-tight text-slate-900 flex items-center gap-1.5">
            <FileSpreadsheet className="h-4.5 w-4.5 text-slate-500" />
            Вкладки «План загрузок»
          </h2>
          <p className="text-[10px] text-slate-500 font-medium mt-1">
            Дополнительные вкладки в модуле Плана загрузок
          </p>
        </div>

        {isWritePermitted && (
          <form onSubmit={handleAddPz} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-slate-50/50 p-3 rounded-xl border border-slate-200">
            <input type="text" placeholder="Название вкладки" required
              value={pzTitle} onChange={e => setPzTitle(e.target.value)}
              className="px-3 py-2.5 bg-white text-xs rounded-xl border border-slate-200 outline-none focus:border-slate-300 font-bold text-slate-800 transition"
            />
            <input type="url" placeholder="https://docs.google.com/..." required
              value={pzUrl} onChange={e => setPzUrl(e.target.value)}
              className="px-3 py-2.5 bg-white text-xs rounded-xl border border-slate-200 outline-none focus:border-slate-300 font-bold text-slate-800 transition"
            />
            <button type="submit"
              className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm active:scale-95 py-2.5 flex items-center justify-center gap-1.5"
            >
              <Plus size={13} strokeWidth={2.5} /> Добавить
            </button>
          </form>
        )}

        <div className="space-y-1.5 max-h-[250px] overflow-y-auto custom-scrollbar">
          {(settings?.planZagruzokTabs || []).map((tab, idx) => (
            <div key={tab.id}
              {...draggableRow(idx)}
              onDrop={(e) => { e.preventDefault(); if (dragIdx === null || dragIdx === idx || !settings) return; onSave({ ...settings, planZagruzokTabs: moveItem(settings.planZagruzokTabs!, dragIdx, idx) }); setDragIdx(null); }}
              className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white border transition group ${dragIdx === idx ? 'border-[#3765F6] ring-2 ring-[#3765F6]/10' : 'border-slate-200/60 hover:border-slate-300'}`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <DragHandle />
                <FileSpreadsheet size={12} className="text-slate-400 shrink-0" />
                <span className="text-xs font-semibold text-slate-700 truncate max-w-[200px]">{tab.name}</span>
              </div>
              {isWritePermitted && (
                <button onClick={() => handleDeletePz(tab.id)}
                  className="text-slate-400 hover:text-rose-600 p-1 hover:bg-rose-50 rounded-lg cursor-pointer transition shrink-0" title="Удалить">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                </button>
              )}
            </div>
          ))}
          {(!settings?.planZagruzokTabs || settings.planZagruzokTabs.length === 0) && (
            <div className="text-[10px] uppercase font-bold tracking-widest text-slate-400 text-center py-6">Нет вкладок</div>
          )}
        </div>
      </div>
    </div>
  );
}