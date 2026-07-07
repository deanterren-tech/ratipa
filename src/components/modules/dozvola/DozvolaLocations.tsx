import React, { useState, useEffect } from 'react';
import { useFirebase, database, onValue } from '../../../firebase';
import { ref, set, push, update, remove } from 'firebase/database';
import { MapPin, Plus, Trash2, Edit, Save, X, Layers, Route, Truck, FileText } from 'lucide-react';
import { UserProfile } from '../../../types';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useDialog } from '../../DialogProvider';

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
  const [expandedLocId, setExpandedLocId] = useState<string | null>(null);
  const [expandedDocsLocId, setExpandedDocsLocId] = useState<string | null>(null);
  const [newDocTexts, setNewDocTexts] = useState<Record<string, string>>({});
  
  const [hoveredMarker, setHoveredMarker] = useState<string | null>(null);

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
        notes: ''
      });
      setEditingId(newKey);
      setEditName('Новая локация');
      setEditLat(53.9006);
      setEditLng(27.5590);
      setEditNotes('');
    }
  };

  const handleSaveLocation = () => {
    if (!editingId || !useFirebase) return;
    update(ref(database, `locationsDB/${editingId}`), {
      name: editName,
      lat: editLat,
      lng: editLng,
      notes: editNotes
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

  return (
    <div className="flex h-[800px] w-full gap-4 bg-white rounded-[2rem] border border-slate-200/50 shadow-sm p-4 overflow-hidden relative">
      <div className="w-1/3 flex flex-col gap-4 border-r border-slate-100 pr-4 h-full">
        {/* Locations Section */}
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          <div className="flex items-center justify-between shrink-0">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-500" />
              База Локаций
            </h2>
            <button 
              onClick={handleAddLocation}
              className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center justify-center transition shrink-0"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          
          {/* Global Search Bar */}
          <div className="relative shrink-0">
            <input 
              type="text"
              placeholder="Общий поиск дозвола на локациях..."
              value={globalSearchQuery}
              onChange={(e) => setGlobalSearchQuery(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl pl-3 pr-8 py-2.5 outline-none focus:border-blue-500 focus:bg-white transition"
            />
            {globalSearchQuery && (
              <button 
                onClick={() => setGlobalSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-200/50 transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            {Object.values(locations).map((loc: LocationItem) => {
              const isEditing = editingId === loc.id;
              const dozvolsAtLoc = Object.keys(dozvolsData).map(key => ({ id: key, ...dozvolsData[key] })).filter((d: any) => 
                 (d.car === loc.name || d.assignedVehicle === loc.name || d.status === loc.name) &&
                 d.status !== 'used' && d.status !== 'expired'
              );
              const count = dozvolsAtLoc.length;
              const docs = (loc.documents ? (Array.isArray(loc.documents) ? loc.documents : Object.values(loc.documents)) : []) as string[];
              
              const globQuery = globalSearchQuery.toLowerCase().trim();
              const locQuery = (locSearchQueries[loc.id] || '').toLowerCase().trim();
              
              // Find matches for global query
              const hasMatchingDozvol = globQuery ? dozvolsAtLoc.some((d: any) => 
                (d.number || '').toLowerCase().includes(globQuery) ||
                (d.type || '').toLowerCase().includes(globQuery) ||
                (d.comment || '').toLowerCase().includes(globQuery)
              ) : false;

              // Filter dozvols that match current search criteria
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

              // Auto-expand when a global query match is found or if manually expanded
              const isDozvolsExpanded = expandedLocId === loc.id || (globQuery !== '' && hasMatchingDozvol);

              return (
                <div 
                  key={loc.id} 
                  className={`border rounded-2xl p-3 flex flex-col gap-2 relative group transition duration-200 ${
                    hasMatchingDozvol 
                      ? 'bg-amber-50/40 border-amber-400 ring-2 ring-amber-400/10 shadow-sm' 
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  {isEditing ? (
                    <div className="flex flex-col gap-2">
                      <input 
                        type="text" 
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full text-xs font-bold bg-white border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:border-blue-500"
                        placeholder="Название локации"
                      />
                      <textarea
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        className="w-full text-[11px] bg-white border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:border-blue-500 h-16 resize-none"
                        placeholder="Описание, заметки или обычный текст..."
                      />
                      <div className="flex gap-2">
                        <input 
                          type="number" 
                          value={editLat}
                          onChange={(e) => setEditLat(parseFloat(e.target.value))}
                          className="w-1/2 text-[10px] bg-white border border-slate-300 rounded-lg px-2 py-1.5 outline-none font-mono"
                          placeholder="Широта"
                          step="0.0001"
                        />
                        <input 
                          type="number" 
                          value={editLng}
                          onChange={(e) => setEditLng(parseFloat(e.target.value))}
                          className="w-1/2 text-[10px] bg-white border border-slate-300 rounded-lg px-2 py-1.5 outline-none font-mono"
                          placeholder="Долгота"
                          step="0.0001"
                        />
                      </div>
                      <div className="flex justify-end gap-1 mt-1">
                        <button onClick={() => setEditingId(null)} className="p-1.5 text-slate-400 hover:text-slate-600">
                          <X className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={handleSaveLocation} className="p-1.5 text-emerald-500 hover:text-emerald-600 bg-emerald-50 rounded-lg">
                          <Save className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between pr-6">
                        <div className="font-bold text-slate-800 text-xs">
                          {loc.name}
                        </div>
                        <div className="flex items-center gap-1">
                          {hasMatchingDozvol && (
                            <span className="bg-amber-500 text-white px-1.5 py-0.5 rounded-full text-[8px] font-bold animate-pulse">
                              Найдено
                            </span>
                          )}
                          <div className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full text-[10px] font-black shrink-0">
                            {count} дозволов
                          </div>
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                      </div>
                      
                      {loc.notes && (
                        <div className="text-[10px] text-slate-600 bg-white border border-slate-100 rounded-xl p-2 mt-1 whitespace-pre-wrap leading-relaxed shadow-sm">
                          {loc.notes}
                        </div>
                      )}

                      {/* Collapsible dozvols list with search & comments editing */}
                      <div className="mt-2 border-t border-slate-200/50 pt-2 shrink-0">
                        <button 
                          onClick={() => setExpandedLocId(expandedLocId === loc.id ? null : loc.id)}
                          className="text-[10px] font-black text-blue-500 hover:text-blue-600 uppercase tracking-wider flex items-center gap-1"
                        >
                          {isDozvolsExpanded ? 'Скрыть список дозволов' : `Показать дозвола (${count})`}
                        </button>
                        
                        {isDozvolsExpanded && (
                          <div className="mt-2 flex flex-col gap-1.5">
                            {/* Per-location search input */}
                            <div className="relative">
                              <input 
                                type="text"
                                placeholder="Поиск дозвола в локации..."
                                value={locSearchQueries[loc.id] || ''}
                                onChange={(e) => setLocSearchQueries(prev => ({ ...prev, [loc.id]: e.target.value }))}
                                className="w-full text-[10px] bg-white border border-slate-200 rounded-lg pl-2 pr-6 py-1 outline-none focus:border-blue-500 transition"
                              />
                              {(locSearchQueries[loc.id] || '') && (
                                <button 
                                  onClick={() => setLocSearchQueries(prev => ({ ...prev, [loc.id]: '' }))}
                                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>

                            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
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
                                  <DozvolCommentRow 
                                    key={d.id} 
                                    d={d} 
                                    isHighlighted={isHighlighted} 
                                  />
                                );
                              })}
                              {filteredDozvols.length === 0 && (
                                <div className="text-[10px] text-slate-400 italic py-2 text-center">
                                  {dozvolsAtLoc.length === 0 ? 'Нет дозволов' : 'Совпадений не найдено'}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Documents Section */}
                      <div className="mt-2 border-t border-slate-200/50 pt-2 shrink-0">
                        <button 
                          onClick={() => setExpandedDocsLocId(expandedDocsLocId === loc.id ? null : loc.id)}
                          className="text-[10px] font-black text-emerald-600 hover:text-emerald-700 uppercase tracking-wider flex items-center gap-1"
                        >
                          {expandedDocsLocId === loc.id ? 'Скрыть документы' : `Показать документы (${docs.length})`}
                        </button>
                        
                        {expandedDocsLocId === loc.id && (
                          <div className="mt-2 flex flex-col gap-1.5">
                            {/* List of documents */}
                            <div className="flex flex-col gap-1 max-h-36 overflow-y-auto pr-1 custom-scrollbar">
                              {docs.map((docText: string, index: number) => (
                                <div key={index} className="bg-white border border-slate-150 rounded-lg p-1.5 flex justify-between items-center gap-2 shadow-sm text-[10px]">
                                  <span className="text-slate-700 leading-tight font-medium break-all flex-1">{docText}</span>
                                  <button 
                                    onClick={() => handleRemoveDocument(loc.id, index, docs)}
                                    className="text-slate-400 hover:text-rose-500 p-0.5 rounded hover:bg-slate-50 shrink-0 transition"
                                    title="Удалить документ"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                              {docs.length === 0 && (
                                <div className="text-[10px] text-slate-400 italic py-1 text-center">
                                  Нет документов
                                </div>
                              )}
                            </div>
                            
                            {/* Add document form */}
                            <div className="flex gap-1 mt-1 border-t border-slate-100 pt-1.5">
                              <input 
                                type="text"
                                placeholder="Текст документа..."
                                value={newDocTexts[loc.id] || ''}
                                onChange={(e) => setNewDocTexts(prev => ({ ...prev, [loc.id]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleAddDocument(loc.id, newDocTexts[loc.id], docs);
                                  }
                                }}
                                className="flex-1 text-[10px] px-2 py-1 border border-slate-200 rounded-lg outline-none focus:border-emerald-500 bg-white"
                              />
                              <button 
                                onClick={() => handleAddDocument(loc.id, newDocTexts[loc.id], docs)}
                                className="px-2 py-1 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition text-[10px] font-bold"
                              >
                                Добавить
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition flex flex-col gap-1">
                        <button 
                          onClick={() => {
                            setEditingId(loc.id);
                            setEditName(loc.name);
                            setEditLat(loc.lat);
                            setEditLng(loc.lng);
                            setEditNotes(loc.notes || '');
                          }}
                          className="p-1 bg-white border border-slate-200 rounded text-slate-500 hover:text-blue-500 hover:border-blue-200"
                        >
                          <Edit className="w-3 h-3" />
                        </button>
                        <button 
                          onClick={() => handleDeleteLocation(loc.id)}
                          className="p-1 bg-white border border-slate-200 rounded text-slate-500 hover:text-rose-500 hover:border-rose-200"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {Object.keys(locations).length === 0 && (
               <div className="text-[11px] text-slate-400 font-medium text-center py-10">
                 Локации не созданы.<br/>Нажмите + чтобы добавить.
               </div>
            )}
          </div>
        </div>

        {/* Deliveries Section */}
        <div className="flex-1 flex flex-col gap-3 min-h-0 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between shrink-0">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <Truck className="w-4 h-4 text-emerald-500" />
              История Отправок
            </h2>
            <button 
              onClick={() => setShowDeliveryForm(true)}
              className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 flex items-center justify-center transition shrink-0"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

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
                <div key={d.id} className="bg-slate-50 border border-slate-200 p-3 rounded-2xl flex flex-col gap-2">
                  <div className="flex justify-between items-start text-xs">
                     <div className="flex flex-col min-w-0 flex-1">
                       <span className="font-bold text-slate-800 truncate pr-2" title={`${locations[d.fromLocId]?.name} ➔ ${locations[routeLocs[routeLocs.length - 1]]?.name || locations[d.toLocId]?.name}`}>
                         {locations[d.fromLocId]?.name} ➔ {locations[routeLocs[routeLocs.length - 1]]?.name || locations[d.toLocId]?.name}
                       </span>
                       {hasRoute && d.status === 'sent' && (
                         <span className="text-[10px] text-slate-500 font-medium mt-0.5">
                           Этап: <span className="font-bold text-blue-600">{activeFromLocName}</span> ➔ <span className="font-bold text-blue-600">{activeToLocName}</span>
                         </span>
                       )}
                     </div>
                     <div className="flex items-center gap-1.5 shrink-0">
                       <span className={`px-2 py-0.5 rounded-full text-[10px] font-black shrink-0 ${d.status === 'sent' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'}`}>
                         {d.status === 'sent' ? (hasRoute && routeLocs.length > 1 ? `В пути (${currentIdx + 1}/${routeLocs.length})` : 'В пути') : 'Доставлено'}
                       </span>
                       <button 
                         onClick={() => handleEditDelivery(d)}
                         className="p-1 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded transition"
                       >
                         <Edit className="w-3.5 h-3.5" />
                       </button>
                       <button 
                         onClick={() => handleDeleteDelivery(d.id)}
                         className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded transition"
                       >
                         <Trash2 className="w-3.5 h-3.5" />
                       </button>
                     </div>
                  </div>

                  {/* Route Steps Visualizer if multi-step */}
                  {hasRoute && routeLocs.length > 1 && (
                    <div className="bg-white border border-slate-150 rounded-xl p-2 flex flex-col gap-1 text-[10px]">
                      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Маршрут доставки:</div>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                          <span className="font-medium text-slate-600 truncate">{locations[d.fromLocId]?.name}</span>
                          <span className="text-[8px] text-slate-400 font-bold ml-auto shrink-0 bg-slate-100 px-1 py-0.2 rounded">Отправка</span>
                        </div>
                        {routeLocs.map((locId, sIdx) => {
                          const isReached = sIdx < currentIdx || d.status === 'received';
                          const isActive = sIdx === currentIdx && d.status === 'sent';
                          const stepTime = d.receivedAtSteps?.[locId] ? new Date(d.receivedAtSteps[locId]).toLocaleDateString() : null;

                          return (
                            <div key={locId} className="flex items-center gap-1.5 pl-3 border-l-2 border-dashed border-slate-200 ml-1 py-0.5">
                              <div className={`w-2 h-2 rounded-full shrink-0 ${isReached ? 'bg-emerald-500' : isActive ? 'bg-blue-500 animate-pulse' : 'bg-slate-300'}`} />
                              <span className={`truncate ${isActive ? 'font-bold text-blue-600' : isReached ? 'text-slate-500 line-through' : 'text-slate-400'}`}>
                                {locations[locId]?.name || 'Unknown'}
                              </span>
                              {stepTime && (
                                <span className="text-[8px] text-slate-400 font-mono ml-auto shrink-0">{stepTime}</span>
                              )}
                              {!stepTime && isActive && (
                                <span className="text-[8px] text-blue-500 font-bold ml-auto shrink-0 bg-blue-50 px-1 rounded animate-pulse">В пути</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="text-[10px] text-slate-500 font-medium">
                     Дозволов: {d.dozvolIds?.length || 0}
                  </div>

                  {/* Transferred permits list */}
                  {d.dozvolIds && d.dozvolIds.length > 0 && (
                    <div className="bg-white border border-slate-150 rounded-xl p-2 flex flex-col gap-1 text-[10px]">
                      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Передаваемые дозвола:</div>
                      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar">
                        {d.dozvolIds.map(id => {
                          const dozvol = dozvolsData[id];
                          if (!dozvol) {
                            return (
                              <span key={id} className="inline-flex items-center bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded text-[8px] font-mono border border-slate-200/30">
                                {id.slice(0, 6)}...
                              </span>
                            );
                          }
                          return (
                            <div 
                              key={id} 
                              className="inline-flex items-center gap-1 bg-slate-50 border border-slate-150 rounded-lg px-1.5 py-0.5 text-[9px] min-w-0"
                              title={`${dozvol.type}${dozvol.comment ? ' • ' + dozvol.comment : ''}`}
                            >
                              <FileText className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                              <span className="font-mono font-bold text-slate-700 truncate">{dozvol.number}</span>
                              <span className="text-[8px] text-blue-600 bg-blue-50 px-1 rounded truncate max-w-[65px] font-medium">
                                {dozvol.type}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="text-[10px] text-slate-400">
                     Отправлено: {d.sentAt}
                     {d.receivedAt && ` • Получено: ${new Date(d.receivedAt).toLocaleDateString()}`}
                  </div>
                  {d.status === 'sent' && (
                     <button 
                       onClick={() => handleReceiveDelivery(d)} 
                       className="mt-1 bg-emerald-50 text-emerald-600 border border-emerald-200 text-xs py-1.5 rounded-lg font-bold hover:bg-emerald-100 transition flex items-center justify-center gap-1.5"
                     >
                       <Truck className="w-3.5 h-3.5" />
                       {hasRoute && currentIdx < routeLocs.length - 1 ? (
                         <span>Подтвердить прибытие в пункт <strong>{activeToLocName}</strong></span>
                       ) : (
                         <span>Подтвердить получение в <strong>{activeToLocName}</strong></span>
                       )}
                     </button>
                  )}
                </div>
              );
            })}
            {Object.keys(deliveries).length === 0 && (
               <div className="text-[11px] text-slate-400 font-medium text-center py-10">
                 Нет истории отправок.
               </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Map Section */}
      <div className="w-2/3 h-full rounded-xl overflow-hidden relative border border-slate-200/50 bg-slate-100 z-0">
        <MapContainer
          center={[53.9006, 27.5590]}
          zoom={6}
          className="w-full h-full"
          style={{ height: '100%', width: '100%', zIndex: 0 }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {Object.values(locations).map((loc: LocationItem) => {
            const dozvolsList = Object.keys(dozvolsData).map(key => ({ id: key, ...dozvolsData[key] })).filter((d: any) => 
               (d.car === loc.name || d.assignedVehicle === loc.name || d.status === loc.name) &&
               d.status !== 'used' && d.status !== 'expired'
            );
            const locDocs = (loc.documents ? (Array.isArray(loc.documents) ? loc.documents : Object.values(loc.documents)) : []) as string[];
            
            const globQuery = globalSearchQuery.toLowerCase().trim();
            const popupQuery = (popupSearchQueries[loc.id] || '').toLowerCase().trim();
            
            // Check if there's any matching dozvol on this location for global search
            const hasMatchingDozvol = globQuery ? dozvolsList.some((d: any) => 
               (d.number || '').toLowerCase().includes(globQuery) ||
               (d.type || '').toLowerCase().includes(globQuery) ||
               (d.comment || '').toLowerCase().includes(globQuery)
            ) : false;

            // Filter dozvols inside map popup based on global/popup search
            const filteredPopupDozvols = dozvolsList.filter((d: any) => {
              if (globQuery) {
                const matchesGlob = (d.number || '').toLowerCase().includes(globQuery) ||
                                    (d.type || '').toLowerCase().includes(globQuery) ||
                                    (d.comment || '').toLowerCase().includes(globQuery);
                if (!matchesGlob) return false;
              }
              if (popupQuery) {
                const matchesPopup = (d.number || '').toLowerCase().includes(popupQuery) ||
                                     (d.type || '').toLowerCase().includes(popupQuery) ||
                                     (d.comment || '').toLowerCase().includes(popupQuery);
                if (!matchesPopup) return false;
              }
              return true;
            });

            const markerBgColor = hasMatchingDozvol 
              ? '#f59e0b' 
              : (hoveredMarker === loc.id ? '#2563eb' : '#3b82f6');
            
            const markerPulseClass = hasMatchingDozvol 
              ? 'animate-bounce shadow-lg border-amber-300 ring-4 ring-amber-400/40' 
              : '';

            const markerIcon = L.divIcon({
               className: 'custom-div-icon',
               html: `<div class="${markerPulseClass}" style="background-color: ${markerBgColor}; width: 22px; height: 22px; border-radius: 50%; border: 2px solid white; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); transition: all 0.2s;"></div>`,
               iconSize: [22, 22],
               iconAnchor: [11, 11]
            });
            
            return (
              <Marker 
                key={loc.id}
                position={editingId === loc.id ? [editLat, editLng] : [loc.lat, loc.lng]}
                icon={markerIcon}
                draggable={editingId === loc.id}
                eventHandlers={{
                  dragend: (e) => {
                    const marker = e.target;
                    const position = marker.getLatLng();
                    if (editingId === loc.id) {
                       setEditLat(position.lat);
                       setEditLng(position.lng);
                    }
                  },
                  mouseover: () => setHoveredMarker(loc.id),
                  mouseout: () => setHoveredMarker(null)
                }}
              >
                <Popup closeButton={false} offset={[0, -5]}>
                   <div className="w-56 bg-white rounded-xl flex flex-col gap-1.5 p-0.5">
                     <div className="font-bold text-xs text-slate-800 mb-1 border-b border-slate-100 pb-1">
                       {loc.name}
                       <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                         Дозвола ({dozvolsList.length})
                       </div>
                     </div>

                     {/* Popup search input */}
                     <div className="relative mb-1 shrink-0">
                       <input 
                         type="text"
                         placeholder="Поиск дозвола..."
                         value={popupSearchQueries[loc.id] || ''}
                         onChange={(e) => setPopupSearchQueries(prev => ({ ...prev, [loc.id]: e.target.value }))}
                         className="w-full text-[9px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 outline-none focus:border-blue-500 transition"
                       />
                       {(popupSearchQueries[loc.id] || '') && (
                         <button 
                           onClick={() => setPopupSearchQueries(prev => ({ ...prev, [loc.id]: '' }))}
                           className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-200/50 transition"
                         >
                           <X className="w-2.5 h-2.5" />
                         </button>
                       )}
                     </div>

                     <div className="max-h-36 overflow-y-auto text-[10px] text-slate-600 flex flex-col gap-1 custom-scrollbar">
                       {filteredPopupDozvols.map((d: any) => {
                         const isHighlighted = (globQuery !== '' && (
                           (d.number || '').toLowerCase().includes(globQuery) ||
                           (d.type || '').toLowerCase().includes(globQuery) ||
                           (d.comment || '').toLowerCase().includes(globQuery)
                         )) || (popupQuery !== '' && (
                           (d.number || '').toLowerCase().includes(popupQuery) ||
                           (d.type || '').toLowerCase().includes(popupQuery) ||
                           (d.comment || '').toLowerCase().includes(popupQuery)
                         ));

                         return (
                           <div 
                             key={d.id} 
                             className={`flex flex-col p-2 rounded-lg gap-1 border shadow-sm transition duration-150 ${
                               isHighlighted
                                 ? 'bg-amber-50/70 border-amber-300 ring-1 ring-amber-300/10'
                                 : 'bg-slate-50 border-slate-200/50'
                             }`}
                           >
                             <div className="flex justify-between items-center gap-1.5">
                               <span className="font-black text-[8.5px] text-blue-600 bg-blue-50 border border-blue-100/50 px-1.5 py-0.5 rounded-full uppercase tracking-tight truncate max-w-[100px]" title={d.type}>
                                 {d.type}
                               </span>
                               <span className="font-mono font-black text-[10px] text-slate-900 bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-sm shrink-0">
                                 {d.number}
                               </span>
                             </div>
                             {d.comment && (
                               <div className="text-[9px] text-slate-500 italic border-t border-slate-100/30 pt-0.5 mt-0.5 leading-tight">
                                 {d.comment}
                               </div>
                             )}
                           </div>
                         );
                       })}
                       {filteredPopupDozvols.length === 0 && (
                         <div className="text-slate-400 italic text-center py-2 text-[9px]">
                           {dozvolsList.length === 0 ? 'Нет дозволов' : 'Не найдено'}
                         </div>
                       )}
                     </div>

                     {locDocs.length > 0 && (
                       <div className="border-t border-slate-100 pt-1.5 mt-1">
                         <div className="text-[10px] font-bold text-emerald-600 mb-1 flex items-center gap-1">
                           <FileText className="w-3 h-3" />
                           <span>Документы ({locDocs.length}):</span>
                         </div>
                         <div className="max-h-24 overflow-y-auto flex flex-col gap-1 custom-scrollbar">
                           {locDocs.map((docText: string, idx: number) => (
                             <div key={idx} className="bg-emerald-50/50 text-[9px] text-slate-600 p-1.5 rounded border border-emerald-100/30 leading-tight break-all">
                               {docText}
                             </div>
                           ))}
                         </div>
                       </div>
                     )}
                   </div>
                </Popup>
              </Marker>
            );
          })}

          {Object.values(deliveries).filter((d: DeliveryItem) => d.status === "sent").map((d: DeliveryItem) => {
            const fromLoc = locations[d.fromLocId];
            if (!fromLoc) return null;

            const dozvolList = (d.dozvolIds || []).map((id: string) => ({ id, ...dozvolsData[id] })).filter((item: any) => !!item.number);

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

                  let lineColor = '#3b82f6'; // Blue for active
                  let lineWeight = 4;
                  let isDashed = true;
                  let isPulse = true;
                  let stageText = 'В пути';

                  if (hasRoute) {
                    if (idx < currentStepIdx) {
                      lineColor = '#10b981'; // Green for completed segments
                      lineWeight = 3;
                      isDashed = false;
                      isPulse = false;
                      stageText = 'Пройдено';
                    } else if (idx === currentStepIdx) {
                      lineColor = '#3b82f6'; // Blue for active segment
                      lineWeight = 5;
                      isDashed = true;
                      isPulse = true;
                      stageText = 'В пути (активный этап)';
                    } else {
                      lineColor = '#94a3b8'; // Slate for future segments
                      lineWeight = 2;
                      isDashed = true;
                      isPulse = false;
                      stageText = 'Запланировано';
                    }
                  }

                  return (
                    <Polyline
                      key={`${d.id}_seg_${idx}`}
                      positions={[[startLoc.lat, startLoc.lng], [endLoc.lat, endLoc.lng]]}
                      pathOptions={{
                        color: lineColor,
                        weight: lineWeight,
                        dashArray: isDashed ? '10, 10' : undefined
                      }}
                      className={isPulse ? 'animate-pulse cursor-pointer' : 'cursor-pointer'}
                    >
                      <Popup closeButton={false}>
                        <div className="w-56 bg-white rounded-xl flex flex-col gap-1.5 p-1 text-xs">
                          <div className="font-bold text-slate-800 border-b border-slate-100 pb-1.5 mb-1">
                            <div className="flex items-center justify-between gap-1 mb-0.5">
                              <div className="flex items-center gap-1 text-blue-600">
                                <Route className="w-3.5 h-3.5" />
                                <span className="font-black">{stageText}</span>
                              </div>
                              {hasRoute && (
                                <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">
                                  Этап {idx + 1} из {routeLocIds.length}
                                </span>
                              )}
                            </div>
                            <div className="text-slate-700 font-black">
                              {startLoc.name} ➔ {endLoc.name}
                            </div>
                            <div className="text-[9px] text-slate-400 font-normal mt-1">
                              Отправлено: {d.sentAt}
                            </div>
                          </div>
                          
                          {/* Route overview if multi-step */}
                          {hasRoute && (
                            <div className="bg-slate-50 border border-slate-100 rounded-lg p-1.5 mb-1">
                              <div className="text-[9px] font-bold text-slate-500 mb-1 uppercase tracking-wider">Маршрут:</div>
                              <div className="flex flex-col gap-1 text-[10px]">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                                  <span className="font-medium text-slate-700 truncate">{fromLoc.name}</span>
                                </div>
                                {routeLocIds.map((stepLocId, stepIdx) => {
                                  const stepLoc = locations[stepLocId];
                                  if (!stepLoc) return null;
                                  const isStepCompleted = stepIdx < currentStepIdx;
                                  const isStepActive = stepIdx === currentStepIdx;
                                  return (
                                    <div key={stepIdx} className="flex items-center gap-1.5 pl-3 border-l-2 border-dashed border-slate-200 ml-1 py-0.5">
                                      <div className={`w-2 h-2 rounded-full shrink-0 ${isStepCompleted ? 'bg-emerald-500' : isStepActive ? 'bg-blue-500 animate-pulse' : 'bg-slate-300'}`} />
                                      <span className={`truncate ${isStepActive ? 'font-bold text-blue-600' : isStepCompleted ? 'text-slate-500 line-through' : 'text-slate-400'}`}>
                                        {stepLoc.name}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          <div className="text-[10px] font-bold text-slate-500 mb-1">
                            Отправленные дозвола ({dozvolList.length}):
                          </div>
                          <div className="max-h-28 overflow-y-auto flex flex-col gap-1 custom-scrollbar">
                            {dozvolList.map((item: any) => (
                              <div key={item.id} className="bg-slate-50 border border-slate-100 rounded p-1.5 flex flex-col gap-0.5">
                                <div className="flex justify-between items-center">
                                  <span className="font-mono font-bold text-slate-700 text-[10px]">{item.number}</span>
                                  <span className="text-[9px] text-slate-500 max-w-[80px] truncate font-medium" title={item.type}>{item.type}</span>
                                </div>
                                {item.comment && (
                                  <div className="text-[9px] text-slate-400 italic border-t border-slate-100/30 pt-0.5 mt-0.5 leading-tight">
                                    {item.comment}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </Popup>
                    </Polyline>
                  );
                })}
              </React.Fragment>
            );
          })}
        </MapContainer>
      </div>

      {showDeliveryForm && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl border border-slate-200 p-6 w-[640px] max-w-full flex flex-col gap-4 max-h-[90vh]">
            <div className="flex justify-between items-center">
              <h2 className="font-black text-lg text-slate-800 flex items-center gap-2">
                <Route className="w-5 h-5 text-blue-500" />
                {editingDelivId ? 'Редактирование отправки' : 'Новая отправка дозволов'}
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
                className="p-1 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex flex-col gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200/60">
              <div className="flex justify-between items-center">
                <span className="text-xs font-black uppercase tracking-wider text-slate-700">Маршрут следования</span>
                <button 
                  type="button"
                  onClick={() => setDelivRoute([...delivRoute, ''])}
                  className="text-[11px] font-bold bg-blue-50 text-blue-600 hover:bg-blue-100 px-2.5 py-1 rounded-lg flex items-center gap-1 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Добавить этап
                </button>
              </div>

              <div className="flex flex-col gap-2.5 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                {/* Starting point */}
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-emerald-500 text-white font-mono text-xs font-black flex items-center justify-center shrink-0">
                    S
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Откуда (Пункт отправления)</label>
                    <select 
                      value={delivFrom} 
                      onChange={(e) => { setDelivFrom(e.target.value); setDelivDozvols([]); setDelivSearchQuery(''); }}
                      className="w-full text-xs font-bold bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-blue-500 transition"
                    >
                      <option value="">Выберите локацию...</option>
                      {Object.values(locations).map((l: LocationItem) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </div>
                </div>

                {/* Route steps */}
                {delivRoute.map((stepLocId, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-blue-500 text-white font-mono text-xs font-black flex items-center justify-center shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">
                        {idx === delivRoute.length - 1 ? 'Конечный пункт назначения' : `Промежуточный пункт ${idx + 1}`}
                      </label>
                      <select 
                        value={stepLocId} 
                        onChange={(e) => {
                          const nextRoute = [...delivRoute];
                          nextRoute[idx] = e.target.value;
                          setDelivRoute(nextRoute);
                        }}
                        className="w-full text-xs font-bold bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-blue-500 transition"
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

            {delivFrom && (
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-end px-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Выберите дозвола {filteredDozvolsAtFrom.length !== dozvolsAtFrom.length ? `(найдено ${filteredDozvolsAtFrom.length} из ${dozvolsAtFrom.length})` : `(${dozvolsAtFrom.length} доступно)`}
                  </label>
                  {delivDozvols.length > 0 && (
                    <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                      Выбрано: {delivDozvols.length}
                    </span>
                  )}
                </div>

                {/* Compact Search Input */}
                <div className="relative">
                  <input 
                    type="text"
                    placeholder="Быстрый поиск по номеру, типу или комментарию..."
                    value={delivSearchQuery}
                    onChange={(e) => setDelivSearchQuery(e.target.value)}
                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl pl-3 pr-8 py-2 outline-none focus:border-blue-500 transition"
                  />
                  {delivSearchQuery && (
                    <button 
                      onClick={() => setDelivSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-200/50 transition"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 border border-slate-200 rounded-2xl p-2.5 max-h-72 overflow-y-auto bg-slate-50/50 custom-scrollbar">
                  {filteredDozvolsAtFrom.map((d: any) => (
                    <div key={d.id} className="flex items-center gap-2.5 bg-white hover:bg-slate-50 border border-slate-200/70 px-2.5 py-1.5 rounded-xl shadow-sm transition">
                      <input 
                        type="checkbox" 
                        checked={delivDozvols.includes(d.id)} 
                        onChange={(e) => {
                          if (e.target.checked) setDelivDozvols([...delivDozvols, d.id]);
                          else setDelivDozvols(delivDozvols.filter(id => id !== d.id));
                        }} 
                        className="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500 cursor-pointer shrink-0"
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
                        <span className="font-mono font-black text-xs text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/40 shrink-0">
                          {d.number}
                        </span>
                        <span className="text-[10px] font-black text-blue-600 bg-blue-50 border border-blue-100/50 px-2 py-0.5 rounded-full uppercase tracking-tight truncate max-w-[130px]" title={d.type}>
                          {d.type}
                        </span>
                      </div>

                      {/* Compact inline comment input */}
                      <div className="flex items-center gap-1.5 shrink-0 w-44">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Коммент:</span>
                        <input 
                          type="text"
                          defaultValue={d.comment || ''}
                          onBlur={(e) => {
                            const newComment = e.target.value.trim();
                            if (newComment !== (d.comment || '')) {
                              update(ref(database, `dozvolsRegistryV4/${d.id}`), { comment: newComment });
                            }
                          }}
                          placeholder="Добавить..."
                          className="w-full text-[10px] px-2 py-1 border border-slate-200 rounded-lg outline-none focus:border-blue-500 bg-slate-50 focus:bg-white transition"
                        />
                      </div>
                    </div>
                  ))}
                  {filteredDozvolsAtFrom.length === 0 && (
                    <span className="text-xs text-slate-400 text-center py-6 italic">
                      {dozvolsAtFrom.length === 0 ? 'Нет дозволов в этой локации' : 'Дозвола не найдены'}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1">
               <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">Дата отправки</label>
               <input 
                 type="date" 
                 value={delivSentAt} 
                 onChange={(e) => setDelivSentAt(e.target.value)} 
                 className="w-full text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-blue-500"
               />
            </div>

            <div className="flex justify-end gap-2 mt-2 pt-4 border-t border-slate-100">
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
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 transition"
              >
                Отмена
              </button>
              <button 
                onClick={handleSaveDelivery}
                disabled={!delivFrom || delivRoute.filter(r => r.trim().length > 0).length === 0 || delivDozvols.length === 0 || !delivSentAt}
                className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-tight bg-blue-500 text-white hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-blue-500/20"
              >
                {editingDelivId ? 'Сохранить изменения' : 'Оформить отправку'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
