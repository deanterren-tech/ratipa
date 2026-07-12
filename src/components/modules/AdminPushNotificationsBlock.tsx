import React, { useState, useEffect } from 'react';
import { UserProfile, AppSettings } from '../../types';
import { dbService } from '../../firebase';
import { 
  Send, Trash2, Users, BellRing, Clock, Check, UserCheck, AlertTriangle, 
  ShieldAlert, Sparkles, Settings, ShieldCheck, ChevronDown, ChevronUp, Sliders, ToggleLeft, ToggleRight
} from 'lucide-react';
import { useDialog } from '../DialogProvider';

interface Props {
  user: UserProfile;
  settings: AppSettings | null;
  onSave: (newSettings: AppSettings) => void;
}

const ROLE_LABELS: Record<string, string> = {
  root_admin: "Разработчик (Root)",
  admin: "Администратор",
  manager: "Менеджер",
  accountant: "Бухгалтер",
  dispatcher: "Диспетчер",
  mechanic: "Механик",
  viewer: "Наблюдатель",
  logist: "Логист",
};

export default function AdminPushNotificationsBlock({ user, settings, onSave }: Props) {
  const { showConfirm } = useDialog();
  const [notifText, setNotifText] = useState('');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [expandedNotifId, setExpandedNotifId] = useState<string | null>(null);
  
  // Send form states
  const [selectedType, setSelectedType] = useState<'info' | 'warning' | 'success' | 'alert'>('info');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]); // Empty = All roles

  // Access Control UI States
  const [isAccessControlOpen, setIsAccessControlOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'receiving' | 'dispatching' | 'matrix'>('receiving');

  useEffect(() => {
    return dbService.getBroadcastNotifications(setNotifications);
  }, []);

  // Extract access settings or supply defaults
  const access = settings?.notificationAccess || {
    enabledRoles: ['root_admin', 'admin', 'manager', 'accountant', 'dispatcher', 'mechanic', 'viewer', 'logist'],
    configRoles: ['root_admin', 'admin'],
    roleNotificationTypes: {
      root_admin: ['info', 'warning', 'success', 'alert'],
      admin: ['info', 'warning', 'success', 'alert'],
      manager: ['info', 'warning', 'success', 'alert'],
      accountant: ['info', 'warning', 'success', 'alert'],
      dispatcher: ['info', 'warning', 'success', 'alert'],
      mechanic: ['info', 'warning', 'success', 'alert'],
      viewer: ['info', 'warning', 'success', 'alert'],
      logist: ['info', 'warning', 'success', 'alert']
    },
    roleAvailableChannels: {
      root_admin: ['push', 'system'],
      admin: ['push', 'system'],
      manager: ['push', 'system'],
      accountant: ['push', 'system'],
      dispatcher: ['push', 'system'],
      mechanic: ['push', 'system'],
      viewer: ['push', 'system'],
      logist: ['push', 'system']
    }
  };

  const enabledRoles = access.enabledRoles || ['root_admin', 'admin', 'manager', 'accountant', 'dispatcher', 'mechanic', 'viewer', 'logist'];
  const configRoles = access.configRoles || ['root_admin', 'admin'];
  const roleNotificationTypes = access.roleNotificationTypes || {};
  const roleAvailableChannels = access.roleAvailableChannels || {};

  // Check if current user has configuration/sending access
  const canConfigure = configRoles.includes(user.role);

  const handleSaveAccess = (updatedAccess: any) => {
    if (!settings || !canConfigure) return;
    onSave({
      ...settings,
      notificationAccess: updatedAccess
    });
  };

  const toggleEnabledRole = (roleId: string) => {
    const current = [...enabledRoles];
    const updated = current.includes(roleId) ? current.filter(r => r !== roleId) : [...current, roleId];
    handleSaveAccess({ ...access, enabledRoles: updated });
  };

  const toggleConfigRole = (roleId: string) => {
    const current = [...configRoles];
    const updated = current.includes(roleId) ? current.filter(r => r !== roleId) : [...current, roleId];
    handleSaveAccess({ ...access, configRoles: updated });
  };

  const toggleRoleNotificationType = (roleId: string, type: string) => {
    const currentTypes = roleNotificationTypes[roleId] || ['info', 'warning', 'success', 'alert'];
    const updatedTypes = currentTypes.includes(type) ? currentTypes.filter(t => t !== type) : [...currentTypes, type];
    handleSaveAccess({
      ...access,
      roleNotificationTypes: {
        ...roleNotificationTypes,
        [roleId]: updatedTypes
      }
    });
  };

  const toggleRoleChannel = (roleId: string, channel: string) => {
    const currentChannels = roleAvailableChannels[roleId] || ['push', 'system'];
    const updatedChannels = currentChannels.includes(channel) ? currentChannels.filter(c => c !== channel) : [...currentChannels, channel];
    handleSaveAccess({
      ...access,
      roleAvailableChannels: {
        ...roleAvailableChannels,
        [roleId]: updatedChannels
      }
    });
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!notifText.trim() || !canConfigure) return;

    dbService.sendBroadcastNotification(
      notifText.trim(),
      user.name,
      user.name,
      user.role,
      selectedRoles,
      selectedType
    );
    setNotifText('');
    setSelectedRoles([]);
    setSelectedType('info');
  };

  const handleDelete = async (id: string) => {
    if (!canConfigure) return;
    const confirmed = await showConfirm('Вы уверены, что хотите удалить это уведомление?', 'Удаление');
    if (confirmed) {
      dbService.deleteBroadcastNotification(id, user.name, user.role);
    }
  };

  const toggleRoleSelection = (roleId: string) => {
    if (selectedRoles.includes(roleId)) {
      setSelectedRoles(prev => prev.filter(r => r !== roleId));
    } else {
      setSelectedRoles(prev => [...prev, roleId]);
    }
  };

  const applyPreset = (type: 'all' | 'admins' | 'employees') => {
    if (type === 'all') {
      setSelectedRoles([]);
    } else if (type === 'admins') {
      setSelectedRoles(['root_admin', 'admin']);
    } else if (type === 'employees') {
      setSelectedRoles(['manager', 'accountant', 'dispatcher', 'mechanic', 'logist', 'viewer']);
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + ' ' + date.toLocaleDateString('ru-RU');
    } catch {
      return isoString;
    }
  };

  const eventTypes = [
    { id: 'info', label: 'Инфо', icon: '📢', colorClass: 'bg-[#3765F6]/10 text-[#3765F6] border-[#3765F6]/25', activeClass: 'bg-[#3765F6] text-white border-[#3765F6]' },
    { id: 'warning', label: 'Внимание', icon: '⚠️', colorClass: 'bg-amber-500/10 text-amber-700 border-amber-500/25', activeClass: 'bg-amber-500 text-white border-amber-500' },
    { id: 'success', label: 'Успешно', icon: '✅', colorClass: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/25', activeClass: 'bg-emerald-500 text-white border-emerald-500' },
    { id: 'alert', label: 'Срочно', icon: '🚨', colorClass: 'bg-rose-500/10 text-rose-700 border-rose-500/25', activeClass: 'bg-rose-500 text-white border-rose-500' },
  ] as const;

  return (
    <div className="space-y-6 w-full select-none font-sans">
      
      {/* 1. Collapsible Role & Access Configuration Card (Admin Panel) */}
      <div className="bg-white/40 border border-white/45 backdrop-blur-xl rounded-[1.8rem] p-6 lg:p-8 shadow-sm">
        <div 
          onClick={() => setIsAccessControlOpen(!isAccessControlOpen)}
          className="flex items-center justify-between cursor-pointer select-none"
        >
          <div className="space-y-1">
            <span className="bg-[#3765F6]/10 text-[#3765F6] border border-[#3765F6]/10 font-mono text-[9px] font-semibold uppercase tracking-widest px-2.5 py-0.5 rounded-full mb-1 inline-block">
              Security & Permissions
            </span>
            <h2 className="text-sm font-bold tracking-tight text-slate-900 flex items-center gap-2">
              <Settings className="h-4.5 w-4.5 text-[#3765F6]" />
              Управление доступом к уведомлениям
            </h2>
            <p className="text-[11px] text-slate-500 font-medium">
              Определите, какие роли получают уведомления, кто может их создавать и какие типы/каналы им доступны.
            </p>
          </div>
          <button className="p-1.5 rounded-xl bg-white/60 border border-slate-200/40 text-slate-500 hover:text-slate-800 transition-all cursor-pointer">
            {isAccessControlOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>

        {isAccessControlOpen && (
          <div className="mt-6 pt-6 border-t border-slate-200/45 space-y-6 animate-in fade-in duration-300">
            
            {/* Settings Tabs */}
            <div className="flex gap-1 bg-slate-100 border border-slate-200/30 p-1 rounded-xl max-w-md">
              <button
                onClick={() => setActiveSettingsTab('receiving')}
                className={`flex-1 py-1.5 text-[10.5px] font-bold uppercase rounded-lg transition tracking-wide cursor-pointer ${
                  activeSettingsTab === 'receiving' 
                    ? 'bg-white text-slate-950 shadow-2xs border border-slate-200/20' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Получение
              </button>
              <button
                onClick={() => setActiveSettingsTab('dispatching')}
                className={`flex-1 py-1.5 text-[10.5px] font-bold uppercase rounded-lg transition tracking-wide cursor-pointer ${
                  activeSettingsTab === 'dispatching' 
                    ? 'bg-white text-slate-950 shadow-2xs border border-slate-200/20' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Отправка/Настройка
              </button>
              <button
                onClick={() => setActiveSettingsTab('matrix')}
                className={`flex-1 py-1.5 text-[10.5px] font-bold uppercase rounded-lg transition tracking-wide cursor-pointer ${
                  activeSettingsTab === 'matrix' 
                    ? 'bg-white text-slate-950 shadow-2xs border border-slate-200/20' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Типы и Каналы
              </button>
            </div>

            {/* Tab 1: Receiving Permission (Who gets notified) */}
            {activeSettingsTab === 'receiving' && (
              <div className="space-y-4">
                <div className="bg-slate-50 border border-slate-200/40 p-4 rounded-2xl">
                  <h4 className="text-xs font-black text-slate-850 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                    <Users size={14} className="text-[#3765F6]" />
                    Включение приема уведомлений
                  </h4>
                  <p className="text-[10.5px] text-slate-500 leading-relaxed font-medium">
                    Снимите флажок с роли, чтобы полностью заблокировать для неё отображение и прием уведомлений в системе (иконка колокольчика будет пустой или скрытой для этой роли).
                  </p>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {Object.entries(ROLE_LABELS).map(([roleId, label]) => {
                    const isEnabled = enabledRoles.includes(roleId);
                    return (
                      <button
                        key={roleId}
                        disabled={!canConfigure}
                        onClick={() => toggleEnabledRole(roleId)}
                        className={`p-3 rounded-xl border text-left text-xs font-semibold flex flex-col justify-between h-20 transition-all ${
                          !canConfigure ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                        } ${
                          isEnabled 
                            ? 'bg-white border-[#3765F6]/45 text-[#3765F6] shadow-2xs' 
                            : 'bg-white/30 border-white/40 text-slate-400'
                        }`}
                      >
                        <span className="truncate w-full block">{label}</span>
                        <div className="flex items-center gap-1.5 mt-auto">
                          {isEnabled ? (
                            <span className="text-[9px] text-[#3765F6] font-bold font-mono">АКТИВЕН</span>
                          ) : (
                            <span className="text-[9px] text-slate-400 font-bold font-mono">ОТКЛЮЧЕН</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tab 2: Dispatching/Config Permission (Who can manage) */}
            {activeSettingsTab === 'dispatching' && (
              <div className="space-y-4">
                <div className="bg-slate-50 border border-slate-200/40 p-4 rounded-2xl">
                  <h4 className="text-xs font-black text-slate-850 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                    <ShieldCheck size={14} className="text-[#3765F6]" />
                    Права на администрирование и отправку
                  </h4>
                  <p className="text-[10.5px] text-slate-500 leading-relaxed font-medium">
                    Укажите, какие роли наделены полномочиями создавать таргетированные рассылки, удалять уведомления и изменять данные настройки безопасности.
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {Object.entries(ROLE_LABELS).map(([roleId, label]) => {
                    const hasConfigPower = configRoles.includes(roleId);
                    return (
                      <button
                        key={roleId}
                        disabled={!canConfigure || roleId === 'root_admin'} // Root developer always has access
                        onClick={() => toggleConfigRole(roleId)}
                        className={`p-3 rounded-xl border text-left text-xs font-semibold flex flex-col justify-between h-20 transition-all ${
                          (!canConfigure || roleId === 'root_admin') ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                        } ${
                          hasConfigPower 
                            ? 'bg-white border-amber-500/40 text-amber-700 shadow-2xs' 
                            : 'bg-white/30 border-white/40 text-slate-400'
                        }`}
                      >
                        <span className="truncate w-full block">{label}</span>
                        <div className="mt-auto flex items-center gap-1.5 text-[9px] font-bold font-mono uppercase">
                          {hasConfigPower ? (
                            <span className="text-amber-600">Администратор</span>
                          ) : (
                            <span className="text-slate-400">Обычный</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tab 3: Matrix (Types & Channels settings per role) */}
            {activeSettingsTab === 'matrix' && (
              <div className="space-y-4">
                <div className="bg-slate-50 border border-slate-200/40 p-4 rounded-2xl">
                  <h4 className="text-xs font-black text-slate-850 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                    <Sliders size={14} className="text-[#3765F6]" />
                    Матрица типов и каналов уведомлений
                  </h4>
                  <p className="text-[10.5px] text-slate-500 leading-relaxed font-medium">
                    Для каждой системной роли детально укажите разрешенные типы событий и доступные каналы связи.
                  </p>
                </div>

                <div className="border border-slate-200/65 rounded-2xl bg-white/45 overflow-hidden divide-y divide-slate-100">
                  {Object.entries(ROLE_LABELS).map(([roleId, label]) => {
                    const allowedTypes = roleNotificationTypes[roleId] || ['info', 'warning', 'success', 'alert'];
                    const allowedChannels = roleAvailableChannels[roleId] || ['push', 'system'];
                    const isRoleEnabled = enabledRoles.includes(roleId);

                    return (
                      <div key={roleId} className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div className="min-w-0">
                          <span className={`text-xs font-extrabold flex items-center gap-2 ${isRoleEnabled ? 'text-slate-900' : 'text-slate-400 italic'}`}>
                            {label}
                            {!isRoleEnabled && <span className="text-[8px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded font-mono uppercase">Заблокирован</span>}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-6">
                          {/* Types selector group */}
                          <div className="space-y-1">
                            <span className="text-[8px] font-black font-mono text-slate-400 uppercase tracking-wider block">Разрешенные типы</span>
                            <div className="flex items-center gap-1.5">
                              {['info', 'warning', 'success', 'alert'].map(typeId => {
                                const active = allowedTypes.includes(typeId);
                                const icons: Record<string, string> = { info: '📢', warning: '⚠️', success: '✅', alert: '🚨' };
                                return (
                                  <button
                                    key={typeId}
                                    disabled={!canConfigure || !isRoleEnabled}
                                    onClick={() => toggleRoleNotificationType(roleId, typeId)}
                                    className={`px-2 py-0.5 text-[9.5px] font-bold border rounded-md transition-all ${
                                      (!canConfigure || !isRoleEnabled) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                                    } ${
                                      active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-400 border-slate-200'
                                    }`}
                                  >
                                    {icons[typeId]} {typeId}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Channels selector group */}
                          <div className="space-y-1">
                            <span className="text-[8px] font-black font-mono text-slate-400 uppercase tracking-wider block">Разрешенные каналы</span>
                            <div className="flex items-center gap-1.5">
                              {[
                                { id: 'push', label: 'Push' },
                                { id: 'system', label: 'Системный' }
                              ].map(ch => {
                                const active = allowedChannels.includes(ch.id);
                                return (
                                  <button
                                    key={ch.id}
                                    disabled={!canConfigure || !isRoleEnabled}
                                    onClick={() => toggleRoleChannel(roleId, ch.id)}
                                    className={`px-2 py-0.5 text-[9.5px] font-bold border rounded-md transition-all ${
                                      (!canConfigure || !isRoleEnabled) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                                    } ${
                                      active ? 'bg-[#3765F6] text-white border-[#3765F6]' : 'bg-white text-slate-400 border-slate-200'
                                    }`}
                                  >
                                    {ch.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {!canConfigure && (
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold rounded-xl flex items-center gap-2 select-none">
                <ShieldAlert size={14} className="text-amber-600 shrink-0" />
                <span>Редактирование настроек заблокировано. У вашей роли ({ROLE_LABELS[user.role] || user.role}) нет прав администратора уведомлений.</span>
              </div>
            )}

          </div>
        )}
      </div>

      {/* 2. New Push Notification Form */}
      <div className="bg-white/40 border border-white/45 backdrop-blur-xl rounded-[1.8rem] p-6 lg:p-8 shadow-sm">
        
        {/* Block Header */}
        <div className="border-b border-white/40 pb-5 mb-6">
          <span className="bg-[#3765F6]/10 text-[#3765F6] border border-[#3765F6]/10 font-mono text-[9px] font-semibold uppercase tracking-widest px-2.5 py-0.5 rounded-full mb-1.5 inline-block">
            Broadcast Communication
          </span>
          <h2 className="text-sm font-bold tracking-tight text-slate-900 mt-1 flex items-center gap-1.5">
            <BellRing className="h-4.5 w-4.5 text-[#3765F6]" />
            Создать новое уведомление
          </h2>
          <p className="text-[11px] text-slate-500 font-medium mt-1 leading-relaxed">
            Заполните поля ниже, чтобы мгновенно транслировать важное объявление на экраны соответствующих сотрудников.
          </p>
        </div>

        {canConfigure ? (
          <form onSubmit={handleSend} className="space-y-6 animate-in fade-in">
            
            {/* Target Audience Settings */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block font-mono">
                🎯 Получатели (целевые роли):
              </label>
              
              {/* Presets */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => applyPreset('all')}
                  className={`px-3 py-1.5 text-[10.5px] font-bold rounded-xl border transition-all cursor-pointer ${
                    selectedRoles.length === 0
                      ? 'bg-[#3765F6] text-white border-[#3765F6] shadow-xs'
                      : 'bg-white/50 text-slate-600 border-white/65 hover:bg-white/80'
                  }`}
                >
                  Все получатели
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('admins')}
                  className={`px-3 py-1.5 text-[10.5px] font-bold rounded-xl border transition-all cursor-pointer ${
                    selectedRoles.length === 2 && selectedRoles.includes('admin') && selectedRoles.includes('root_admin')
                      ? 'bg-[#3765F6] text-white border-[#3765F6] shadow-xs'
                      : 'bg-white/50 text-slate-600 border-white/65 hover:bg-white/80'
                  }`}
                >
                  Только Администрация
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('employees')}
                  className={`px-3 py-1.5 text-[10.5px] font-bold rounded-xl border transition-all cursor-pointer ${
                    selectedRoles.length === 6 && !selectedRoles.includes('admin')
                      ? 'bg-[#3765F6] text-white border-[#3765F6] shadow-xs'
                      : 'bg-white/50 text-slate-600 border-white/65 hover:bg-white/80'
                  }`}
                >
                  Только сотрудники
                </button>
              </div>

              {/* Detailed checkboxes list */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1.5">
                {Object.entries(ROLE_LABELS).map(([roleId, label]) => {
                  const isChecked = selectedRoles.includes(roleId);
                  const isRoleEnabled = enabledRoles.includes(roleId);
                  
                  return (
                    <button
                      key={roleId}
                      type="button"
                      disabled={!isRoleEnabled}
                      onClick={() => toggleRoleSelection(roleId)}
                      className={`px-3 py-2 rounded-xl text-left text-xs font-semibold border flex items-center justify-between transition-all cursor-pointer ${
                        isChecked
                          ? 'bg-white border-[#3765F6] text-[#3765F6] shadow-2xs'
                          : 'bg-white/30 border-white/40 text-slate-500 hover:bg-white/60 hover:text-slate-800'
                      } ${!isRoleEnabled ? 'opacity-35 line-through cursor-not-allowed' : ''}`}
                    >
                      <span className="truncate">{label}</span>
                      <span className={`w-1.5 h-1.5 rounded-full ${isChecked ? 'bg-[#3765F6]' : 'bg-slate-300'}`} />
                    </button>
                  );
                })}
              </div>
              {selectedRoles.length > 0 && (
                <p className="text-[9.5px] text-slate-400 font-semibold font-mono">
                  * Объявление увидят только выбранные роли (активные в приеме).
                </p>
              )}
            </div>

            {/* Style / Type settings */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block font-mono">
                🎨 Оформление и важность:
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {eventTypes.map((type) => {
                  const isActive = selectedType === type.id;
                  return (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => setSelectedType(type.id)}
                      className={`px-4 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                        isActive ? type.activeClass : type.colorClass
                      }`}
                    >
                      <span>{type.icon}</span>
                      <span>{type.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Text area input */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block font-mono">
                📝 Текст сообщения:
              </label>
              <textarea
                value={notifText}
                onChange={(e) => setNotifText(e.target.value)}
                placeholder="Введите важное объявление, которое мгновенно отобразится у получателей..."
                className="w-full text-xs p-4 bg-white/45 border border-white/50 backdrop-blur-md rounded-2xl outline-none focus:ring-4 focus:ring-[#3765F6]/15 focus:border-[#3765F6] transition-all font-sans min-h-[100px] resize-y shadow-inner text-slate-800"
                required
              />
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={!notifText.trim()}
                className="px-5 py-3 bg-[#3765F6] hover:bg-[#2555E5] active:scale-95 text-white shadow-xs disabled:bg-slate-900/10 disabled:text-slate-400 font-bold tracking-wide text-xs rounded-xl flex items-center gap-2 cursor-pointer transition-all duration-150"
              >
                <Send className="h-4 w-4" />
                <span>Отправить получателям</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="p-6 bg-slate-50 border border-slate-200/50 rounded-2xl text-center select-none space-y-3">
            <span className="p-3 bg-amber-50 text-amber-600 rounded-xl inline-block">
              <ShieldAlert size={24} />
            </span>
            <h4 className="text-xs font-bold text-slate-800">Функция отправки недоступна</h4>
            <p className="text-[10.5px] text-slate-400 max-w-md mx-auto leading-normal">
              Пользователям вашей роли ({ROLE_LABELS[user.role] || user.role}) заблокирована возможность ручной рассылки уведомлений. Пожалуйста, обратитесь к разработчику.
            </p>
          </div>
        )}
      </div>

      {/* 3. History & Read tracking */}
      <div className="bg-white/40 border border-white/45 backdrop-blur-xl rounded-[1.8rem] p-6 lg:p-8 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4.5 w-4.5 text-slate-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-850">
            История отправленных push-уведомлений
          </h3>
        </div>

        {notifications.length === 0 ? (
          <div className="bg-white/20 border border-white/30 shadow-inner rounded-[1.5rem] py-12 text-center">
            <span className="text-xs text-slate-400 font-bold uppercase tracking-widest font-mono">Уведомлений пока не найдено</span>
          </div>
        ) : (
          <div className="space-y-4">
            {notifications.map((notif) => {
              const readUsers = Object.entries(notif.readBy || {});
              const isExpanded = expandedNotifId === notif.id;
              const hasTargetRoles = notif.targetRoles && notif.targetRoles.length > 0;
              
              // Style badge depending on type
              let typeBadge = "bg-[#3765F6]/10 text-[#3765F6]";
              let typeIcon = "📢";
              if (notif.type === 'alert') { typeBadge = "bg-rose-500/10 text-rose-600"; typeIcon = "🚨"; }
              else if (notif.type === 'warning') { typeBadge = "bg-amber-500/10 text-amber-700"; typeIcon = "⚠️"; }
              else if (notif.type === 'success') { typeBadge = "bg-emerald-500/10 text-emerald-600"; typeIcon = "✅"; }

              return (
                <div
                  key={notif.id}
                  className="bg-white/50 border border-white/45 backdrop-blur-md shadow-inner rounded-[1.8rem] p-5 transition-all duration-150 hover:bg-white/60"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2.5 flex-1">
                      
                      {/* Metainfo Line */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${typeBadge} flex items-center gap-1`}>
                          <span>{typeIcon}</span>
                          <span>{notif.type || 'info'}</span>
                        </span>
                        
                        <span className="bg-slate-900/5 text-slate-600 text-[9px] font-mono font-bold px-2 py-0.5 rounded-md">
                          Таргет: {hasTargetRoles ? notif.targetRoles.map((r: string) => ROLE_LABELS[r] || r).join(', ') : 'Все сотрудники'}
                        </span>
                      </div>

                      <p className="text-xs text-slate-800 font-semibold leading-relaxed whitespace-pre-wrap">
                        {notif.text}
                      </p>
                      
                      <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400 font-bold font-mono">
                        <span className="text-slate-500">Отправитель: {notif.createdBy}</span>
                        <span>•</span>
                        <span>{formatTime(notif.createdAt)}</span>
                      </div>
                    </div>

                    {canConfigure && (
                      <button
                        onClick={() => handleDelete(notif.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 rounded-xl transition-all cursor-pointer shrink-0"
                        title="Удалить уведомление"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {/* Read statistics */}
                  <div className="mt-4 pt-3 border-t border-white/35 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedNotifId(isExpanded ? null : notif.id)}
                      className="flex items-center gap-2 self-start text-[10.5px] font-bold text-slate-600 hover:text-[#3765F6] transition-colors select-none cursor-pointer"
                    >
                      <Users className="h-3.5 w-3.5 text-slate-400" />
                      <span>Прочитано пользователей:</span>
                      <span className="px-2 py-0.5 bg-slate-900/10 text-slate-800 font-black rounded-full text-[9px] font-mono">
                        {readUsers.length}
                      </span>
                      <span className="text-[9px] text-slate-400 font-semibold">
                        (Нажмите для {isExpanded ? 'скрытия' : 'просмотра'})
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="mt-2 pl-1 animate-in fade-in slide-in-from-top-1 duration-100">
                        {readUsers.length === 0 ? (
                          <span className="text-[10px] text-slate-400 font-bold italic block font-mono">
                            Пока никто не прочитал это уведомление.
                          </span>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 pt-1">
                            {readUsers.map(([uid, details]: [string, any]) => (
                              <div
                                key={uid}
                                className="flex items-center gap-2 bg-white/50 border border-white/45 backdrop-blur-sm rounded-xl px-2.5 py-1.5 text-[10px]"
                              >
                                <div className="p-0.5 bg-[#3765F6]/5 text-[#3765F6] rounded-md">
                                  <UserCheck className="h-3.5 w-3.5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <span className="font-extrabold text-slate-800 block truncate leading-none">
                                    {details.username}
                                  </span>
                                  <span className="text-[8.5px] text-slate-450 font-mono leading-none mt-1 block font-bold">
                                    {new Date(details.readAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
