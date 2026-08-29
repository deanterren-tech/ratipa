import React, {useState, useEffect} from 'react'
import {useFirebase, database, onValue} from '../../../firebase'
import {ref, set, push, update, remove} from 'firebase/database'
import {MapPin, Plus, Trash2, Edit, Save, X, Layers, Route, Truck, FileText} from 'lucide-react'
import {UserProfile} from '../../../types'
import {MapContainer, TileLayer, Marker, Polyline, useMap} from 'react-leaflet'
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {useDialog} from '../../DialogProvider'

interface DozvolaLocationsProps {
  user: UserProfile;
}

interface LocationItem {
  id: string;
  name: string;
  lat: number;
  lng: number;
  notes?: string;
  documents?: string[];
  country?: string;
  status?: 'active' | 'limited' | 'closed';
  limitMax?: number;
}

interface DeliveryItem {
  id: string;
  fromLocId: string;
  toLocId: string;
  dozvolIds: string[];
  sentAt: string;
  receivedAt?: string;
  status: 'sent' | 'received';
  routeLocIds?: string[];
  currentStepIndex?: number;
  receivedAtSteps?: Record<string, string>;
}

const DozvolCommentRow: React.FC<{ d: any; isHighlighted?: boolean }> = ({ d, isHighlighted }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [comment, setComment] = useState(d.comment || '');

  const handleSave = () => {
    if (useFirebase) {
      update(ref(database, `dozvolsRegistryV4/${d.id}`), { comment }).then(() => {
        setIsEditing(false);
      }).catch(err => console.error(err));
    }
  };

  return (
    <div className={`border rounded-xl p-2.5 flex flex-col gap-1.5 shadow-sm transition duration-150 ${
      isHighlighted 
        ? 'bg-amber-50/70 border-amber-400 ring-2 ring-amber-400/10 shadow' 
        : 'bg-white border-slate-200 hover:border-slate-300'
    }`}>
      <div className="flex justify-between items-center gap-2">
        <span className="text-[10px] font-black text-blue-600 bg-blue-50 border border-blue-100/70 px-2 py-0.5 rounded-full uppercase tracking-tight truncate max-w-[150px]" title={d.type}>
          {d.type}
        </span>
        <span className="font-mono font-black text-xs bg-slate-100 text-slate-900 px-2 py-0.5 rounded border border-slate-200/50 shadow-sm shrink-0">
          {d.number}
        </span>
      </div>
      {isEditing ? (
        <div className="flex gap-1 mt-1">
          <input 
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="flex-1 text-[10px] px-1.5 py-0.5 border border-slate-300 rounded outline-none focus:border-blue-500"
            placeholder="Комментарий..."
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            autoFocus
          />
          <button 
            onClick={handleSave}
            className="p-1 bg-emerald-50 text-emerald-600 rounded hover:bg-emerald-100"
          >
            <Save className="w-3 h-3" />
          </button>
          <button 
            onClick={() => { setIsEditing(false); setComment(d.comment || ''); }}
            className="p-1 bg-slate-100 text-slate-500 rounded hover:bg-slate-200"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <div className="flex justify-between items-start gap-2 mt-0.5 group/comment">
          <div className="text-[10px] text-slate-500 italic leading-relaxed min-h-[14px] flex-1">
            {d.comment ? d.comment : <span className="text-slate-300">Нет комментария</span>}
          </div>
          <button 
            onClick={() => setIsEditing(true)}
            className="opacity-0 group-hover/comment:opacity-100 p-0.5 text-slate-400 hover:text-blue-500 hover:bg-slate-50 rounded transition"
          >
            <Edit className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
};

interface MapControllerProps {
  triggerCenter: number;
  locations: Record<string, LocationItem>;
}

const MapController: React.FC<MapControllerProps> = ({ triggerCenter, locations }) => {
  const map = useMap();
  useEffect(() => {
    if (triggerCenter === 0) return;
    const locsArray = Object.values(locations);
    if (locsArray.length === 0) return;
    if (locsArray.length === 1) {
      map.setView([locsArray[0].lat, locsArray[0].lng], 10);
    } else {
      const bounds = L.latLngBounds(locsArray.map(l => [l.lat, l.lng]));
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [triggerCenter, locations, map]);
  return null;
};

interface MapControlsProps {
  onCenter: () => void;
  isLightMap: boolean;
  setIsLightMap: (val: boolean) => void;
}

const MapControls: React.FC<MapControlsProps> = ({ onCenter, isLightMap, setIsLightMap }) => {
  const map = useMap();
  return (
    <div className="absolute top-4 left-4 z-[1000] flex flex-col gap-2 pointer-events-auto">
      <div className="flex flex-col bg-white/95 backdrop-blur-md rounded-xl border border-slate-200/60 shadow-lg p-1">
        <button 
          onClick={() => map.zoomIn()} 
          className="w-8 h-8 rounded-lg text-slate-600 hover:text-[#3765F6] hover:bg-slate-50 flex items-center justify-center font-bold text-base transition cursor-pointer"
          title="Приблизить"
        >
          +
        </button>
        <div className="h-[1px] bg-slate-100 mx-1" />
        <button 
          onClick={() => map.zoomOut()} 
          className="w-8 h-8 rounded-lg text-slate-600 hover:text-[#3765F6] hover:bg-slate-50 flex items-center justify-center font-bold text-base transition cursor-pointer"
          title="Отдалить"
        >
          −
        </button>
      </div>

      <button 
        onClick={onCenter} 
        className="w-10 h-10 bg-white/95 backdrop-blur-md rounded-xl border border-slate-200/60 shadow-lg text-[#3765F6] hover:text-[#2555E5] hover:bg-slate-50 flex items-center justify-center transition cursor-pointer"
        title="Показать все локации"
      >
        <MapPin className="w-5 h-5" />
      </button>

      <button 
        onClick={() => setIsLightMap(!isLightMap)} 
        className={`w-10 h-10 rounded-xl border shadow-lg flex items-center justify-center transition cursor-pointer ${
          isLightMap 
            ? 'bg-[#3765F6] border-[#3765F6] text-white' 
            : 'bg-white/95 border-slate-200/60 text-slate-600 hover:bg-slate-50'
        }`}
        title="Переключить стиль карты"
      >
        <Layers className="w-4 h-4" />
      </button>
    </div>
  );
};

export default function DozvolaLocations({ user }: DozvolaLocationsProps) {
  const { showConfirm } = useDialog();
  const [locations, setLocations] = useState<Record<string, LocationItem>>({});
  const [dozvolsData, setDozvolsData] = useState<Record<string, any>>({});
  const [deliveries, setDeliveries] = useState<Record<string, DeliveryItem>>({});
  const [settings, setSettings] = useState<any>({});

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editLat, setEditLat] = useState<number>(0);
  const [editLng, setEditLng] = useState<number>(0);
  const [editNotes, setEditNotes] = useState('');
  const [editCountry, setEditCountry] = useState('Беларусь');

  const [expandedLocId, setExpandedLocId] = useState<string | null>(null);
  const [expandedDocsLocId, setExpandedDocsLocId] = useState<string | null>(null);
  const [newDocTexts, setNewDocTexts] = useState<Record<string, string>>({});
  
  const [hoveredMarker, setHoveredMarker] = useState<string | null>(null);
  const [selectedLocId, setSelectedLocId] = useState<string | null>(null);
  const [isLightMap, setIsLightMap] = useState(true);
  const [triggerCenter, setTriggerCenter] = useState(0);

  const [showDeliveryForm, setShowDeliveryForm] = useState(false);
  const [editingDelivId, setEditingDelivId] = useState<string | null>(null);
  const [delivFrom, setDelivFrom] = useState('');
  const [delivTo, setDelivTo] = useState('');
  const [delivRoute, setDelivRoute] = useState<string[]>(['']);
  const [delivDozvols, setDelivDozvols] = useState<string[]>([]);
  const [delivSentAt, setDelivSentAt] = useState('');
  const [delivSearchQuery, setDelivSearchQuery] = useState('');
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [locSearchQueries, setLocSearchQueries] = useState<Record<string, string>>({});
  const [popupSearchQueries, setPopupSearchQueries] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!useFirebase) return;
    const unsubLocs = onValue(ref(database, 'locationsDB'), (snap) => setLocations(snap.val() || {}));
    const unsubDozvols = onValue(ref(database, 'dozvolsRegistryV4'), (snap) => setDozvolsData(snap.val() || {}));
    const unsubDeliv = onValue(ref(database, 'locationsDeliveries'), (snap) => setDeliveries(snap.val() || {}));
    return () => { unsubLocs(); unsubDozvols(); unsubDeliv(); };
  }, []);

  const handleAddLocation = () => {
    if (!useFirebase) return;
    const newKey = push(ref(database, 'locationsDB')).key;
    if (newKey) {
      set(ref(database, `locationsDB/${newKey}`), {
        id: newKey,
        name: 'Новая локация',
        lat: 53.9006,
        lng: 27.5590,
        notes: '',
        country: 'Беларусь',
        status: 'active',
        limitMax: 20
      });
      setEditingId(newKey);
      setEditName('Новая локация');
      setEditLat(53.9006);
      setEditLng(27.5590);
      setEditNotes('');
      setEditCountry('Беларусь');
    }
  };

  const handleSaveLocation = () => {
    if (!editingId || !useFirebase) return;
    update(ref(database, `locationsDB/${editingId}`), {
      name: editName,
      lat: editLat,
      lng: editLng,
      notes: editNotes,
      country: editCountry
    });
    setEditingId(null);
  };

  const handleDeleteLocation = async (id: string) => {
    if (!useFirebase) return;
    if (await showConfirm('Удалить эту локацию?')) {
      remove(ref(database, `locationsDB/${id}`));
    }
  };

  const handleDeleteDelivery = async (id: string) => {
    if (!useFirebase) return;
    if (await showConfirm('Удалить эту отправку?')) {
      remove(ref(database, `locationsDeliveries/${id}`));
    }
  };

  const handleSaveDelivery = () => {
    const activeRoute = delivRoute.filter(r => r.trim().length > 0);
    const finalRoute = activeRoute.length > 0 ? activeRoute : (delivTo ? [delivTo] : []);
    
    if (!delivFrom || finalRoute.length === 0 || delivDozvols.length === 0 || !delivSentAt || !useFirebase) return;
    
    const immediateTo = finalRoute[0];
    
    const deliveryPayload: any = {
      fromLocId: delivFrom,
      toLocId: immediateTo,
      dozvolIds: delivDozvols,
      sentAt: delivSentAt,
      routeLocIds: finalRoute,
      currentStepIndex: 0,
    };

    if (editingDelivId) {
      const existing = deliveries[editingDelivId];
      if (existing) {
        deliveryPayload.currentStepIndex = existing.currentStepIndex ?? 0;
        deliveryPayload.receivedAtSteps = existing.receivedAtSteps ?? {};
        const idx = deliveryPayload.currentStepIndex;
        if (idx < finalRoute.length) {
          deliveryPayload.toLocId = finalRoute[idx];
        } else {
          deliveryPayload.currentStepIndex = finalRoute.length - 1;
          deliveryPayload.toLocId = finalRoute[finalRoute.length - 1];
        }
      }
      update(ref(database, `locationsDeliveries/${editingDelivId}`), deliveryPayload);
    } else {
      const newKey = push(ref(database, 'locationsDeliveries')).key;
      if (newKey) {
        deliveryPayload.id = newKey;
        deliveryPayload.status = 'sent';
        set(ref(database, `locationsDeliveries/${newKey}`), deliveryPayload);
      }
    }

    setShowDeliveryForm(false);
    setEditingDelivId(null);
    setDelivFrom('');
    setDelivTo('');
    setDelivRoute(['']);
    setDelivDozvols([]);
    setDelivSentAt('');
    setDelivSearchQuery('');
  };

  const handleEditDelivery = (d: DeliveryItem) => {
    setEditingDelivId(d.id);
    setDelivFrom(d.fromLocId);
    setDelivTo(d.toLocId);
    if (d.routeLocIds && d.routeLocIds.length > 0) {
      setDelivRoute(d.routeLocIds);
    } else {
      setDelivRoute([d.toLocId]);
    }
    setDelivDozvols(d.dozvolIds || []);
    setDelivSentAt(d.sentAt);
    setShowDeliveryForm(true);
  };

  const handleReceiveDelivery = (d: DeliveryItem) => {
    if (!useFirebase) return;
    const toLocName = locations[d.toLocId]?.name;
    if (!toLocName) return;

    const updates: Record<string, any> = {};
    const now = new Date().toISOString();

    const hasRoute = d.routeLocIds && d.routeLocIds.length > 1;
    const currentIdx = d.currentStepIndex ?? 0;

    if (hasRoute && currentIdx < d.routeLocIds.length - 1) {
      const nextIdx = currentIdx + 1;
      const nextLocId = d.routeLocIds[nextIdx];
      
      updates[`locationsDeliveries/${d.id}/currentStepIndex`] = nextIdx;
      updates[`locationsDeliveries/${d.id}/toLocId`] = nextLocId;
      updates[`locationsDeliveries/${d.id}/receivedAtSteps/${d.toLocId}`] = now;
      
      if (d.dozvolIds) {
        d.dozvolIds.forEach(dId => {
          updates[`dozvolsRegistryV4/${dId}/car`] = toLocName;
        });
      }
    } else {
      updates[`locationsDeliveries/${d.id}/status`] = 'received';
      updates[`locationsDeliveries/${d.id}/receivedAt`] = now;
      if (hasRoute) {
        updates[`locationsDeliveries/${d.id}/receivedAtSteps/${d.toLocId}`] = now;
      }

      if (d.dozvolIds) {
        d.dozvolIds.forEach(dId => {
          updates[`dozvolsRegistryV4/${dId}/car`] = toLocName;
        });
      }
    }

    update(ref(database), updates);
  };

  const handleAddDocument = (locId: string, text: string, currentDocs: string[]) => {
    if (!text || !text.trim() || !useFirebase) return;
    const cleanText = text.trim();
    const updatedDocs = [...currentDocs, cleanText];
    
    update(ref(database, `locationsDB/${locId}`), {
      documents: updatedDocs
    }).then(() => {
      setNewDocTexts(prev => ({ ...prev, [locId]: '' }));
    }).catch(err => console.error(err));
  };

  const handleRemoveDocument = async (locId: string, indexToRemove: number, currentDocs: string[]) => {
    if (!useFirebase) return;
    if (await showConfirm('Удалить этот документ из локации?')) {
      const updatedDocs = currentDocs.filter((_, idx) => idx !== indexToRemove);
      update(ref(database, `locationsDB/${locId}`), {
        documents: updatedDocs.length > 0 ? updatedDocs : null
      }).catch(err => console.error(err));
    }
  };

  const dozvolsAtFrom = delivFrom && locations[delivFrom] 
    ? Object.keys(dozvolsData).map(key => ({ id: key, ...dozvolsData[key] })).filter((d: any) => 
        (d.car === locations[delivFrom].name || d.assignedVehicle === locations[delivFrom].name || d.status === locations[delivFrom].name) &&
        d.status !== 'used' && d.status !== 'expired'
      ) 
    : [];

  const filteredDozvolsAtFrom = dozvolsAtFrom.filter((d: any) => {
    const query = delivSearchQuery.toLowerCase().trim();
    if (!query) return true;
    return (
      (d.number || '').toLowerCase().includes(query) ||
      (d.type || '').toLowerCase().includes(query) ||
      (d.comment || '').toLowerCase().includes(query)
    );
  });

  const normalizedLocations = Object.values(locations).map(l => ({
    ...l,
    country: l.country || 'Беларусь'
  }));

  const filteredLocs = normalizedLocations.filter(loc => {
    // Search query match
    const q = globalSearchQuery.toLowerCase().trim();
    if (!q) return true;

    // Matches name, country, or notes
    const matchesLoc = loc.name.toLowerCase().includes(q) || 
                       (loc.country || 'Беларусь').toLowerCase().includes(q) || 
                       (loc.notes || '').toLowerCase().includes(q);
    if (matchesLoc) return true;

    // Or matches permits inside this location
    const dozvolsAtLoc = Object.keys(dozvolsData).map(key => ({ id: key, ...dozvolsData[key] })).filter((d: any) => 
       (d.car === loc.name || d.assignedVehicle === loc.name || d.status === loc.name) &&
       d.status !== 'used' && d.status !== 'expired'
    );
    const matchesDozvols = dozvolsAtLoc.some((d: any) => 
      (d.number || '').toLowerCase().includes(q) ||
      (d.type || '').toLowerCase().includes(q) ||
      (d.comment || '').toLowerCase().includes(q)
    );
    return matchesDozvols;
  });

  return (
    <div className="flex flex-col h-[820px] w-full gap-4 text-slate-800">
      
      {/* 1) ВЕРХНЯЯ ПАНЕЛЬ ФИЛЬТРОВ И ДЕЙСТВИЙ */}
      <div className="bg-white/80 backdrop-blur-xl rounded-2xl p-4 border border-slate-200/50 shadow-[0_4px_20px_rgba(0,0,0,0.01)] flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
        <div className="flex flex-col">
          <span className="text-[10px] font-bold text-[#3765F6] uppercase tracking-wider">Логистический узел</span>
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 mt-0.5">
            <Route className="w-4 h-4 text-[#3765F6]" />
            Интерактивная карта и логистика дозволов
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          {/* Search Inputs */}
          <div className="relative min-w-[180px] flex-1 sm:flex-initial">
            <input 
              type="text"
              placeholder="Поиск дозвола..."
              value={globalSearchQuery}
              onChange={(e) => setGlobalSearchQuery(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200/60 rounded-xl pl-3 pr-8 py-2 outline-none focus:border-[#3765F6] focus:bg-white transition font-medium"
            />
            {globalSearchQuery && (
              <button 
                onClick={() => setGlobalSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button 
            onClick={handleAddLocation}
            className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3 min-h-[44px] py-2 rounded-xl transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Добавить точку
          </button>
          
          <button 
            onClick={() => {
              const firstLoc = Object.keys(locations)[0];
              if (firstLoc) setDelivFrom(firstLoc);
              setShowDeliveryForm(true);
            }}
            className="flex items-center gap-1 bg-[#3765F6] hover:bg-[#2555E5] text-white text-xs font-semibold px-3.5 min-h-[44px] py-2 rounded-xl transition cursor-pointer shadow-sm shadow-blue-500/10"
          >
            <Truck className="w-3.5 h-3.5" />
            Оформить отправку
          </button>
        </div>
      </div>

      {/* TWO COLUMNS BODY */}
      <div className="flex-1 flex gap-4 min-h-0">
        
        {/* SIDEBAR COL (LEFT) */}
        <div className="w-80 sm:w-[350px] flex flex-col gap-4 h-full shrink-0 min-h-0">
          
          {/* LOCATIONS LIST */}
          <div className="flex-1 flex flex-col bg-white/70 backdrop-blur-xl rounded-2xl border border-slate-200/50 p-4 min-h-0 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#3765F6]" />
                Локации ({filteredLocs.length})
              </h3>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {filteredLocs.map((loc) => {
                const isEditing = editingId === loc.id;
                const dozvolsAtLoc = Object.keys(dozvolsData).map(key => ({ id: key, ...dozvolsData[key] })).filter((d: any) => 
                   (d.car === loc.name || d.assignedVehicle === loc.name || d.status === loc.name) &&
                   d.status !== 'used' && d.status !== 'expired'
                );
                const count = dozvolsAtLoc.length;
                const limitMax = loc.limitMax || 20;
                const docs = (loc.documents ? (Array.isArray(loc.documents) ? loc.documents : Object.values(loc.documents)) : []) as string[];
                const globQuery = globalSearchQuery.toLowerCase().trim();
                const locQuery = (locSearchQueries[loc.id] || '').toLowerCase().trim();
                
                const hasMatchingDozvol = globQuery ? dozvolsAtLoc.some((d: any) => 
                  (d.number || '').toLowerCase().includes(globQuery) ||
                  (d.type || '').toLowerCase().includes(globQuery) ||
                  (d.comment || '').toLowerCase().includes(globQuery)
                ) : false;

                const filteredDozvols = dozvolsAtLoc.filter((d: any) => {
                  if (globQuery) {
                    const matchesGlob = (d.number || '').toLowerCase().includes(globQuery) ||
                                        (d.type || '').toLowerCase().includes(globQuery) ||
                                        (d.comment || '').toLowerCase().includes(globQuery);
                    if (!matchesGlob) return false;
                  }
                  if (locQuery) {
                    const matchesLoc = (d.number || '').toLowerCase().includes(locQuery) ||
                                       (d.type || '').toLowerCase().includes(locQuery) ||
                                       (d.comment || '').toLowerCase().includes(locQuery);
                    if (!matchesLoc) return false;
                  }
                  return true;
                });

                const isDozvolsExpanded = expandedLocId === loc.id || (globQuery !== '' && hasMatchingDozvol);

                if (isEditing) {
                  return (
                    <div key={loc.id} className="flex flex-col gap-3 bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-1 mb-1">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Редактирование</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase">Название локации</label>
                        <input 
                          type="text" 
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-[#3765F6] focus:bg-white transition"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase">Страна / Регион</label>
                        <input 
                          type="text" 
                          value={editCountry}
                          onChange={(e) => setEditCountry(e.target.value)}
                          className="w-full text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-[#3765F6] focus:bg-white transition"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase">Заметки</label>
                        <textarea
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          className="w-full text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-[#3765F6] h-12 resize-none transition"
                        />
                      </div>
                      <div className="flex justify-end gap-1.5 mt-1 font-semibold">
                        <button onClick={() => setEditingId(null)} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-[10px] text-slate-600 rounded-lg transition">
                          Отмена
                        </button>
                        <button onClick={handleSaveLocation} className="px-2.5 py-1 bg-[#3765F6] hover:bg-[#2555E5] text-[10px] text-white rounded-lg transition">
                          Сохранить
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div 
                    key={loc.id}
                    onClick={() => setSelectedLocId(loc.id)}
                    className={`cursor-pointer group relative flex flex-col gap-2 p-3.5 rounded-xl border transition duration-150 ${
                      selectedLocId === loc.id 
                        ? 'bg-blue-50/20 border-[#3765F6] ring-1 ring-[#3765F6]/15 shadow-sm' 
                        : hasMatchingDozvol 
                          ? 'bg-amber-50/20 border-amber-300 ring-1 ring-amber-400/10 shadow-sm' 
                          : 'bg-white border-slate-200/60 hover:border-slate-300 shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between pr-8">
                      <div className="flex flex-col min-w-0">
                        <h4 className="font-bold text-slate-800 text-xs truncate group-hover:text-[#3765F6] transition">
                          {loc.name}
                        </h4>
                        <span className="text-[10px] text-slate-400 font-medium">{loc.country}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {hasMatchingDozvol && (
                          <span className="bg-amber-500 text-white px-1.5 py-0.2 rounded text-[8px] font-bold uppercase">
                            Найдено
                          </span>
                        )}
                        <span className="bg-blue-50 text-[#3765F6] border border-blue-100/50 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
                          {count} шт
                        </span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-[10px] mt-0.5">
                      <span className="text-slate-400 font-mono flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-300" />
                        {loc.lat.toFixed(3)}, {loc.lng.toFixed(3)}
                      </span>
                    </div>

                    {loc.notes && (
                      <p className="text-[10px] text-slate-500 bg-slate-50/50 p-2 rounded-lg leading-relaxed border border-slate-100/50 truncate mt-0.5">
                        {loc.notes}
                      </p>
                    )}

                    {/* Collapsible permits details */}
                    <div className="mt-1.5 border-t border-slate-100/70 pt-2 shrink-0" onClick={e => e.stopPropagation()}>
                      <button 
                        onClick={() => setExpandedLocId(expandedLocId === loc.id ? null : loc.id)}
                        className="text-[9px] font-bold text-[#3765F6] hover:text-[#2555E5] uppercase tracking-wider flex items-center gap-1"
                      >
                        {isDozvolsExpanded ? 'Скрыть бланки' : `Показать бланки (${count})`}
                      </button>
                      
                      {isDozvolsExpanded && (
                        <div className="mt-2 flex flex-col gap-1.5">
                          <div className="relative">
                            <input 
                              type="text"
                              placeholder="Быстрый поиск в точке..."
                              value={locSearchQueries[loc.id] || ''}
                              onChange={(e) => setLocSearchQueries(prev => ({ ...prev, [loc.id]: e.target.value }))}
                              className="w-full text-[10px] bg-white border border-slate-200 rounded-lg pl-2 pr-6 py-1 outline-none focus:border-[#3765F6]"
                            />
                            {(locSearchQueries[loc.id] || '') && (
                              <button onClick={() => setLocSearchQueries(prev => ({ ...prev, [loc.id]: '' }))} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400">
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-0.5 custom-scrollbar">
                            {filteredDozvols.map((d: any) => {
                              const isHighlighted = (globQuery !== '' && (
                                (d.number || '').toLowerCase().includes(globQuery) ||
                                (d.type || '').toLowerCase().includes(globQuery) ||
                                (d.comment || '').toLowerCase().includes(globQuery)
                              )) || (locQuery !== '' && (
                                (d.number || '').toLowerCase().includes(locQuery) ||
                                (d.type || '').toLowerCase().includes(locQuery) ||
                                (d.comment || '').toLowerCase().includes(locQuery)
                              ));
                              return (
                                <DozvolCommentRow key={d.id} d={d} isHighlighted={isHighlighted} />
                              );
                            })}
                            {filteredDozvols.length === 0 && (
                              <div className="text-[10px] text-slate-400 italic py-2 text-center">
                                Бланки отсутствуют
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div 
                      className="absolute top-2.5 right-2 opacity-0 group-hover:opacity-100 transition flex items-center gap-1"
                      onClick={e => e.stopPropagation()}
                    >
                      <button 
                        onClick={() => {
                          setEditingId(loc.id);
                          setEditName(loc.name);
                          setEditLat(loc.lat);
                          setEditLng(loc.lng);
                          setEditNotes(loc.notes || '');
                          setEditCountry(loc.country || 'Беларусь');
                        }}
                        className="p-1 bg-white border border-slate-200 hover:border-slate-300 rounded text-slate-500 hover:text-[#3765F6] shadow-sm transition"
                      >
                        <Edit className="w-3 h-3" />
                      </button>
                      <button 
                        onClick={() => handleDeleteLocation(loc.id)}
                        className="p-1 bg-white border border-slate-200 hover:border-rose-300 rounded text-slate-500 hover:text-rose-500 shadow-sm transition"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* DELIVERIES LIST (BOTTOM) */}
          <div className="h-2/5 flex flex-col bg-white/70 backdrop-blur-xl rounded-2xl border border-slate-200/50 p-4 min-h-0 shadow-sm">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 shrink-0 mb-3">
              <Truck className="w-3.5 h-3.5 text-[#3765F6]" />
              Транзитные отправки
            </h3>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {Object.values(deliveries).sort((a: DeliveryItem, b: DeliveryItem) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()).map((d: DeliveryItem) => {
                const hasRoute = d.routeLocIds && d.routeLocIds.length > 0;
                const routeLocs = hasRoute ? d.routeLocIds! : [d.toLocId];
                const currentIdx = d.currentStepIndex ?? 0;
                
                const activeFromLocId = currentIdx === 0 ? d.fromLocId : routeLocs[currentIdx - 1];
                const activeToLocId = d.toLocId;

                const activeFromLocName = locations[activeFromLocId]?.name || 'Unknown';
                const activeToLocName = locations[activeToLocId]?.name || 'Unknown';

                return (
                  <div key={d.id} className="bg-white/90 border border-slate-200/60 p-3 rounded-xl flex flex-col gap-2 hover:border-slate-300 transition">
                    <div className="flex justify-between items-start text-xs">
                       <div className="flex flex-col min-w-0 flex-1">
                         <span className="font-bold text-slate-800 truncate pr-2 flex items-center gap-1" title={`${locations[d.fromLocId]?.name} ➔ ${locations[routeLocs[routeLocs.length - 1]]?.name || locations[d.toLocId]?.name}`}>
                           {locations[d.fromLocId]?.name} <span className="text-slate-400">➔</span> {locations[routeLocs[routeLocs.length - 1]]?.name || locations[d.toLocId]?.name}
                         </span>
                         {hasRoute && d.status === 'sent' && (
                           <span className="text-[10px] text-slate-500 font-medium mt-1">
                             В пути: <span className="font-bold text-[#3765F6]">{activeFromLocName}</span> ➔ <span className="font-bold text-[#3765F6]">{activeToLocName}</span>
                           </span>
                         )}
                       </div>
                       
                       <div className="flex items-center gap-1 shrink-0">
                         <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider shrink-0 ${d.status === 'sent' ? 'bg-blue-50 text-blue-700 border border-blue-100/30' : 'bg-emerald-50 text-emerald-700 border border-emerald-100/30'}`}>
                           {d.status === 'sent' ? 'В пути' : 'Доставлен'}
                         </span>
                         <button onClick={() => handleEditDelivery(d)} className="p-1 text-slate-400 hover:text-[#3765F6] hover:bg-slate-50 rounded-md transition">
                           <Edit className="w-3.5 h-3.5" />
                         </button>
                         <button onClick={() => handleDeleteDelivery(d.id)} className="p-1 text-slate-400 hover:text-rose-500 hover:bg-slate-50 rounded-md transition">
                           <Trash2 className="w-3.5 h-3.5" />
                         </button>
                       </div>
                    </div>

                    <div className="text-[10px] text-slate-500 font-medium flex items-center gap-1">
                      <FileText className="w-3 h-3 text-slate-400" />
                      Бланков на борту: <span className="font-bold text-slate-700">{d.dozvolIds?.length || 0} шт</span>
                    </div>

                    {d.status === 'sent' && (
                       <button 
                         onClick={() => handleReceiveDelivery(d)} 
                         className="mt-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/50 text-xs min-h-[44px] py-2 rounded-xl font-semibold transition flex items-center justify-center gap-1 cursor-pointer shadow-sm shadow-emerald-500/5"
                       >
                         <Truck className="w-3.5 h-3.5" />
                         <span>Получить в {activeToLocName}</span>
                       </button>
                    )}
                  </div>
                );
              })}
              {Object.keys(deliveries).length === 0 && (
                <div className="text-[11px] text-slate-400 text-center py-6 italic bg-white border border-dashed border-slate-200 rounded-xl">
                  Активных отправок нет
                </div>
              )}
            </div>
          </div>
        </div>

        {/* MAP PANEL (RIGHT) */}
        <div className="flex-1 h-full rounded-2xl overflow-hidden relative border border-slate-200/50 bg-slate-50 z-0">
          <MapContainer
            center={[53.9006, 27.5590]}
            zoom={6}
            zoomControl={false}
            className="w-full h-full"
            style={{ height: '100%', width: '100%', zIndex: 0 }}
          >
            {isLightMap ? (
              <TileLayer
                attribution='&copy; CARTO'
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              />
            ) : (
              <TileLayer
                attribution='&copy; OpenStreetMap'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
            )}

            {/* Custom map controller */}
            <MapController triggerCenter={triggerCenter} locations={locations} />

            {/* Custom map controls floating panel */}
            <MapControls 
              onCenter={() => setTriggerCenter(prev => prev + 1)} 
              isLightMap={isLightMap} 
              setIsLightMap={setIsLightMap} 
            />

            {/* Locations Markers */}
            {Object.values(locations).map((loc: LocationItem) => {
              const dozvolsList = Object.keys(dozvolsData).map(key => ({ id: key, ...dozvolsData[key] })).filter((d: any) => 
                 (d.car === loc.name || d.assignedVehicle === loc.name || d.status === loc.name) &&
                 d.status !== 'used' && d.status !== 'expired'
              );
              const count = dozvolsList.length;
              const isSelected = selectedLocId === loc.id;
              
              const isFilteredOut = !filteredLocs.some(fl => fl.id === loc.id);
              
              let pinColor = '#3765F6'; // Default brand blue
              let ringPulseColor = 'rgba(55, 101, 246, 0.2)';

              // Highlight matching search results in vibrant blue ring
              const q = globalSearchQuery.toLowerCase().trim();
              const matchesSearch = q && (
                loc.name.toLowerCase().includes(q) || 
                dozvolsList.some((d: any) => 
                  (d.number || '').toLowerCase().includes(q) ||
                  (d.type || '').toLowerCase().includes(q) ||
                  (d.comment || '').toLowerCase().includes(q)
                )
              );

              if (matchesSearch) {
                ringPulseColor = 'rgba(55, 101, 246, 0.4)';
              }

              const isHighlighted = isSelected || matchesSearch;

              const customIcon = L.divIcon({
                className: 'custom-map-pin',
                html: `
                  <div class="relative flex items-center justify-center transition-all duration-300 ${isHighlighted ? 'scale-125' : 'hover:scale-110'}" style="opacity: ${isFilteredOut ? 0.35 : 1.0};">
                    <div class="absolute w-8 h-8 rounded-full animate-ping opacity-75" style="background-color: ${ringPulseColor}; animation-duration: 3s;"></div>
                    <div class="relative w-6 h-6 rounded-full border-2 border-white flex items-center justify-center shadow-lg transition-all" style="background-color: ${pinColor}; box-shadow: 0 4px 10px rgba(0,0,0,0.15);">
                      <span class="text-[9px] font-bold text-white leading-none">${count}</span>
                    </div>
                  </div>
                `,
                iconSize: [24, 24],
                iconAnchor: [12, 12]
              });

              return (
                <Marker 
                  key={loc.id}
                  position={editingId === loc.id ? [editLat, editLng] : [loc.lat, loc.lng]}
                  icon={customIcon}
                  draggable={editingId === loc.id}
                  eventHandlers={{
                    click: () => {
                      setSelectedLocId(loc.id);
                    },
                    dragend: (e) => {
                      const marker = e.target;
                      const position = marker.getLatLng();
                      if (editingId === loc.id) {
                         setEditLat(position.lat);
                         setEditLng(position.lng);
                      }
                    }
                  }}
                />
              );
            })}

            {/* Shipments Routes Polyline */}
            {Object.values(deliveries).filter((d: DeliveryItem) => d.status === "sent").map((d: DeliveryItem) => {
              const fromLoc = locations[d.fromLocId];
              if (!fromLoc) return null;

              const hasRoute = d.routeLocIds && d.routeLocIds.length > 0;
              const routeLocIds = hasRoute ? d.routeLocIds! : [d.toLocId];
              const currentStepIdx = d.currentStepIndex ?? 0;

              return (
                <React.Fragment key={d.id}>
                  {routeLocIds.map((locId, idx) => {
                    const startLocId = idx === 0 ? d.fromLocId : routeLocIds[idx - 1];
                    const endLocId = locId;

                    const startLoc = locations[startLocId];
                    const endLoc = locations[endLocId];
                    if (!startLoc || !endLoc) return null;

                    let lineColor = '#3765F6'; // Active transit route -> Blue
                    let lineWeight = 4;
                    let isDashed = true;

                    if (hasRoute) {
                      if (idx < currentStepIdx) {
                        lineColor = '#10B981'; // Completed segment -> Green
                        lineWeight = 3;
                        isDashed = false;
                      } else if (idx === currentStepIdx) {
                        lineColor = '#3765F6'; // Active segment -> Bold pulsing Blue
                        lineWeight = 5;
                        isDashed = true;
                      } else {
                        lineColor = '#94A3B8'; // Future segment -> Slate
                        lineWeight = 2;
                        isDashed = true;
                      }
                    }

                    return (
                      <Polyline
                        key={`${d.id}_seg_${idx}`}
                        positions={[[startLoc.lat, startLoc.lng], [endLoc.lat, endLoc.lng]]}
                        pathOptions={{
                          color: lineColor,
                          weight: lineWeight,
                          dashArray: isDashed ? '10, 10' : undefined,
                          opacity: 0.8
                        }}
                      />
                    );
                  })}
                </React.Fragment>
              );
            })}
          </MapContainer>

          {/* 3) GLASSMORPHIC FLOATING DETAIL PANEL (DRAWER SIDE-BAR OVER MAP) */}
          {selectedLocId && locations[selectedLocId] && (() => {
            const loc = locations[selectedLocId];
            const dozvolsList = Object.keys(dozvolsData).map(key => ({ id: key, ...dozvolsData[key] })).filter((d: any) => 
               (d.car === loc.name || d.assignedVehicle === loc.name || d.status === loc.name) &&
               d.status !== 'used' && d.status !== 'expired'
            );
            const count = dozvolsList.length;
            const limitMax = loc.limitMax || 20;
            const docs = (loc.documents ? (Array.isArray(loc.documents) ? loc.documents : Object.values(loc.documents)) : []) as string[];

            // Extract operations associated with this node
            const locOps = Object.values(deliveries).filter((d: DeliveryItem) => 
              d.fromLocId === loc.id || d.toLocId === loc.id || (d.routeLocIds && d.routeLocIds.includes(loc.id))
            ).sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());

            // Counts of permit types at this node
            const typeCounts: Record<string, number> = {};
            dozvolsList.forEach(d => {
              typeCounts[d.type] = (typeCounts[d.type] || 0) + 1;
            });

            return (
              <div className="absolute top-4 right-4 bottom-4 w-80 bg-white/95 backdrop-blur-md border border-slate-200/50 shadow-2xl rounded-2xl p-5 z-[1000] flex flex-col gap-4 overflow-y-auto pointer-events-auto custom-scrollbar">
                 <div className="flex items-start justify-between">
                   <div className="flex flex-col">
                     <span className="text-[9px] font-bold text-[#3765F6] bg-blue-50 border border-blue-100/50 px-2.5 py-0.5 rounded-full w-max uppercase tracking-wider">Логистический Узел</span>
                     <h3 className="text-sm font-bold text-slate-800 mt-1.5">{loc.name}</h3>
                     <span className="text-[11px] text-slate-400 font-medium">{loc.country || 'Беларусь'}</span>
                   </div>
                   <button 
                     onClick={() => setSelectedLocId(null)} 
                     className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition cursor-pointer shrink-0"
                   >
                     <X className="w-4 h-4" />
                   </button>
                 </div>

                 {/* Associated Permits Categories */}
                 <div className="flex flex-col gap-2">
                   <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                     <FileText className="w-3.5 h-3.5" />
                     <span>Виды дозволов на точке</span>
                   </h4>
                   <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto custom-scrollbar">
                     {Object.entries(typeCounts).map(([type, total]) => (
                       <div key={type} className="flex justify-between items-center bg-white border border-slate-200 p-2 rounded-lg text-xs font-semibold shadow-sm">
                         <span className="text-slate-700">{type}</span>
                         <span className="font-mono font-bold text-[#3765F6] bg-blue-50/50 border border-blue-100/50 px-2 py-0.5 rounded">{total} шт</span>
                       </div>
                     ))}
                     {Object.keys(typeCounts).length === 0 && (
                       <span className="text-[11px] text-slate-400 italic text-center py-2 bg-slate-50/30 border border-dashed border-slate-200 rounded-lg">
                         Дозволов на точке нет
                       </span>
                     )}
                   </div>
                 </div>

                 {/* Logs and operation journal */}
                 <div className="flex flex-col gap-2">
                   <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Операционный журнал</h4>
                   <div className="flex flex-col gap-2 max-h-40 overflow-y-auto custom-scrollbar">
                     {locOps.slice(0, 4).map((op) => {
                       const isFrom = op.fromLocId === loc.id;
                       const targetName = isFrom ? (locations[op.toLocId]?.name || 'Unknown') : (locations[op.fromLocId]?.name || 'Unknown');
                       return (
                         <div key={op.id} className="bg-slate-50/50 border border-slate-200/70 p-2 rounded-xl text-[10px] flex flex-col gap-1 shadow-sm">
                           <div className="flex justify-between items-center">
                             <span className={`font-bold ${isFrom ? 'text-rose-600' : 'text-emerald-600'}`}>
                               {isFrom ? '➔ Отправка' : '← Получение'}
                             </span>
                             <span className="text-[8px] text-slate-400 font-mono">{op.sentAt}</span>
                           </div>
                           <div className="text-slate-600 truncate font-semibold">
                             {isFrom ? `В пункт: ${targetName}` : `Из пункта: ${targetName}`}
                           </div>
                           <div className="text-[8px] text-slate-400 font-bold">
                             Объём: {op.dozvolIds?.length || 0} бланков
                           </div>
                         </div>
                       );
                     })}
                     {locOps.length === 0 && (
                       <span className="text-[11px] text-slate-400 italic text-center py-2 bg-slate-50/30 border border-dashed border-slate-200 rounded-lg">
                         Операций не зарегистрировано
                       </span>
                     )}
                 </div>
               </div>

               {/* Location actions */}
               <div className="mt-auto pt-3 border-t border-slate-200 flex flex-col gap-2">
                 <button
                   onClick={() => {
                     setDelivFrom(loc.id);
                     setShowDeliveryForm(true);
                   }}
                   className="w-full min-h-[44px] py-2 bg-[#3765F6] hover:bg-[#2555E5] text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm shadow-blue-500/10"
                 >
                   <Truck className="w-3.5 h-3.5" />
                   Оформить отправку
                 </button>
                 <button
                   onClick={() => {
                     setEditingId(loc.id);
                     setEditName(loc.name);
                     setEditLat(loc.lat);
                     setEditLng(loc.lng);
                     setEditNotes(loc.notes || '');
                     setEditCountry(loc.country || 'Беларусь');
                   }}
                   className="w-full min-h-[44px] py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200/50 rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer"
                 >
                   <Edit className="w-3.5 h-3.5" />
                   Редактировать точку
                 </button>
               </div>
            </div>
            );
          })()}
        </div>
      </div>

      {/* FORM MODAL FOR SENDING PERMITS (GLASSMORPHIC DIALOG) */}
      {showDeliveryForm && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200/50 p-6 w-[620px] max-w-full flex flex-col gap-4 my-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <h2 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                <Route className="w-4 h-4 text-[#3765F6]" />
                {editingDelivId ? 'Редактировать отправку дозволов' : 'Оформление транзита бланков'}
              </h2>
              <button 
                onClick={() => {
                  setShowDeliveryForm(false);
                  setEditingDelivId(null);
                  setDelivFrom('');
                  setDelivTo('');
                  setDelivRoute(['']);
                  setDelivDozvols([]);
                  setDelivSentAt('');
                  setDelivSearchQuery('');
                }} 
                className="min-h-[44px] min-w-[44px] rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="flex flex-col gap-3 bg-slate-50/80 p-4 rounded-2xl border border-slate-200/40 overflow-y-auto max-h-56 custom-scrollbar">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Маршрут следования</span>
                <button 
                  type="button"
                  onClick={() => setDelivRoute([...delivRoute, ''])}
                  className="text-[11px] font-bold bg-blue-50 text-[#3765F6] hover:bg-blue-100 px-2.5 py-1 rounded-lg flex items-center gap-1 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Пункт транзита
                </button>
              </div>

              <div className="flex flex-col gap-2.5">
                {/* Source node */}
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-500 text-white font-bold text-xs flex items-center justify-center shrink-0">
                    S
                  </div>
                  <div className="flex-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase">Пункт отправления</label>
                    <select 
                      value={delivFrom} 
                      onChange={(e) => { setDelivFrom(e.target.value); setDelivDozvols([]); setDelivSearchQuery(''); }}
                      className="w-full text-xs font-semibold bg-white border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-[#3765F6] transition"
                    >
                      <option value="">Выберите начальную точку...</option>
                      {Object.values(locations).map((l: LocationItem) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </div>
                </div>

                {/* Steps */}
                {delivRoute.map((stepLocId, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-[#3765F6] text-white font-bold text-xs flex items-center justify-center shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1">
                      <label className="text-[9px] font-bold text-slate-400 uppercase">
                        {idx === delivRoute.length - 1 ? 'Конечный получатель' : `Транзитная точка ${idx + 1}`}
                      </label>
                      <select 
                        value={stepLocId} 
                        onChange={(e) => {
                          const nextRoute = [...delivRoute];
                          nextRoute[idx] = e.target.value;
                          setDelivRoute(nextRoute);
                        }}
                        className="w-full text-xs font-semibold bg-white border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-[#3765F6] transition"
                      >
                        <option value="">Выберите локацию...</option>
                        {Object.values(locations).filter((l: LocationItem) => l.id !== delivFrom).map((l: LocationItem) => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </select>
                    </div>
                    {delivRoute.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const nextRoute = [...delivRoute];
                          nextRoute.splice(idx, 1);
                          setDelivRoute(nextRoute);
                        }}
                        className="p-1.5 mt-4 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Select permits to transmit */}
            {delivFrom && (
              <div className="flex flex-col gap-2 min-h-0 flex-1">
                <div className="flex justify-between items-end">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Выберите бланки для передачи ({filteredDozvolsAtFrom.length} доступно)
                  </label>
                  {delivDozvols.length > 0 && (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                      Выбрано: {delivDozvols.length} шт
                    </span>
                  )}
                </div>

                <div className="relative">
                  <input 
                    type="text"
                    placeholder="Быстрый поиск дозвола в пункте..."
                    value={delivSearchQuery}
                    onChange={(e) => setDelivSearchQuery(e.target.value)}
                    className="w-full text-xs bg-slate-50 border border-slate-200/60 rounded-xl pl-3 pr-8 py-2 outline-none focus:border-[#3765F6] transition"
                  />
                  {delivSearchQuery && (
                    <button onClick={() => setDelivSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 border border-slate-200/60 rounded-2xl p-2.5 overflow-y-auto bg-slate-50/50 flex-1 min-h-[120px] custom-scrollbar">
                  {filteredDozvolsAtFrom.map((d: any) => (
                    <div key={d.id} className="flex items-center gap-2.5 bg-white hover:bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-xl shadow-sm transition">
                      <input 
                        type="checkbox" 
                        checked={delivDozvols.includes(d.id)} 
                        onChange={(e) => {
                          if (e.target.checked) setDelivDozvols([...delivDozvols, d.id]);
                          else setDelivDozvols(delivDozvols.filter(id => id !== d.id));
                        }} 
                        className="w-4 h-4 rounded text-[#3765F6] border-slate-300 focus:ring-[#3765F6] cursor-pointer shrink-0"
                      />
                      
                      <div 
                        className="flex items-center gap-2 cursor-pointer select-none min-w-0 flex-1"
                        onClick={() => {
                          if (delivDozvols.includes(d.id)) {
                            setDelivDozvols(delivDozvols.filter(id => id !== d.id));
                          } else {
                            setDelivDozvols([...delivDozvols, d.id]);
                          }
                        }}
                      >
                        <span className="font-mono font-bold text-xs text-slate-900 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200/50 shrink-0">
                          {d.number}
                        </span>
                        <span className="text-[10px] font-semibold text-[#3765F6] bg-blue-50 border border-blue-100/50 px-2 py-0.5 rounded-full uppercase tracking-wider truncate max-w-[150px]">
                          {d.type}
                        </span>
                      </div>
                    </div>
                  ))}
                  {filteredDozvolsAtFrom.length === 0 && (
                    <span className="text-xs text-slate-400 text-center py-6 italic bg-white border border-dashed border-slate-200 rounded-xl">
                      Бланков для транзита не найдено
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1 shrink-0">
               <label className="text-[10px] font-bold text-slate-400 uppercase">Дата отправки</label>
               <input 
                 type="date" 
                 value={delivSentAt} 
                 onChange={(e) => setDelivSentAt(e.target.value)} 
                 className="w-full text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-[#3765F6]"
               />
            </div>

            <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-slate-100 shrink-0 font-semibold">
              <button 
                onClick={() => {
                  setShowDeliveryForm(false);
                  setEditingDelivId(null);
                  setDelivFrom('');
                  setDelivTo('');
                  setDelivRoute(['']);
                  setDelivDozvols([]);
                  setDelivSentAt('');
                  setDelivSearchQuery('');
                }}
                className="px-4 min-h-[44px] py-2 rounded-xl text-xs text-slate-500 hover:bg-slate-100 transition"
              >
                Отмена
              </button>
              <button 
                onClick={handleSaveDelivery}
                disabled={!delivFrom || delivRoute.filter(r => r.trim().length > 0).length === 0 || delivDozvols.length === 0 || !delivSentAt}
                className="px-4 min-h-[44px] py-2 rounded-xl text-xs text-white bg-[#3765F6] hover:bg-[#2555E5] transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-blue-500/10"
              >
                Оформить отправку
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}