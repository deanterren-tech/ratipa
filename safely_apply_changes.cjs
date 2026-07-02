const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'components', 'modules', 'DohodModule.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Convert CRLF to LF
content = content.replace(/\r\n/g, '\n');

// 1. Replace imports
const oldImport = "import { Plus, Trash2, Save, MapPin, Calculator, MessageSquare, Sparkles, Info, Ship, TrendingUp, FileSpreadsheet, Calendar, RefreshCw, Edit, Copy, X, Check } from 'lucide-react';";
const newImport = "import { Plus, Trash2, Save, MapPin, Calculator, MessageSquare, Sparkles, Info, Ship, TrendingUp, FileSpreadsheet, Calendar, RefreshCw, Edit, Copy, X, Check, ChevronUp, ChevronDown, GripVertical } from 'lucide-react';";

if (content.includes(oldImport)) {
  content = content.replace(oldImport, newImport);
  console.log("Successfully replaced imports!");
} else {
  console.log("Could not find standard imports line!");
}

// 2. Add handleMoveWaypoint helper
const oldState = "const [mapWaypoints, setMapWaypoints] = useState<string[]>([]);";
const newState = `const [mapWaypoints, setMapWaypoints] = useState<string[]>([]);

  const handleMoveWaypoint = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= mapWaypoints.length) return;
    const updated = [...mapWaypoints];
    const [removed] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, removed);
    setMapWaypoints(updated);
  };`;

if (content.includes(oldState)) {
  content = content.replace(oldState, newState);
  console.log("Successfully added handleMoveWaypoint helper!");
} else {
  console.log("Could not find mapWaypoints state declaration!");
}

// 3. Find and replace the waypoints map ONLY inside the Interactive Calculation modal
const targetWaypointPart = `                        {/* 2. Промежуточные точки */}
                        {mapWaypoints.map((wp, index) => (
                           <div key={index} className="flex flex-col gap-1.5 bg-white p-2.5 rounded-xl border border-slate-200/50 animate-fade-in relative">
                              <div className="flex items-center justify-between">
                                 <span className="text-[9px] font-bold text-slate-400 font-mono font-black">Промежуточная точка #{index + 1}</span>
                                 <button 
                                    type="button"
                                    onClick={() => {
                                       const newWps = mapWaypoints.filter((_, idx) => idx !== index);
                                       setMapWaypoints(newWps);
                                    }}
                                    className="text-rose-500 hover:text-rose-600 transition cursor-pointer"
                                 >
                                    <Trash2 className="w-3.5 h-3.5" />
                                 </button>
                              </div>
                              <input 
                                 type="text"
                                 value={wp}
                                 onChange={(e) => {
                                    const newWps = [...mapWaypoints];
                                    newWps[index] = e.target.value;
                                    setMapWaypoints(newWps);
                                 }}
                                 placeholder="Введите промежуточный населенный пункт..."
                                 className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                              />
                           </div>
                        ))}`;

const newWaypointPart = `                        {/* 2. Промежуточные точки */}
                        {mapWaypoints.map((wp, index) => (
                           <div 
                              key={index} 
                              className="flex flex-col gap-1.5 bg-white p-2.5 rounded-xl border border-slate-200/50 animate-fade-in relative group"
                              draggable={true}
                              onDragStart={(e) => {
                                 e.dataTransfer.setData('text/plain', index.toString());
                              }}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                 e.preventDefault();
                                 const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
                                 if (!isNaN(fromIndex) && fromIndex !== index) {
                                    handleMoveWaypoint(fromIndex, index);
                                 }
                              }}
                           >
                              <div className="flex items-center justify-between">
                                 <div className="flex items-center gap-1.5 cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 transition">
                                    <GripVertical className="w-3.5 h-3.5" />
                                    <span className="text-[9px] font-bold text-slate-400 font-mono font-black select-none">Промежуточная точка #{index + 1}</span>
                                 </div>
                                 <div className="flex items-center gap-1">
                                    <button
                                       type="button"
                                       disabled={index === 0}
                                       onClick={() => handleMoveWaypoint(index, index - 1)}
                                       className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 transition cursor-pointer"
                                       title="Переместить вверх"
                                    >
                                       <ChevronUp className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                       type="button"
                                       disabled={index === mapWaypoints.length - 1}
                                       onClick={() => handleMoveWaypoint(index, index + 1)}
                                       className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 transition cursor-pointer"
                                       title="Переместить вниз"
                                    >
                                       <ChevronDown className="w-3.5 h-3.5" />
                                    </button>
                                    <button 
                                       type="button"
                                       onClick={() => {
                                          const newWps = mapWaypoints.filter((_, idx) => idx !== index);
                                          setMapWaypoints(newWps);
                                       }}
                                       className="p-1 text-rose-500 hover:text-rose-600 transition cursor-pointer ml-1"
                                       title="Удалить"
                                    >
                                       <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                 </div>
                              </div>
                              <input 
                                 type="text"
                                 value={wp}
                                 onChange={(e) => {
                                    const newWps = [...mapWaypoints];
                                    newWps[index] = e.target.value;
                                    setMapWaypoints(newWps);
                                 }}
                                 placeholder="Введите промежуточный населенный пункт..."
                                 className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                              />
                           </div>
                        ))}`;

if (content.includes(targetWaypointPart)) {
  content = content.replace(targetWaypointPart, newWaypointPart);
  console.log("Successfully replaced the waypoints list!");
} else {
  console.log("Could not find the targetWaypointPart in DohodModule.tsx!");
}

// 4. Update the BelarusMap call
const oldMapBlock = `                        <BelarusMap 
                           origin={mapOrigin} 
                           destination={mapDestination} 
                           waypoints={mapWaypoints} 
                           onDistance={setMapKmResult} 
                        />`;

const newMapBlock = `                        <BelarusMap 
                           origin={mapOrigin} 
                           destination={mapDestination} 
                           waypoints={mapWaypoints} 
                           onDistance={setMapKmResult} 
                           onOriginChange={setMapOrigin}
                           onDestinationChange={setMapDestination}
                           onWaypointsChange={setMapWaypoints}
                        />`;

if (content.includes(oldMapBlock)) {
  content = content.replace(oldMapBlock, newMapBlock);
  console.log("Successfully updated the BelarusMap component call!");
} else {
  console.log("Could not find the oldMapBlock in DohodModule.tsx!");
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("Done safely applying changes!");
