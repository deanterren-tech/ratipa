import React, {useState} from 'react'
import {UserProfile, AppSettings, Announcement} from '../../types'
import {dbService} from '../../api'
import {Megaphone, Trash2} from 'lucide-react'

interface Props {
  user: UserProfile;
  settings: AppSettings | null;
}

export default function AdminAnnouncementsBlock({ user, settings }: Props) {
  const [annText, setAnnText] = useState('');
  const [annImportant, setAnnImportant] = useState(false);

  const isWritePermitted = user.role === 'admin' || user.role === 'root_admin' || user.permissions?.settings === 'write';

  const handleAddAnnouncement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings || !annText.trim() || !isWritePermitted) return;
    
    const newAnn: Announcement = {
      id: "ann_" + Date.now(),
      text: annText.trim(),
      date: new Date().toLocaleDateString('ru-RU').replace(/\./g, '/'),
      author: user.name,
      important: annImportant
    };
    dbService.saveSettings({ ...settings, announcements: [newAnn, ...(settings.announcements || [])] }, user.name, user.role);
    setAnnText('');
    setAnnImportant(false);
  };

  const handleDeleteAnnouncement = (id: string) => {
    if (!settings || !isWritePermitted) return;
    const updated = (settings.announcements || []).filter(a => a.id !== id);
    dbService.saveSettings({ ...settings, announcements: updated }, user.name, user.role);
  };

  return (
 <div className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm space-y-8 w-full select-none">
      
      {/* Block Header */}
      <div className="border-b border-white/40 pb-4">
        <span className="bg-slate-900 text-white font-bold text-[9px] px-2.5 py-0.5 rounded-full uppercase font-mono tracking-wider">
          Dashboard Board
        </span>
        <h2 className="text-sm font-bold uppercase tracking-tight text-slate-900 mt-2 flex items-center gap-1.5">
          <Megaphone className="h-4.5 w-4.5 text-slate-500" />
          Системные уведомления (Dashboard)
        </h2>
        <p className="text-[10px] text-slate-500 font-medium mt-1 leading-relaxed">
          Публикация важных инструкций, объявлений и новостей на главной панели сотрудников.
        </p>
      </div>

      {isWritePermitted && (
 <form onSubmit={handleAddAnnouncement} className="space-y-4 bg-white border border-slate-200 shadow-sm p-5 rounded-2xl">
          <textarea
            placeholder="Инструкция: Сдавать CMR строго до вторника, 12:00..."
            required
            value={annText}
            onChange={(e) => setAnnText(e.target.value)}
            className="w-full p-4 bg-white/40 border border-white/45 text-xs rounded-2xl outline-none focus:ring-2 focus:ring-blue-100/30 shadow-sm h-24 resize-none transition-all font-semibold text-slate-800"
          />
 <div className="flex justify-between items-center bg-white border border-slate-200 p-3 shadow-sm rounded-2xl">
            <label className="flex items-center gap-2 text-[10px] font-bold uppercase text-slate-500 select-none cursor-pointer group">
              <input
                type="checkbox"
                checked={annImportant}
                onChange={(e) => setAnnImportant(e.target.checked)}
                className="rounded border border-slate-200 accent-slate-900 h-4 w-4 cursor-pointer transition"
              />
              <span className="group-hover:text-slate-800 transition-colors">Пометить как ВАЖНОЕ (рамка)</span>
            </label>
            <button type="submit" className="bg-slate-900 hover:bg-slate-800 active:scale-95 text-white rounded-xl shadow-sm text-[10px] font-semibold uppercase px-4 py-2 cursor-pointer transition-all">
              Опубликовать
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1 text-xs">
        {settings?.announcements?.map((ann) => (
          <div 
            key={ann.id} 
            className={`p-5 rounded-2xl border flex justify-between gap-3 transition-all ${
              ann.important 
                ? 'border-amber-500/30 bg-amber-500/10' 
                : 'bg-white/40 border border-white/45 shadow-sm'
            }`}
          >
            <div className="flex-1 space-y-2">
              <p className="text-slate-800 font-semibold leading-relaxed">{ann.text}</p>
              <span className="text-[9px] font-bold font-mono text-slate-400 block uppercase tracking-wide">От: {ann.author} • {ann.date}</span>
            </div>
            {isWritePermitted && (
              <button 
                onClick={() => handleDeleteAnnouncement(ann.id)} 
                className="text-slate-450 hover:text-rose-600 hover:bg-rose-500/10 border border-white/45 shadow-sm rounded-xl p-2 self-start cursor-pointer transition-all active:scale-90"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {(!settings?.announcements || settings.announcements.length === 0) && (
           <div className="text-[10px] uppercase font-bold tracking-widest text-slate-400 text-center py-6 font-mono">
              Уведомлений нет
           </div>
        )}
      </div>
    </div>
  );
}
