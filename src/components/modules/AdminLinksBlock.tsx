import React, {useState} from 'react'
import {UserProfile, AppSettings, QuickLink, ExternalTab, CurrentPlanningTab, PlanZagruzokTab} from '../../types'
import {ExternalLink, Link, Plus, X, Check, Globe, GripVertical, Table2, FileSpreadsheet, Pencil, Trash2} from 'lucide-react'
import { UI } from '../../ui/kit';
import { SectionHeader } from '../../ui/components';

interface Props {
  user: UserProfile;
  settings: AppSettings | null;
  onSave: (s: AppSettings) => void;
}

const iconBtnDanger = 'inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer';
const iconBtnSuccess = 'inline-flex items-center justify-center p-1.5 rounded-lg text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer';

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function DragHandle() {
  return (
    <div className="cursor-grab active:cursor-grabbing text-[#9CA3AF] hover:text-[#4B5563] p-0.5 rounded transition shrink-0">
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
  const [editingCpId] = useState<string | null>(null);
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
    (e.currentTarget as HTMLElement).style.borderTop = '2px solid var(--accent-ui)';
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
    <div className="flex flex-col gap-6">
      {/* Виджет быстрых ссылок */}
      <div className="flex flex-col gap-3 pb-6 border-b border-[#E5E7EB] last:border-0 last:pb-0">
        <SectionHeader
          icon={<Link className="w-4 h-4" />}
          tone="graphite"
          title="Виджет быстрых ссылок на Dashboard"
          subtitle="Ссылки отображаются на главной панели под блоком новостей"
        >
          <span className={UI.countBadge}>{settings?.quickLinks?.length || 0}</span>
        </SectionHeader>

        {isWritePermitted && (
          <form onSubmit={handleAddLink} className="flex flex-col sm:flex-row gap-2">
            <input type="text" placeholder="Название" required
              value={linkTitle} onChange={e => setLinkTitle(e.target.value)}
              className={UI.input}
            />
            <input type="url" placeholder="https://..." required
              value={linkUrl} onChange={e => setLinkUrl(e.target.value)}
              className={UI.input}
            />
            <button type="submit" className={`${UI.buttonPrimary} shrink-0`}>
              <Plus size={14} strokeWidth={2.5} /> Добавить
            </button>
          </form>
        )}

        <div className="flex flex-col gap-1.5 max-h-[250px] overflow-y-auto custom-scrollbar">
          {settings?.quickLinks?.map((link, idx) => {
            const isEditing = editingLinkId === link.id;
            if (isEditing) {
              return (
                <form key={link.id} onSubmit={handleSaveEditLink}
                  className="flex flex-col sm:flex-row gap-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-2"
                >
                  <input type="text" value={editingLinkTitle} required
                    onChange={e => setEditingLinkTitle(e.target.value)}
                    className={`${UI.inputSm} flex-1`}
                  />
                  <input type="url" value={editingLinkUrl} required
                    onChange={e => setEditingLinkUrl(e.target.value)}
                    className={`${UI.inputSm} flex-1`}
                  />
                  <div className="flex gap-0.5 justify-end shrink-0">
                    <button type="submit" className={iconBtnSuccess} title="Сохранить"><Check size={14} /></button>
                    <button type="button" onClick={() => setEditingLinkId(null)}
                      className={UI.buttonIcon} title="Отмена"><X size={14} /></button>
                  </div>
                </form>
              );
            }
            return (
              <div key={link.id}
                {...draggableRow(idx)}
                onDrop={(e) => { e.preventDefault(); if (dragIdx === null || dragIdx === idx || !settings) return; onSave({ ...settings, quickLinks: moveItem(settings.quickLinks!, dragIdx, idx) }); setDragIdx(null); }}
                className={`flex items-center justify-between gap-2 px-3 py-2.5 bg-white border rounded-xl transition-colors ${dragIdx === idx ? 'border-[var(--accent)] ring-2 ring-[var(--accent-20)]' : 'border-[#E5E7EB] hover:bg-[#F9FAFB]'}`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <DragHandle />
                  <ExternalLink size={12} className="text-[#9CA3AF] shrink-0" />
                  <a href={link.url} target="_blank" rel="noopener noreferrer"
                    className="text-xs font-medium text-[#4B5563] hover:text-[#121316] truncate max-w-[220px] transition-colors"
                  >{link.title}</a>
                </div>
                {isWritePermitted && (
                  <div className="flex gap-0.5 shrink-0">
                    <button onClick={() => handleStartEditLink(link)}
                      className={UI.buttonIcon} title="Редактировать">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => handleDeleteLink(link.id)}
                      className={iconBtnDanger} title="Удалить">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {(!settings?.quickLinks || settings.quickLinks.length === 0) && (
            <div className="py-6 text-center text-xs text-[#6B7280]">Нет ссылок</div>
          )}
        </div>
      </div>

      {/* Кастомные вкладки на внешние сайты */}
      <div className="flex flex-col gap-3 pb-6 border-b border-[#E5E7EB] last:border-0 last:pb-0">
        <SectionHeader
          icon={<Globe className="w-4 h-4" />}
          tone="graphite"
          title="Кастомные меню-вкладки на внешние сайты"
          subtitle="Отображаются в верхнем навигационном меню RATIPA"
        >
          <span className={UI.countBadge}>{settings?.externalTabs?.length || 0}</span>
        </SectionHeader>

        {isWritePermitted && (
          <form onSubmit={handleAddExt} className="flex flex-col sm:flex-row gap-2">
            <input type="text" placeholder="Название" required
              value={extTitle} onChange={e => setExtTitle(e.target.value)}
              className={UI.input}
            />
            <input type="url" placeholder="https://..." required
              value={extUrl} onChange={e => setExtUrl(e.target.value)}
              className={UI.input}
            />
            <button type="submit" className={`${UI.buttonPrimary} shrink-0`}>
              <Plus size={14} strokeWidth={2.5} /> Добавить
            </button>
          </form>
        )}

        <div className="flex flex-col gap-1.5 max-h-[250px] overflow-y-auto custom-scrollbar">
          {(settings?.externalTabs || []).map((tab, idx) => {
            const isEditing = editingExtId === tab.id;
            if (isEditing) {
              return (
                <form key={tab.id} onSubmit={handleSaveEditExt}
                  className="flex flex-col sm:flex-row gap-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-2"
                >
                  <input type="text" value={editingExtTitle} required
                    onChange={e => setEditingExtTitle(e.target.value)}
                    className={`${UI.inputSm} flex-1`}
                  />
                  <input type="url" value={editingExtUrl} required
                    onChange={e => setEditingExtUrl(e.target.value)}
                    className={`${UI.inputSm} flex-1`}
                  />
                  <div className="flex gap-0.5 justify-end shrink-0">
                    <button type="submit" className={iconBtnSuccess} title="Сохранить"><Check size={14} /></button>
                    <button type="button" onClick={() => setEditingExtId(null)}
                      className={UI.buttonIcon} title="Отмена"><X size={14} /></button>
                  </div>
                </form>
              );
            }
            return (
              <div key={tab.id}
                {...draggableRow(idx)}
                onDrop={(e) => { e.preventDefault(); if (dragIdx === null || dragIdx === idx || !settings) return; onSave({ ...settings, externalTabs: moveItem(settings.externalTabs!, dragIdx, idx) }); setDragIdx(null); }}
                className={`flex items-center justify-between gap-2 px-3 py-2.5 bg-white border rounded-xl transition-colors ${dragIdx === idx ? 'border-[var(--accent)] ring-2 ring-[var(--accent-20)]' : 'border-[#E5E7EB] hover:bg-[#F9FAFB]'}`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <DragHandle />
                  <Globe size={12} className="text-[#9CA3AF] shrink-0" />
                  <span className="text-xs font-medium text-[#4B5563] truncate max-w-[220px]">{tab.title}</span>
                </div>
                {isWritePermitted && (
                  <div className="flex gap-0.5 shrink-0">
                    <button onClick={() => handleStartEditExt(tab)}
                      className={UI.buttonIcon} title="Редактировать">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => handleDeleteExt(tab.id)}
                      className={iconBtnDanger} title="Удалить">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {(!settings?.externalTabs || settings.externalTabs.length === 0) && (
            <div className="py-6 text-center text-xs text-[#6B7280]">Нет вкладок</div>
          )}
        </div>
      </div>

      {/* Вкладки «Текущее планирование» */}
      <div className="flex flex-col gap-3 pb-6 border-b border-[#E5E7EB] last:border-0 last:pb-0">
        <SectionHeader
          icon={<Table2 className="w-4 h-4" />}
          tone="graphite"
          title="Вкладки «Текущее планирование»"
          subtitle="Вкладки отображаются в модуле Текущего планирования"
        >
          <span className={UI.countBadge}>{settings?.currentPlanningTabs?.length || 0}</span>
        </SectionHeader>

        {isWritePermitted && (
          <form onSubmit={handleAddCp} className="flex flex-col sm:flex-row gap-2">
            <input type="text" placeholder="Название вкладки" required
              value={cpTitle} onChange={e => setCpTitle(e.target.value)}
              className={UI.input}
            />
            <input type="url" placeholder="https://docs.google.com/..." required
              value={cpUrl} onChange={e => setCpUrl(e.target.value)}
              className={UI.input}
            />
            <button type="submit" className={`${UI.buttonPrimary} shrink-0`}>
              <Plus size={14} strokeWidth={2.5} /> Добавить
            </button>
          </form>
        )}

        <div className="flex flex-col gap-1.5 max-h-[250px] overflow-y-auto custom-scrollbar">
          {(settings?.currentPlanningTabs || []).map((tab, idx) => (
            <div key={tab.id}
              {...draggableRow(idx)}
              onDrop={(e) => { e.preventDefault(); if (dragIdx === null || dragIdx === idx || !settings) return; onSave({ ...settings, currentPlanningTabs: moveItem(settings.currentPlanningTabs!, dragIdx, idx) }); setDragIdx(null); }}
              className={`flex items-center justify-between gap-2 px-3 py-2.5 bg-white border rounded-xl transition-colors ${dragIdx === idx ? 'border-[var(--accent)] ring-2 ring-[var(--accent-20)]' : 'border-[#E5E7EB] hover:bg-[#F9FAFB]'}`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <DragHandle />
                <Table2 size={12} className="text-[#9CA3AF] shrink-0" />
                <span className="text-xs font-medium text-[#4B5563] truncate max-w-[220px]">{tab.name}</span>
              </div>
              {isWritePermitted && (
                <button onClick={() => handleDeleteCp(tab.id)}
                  className={`${iconBtnDanger} shrink-0`} title="Удалить">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
          {(!settings?.currentPlanningTabs || settings.currentPlanningTabs.length === 0) && (
            <div className="py-6 text-center text-xs text-[#6B7280]">Нет вкладок</div>
          )}
        </div>
      </div>

      {/* Вкладки «План загрузок» */}
      <div className="flex flex-col gap-3 pb-6 border-b border-[#E5E7EB] last:border-0 last:pb-0">
        <SectionHeader
          icon={<FileSpreadsheet className="w-4 h-4" />}
          tone="graphite"
          title="Вкладки «План загрузок»"
          subtitle="Дополнительные вкладки в модуле Плана загрузок"
        >
          <span className={UI.countBadge}>{settings?.planZagruzokTabs?.length || 0}</span>
        </SectionHeader>

        {isWritePermitted && (
          <form onSubmit={handleAddPz} className="flex flex-col sm:flex-row gap-2">
            <input type="text" placeholder="Название вкладки" required
              value={pzTitle} onChange={e => setPzTitle(e.target.value)}
              className={UI.input}
            />
            <input type="url" placeholder="https://docs.google.com/..." required
              value={pzUrl} onChange={e => setPzUrl(e.target.value)}
              className={UI.input}
            />
            <button type="submit" className={`${UI.buttonPrimary} shrink-0`}>
              <Plus size={14} strokeWidth={2.5} /> Добавить
            </button>
          </form>
        )}

        <div className="flex flex-col gap-1.5 max-h-[250px] overflow-y-auto custom-scrollbar">
          {(settings?.planZagruzokTabs || []).map((tab, idx) => (
            <div key={tab.id}
              {...draggableRow(idx)}
              onDrop={(e) => { e.preventDefault(); if (dragIdx === null || dragIdx === idx || !settings) return; onSave({ ...settings, planZagruzokTabs: moveItem(settings.planZagruzokTabs!, dragIdx, idx) }); setDragIdx(null); }}
              className={`flex items-center justify-between gap-2 px-3 py-2.5 bg-white border rounded-xl transition-colors ${dragIdx === idx ? 'border-[var(--accent)] ring-2 ring-[var(--accent-20)]' : 'border-[#E5E7EB] hover:bg-[#F9FAFB]'}`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <DragHandle />
                <FileSpreadsheet size={12} className="text-[#9CA3AF] shrink-0" />
                <span className="text-xs font-medium text-[#4B5563] truncate max-w-[220px]">{tab.name}</span>
              </div>
              {isWritePermitted && (
                <button onClick={() => handleDeletePz(tab.id)}
                  className={`${iconBtnDanger} shrink-0`} title="Удалить">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
          {(!settings?.planZagruzokTabs || settings.planZagruzokTabs.length === 0) && (
            <div className="py-6 text-center text-xs text-[#6B7280]">Нет вкладок</div>
          )}
        </div>
      </div>
    </div>
  );
}
