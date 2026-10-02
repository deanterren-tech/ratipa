import { currentAccentColor } from '../../../theme/accent';
import React, {useState, useEffect} from 'react'
import {useFirebase, database, onValue} from '../../../firebase'
import {ref, set, push, update, remove} from 'firebase/database'
import {MapPin, Plus, Trash2, Edit, Save, X, Layers, Route, Truck, FileText, ArrowRight, ArrowLeft, Search, ChevronUp, ChevronDown, Info} from 'lucide-react'
import {UserProfile} from '../../../types'
import { useModalKeyboard } from '../../../hooks/useModalKeyboard'
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
        : 'bg-white border-[#E5E7EB] hover:bg-[#F3F4F6]'
    }`}>
      <div className="flex justify-between items-center gap-2">
        <span className="text-[10px] font-mono font-medium text-[#4B5563] bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 rounded-md truncate max-w-[150px]" title={d.type}>
          {d.type}
        </span>
        <span className="font-mono font-semibold text-xs bg-[#F3F4F6] text-[#121316] px-2 py-0.5 rounded border border-[#E5E7EB] shadow-sm shrink-0">
          {d.number}
        </span>
      </div>
      {isEditing ? (
        <div className="flex gap-1 mt-1">
          <input 
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="flex-1 text-[10px] px-1.5 py-0.5 border border-[#E5E7EB] rounded outline-none focus:border-[var(--accent-ui)]"
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
            className="p-1 bg-[#F3F4F6] text-[#6B7280] rounded hover:bg-[#E5E7EB]"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <div className="flex justify-between items-start gap-2 mt-0.5 group/comment">
          <div className="text-[10px] text-[#6B7280] italic leading-relaxed min-h-[14px] flex-1">
            {d.comment ? d.comment : <span className="text-[#9CA3AF]">Нет комментария</span>}
          </div>
          <button 
            onClick={() => setIsEditing(true)}
            className="opacity-0 group-hover/comment:opacity-100 p-0.5 text-[#9CA3AF] hover:text-blue-500 hover:bg-[#F3F4F6] rounded transition"
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
}

const MapControls: React.FC<MapControlsProps> = ({ onCenter }) => {
  const map = useMap();
  const [legendOpen, setLegendOpen] = React.useState(false);
  return (
    <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-2 pointer-events-auto">
 <div className="flex flex-col bg-white rounded-xl border border-[#E5E7EB] shadow-lg p-1">
        <button 
          onClick={() => map.zoomIn()} 
          className="w-8 h-8 rounded-lg text-[#4B5563] hover:text-[var(--accent-ink)] hover:bg-[#F3F4F6] flex items-center justify-center font-semibold text-base transition cursor-pointer"
          title="Приблизить"
        >
          +
        </button>
        <div className="h-[1px] bg-[#F3F4F6] mx-1" />
        <button 
          onClick={() => map.zoomOut()} 
          className="w-8 h-8 rounded-lg text-[#4B5563] hover:text-[var(--accent-ink)] hover:bg-[#F3F4F6] flex items-center justify-center font-semibold text-base transition cursor-pointer"
          title="Отдалить"
        >
          −
        </button>
      </div>

      <button 
        onClick={onCenter} 
        className="w-10 h-10 bg-white rounded-xl border border-[#E5E7EB] shadow-[0_6px_20px_rgba(15,23,42,0.10)] text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] flex items-center justify-center transition-colors cursor-pointer"
        title="Показать все локации"
      >
        <MapPin className="w-5 h-5" />
      </button>

      {/* Компактная расшифровка обозначений — не занимает площадь карты */}
      <button
        onClick={() => setLegendOpen((v) => !v)}
        className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-colors cursor-pointer shadow-[0_6px_20px_rgba(15,23,42,0.10)] ${
          legendOpen ? 'bg-[#121316] border-[#121316] text-white' : 'bg-white border-[#E5E7EB] text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6]'
        }`}
        title="Обозначения на карте"
      >
        <Info className="w-4 h-4" />
      </button>

      {legendOpen && (
        <div className="absolute right-12 top-[104px] w-56 bg-white/95 backdrop-blur-sm border border-[#E5E7EB] rounded-xl shadow-[0_8px_24px_rgba(15,23,42,0.12)] p-3 flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold text-[#6B7280] tracking-wider uppercase select-none mb-0.5">Обозначения</span>
          {[
            ['dot', currentAccentColor('ui'), 'Локация с бланками'],
            ['line', currentAccentColor('ui'), 'Активный участок'],
            ['line', '#10B981', 'Пройден'],
            ['line', '#94A3B8', 'Предстоит'],
            ['dot', '#3B82F6', 'Отправка в пути'],
            ['dot', '#10B981', 'Доставлено'],
          ].map(([shape, color, label]) => (
            <span key={label} className="inline-flex items-center gap-2 text-[10px] text-[#4B5563]">
              <span
                className={shape === 'dot' ? 'w-2 h-2 rounded-full shrink-0' : 'w-4 h-0.5 rounded-full shrink-0'}
                style={{ backgroundColor: color as string }}
              />
              {label}
            </span>
          ))}
        </div>
      )}

    </div>
  );
};

export default function DozvolaLocations({ user }: DozvolaLocationsProps) {
  const [panelsOpen, setPanelsOpen] = useState(true);
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
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [triggerCenter, setTriggerCenter] = useState(0);

  const [showDeliveryForm, setShowDeliveryForm] = useState(false);
  const closeDeliveryFormRef = React.useRef<() => void>(() => {});
  const closeDeliveryForm = () => {
    setShowDeliveryForm(false);
    setEditingDelivId(null);
    setDelivFrom('');
    setDelivTo('');
    setDelivRoute(['']);
    setDelivDozvols([]);
    setDelivSentAt('');
    setDelivSearchQuery('');
  };
  closeDeliveryFormRef.current = closeDeliveryForm;

  // Клавиатура: Escape закрывает форму транзита
  useModalKeyboard({
    isOpen: showDeliveryForm,
    onClose: () => closeDeliveryFormRef.current(),
    skipInitialFocus: true,
  });

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
    if (await showConfirm('Локация будет удалена со всеми привязанными данными.', 'Удалить локацию', { variant: 'danger', confirmLabel: 'Удалить' })) {
      remove(ref(database, `locationsDB/${id}`));
    }
  };

  const handleDeleteDelivery = async (id: string) => {
    if (!useFirebase) return;
    if (await showConfirm('Отправка будет удалена безвозвратно.', 'Удалить отправку', { variant: 'danger', confirmLabel: 'Удалить' })) {
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
    if (await showConfirm('Документ отвяжется от локации.', 'Удалить документ', { variant: 'danger', confirmLabel: 'Удалить' })) {
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
    <div className="w-full flex flex-col text-[#121316] flex-1 min-h-0 h-full">
      
{/* TWO COLUMNS: слева список локаций + транзит, справа карта */}
      <div className="relative flex-1 min-h-0 w-full overflow-hidden">
        
        {/* SIDEBAR COL (LEFT) */}
        <div className="absolute left-3 top-3 bottom-3 z-[550] flex flex-col gap-2.5 w-[calc(100%-1.5rem)] sm:w-[300px] lg:w-[340px] pointer-events-none">

          {/* FLOATING PANEL — фильтры и быстрые действия */}
          <div className="pointer-events-auto shrink-0 flex flex-wrap items-center gap-1.5 bg-white/95 backdrop-blur-sm border border-[#E5E7EB] rounded-xl shadow-[0_6px_20px_rgba(15,23,42,0.10)] p-1.5">
            <span className="hidden lg:inline-flex items-center gap-1.5 pl-1.5 pr-1 text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none shrink-0">
              <Route className="w-3.5 h-3.5 text-[var(--accent-ink)]" />
              Узел
            </span>
            <div className="relative flex-1 min-w-[120px]">
              <Search className="w-3.5 h-3.5 text-[#9CA3AF] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input type="text" placeholder="Поиск дозвола..." value={globalSearchQuery}
                onChange={(e) => setGlobalSearchQuery(e.target.value)}
                className="w-full text-[11px] bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg pl-8 pr-7 py-1.5 outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] focus:bg-white transition"
              />
              {globalSearchQuery && (
                <button onClick={() => setGlobalSearchQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#4B5563] cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <button onClick={handleAddLocation} title="Новая точка"
              className="flex items-center justify-center gap-1.5 bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[#4B5563] text-[11px] font-medium px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap">
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Точка</span>
            </button>
            <button onClick={() => { const firstLoc = Object.keys(locations)[0]; if (firstLoc) setDelivFrom(firstLoc); setShowDeliveryForm(true); }} title="Новая отправка"
              className="flex items-center justify-center gap-1.5 bg-[#121316] hover:bg-black text-white text-[11px] font-medium px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap">
              <Truck className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Отправка</span>
            </button>
            <button
              onClick={() => setPanelsOpen((v) => !v)}
              title={panelsOpen ? 'Скрыть списки' : 'Показать списки'}
              className="sm:hidden flex items-center justify-center p-1.5 rounded-lg border border-[#E5E7EB] bg-white text-[#4B5563] hover:bg-[#F3F4F6] transition-colors cursor-pointer shrink-0"
            >
              {panelsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* FLOATING PANELS — локации, отправки, легенда */}
          <div className={`pointer-events-auto flex flex-col gap-2.5 min-h-0 flex-1 overflow-y-auto custom-scrollbar pb-1 ${panelsOpen ? '' : 'hidden sm:flex'}`}>
          
          {/* LOCATIONS LIST */}
          <div className="flex flex-col bg-white/95 backdrop-blur-sm rounded-xl border border-[#E5E7EB] shadow-[0_6px_20px_rgba(15,23,42,0.10)] shrink-0 max-h-[55%]">
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-[#E5E7EB]">
              <h3 className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none flex items-center gap-2">
                <span className="p-1.5 bg-[#F3F4F6] text-[var(--accent-ink)] rounded-lg">
                  <Layers className="w-3.5 h-3.5" />
                </span>
                Локации
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[#E5E7EB] text-[#4B5563]">
                  {filteredLocs.length}
                </span>
              </h3>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-1.5 p-4 custom-scrollbar">
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
                    <div key={loc.id} className="flex flex-col gap-3 bg-white border border-[#E5E7EB] rounded-xl p-3 shadow-sm">
                      <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-1 mb-1">
                        <span className="text-[10px] font-semibold text-[#6B7280] uppercase">Редактирование</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase">Название локации</label>
                        <input 
                          type="text" 
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full text-xs font-semibold bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-2 py-1 outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase">Страна / Регион</label>
                        <input 
                          type="text" 
                          value={editCountry}
                          onChange={(e) => setEditCountry(e.target.value)}
                          className="w-full text-xs font-semibold bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-2 py-1 outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase">Заметки</label>
                        <textarea
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          className="w-full text-xs bg-white border border-[#E5E7EB] rounded-xl px-2 py-1 outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] h-12 resize-none transition"
                        />
                      </div>
                      <div className="flex justify-end gap-1.5 mt-1 font-semibold">
                        <button onClick={() => setEditingId(null)} className="px-2.5 py-1 bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[10px] text-[#4B5563] rounded-lg transition">
                          Отмена
                        </button>
                        <button onClick={handleSaveLocation} className="px-2.5 py-1 bg-[#121316] hover:bg-black text-[10px] text-white rounded-xl transition">
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
                    className={`cursor-pointer group relative flex flex-col gap-2 p-3 rounded-xl border transition-colors ${
                      selectedLocId === loc.id 
                        ? 'bg-white border-[#121316] shadow-xs' 
                        : hasMatchingDozvol 
                          ? 'bg-amber-50/40 border-amber-300 shadow-xs' 
                          : 'bg-white border-[#E5E7EB] hover:bg-[#F9FAFB]'
                    }`}
                  >
                    <div className="flex items-start justify-between pr-8">
                      <div className="flex flex-col min-w-0">
                        <h4 className="font-semibold text-[#121316] text-xs truncate group-hover:text-[var(--accent-ink)] transition-colors">
                          {loc.name}
                        </h4>
                        <span className="text-[10px] text-[#6B7280]">{loc.country}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {hasMatchingDozvol && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Найдено</span>
                        )}
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[#F3F4F6] border border-[#E5E7EB] text-[#4B5563]">{count} шт</span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-[10px] mt-0.5">
                      <span className="text-[#9CA3AF] font-mono flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-[#9CA3AF]" />
                        {loc.lat.toFixed(3)}, {loc.lng.toFixed(3)}
                      </span>
                    </div>

                    {loc.notes && (
                      <p className="text-[10px] text-[#6B7280] bg-[#F9FAFB] p-2 rounded-lg leading-relaxed border border-[#E5E7EB] truncate mt-0.5">
                        {loc.notes}
                      </p>
                    )}

                    {/* Collapsible permits details */}
                    <div className="mt-1.5 border-t border-[#E5E7EB] pt-2 shrink-0" onClick={e => e.stopPropagation()}>
                      <button 
                        onClick={() => setExpandedLocId(expandedLocId === loc.id ? null : loc.id)}
                        className="text-[10px] font-medium text-[#6B7280] hover:text-[#121316] transition-colors flex items-center gap-1"
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
                              className="w-full text-[10px] bg-white border border-[#E5E7EB] rounded-xl pl-2 pr-6 py-1 outline-none focus:border-[var(--accent-ui)]"
                            />
                            {(locSearchQueries[loc.id] || '') && (
                              <button onClick={() => setLocSearchQueries(prev => ({ ...prev, [loc.id]: '' }))} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]">
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
                              <div className="text-[10px] text-[#9CA3AF] italic py-2 text-center">
                                Бланки отсутствуют
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div 
                      className="absolute top-2.5 right-2 md:opacity-0 md:group-hover:opacity-100 transition flex items-center gap-1"
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
                        className="p-1 bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] rounded text-[#6B7280] hover:text-[var(--accent-ink)] shadow-sm transition"
                      >
                        <Edit className="w-3 h-3" />
                      </button>
                      <button 
                        onClick={() => handleDeleteLocation(loc.id)}
                        className="p-1 bg-white border border-[#E5E7EB] hover:border-rose-300 rounded text-[#6B7280] hover:text-rose-500 shadow-sm transition"
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
 <div className="flex flex-col bg-white/95 backdrop-blur-sm rounded-xl border border-[#E5E7EB] shadow-[0_6px_20px_rgba(15,23,42,0.10)] shrink-0 max-h-[38%]">
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-[#E5E7EB]">
              <h3 className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none flex items-center gap-2">
                <span className="p-1.5 bg-[#F3F4F6] text-[var(--accent-ink)] rounded-lg">
                  <Truck className="w-3.5 h-3.5" />
                </span>
                Транзитные отправки
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[#E5E7EB] text-[#4B5563]">
                  {Object.keys(deliveries).length}
                </span>
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 p-4 custom-scrollbar">
              {Object.values(deliveries).sort((a: DeliveryItem, b: DeliveryItem) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()).map((d: DeliveryItem) => {
                const hasRoute = d.routeLocIds && d.routeLocIds.length > 0;
                const routeLocs = hasRoute ? d.routeLocIds! : [d.toLocId];
                const currentIdx = d.currentStepIndex ?? 0;
                
                const activeFromLocId = currentIdx === 0 ? d.fromLocId : routeLocs[currentIdx - 1];
                const activeToLocId = d.toLocId;

                const activeFromLocName = locations[activeFromLocId]?.name || 'Unknown';
                const activeToLocName = locations[activeToLocId]?.name || 'Unknown';

                return (
                  <div key={d.id} className="border border-[#E5E7EB] p-3 rounded-xl flex flex-col gap-2 hover:bg-[#F9FAFB] transition-colors bg-white">
                    <div className="flex justify-between items-start text-xs">
                       <div className="flex flex-col min-w-0 flex-1">
                         <span className="font-semibold text-[#121316] truncate pr-2 flex items-center gap-1" title={`${locations[d.fromLocId]?.name} → ${locations[routeLocs[routeLocs.length - 1]]?.name || locations[d.toLocId]?.name}`}>
                           {locations[d.fromLocId]?.name} <ArrowRight className="w-3 h-3 text-[#9CA3AF] shrink-0" /> {locations[routeLocs[routeLocs.length - 1]]?.name || locations[d.toLocId]?.name}
                         </span>
                         {hasRoute && d.status === 'sent' && (
                           <span className="text-[10px] text-[#6B7280] font-medium mt-1">
                             В пути: <span className="font-semibold text-[var(--accent-ink)]">{activeFromLocName}</span><ArrowRight className="w-3 h-3 text-[#9CA3AF] shrink-0" /><span className="font-semibold text-[var(--accent-ink)]">{activeToLocName}</span>
                           </span>
                         )}
                       </div>
                       
                       <div className="flex items-center gap-1 shrink-0">
                         <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${d.status === 'sent' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                           {d.status === 'sent' ? 'В пути' : 'Доставлен'}
                         </span>
                         <button onClick={() => handleEditDelivery(d)} className="p-1 text-[#9CA3AF] hover:text-[var(--accent-ink)] hover:bg-[#F3F4F6] rounded-md transition">
                           <Edit className="w-3.5 h-3.5" />
                         </button>
                         <button onClick={() => handleDeleteDelivery(d.id)} className="p-1 text-[#9CA3AF] hover:text-rose-500 hover:bg-[#F3F4F6] rounded-md transition">
                           <Trash2 className="w-3.5 h-3.5" />
                         </button>
                       </div>
                    </div>

                    <div className="text-[10px] text-[#6B7280] font-medium flex items-center gap-1">
                      <FileText className="w-3 h-3 text-[#9CA3AF]" />
                      Бланков на борту: <span className="font-semibold text-[#374151]">{d.dozvolIds?.length || 0} шт</span>
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
                <div className="text-[11px] text-[#9CA3AF] text-center py-6 italic bg-white border border-dashed border-[#E5E7EB] rounded-xl">
                  Активных отправок нет
                </div>
              )}
            </div>
          </div>


          </div>
        </div>

        {/* MAP PANEL (RIGHT) */}
        <div className="absolute inset-0 z-0">
          <MapContainer
            center={[53.9006, 27.5590]}
            zoom={6}
            zoomControl={false}
            className="w-full h-full"
            style={{ height: '100%', width: '100%', zIndex: 0 }}
          >
            <TileLayer
              attribution='&copy; OpenStreetMap'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* Custom map controller */}
            <MapController triggerCenter={triggerCenter} locations={locations} />

            {/* Custom map controls floating panel */}
            <MapControls onCenter={() => setTriggerCenter(prev => prev + 1)} />

            {/* Locations Markers */}
            {Object.values(locations).map((loc: LocationItem) => {
              const dozvolsList = Object.keys(dozvolsData).map(key => ({ id: key, ...dozvolsData[key] })).filter((d: any) => 
                 (d.car === loc.name || d.assignedVehicle === loc.name || d.status === loc.name) &&
                 d.status !== 'used' && d.status !== 'expired'
              );
              const count = dozvolsList.length;
              const isSelected = selectedLocId === loc.id;
              
              const isFilteredOut = !filteredLocs.some(fl => fl.id === loc.id);
              
              let pinColor = currentAccentColor('ui'); // акцент текущей темы
              let ringPulseColor = 'var(--accent-20)';

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
                ringPulseColor = 'var(--accent-40)';
              }

              const isHighlighted = isSelected || matchesSearch;

              const customIcon = L.divIcon({
                className: 'custom-map-pin',
                html: `
                  <div class="relative flex items-center justify-center transition-all duration-300 ${isHighlighted ? 'scale-125' : 'hover:scale-110'}" style="opacity: ${isFilteredOut ? 0.35 : 1.0};">
                    <div class="absolute w-8 h-8 rounded-full animate-ping opacity-75" style="background-color: ${ringPulseColor}; animation-duration: 3s;"></div>
                    <div class="relative w-6 h-6 rounded-full border-2 border-white flex items-center justify-center shadow-lg transition-all" style="background-color: ${pinColor}; box-shadow: 0 4px 10px rgba(0,0,0,0.15);">
                      <span class="text-[10px] font-semibold text-white leading-none">${count}</span>
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

                    let lineColor = currentAccentColor('ui'); // активный маршрут
                    let lineWeight = 4;
                    let isDashed = true;

                    if (hasRoute) {
                      if (idx < currentStepIdx) {
                        lineColor = '#10B981'; // Completed segment -> Green
                        lineWeight = 3;
                        isDashed = false;
                      } else if (idx === currentStepIdx) {
                        lineColor = currentAccentColor('ui'); // активный участок
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
                        eventHandlers={{
                          click: () => setSelectedDeliveryId(d.id)
                        }}
                      />
                    );
                  })}
                </React.Fragment>
              );
            })}
          </MapContainer>

                    {/* DELIVERY DETAIL POPUP — при клике на линию отправки */}
          {selectedDeliveryId && deliveries[selectedDeliveryId] && (() => {
            const d = deliveries[selectedDeliveryId];
            const fromLoc = locations[d.fromLocId];
            const toLoc = locations[d.toLocId];
            const dozvolsInDelivery = d.dozvolIds.map((did: string) => dozvolsData[did]).filter(Boolean);
            return (
              <div className="absolute bottom-4 left-4 z-[1001] bg-white border border-[#E5E7EB] shadow-[0_8px_24px_rgba(15,23,42,0.12)] rounded-xl p-4 w-80 max-w-[calc(100%-2rem)] flex flex-col gap-3 pointer-events-auto">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-[var(--accent-ink)] bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 rounded-full">Транзит</span>
                  <button onClick={() => setSelectedDeliveryId(null)} className="text-[#9CA3AF] hover:text-[#121316] p-1 rounded-lg hover:bg-[#F3F4F6] transition cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex flex-col gap-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                    <span className="font-semibold text-[#374151]">{fromLoc?.name || '?'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent-ui)] shrink-0" />
                    <span className="font-semibold text-[#374151]">{toLoc?.name || '?'}</span>
                  </div>
                </div>
                <div className="text-[10px] text-[#9CA3AF] font-mono">Отправлено: {new Date(d.sentAt).toLocaleDateString('ru-RU').replace(/\./g, '/')}</div>
                <div className="border-t border-[#E5E7EB] pt-2">
                  <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Дозволы в отправке ({dozvolsInDelivery.length})</span>
                  <div className="flex flex-wrap gap-1 mt-1.5 max-h-32 overflow-y-auto custom-scrollbar">
                    {dozvolsInDelivery.map((p: any, pi: number) => (
                      <span key={pi} className="font-mono text-[10px] font-semibold bg-[#F3F4F6] text-[#374151] px-1.5 py-0.5 rounded border border-[#E5E7EB]">
                        {p?.type || '?'} №{p?.number || p?.permitNumber || '—'}
                      </span>
                    ))}
                    {dozvolsInDelivery.length === 0 && (
                      <span className="text-[10px] text-[#9CA3AF] italic">Нет данных о дозволах</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

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
 <div className="absolute top-3 right-3 bottom-3 w-80 bg-white border border-[#E5E7EB] shadow-[0_8px_24px_rgba(15,23,42,0.12)] rounded-xl p-5 z-[1000] flex flex-col gap-4 overflow-y-auto pointer-events-auto custom-scrollbar">
                 <div className="flex items-start justify-between">
                   <div className="flex flex-col">
                     <span className="text-[10px] font-semibold text-[var(--accent-ink)] bg-[#F3F4F6] border border-[#E5E7EB] px-2.5 py-0.5 rounded-full w-max">Логистический Узел</span>
                     <h3 className="text-sm font-semibold text-[#121316] mt-1.5">{loc.name}</h3>
                     <span className="text-[11px] text-[#9CA3AF] font-medium">{loc.country || 'Беларусь'}</span>
                   </div>
                   <button 
                     onClick={() => setSelectedLocId(null)} 
                     className="w-7 h-7 flex items-center justify-center text-[#9CA3AF] hover:text-[#121316] transition cursor-pointer shrink-0"
                   >
                     <X className="w-4 h-4" />
                   </button>
                 </div>

                 {/* Associated Permits — номера дозволов по видам */}
                                 <div className="flex flex-col gap-2">
                                   <h4 className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider flex items-center gap-1">
                                     <FileText className="w-3.5 h-3.5" />
                                     <span>Дозволы на точке</span>
                                   </h4>
                                   <div className="flex flex-col gap-2 max-h-60 overflow-y-auto custom-scrollbar">
                                     {(() => {
                                       // Group permits by type
                                       const grouped: Record<string, any[]> = {};
                                       dozvolsList.forEach(d => {
                                         const t = d.type || 'Прочее';
                                         if (!grouped[t]) grouped[t] = [];
                                         grouped[t].push(d);
                                       });
                                       return Object.entries(grouped).map(([type, items]) => (
                                         <div key={type} className="flex flex-col bg-white border border-[#E5E7EB] rounded-lg p-2">
                                           <div className="text-[10px] font-semibold text-[#6B7280] mb-1">{type} — {items.length} шт</div>
                                           <div className="flex flex-wrap gap-1">
                                             {items.map((d: any) => (
                                               <span key={d.id} className="font-mono text-[10px] font-semibold bg-[#F3F4F6] text-[#374151] px-1.5 py-0.5 rounded border border-[#E5E7EB]">
                                                 №{d.number || d.permitNumber || '—'}
                                               </span>
                                             ))}
                                           </div>
                                         </div>
                                       ));
                                     })()}
                                     {dozvolsList.length === 0 && (
                                       <span className="text-[11px] text-[#9CA3AF] italic text-center py-2 bg-[#F9FAFB] border border-dashed border-[#E5E7EB] rounded-lg">
                                         Дозволов на точке нет
                                       </span>
                                     )}
                                   </div>
                                 </div>

                 {/* Logs and operation journal */}
                 <div className="flex flex-col gap-2">
                   <h4 className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Операционный журнал</h4>
                   <div className="flex flex-col gap-2 max-h-40 overflow-y-auto custom-scrollbar">
                     {locOps.slice(0, 4).map((op) => {
                       const isFrom = op.fromLocId === loc.id;
                       const targetName = isFrom ? (locations[op.toLocId]?.name || 'Unknown') : (locations[op.fromLocId]?.name || 'Unknown');
                       return (
                         <div key={op.id} className="bg-white border border-[#E5E7EB] p-2 rounded-xl text-[10px] flex flex-col gap-1 shadow-sm">
                           <div className="flex justify-between items-center">
                             <span className={`font-semibold ${isFrom ? 'text-rose-600' : 'text-emerald-600'}`}>
                               {isFrom ? <><ArrowRight className="w-3 h-3" />Отправка</> : <><ArrowLeft className="w-3 h-3" />Получение</>}
                             </span>
                             <span className="text-[8px] text-[#9CA3AF] font-mono">{op.sentAt}</span>
                           </div>
                           <div className="text-[#4B5563] truncate font-semibold">
                             {isFrom ? `В пункт: ${targetName}` : `Из пункта: ${targetName}`}
                           </div>
                           <div className="text-[8px] text-[#9CA3AF] font-semibold">
                             Объём: {op.dozvolIds?.length || 0} бланков
                           </div>
                         </div>
                       );
                     })}
                     {locOps.length === 0 && (
                       <span className="text-[11px] text-[#9CA3AF] italic text-center py-2 bg-[#F9FAFB] border border-dashed border-[#E5E7EB] rounded-lg">
                         Операций не зарегистрировано
                       </span>
                     )}
                 </div>
               </div>

               {/* Location actions */}
               <div className="mt-auto pt-3 border-t border-[#E5E7EB] flex flex-col gap-2">
                 <button
                   onClick={() => {
                     setDelivFrom(loc.id);
                     setShowDeliveryForm(true);
                   }}
                   className="w-full min-h-[44px] py-2 bg-[#121316] hover:bg-black text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm"
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
                   className="w-full min-h-[44px] py-2 bg-[#F9FAFB] hover:bg-[#F3F4F6] text-[#374151] text-xs font-semibold border border-[#E5E7EB] rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer"
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
 <div data-scroll-lock="modal" className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4 sm:p-6">
          <div className="relative z-10 w-[620px] max-w-full bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.12)] flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex justify-between items-center px-4 sm:px-6 py-4 border-b border-[#E5E7EB] shrink-0">
              <h2 className="font-semibold text-sm text-[#121316] flex items-center gap-1.5">
                <Route className="w-4 h-4 text-[#6B7280]" />
                {editingDelivId ? 'Редактировать отправку дозволов' : 'Оформление транзита бланков'}
              </h2>
              <button 
onClick={closeDeliveryForm} 
                className="p-1.5 text-[#9CA3AF] hover:text-[#121316] rounded-lg hover:bg-[#F3F4F6] transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* Маршрут: откуда → куда. Отдельная сводка, чтобы направление читалось сразу */}
            <div className="flex flex-col gap-3 px-4 sm:px-6 py-4 shrink-0 border-b border-[#F3F4F6]">
              {(() => {
                const nameOf = (id: string) => (locations as any)[id]?.name || '';
                const from = nameOf(delivFrom);
                const toId = [...delivRoute].reverse().find((r) => r && r.trim());
                const to = nameOf(toId || '');
                return (
                  <div className="flex items-center gap-2 text-xs min-w-0 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span className="truncate max-w-[160px]">{from || 'Откуда — не выбрано'}</span>
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" />
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-ui)]" />
                      <span className="truncate max-w-[160px]">{to || 'Куда — не выбрано'}</span>
                    </span>
                    {delivRoute.filter((r) => r && r.trim()).length > 1 && (
                      <span className="text-[10px] text-[#6B7280]">
                        через {delivRoute.filter((r) => r && r.trim()).length - 1} пункт(ов)
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="flex flex-col gap-4 px-4 sm:px-6 py-4 shrink-0">
              <div className="flex justify-between items-center">
                <span className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none">Маршрут следования</span>
                <button 
                  type="button"
                  onClick={() => setDelivRoute([...delivRoute, ''])}
                  className="text-[11px] font-medium bg-[#F3F4F6] border border-[#E5E7EB] text-[var(--accent-ink)] hover:bg-[#E5E7EB] px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Пункт транзита
                </button>
              </div>

              <div className="flex flex-col gap-2.5">
                {/* Source node */}
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center shrink-0">
                    S
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase">Пункт отправления</label>
                    <select 
                      value={delivFrom} 
                      onChange={(e) => { setDelivFrom(e.target.value); setDelivDozvols([]); setDelivSearchQuery(''); }}
                      className="w-full text-xs font-semibold bg-white border border-[#E5E7EB] rounded-xl px-2 py-1.5 outline-none focus:border-[var(--accent-ui)] transition"
                    >
                      <option value="">Выберите начальную точку...</option>
                      {Object.values(locations).map((l: LocationItem) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </div>
                </div>

                {/* Steps */}
                {delivRoute.map((stepLocId, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-[var(--accent-solid)] text-[var(--accent-on)] font-semibold text-xs flex items-center justify-center shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase">
                        {idx === delivRoute.length - 1 ? 'Конечный получатель' : `Транзитная точка ${idx + 1}`}
                      </label>
                      <select 
                        value={stepLocId} 
                        onChange={(e) => {
                          const nextRoute = [...delivRoute];
                          nextRoute[idx] = e.target.value;
                          setDelivRoute(nextRoute);
                        }}
                        className="w-full text-xs font-semibold bg-white border border-[#E5E7EB] rounded-xl px-2 py-1.5 outline-none focus:border-[var(--accent-ui)] transition"
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
                        className="p-1.5 mt-4 text-[#9CA3AF] hover:text-rose-500 hover:bg-rose-50 rounded-lg transition shrink-0"
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
              <div className="flex flex-col gap-2 min-h-0 flex-1 px-4 sm:px-6 pb-4">
                <div className="flex justify-between items-end">
                  <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                    Выберите бланки для передачи ({filteredDozvolsAtFrom.length} доступно)
                  </label>
                  {delivDozvols.length > 0 && (
                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
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
                    className="w-full text-xs bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl pl-3 pr-8 py-2 outline-none focus:border-[var(--accent-ui)] transition"
                  />
                  {delivSearchQuery && (
                    <button onClick={() => setDelivSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 border border-[#E5E7EB] rounded-2xl p-2.5 overflow-y-auto bg-white flex-1 min-h-[120px] custom-scrollbar">
                  {filteredDozvolsAtFrom.map((d: any) => (
                    <div key={d.id} className="flex items-center gap-2.5 bg-white hover:bg-[#F3F4F6] border border-[#E5E7EB] px-2.5 py-1.5 rounded-xl shadow-sm transition">
                      <input 
                        type="checkbox" 
                        checked={delivDozvols.includes(d.id)} 
                        onChange={(e) => {
                          if (e.target.checked) setDelivDozvols([...delivDozvols, d.id]);
                          else setDelivDozvols(delivDozvols.filter(id => id !== d.id));
                        }} 
                        className="w-4 h-4 rounded text-[var(--accent-ink)] border-[#E5E7EB] focus:ring-[var(--accent-ui)] cursor-pointer shrink-0"
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
                        <span className="font-mono font-semibold text-xs text-[#121316] bg-[#F9FAFB] px-1.5 py-0.5 rounded border border-[#E5E7EB] shrink-0">
                          {d.number}
                        </span>
                        <span className="text-[10px] font-mono font-medium text-[#4B5563] bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 rounded-md truncate max-w-[150px]">
                          {d.type}
                        </span>
                      </div>
                    </div>
                  ))}
                  {filteredDozvolsAtFrom.length === 0 && (
                    <span className="text-xs text-[#9CA3AF] text-center py-6 italic bg-white border border-dashed border-[#E5E7EB] rounded-xl">
                      Бланков для транзита не найдено
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1 shrink-0 px-4 sm:px-6">
               <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Дата отправки</label>
               <input 
                 type="date" 
                 value={delivSentAt} 
                 onChange={(e) => setDelivSentAt(e.target.value)} 
                 className="w-full text-xs font-semibold bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3 py-2 outline-none focus:border-[var(--accent-ui)]"
               />
            </div>

            <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-4 mt-2 border-t border-[#E5E7EB] shrink-0">
              {/* Валидация рядом с действием: видно, чего не хватает для оформления */}
              <span className="text-[11px] text-[#6B7280] min-w-0">
                {[
                  !delivFrom && 'выберите пункт отправления',
                  delivRoute.filter(r => r.trim()).length === 0 && 'укажите получателя',
                  delivDozvols.length === 0 && 'выберите бланки',
                  !delivSentAt && 'укажите дату отправки',
                ].filter(Boolean).join(' · ') || `${delivDozvols.length} бланк(ов) к передаче`}
              </span>
              <div className="flex items-center gap-2 shrink-0">
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
                className="px-4 h-9 rounded-lg text-xs font-medium text-[#4B5563] bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button 
                onClick={handleSaveDelivery}
                disabled={!delivFrom || delivRoute.filter(r => r.trim().length > 0).length === 0 || delivDozvols.length === 0 || !delivSentAt}
                className="px-5 h-9 rounded-lg text-xs font-medium text-[var(--accent-on)] bg-[var(--accent-solid)] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingDelivId ? 'Сохранить отправку' : 'Оформить отправку'}
              </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}