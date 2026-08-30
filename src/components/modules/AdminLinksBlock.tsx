import React, {useState} from 'react'
import {UserProfile, AppSettings, QuickLink, ExternalTab} from '../../types'
import {ExternalLink, Link, Plus, X, Check, Globe} from 'lucide-react'

interface Props {
  user: UserProfile;
  settings: AppSettings | null;
  onSave: (s: AppSettings) => void;
}

export default function AdminLinksBlock({ user, settings, onSave }: Props) {
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [editingLinkTitle, setEditingLinkTitle] = useState('');
  const [editingLinkUrl, setEditingLinkUrl] = useState('');

  // External tabs
  const [extTitle, setExtTitle] = useState('');
  const [extUrl, setExtUrl] = useState('');
  const [editingExtId, setEditingExtId] = useState<string | null>(null);
  const [editingExtTitle, setEditingExtTitle] = useState('');
  const [editingExtUrl, setEditingExtUrl] = useState('');

  const isWritePermitted = user.role === 'admin' || user.role === 'root_admin' || user.permissions?.settings === 'write';

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
          {settings?.quickLinks?.map(link => {
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
                className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white border border-slate-200/60 hover:border-slate-300 transition group"
              >
                <div className="flex items-center gap-2 min-w-0">
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
          {(settings?.externalTabs || []).map(tab => {
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
                className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white border border-slate-200/60 hover:border-slate-300 transition group"
              >
                <div className="flex items-center gap-2 min-w-0">
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
    </div>
  );
}