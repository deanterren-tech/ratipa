import React, {useState} from 'react'
import {UserProfile, AppSettings, Announcement} from '../../types'
import {dbService} from '../../api'
import {Megaphone, Trash2} from 'lucide-react'
import { UI } from '../../ui/kit';
import { SectionHeader } from '../../ui/components';

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
    <div className="flex flex-col gap-4">
      <SectionHeader
        icon={<Megaphone className="w-4 h-4" />}
        tone="graphite"
        title="Системные уведомления (Dashboard)"
        subtitle="Публикация важных инструкций, объявлений и новостей на главной панели сотрудников."
      />

      {isWritePermitted && (
        <form onSubmit={handleAddAnnouncement} className="flex flex-col gap-3 bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-4">
          <textarea
            placeholder="Инструкция: сдавать CMR строго до вторника, 12:00..."
            required
            value={annText}
            onChange={(e) => setAnnText(e.target.value)}
            className={`${UI.textarea} h-24 resize-none`}
          />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-[#4B5563] select-none cursor-pointer">
              <input
                type="checkbox"
                checked={annImportant}
                onChange={(e) => setAnnImportant(e.target.checked)}
                className={UI.checkbox}
              />
              <span>Пометить как важное (рамка)</span>
            </label>
            <button type="submit" className={UI.buttonPrimary}>
              Опубликовать
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col max-h-[320px] overflow-y-auto custom-scrollbar">
        {settings?.announcements?.map((ann) => (
          <div
            key={ann.id}
            className="flex items-start justify-between gap-3 py-3 border-b border-[#E5E7EB] last:border-0"
          >
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              {ann.important && (
                <span className="self-start text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  Важное
                </span>
              )}
              <p className="text-xs text-[#4B5563] leading-relaxed whitespace-pre-wrap">{ann.text}</p>
              <span className="text-[11px] font-mono text-[#9CA3AF] block">От: {ann.author} • {ann.date}</span>
            </div>
            {isWritePermitted && (
              <button
                onClick={() => handleDeleteAnnouncement(ann.id)}
                className="inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
                title="Удалить"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {(!settings?.announcements || settings.announcements.length === 0) && (
          <div className="py-10 text-center">
            <Megaphone className="w-6 h-6 mx-auto mb-2 text-[#D1D5DB]" />
            <p className="text-xs text-[#6B7280]">Уведомлений нет</p>
          </div>
        )}
      </div>
    </div>
  );
}
