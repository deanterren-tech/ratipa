import React, { useState } from 'react';
import { UserProfile, AppSettings, Announcement } from '../../types';
import { dbService } from '../../firebase';
import { Megaphone, Trash2 } from 'lucide-react';

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
      date: new Date().toLocaleDateString('ru-RU'),
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
    <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] mt-6 space-y-4">
      <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
        <Megaphone className="h-4.5 w-4.5 text-slate-900 font-bold" style={{ fill: '#70FC8E' }} />
        Системные уведомления (Dashboard)
      </h2>

      {isWritePermitted && (
        <form onSubmit={handleAddAnnouncement} className="space-y-3.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/50">
          <textarea
            placeholder="Инструкция: Сдавать CMR строго до вторника, 12:00..."
            required
            value={annText}
            onChange={(e) => setAnnText(e.target.value)}
            className="w-full p-3 bg-white text-xs rounded-xl border border-slate-200 h-20 resize-none focus:outline-none font-semibold text-slate-800"
          />
          <div className="flex justify-between items-center bg-white p-2 px-3 border border-slate-200 rounded-xl">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-500 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={annImportant}
                onChange={(e) => setAnnImportant(e.target.checked)}
                className="rounded border border-slate-350 accent-slate-900 h-3.5 w-3.5 cursor-pointer"
              />
              Пометить как ВАЖНОЕ (рамка)
            </label>
            <button type="submit" className="bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-xl text-[10px] font-black uppercase px-4 py-2 cursor-pointer transition">
              Опубликовать
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3 max-h-[250px] overflow-y-auto pr-1 text-xs">
        {settings?.announcements?.map((ann) => (
          <div 
            key={ann.id} 
            className={`p-4 rounded-2xl border flex justify-between gap-3 ${
              ann.important 
                ? 'border-amber-200 bg-amber-50/20' 
                : 'bg-slate-50/70 border-slate-150'
            }`}
          >
            <div className="flex-1">
              <p className="text-slate-800 font-bold leading-normal">{ann.text}</p>
              <span className="text-[9px] font-bold font-mono text-slate-400 mt-2 block uppercase">От: {ann.author} • {ann.date}</span>
            </div>
            {isWritePermitted && (
              <button 
                onClick={() => handleDeleteAnnouncement(ann.id)} 
                className="text-rose-500 hover:text-rose-700 bg-white border border-slate-200 rounded-lg p-1.5 self-start shadow-3xs cursor-pointer transition"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        {(!settings?.announcements || settings.announcements.length === 0) && (
           <div className="text-[10px] uppercase font-black tracking-widest text-slate-400 text-center py-6 font-mono">
              Уведомлений нет
           </div>
        )}
      </div>
    </div>
  );
}
