import React, { useState, useEffect } from 'react';
import { UserProfile, AppSettings, FerryTemplate, DistancePreset, Announcement, QuickLink, CarRateGroup, Driver } from '../../types';
import { dbService } from '../../firebase';
import { pdService } from '../../firebase/planDohodService';
import { 
  Settings, 
  Plus, 
  Trash2, 
  Anchor, 
  Compass, 
  Megaphone, 
  ExternalLink, 
  Lock,
  Truck,
  Wallet,
  MapPin,
  TrendingUp,
  Edit2,
  Users
} from 'lucide-react';
import { useDialog } from '../DialogProvider';
import { useToast } from '../ToastProvider';

interface SettingsModuleProps {
  user: UserProfile;
}

export default function SettingsModule({ user }: SettingsModuleProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  
  // Dynamic directory builders
  const [ferries, setFerries] = useState<FerryTemplate[]>([]);
  const [distances, setDistances] = useState<DistancePreset[]>([]);
  const [carRateGroups, setCarRateGroups] = useState<CarRateGroup[]>([]);

  // Local Form states (Tariff Group)
  const [stName, setStName] = useState('');
  const [stRate, setStRate] = useState<number>(0.125);
  const [stPerDiem, setStPerDiem] = useState<number | undefined>(undefined);
  const [stComment, setStComment] = useState('');

  // Local Form states (Ferry)
  const [fName, setFName] = useState('');
  const [fPrice, setFPrice] = useState<number>(0);

  // Local Form states (Distance)
  const [dFrom, setDFrom] = useState('');
  const [dTo, setDTo] = useState('');
  const [dKm, setDKm] = useState<number>(0);

  // Local Form states (Announcement)
  const [annText, setAnnText] = useState('');
  const [annImportant, setAnnImportant] = useState(false);

  // Local Form states (Quick link)
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  
  // Modal for adding vehicle
  const [addingVehicleGroup, setAddingVehicleGroup] = useState<CarRateGroup | null>(null);
  const [newVehiclePlate, setNewVehiclePlate] = useState('');

  // Directions & coefficients list
  const [directions, setDirections] = useState<Record<string, number>>({});
  // Local Form states (Directions)
  const [dirName, setDirName] = useState('');
  const [dirCoeff, setDirCoeff] = useState<number>(1.0);
  const [editingDirKey, setEditingDirKey] = useState<string | null>(null);

  // Drivers Directory State
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [drName, setDrName] = useState('');
  const [drPhone, setDrPhone] = useState('');
  const [drLicense, setDrLicense] = useState('');
  const [drRateGroupId, setDrRateGroupId] = useState('');
  const [drComment, setDrComment] = useState('');
  
  useEffect(() => {
    // Sync settings & categories
    const unsubSettings = dbService.getSettings(setSettings);
    const unsubFerries = dbService.getFerryTemplates(setFerries);
    const unsubDistances = dbService.getDistances(setDistances);
    const unsubCars = dbService.getCarRateGroups(setCarRateGroups);
    const unsubDirections = pdService.subscribeDirections(setDirections);
    const unsubDrivers = dbService.getDrivers(setDrivers);

    return () => {
      unsubSettings();
      unsubFerries();
      unsubDistances();
      unsubCars();
      unsubDirections();
      unsubDrivers();
    };
  }, []);

  // --- Directions & Coefficients Presets handlers ---
  const handleAddDirection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirName.trim() || dirCoeff < 0) return;
    
    const formattedName = dirName.trim();
    const updatedDirections = { ...directions };
    
    // If name changed during edit, clean up the old entry
    if (editingDirKey && editingDirKey !== formattedName) {
      delete updatedDirections[editingDirKey];
    }
    
    updatedDirections[formattedName] = dirCoeff;
    pdService.addDirection(updatedDirections);
    dbService.logAction(user.name, user.role, editingDirKey ? 'Edit Direction' : 'Add Direction', 'Settings', formattedName, `${editingDirKey ? 'Обновлено' : 'Добавлено'} направление: ${formattedName} с коэф: ${dirCoeff}`);
    
    setDirName('');
    setDirCoeff(1.0);
    setEditingDirKey(null);
  };

  const handleDeleteDirection = async (nameToDel: string) => {
    if (!(await showConfirm(`Вы действительно хотите удалить направление "${nameToDel}"?`))) return;
    const updatedDirections = { ...directions };
    delete updatedDirections[nameToDel];
    pdService.removeDirection(updatedDirections);
    dbService.logAction(user.name, user.role, 'Delete Direction', 'Settings', nameToDel, `Удалено направление: ${nameToDel}`);
    if (editingDirKey === nameToDel) {
      setDirName('');
      setDirCoeff(1.0);
      setEditingDirKey(null);
    }
  };

  const handleEditClickDirection = (nameToEdit: string, cVal: number) => {
    setDirName(nameToEdit);
    setDirCoeff(cVal);
    setEditingDirKey(nameToEdit);
  };

  const handleCancelEditDirection = () => {
    setDirName('');
    setDirCoeff(1.0);
    setEditingDirKey(null);
  };

  // Save/Delete Tariffs
  const handleAddTariff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stName || stRate <= 0) return;
    
    const newGroupId = "st_" + Date.now();
    const newGroup: CarRateGroup = {
      id: newGroupId,
      name: stName.trim(),
      rate: stRate,
      perDiemRate: stPerDiem,
      vehicles: [],
      comment: stComment.trim()
    };

    dbService.saveCarRateGroup(newGroup, user.name, user.role);
    setStName('');
    setStRate(0.125);
    setStPerDiem(undefined);
    setStComment('');
    toast("Тарифная группа успешно сохранена.", 'success');
  };

  const handleDeleteTariff = async (id: string) => {
    if (await showConfirm("Удалить эту тарифную группу?")) {
      dbService.deleteCarRateGroup(id, user.name, user.role);
    }
  };

  // Drivers Handlers
  const handleAddDriver = (e: React.FormEvent) => {
    e.preventDefault();
    if (!drName.trim()) return;

    const newDriver: Driver = {
      id: "dr_" + Date.now(),
      name: drName.trim(),
      phone: drPhone.trim(),
      license: drLicense.trim(),
      rateGroupId: drRateGroupId,
      comment: drComment.trim()
    };

    dbService.saveDriver(newDriver, user.name, user.role);
    setDrName('');
    setDrPhone('');
    setDrLicense('');
    setDrRateGroupId('');
    setDrComment('');
    toast("Водитель успешно добавлен в справочник.", 'success');
  };

  const handleDeleteDriver = async (id: string, name: string) => {
    if (await showConfirm(`Вы действительно хотите удалить водителя "${name}" из справочника?`)) {
      dbService.deleteDriver(id, user.name, user.role);
    }
  };

  // Save/Delete Ferries
  const handleAddFerry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fName || fPrice <= 0) return;
    
    const newFerry: FerryTemplate = {
      id: "ferry_" + Date.now(),
      name: fName.trim(),
      price: fPrice
    };

    dbService.saveFerryTemplate(newFerry, user.name, user.role);
    setFName('');
    setFPrice(0);
    toast("Паромный коэффициент сохранен.", 'success');
  };

  const handleDeleteFerry = (id: string) => {
    console.log(`SettingsModule: Deleting ferry ${id}`);
    dbService.deleteFerryTemplate(id, user.name, user.role);
  };

  // Save/Delete Distances
  const handleAddDistance = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dFrom || !dTo || dKm <= 0) return;

    const newDist: DistancePreset = {
      id: "dist_" + Date.now(),
      from: dFrom.trim(),
      to: dTo.trim(),
      distance: dKm
    };

    dbService.saveDistance(newDist, user.name, user.role);
    setDFrom('');
    setDTo('');
    setDKm(0);
    toast("Ориентир маршрута внесен в базу.", 'success');
  };

  const handleDeleteDistance = async (id: string) => {
    if (await showConfirm("Удалить этот ориентир?")) {
      dbService.deleteDistance(id, user.name, user.role);
    }
  };

  // Save settings (Announcements block / Bookmarks block)
  const handleAddAnnouncement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!annText.trim() || !settings) return;

    const newAnn: Announcement = {
      id: "ann_" + Date.now(),
      text: annText.trim(),
      date: new Date().toLocaleDateString(),
      author: user.name,
      important: annImportant
    };

    const updated: AppSettings = {
      ...settings,
      announcements: [newAnn, ...(settings.announcements || [])]
    };

    dbService.saveSettings(updated, user.name, user.role);
    setAnnText('');
    setAnnImportant(false);
    toast("Объявление транслировано на Dashboard.", 'success');
  };

  const handleDeleteAnnouncement = (id: string) => {
    if (!settings) return;
    const updated: AppSettings = {
      ...settings,
      announcements: settings.announcements.filter(a => a.id !== id)
    };
    dbService.saveSettings(updated, user.name, user.role);
  };

  const handleAddQuickLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkTitle || !linkUrl || !settings) return;

    const newLink: QuickLink = {
      id: "link_" + Date.now(),
      title: linkTitle.trim(),
      url: linkUrl.trim()
    };

    const updated: AppSettings = {
      ...settings,
      quickLinks: [...(settings.quickLinks || []), newLink]
    };

    dbService.saveSettings(updated, user.name, user.role);
    setLinkTitle('');
    setLinkUrl('');
    toast("Ссылка выведена на Dashboard.", 'success');
  };

  const handleDeleteQuickLink = (id: string) => {
    if (!settings) return;
    const updated: AppSettings = {
      ...settings,
      quickLinks: settings.quickLinks.filter(l => l.id !== id)
    };
    dbService.saveSettings(updated, user.name, user.role);
  };

  // Guard view options
  if (user.permissions.settings === 'none') {
    return (
      <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgba(0,0,0,0.01)] border border-slate-200/50 text-center flex flex-col justify-center items-center py-24 select-none">
        <Lock className="h-12 w-12 text-slate-400 mb-4" style={{ strokeWidth: 1.5 }} />
        <span className="text-sm font-black text-slate-900 uppercase font-mono tracking-wider">Раздел заблокирован</span>
        <p className="text-xs text-slate-500 max-w-xs mt-2 font-medium">
          Просмотр справочников закрыт в соответствии с политикой администратора.
        </p>
      </div>
    );
  }

  const isWritePermitted = user.permissions.settings === 'write';

  return (
    <div className="w-full space-y-6 font-sans">
      
      {/* Global Rates Settings */}
      <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)]">
        <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-6">
          <Settings className="h-4 w-4 text-slate-900" style={{ fill: '#70FC8E' }} />
          Глобальные ставки
        </h2>
        {settings && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block font-mono">Ставка простоя (€/день)</label>
              <input
                type="number"
                defaultValue={settings.idleRate}
                onBlur={(e) => dbService.saveSettings({...settings, idleRate: Number(e.target.value)}, user.name, user.role)}
                className="w-full mt-2 px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block font-mono">Ставка суточных (€/день)</label>
              <input
                type="number"
                defaultValue={settings.perDiemRate}
                onBlur={(e) => dbService.saveSettings({...settings, perDiemRate: Number(e.target.value)}, user.name, user.role)}
                className="w-full mt-2 px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black"
              />
            </div>
          </div>
        )}
      </div>

      {/* ROW 0: TARIFF GROUPS */}
      <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
        <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
          <Truck className="h-4.5 w-4.5 text-slate-900 font-bold" style={{ fill: '#70FC8E' }} />
          Тарифные группы (Зарплата и Авто)
        </h2>

        {isWritePermitted && (
            <form onSubmit={handleAddTariff} className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/50">
              <input
                type="text"
                placeholder="Название (Группа 0.14)"
                required
                value={stName}
                onChange={(e) => setStName(e.target.value)}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400 sm:col-span-1"
              />
              <input
                type="number"
                step="0.001"
                placeholder="Тариф за км (€)"
                required
                value={stRate || ''}
                onChange={(e) => setStRate(Number(e.target.value))}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400 sm:col-span-1"
              />
              <input
                type="number"
                placeholder="Суточные (€/день)"
                value={stPerDiem || ''}
                onChange={(e) => setStPerDiem(e.target.value ? Number(e.target.value) : undefined)}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400 sm:col-span-1"
              />
              <input
                type="text"
                placeholder="Комментарий (опционально)"
                value={stComment}
                onChange={(e) => setStComment(e.target.value)}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400 sm:col-span-1"
              />
              <button type="submit" className="bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-xl text-xs font-black uppercase tracking-tight transition cursor-pointer">
                Создать группу
              </button>
            </form>
          )}

        <div className="space-y-4">
          {carRateGroups.map((group) => (
            <div key={group.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
               <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-3">
                 <div>
                   <span className="font-black text-sm text-slate-900">{group.name || 'Без названия'}</span>
                   <span className="font-bold text-xs text-slate-500 ml-2">Тариф: {group.rate} €/км</span>
                   {group.perDiemRate !== undefined && group.perDiemRate > 0 && (
                     <span className="font-bold text-xs text-indigo-500 ml-2">Суточные: {group.perDiemRate} €/д</span>
                   )}
                   {group.comment && <div className="text-[10px] text-slate-400 mt-0.5">{group.comment}</div>}
                 </div>
                 {isWritePermitted && (
                   <button onClick={() => handleDeleteTariff(group.id)} className="text-rose-500 p-2 hover:bg-rose-50 rounded-lg transition self-start sm:self-auto"><Trash2 className="h-4 w-4"/></button>
                 )}
               </div>
               <div className="flex flex-wrap gap-2 text-[10px] font-bold text-slate-700">
                 {(group.vehicles || []).map((v, i) => (
                   <span key={`${group.id}-${i}-${v}`} className="bg-white px-2 py-1 rounded border border-slate-200 flex items-center gap-1">
                     {v}
                     {isWritePermitted && <button onClick={() => dbService.saveCarRateGroup({...group, vehicles: group.vehicles.filter(x => x !== v)}, user.name, user.role)} className="ml-1 text-slate-400">×</button>}
                   </span>
                 ))}
                 {isWritePermitted && (
                   <button 
                     onClick={() => {
                        setAddingVehicleGroup(group);

                     }}
                     className="bg-slate-200 px-2 py-1 rounded text-slate-600 shadow-sm border border-slate-300 hover:bg-slate-300 transition"
                    >+ Добавить авто</button>
                 )}
               </div>
            </div>
          ))}
          {!carRateGroups.length && (
              <div className="text-center py-6 text-slate-400 text-xs font-mono font-black uppercase tracking-widest bg-slate-50 rounded-2xl border border-slate-250/20">Группы не созданы.</div>
          )}
        </div>
        
        {/* Modal for adding vehicle */}
        {addingVehicleGroup && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white p-6 rounded-2xl w-full max-w-sm space-y-4">
              <h3 className="font-black text-sm">Добавить авто в {addingVehicleGroup.name}</h3>
              <input
                type="text"
                className="w-full p-2 border rounded-xl text-xs"
                placeholder="ГОС. НОМЕР"
                value={newVehiclePlate}
                onChange={(e) => setNewVehiclePlate(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={() => setAddingVehicleGroup(null)} className="flex-1 bg-slate-100 p-2 rounded-xl text-xs font-bold">Отмена</button>
                <button 
                  onClick={() => {
                     const normalized = newVehiclePlate.toUpperCase().trim().replace(/\s+/g, ' ');
                     if (normalized && !addingVehicleGroup.vehicles?.includes(normalized)) {
                        dbService.saveCarRateGroup({...addingVehicleGroup, vehicles: [...(addingVehicleGroup.vehicles || []), normalized]}, user.name, user.role);
                        setAddingVehicleGroup(null);
                        setNewVehiclePlate('');
                     }
                  }} 
                  className="flex-1 bg-slate-900 text-white p-2 rounded-xl text-xs font-bold"
                >Добавить</button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ROW 1: DRIVERS DIRECTORY */}
      <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
        <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
          <Users className="h-4.5 w-4.5 text-slate-900 font-bold" style={{ fill: '#70FC8E' }} />
          Справочник водителей (Активная база)
        </h2>

        {isWritePermitted && (
          <form onSubmit={handleAddDriver} className="flex gap-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/50">
            <input
              type="text"
              placeholder="ФИО Водителя (Иванов И.И.)"
              required
              value={drName}
              onChange={(e) => setDrName(e.target.value)}
              className="flex-1 p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400"
            />
            <button type="submit" className="bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-xl text-xs font-black uppercase tracking-tight py-2.5 px-6 transition cursor-pointer shrink-0">
              Добавить водителя
            </button>
          </form>
        )}

        <div className="overflow-x-auto border border-slate-200/60 rounded-2xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-[10px] font-black uppercase text-slate-500 font-mono border-b border-slate-250/30">
                <th className="px-4 py-3">ФИО водителя</th>
                {isWritePermitted && <th className="px-4 py-3 text-right">Действия</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {drivers.map((drv) => {
                return (
                  <tr key={drv.id} className="hover:bg-slate-50/40 transition">
                    <td className="px-4 py-3 font-black text-slate-900">{drv.name}</td>
                    {isWritePermitted && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDeleteDriver(drv.id, drv.name)}
                          className="text-rose-500 p-1.5 hover:bg-rose-50 rounded-lg transition"
                          title="Удалить из базы"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {drivers.length === 0 && (
                <tr>
                  <td colSpan={isWritePermitted ? 2 : 1} className="text-center py-6 text-slate-400 text-xs font-mono font-black uppercase tracking-widest bg-slate-50">
                    Водители не зарегистрированы.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-12">

        {/* ROW 0: DIRECTION EXPENSE COEFFICIENTS */}
        <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
            <TrendingUp className="h-4.5 w-4.5 text-slate-900 font-bold" />
            Районы/направления и коэффициенты расходов
          </h2>
          <p className="text-[10px] text-slate-500 font-bold">Используется при расчете плана дохода. Задает наценку расходов на КМ по умолчанию.</p>

          {isWritePermitted && (
            <form onSubmit={handleAddDirection} className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-200/50">
              <input
                type="text"
                placeholder="Германия / Азия"
                required
                value={dirName}
                onChange={(e) => setDirName(e.target.value)}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-[10px] font-bold text-slate-800 focus:border-slate-450"
              />
              <input
                type="number"
                step="0.01"
                placeholder="Коэф (напр. 1.2)"
                required
                value={dirCoeff}
                onChange={(e) => setDirCoeff(Number(e.target.value))}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-[10px] font-bold text-slate-800 focus:border-slate-450"
              />
              <div className="flex gap-1 pt-0">
                <button type="submit" className="flex-1 bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-xl text-[10px] font-black uppercase tracking-wider transition cursor-pointer">
                  {editingDirKey ? 'Сберечь' : 'Внести'}
                </button>
                {editingDirKey && (
                  <button 
                    type="button" 
                    onClick={handleCancelEditDirection} 
                    className="px-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-[10px] font-bold transition"
                  >
                    Отм
                  </button>
                )}
              </div>
            </form>
          )}

          <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
            {Object.entries(directions).map(([name, coeff]) => (
              <div key={name} className="flex justify-between items-center p-3.5 bg-slate-50/70 rounded-2xl text-xs font-bold border border-slate-200/20 group hover:border-slate-300/60 transition duration-100">
                <span className="text-slate-800 uppercase tracking-tight flex items-center gap-1.5">
                  <MapPin size={12} className="text-slate-400" />
                  {name}
                </span>
                <div className="flex items-center gap-2">
                  <strong className="text-slate-950 font-mono font-black py-1 px-2.5 bg-slate-100 rounded-lg">x{coeff as number}</strong>
                  {isWritePermitted && (
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={() => handleEditClickDirection(name, coeff as number)} 
                        className="text-blue-500 hover:text-blue-700 p-1.5 bg-white border border-slate-150 rounded-lg hover:border-blue-200 transition cursor-pointer"
                        title="Редактировать"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button 
                        onClick={() => handleDeleteDirection(name)} 
                        className="text-rose-500 hover:text-rose-700 p-1.5 bg-white border border-slate-150 rounded-lg hover:border-rose-200 transition cursor-pointer"
                        title="Удалить"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {Object.keys(directions).length === 0 && (
              <div className="text-center py-10 text-slate-400 text-xs font-mono font-black uppercase tracking-widest bg-slate-50 rounded-2xl border border-slate-250/20">Направления не заполнены.</div>
            )}
          </div>
        </div>
        
        {/* ROW 1: FERRY PRICING PRESSETS */}
        <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
            <Anchor className="h-4.5 w-4.5 text-slate-900 font-bold" style={{ fill: '#70FC8E' }} />
            Тарифы Паромных Линий (DFS)
          </h2>
          <p className="text-[10px] text-slate-500 font-bold">Цены указаны в EUR. Справка в другой валюте по внутреннему курсу.</p>

          {isWritePermitted && (
            <form onSubmit={handleAddFerry} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/50">
              <input
                type="text"
                placeholder="Откуда — Куда"
                required
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400"
              />
              <input
                type="number"
                placeholder="Цена (EUR)"
                required
                value={fPrice || ''}
                onChange={(e) => setFPrice(Number(e.target.value))}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400"
              />
              <button type="submit" className="bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-xl text-xs font-black uppercase tracking-tight transition cursor-pointer">
                Добавить
              </button>
            </form>
          )}

          <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
            {ferries.map((fe) => (
              <div key={fe.id} className="flex justify-between items-center p-3.5 bg-slate-50/70 rounded-2xl text-xs font-bold border border-slate-200/20 group hover:border-slate-300/60 transition duration-100">
                <span className="text-slate-800 uppercase tracking-tight">{fe.name}</span>
                <div className="flex items-center gap-3">
                  <strong className="text-slate-950 font-mono font-black">{fe.price} EUR</strong>
                  {isWritePermitted && (
                    <button 
                      onClick={() => handleDeleteFerry(fe.id)} 
                      className="text-rose-500 hover:text-rose-700 p-2 bg-white border border-slate-150 rounded-lg hover:border-rose-200 transition cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!ferries.length && (
              <div className="text-center py-10 text-slate-400 text-xs font-mono font-black uppercase tracking-widest bg-slate-50 rounded-2xl border border-slate-250/20">Тарифы не внесены.</div>
            )}
          </div>
        </div>

        {/* ROW 2: DISTANCES PRESETS */}
        <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
            <Compass className="h-4.5 w-4.5 text-slate-900 font-bold" style={{ fill: '#70FC8E' }} />
            База стандартных расстояний (КМ)
          </h2>

          {isWritePermitted && (
            <form onSubmit={handleAddDistance} className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-200/50">
              <input
                type="text"
                placeholder="От (Минск)"
                required
                value={dFrom}
                onChange={(e) => setDFrom(e.target.value)}
                className="p-2 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-[10px] font-bold text-slate-800"
              />
              <input
                type="text"
                placeholder="До (Берлин)"
                required
                value={dTo}
                onChange={(e) => setDTo(e.target.value)}
                className="p-2 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-[10px] font-bold text-slate-800"
              />
              <input
                type="number"
                placeholder="Расстояние"
                required
                value={dKm || ''}
                onChange={(e) => setDKm(Number(e.target.value))}
                className="p-2 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-[10px] font-bold text-slate-800"
              />
              <button type="submit" className="bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-xl text-[10px] font-black uppercase tracking-wider transition cursor-pointer">
                Внести
              </button>
            </form>
          )}

          <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
            {distances.map((di) => (
              <div key={di.id} className="flex justify-between items-center p-3.5 bg-slate-50/70 rounded-2xl text-xs font-bold border border-slate-200/20 group hover:border-slate-300/60 transition duration-100">
                <span className="text-slate-800 uppercase tracking-tight">{di.from} &rarr; {di.to}</span>
                <div className="flex items-center gap-3">
                  <strong className="text-slate-950 font-mono font-black">{di.distance} км</strong>
                  {isWritePermitted && (
                    <button 
                      onClick={() => handleDeleteDistance(di.id)} 
                      className="text-rose-500 hover:text-rose-700 p-1 bg-white border border-slate-150 rounded-lg hover:border-rose-200 transition cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!distances.length && (
              <div className="text-center py-10 text-slate-400 text-xs font-mono font-black uppercase tracking-widest bg-slate-50 rounded-2xl border border-slate-250/20">Маршруты не заполнены.</div>
            )}
          </div>
        </div>

        {/* ROW 3: SYSTEM NEWS/ANNOUNCEMENTS */}
        <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
            <Megaphone className="h-4.5 w-4.5 text-slate-900 font-bold" style={{ fill: '#70FC8E' }} />
            Доска объявлений
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
          </div>
        </div>

        {/* ROW 4: BOOKMARKS / EXTERNAL QUICK LINKS */}
        <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
            <ExternalLink className="h-4.5 w-4.5 text-slate-900 font-bold" style={{ fill: '#70FC8E' }} />
            Полезные ссылки
          </h2>

          {isWritePermitted && (
            <form onSubmit={handleAddQuickLink} className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-200/50 select-none">
              <input
                type="text"
                placeholder="Служба/Название"
                required
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-slate-450 font-bold"
              />
              <input
                type="url"
                placeholder="https://..."
                required
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-slate-450 font-bold"
              />
              <button type="submit" className="bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-xl text-[10px] font-black uppercase transition cursor-pointer">
                Внедрить Ссылку
              </button>
            </form>
          )}

          <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
            {settings?.quickLinks?.map((li) => (
              <div key={li.id} className="flex justify-between items-center p-3.5 bg-slate-50/70 rounded-2xl text-xs font-bold border border-slate-200/20 group hover:border-slate-300/60 transition duration-100">
                <span className="text-slate-800 uppercase tracking-tight">{li.title}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-slate-400 font-mono max-w-[120px] truncate">{li.url}</span>
                  {isWritePermitted && (
                    <button 
                      onClick={() => handleDeleteQuickLink(li.id)} 
                      className="text-rose-500 hover:text-rose-700 p-1 bg-white border border-slate-150 rounded-lg hover:border-rose-200 transition cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
}
