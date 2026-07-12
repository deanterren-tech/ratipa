import React, { useState, useEffect } from 'react';
import { UserProfile } from '../../types';
import { pdService } from '../../firebase/planDohodService';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { useToast } from '../ToastProvider';

interface Props {
  user: UserProfile;
}

export default function PlanDohodDispatchersSettingsBlock({ user }: Props) {
  const { toast } = useToast();
  const [dispatchers, setDispatchers] = useState<string[]>([]);
  const [dispatchersOrder, setDispatchersOrder] = useState<string[]>([]);
  const [newDispatcherName, setNewDispatcherName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    return pdService.subscribeDispatchers((disp, order) => {
      setDispatchers(disp);
      setDispatchersOrder(order);
    });
  }, []);

  const filteredDispatchers = dispatchersOrder.filter(d => 
    d.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAddDispatcher = () => {
    const trimmed = newDispatcherName.trim();
    if (!trimmed) {
      toast('Введите имя диспетчера', 'error');
      return;
    }
    if (dispatchers.includes(trimmed)) {
      toast('Такой диспетчер уже существует', 'error');
      return;
    }

    const updatedDisp = [...dispatchers, trimmed];
    const updatedOrder = [...dispatchersOrder];
    if (!updatedOrder.includes(trimmed)) {
      // Add right before 'All' if it exists, otherwise at the end
      const allIdx = updatedOrder.indexOf('All');
      if (allIdx > -1) {
        updatedOrder.splice(allIdx, 0, trimmed);
      } else {
        updatedOrder.push(trimmed);
      }
    }

    pdService.updateDispatchers(updatedDisp);
    pdService.updateDispatchersOrder(updatedOrder);
    setNewDispatcherName('');
    toast('Диспетчер добавлен', 'success');
  };

  const handleDeleteDispatcher = (name: string) => {
    const updatedDisp = dispatchers.filter(d => d !== name);
    const updatedOrder = dispatchersOrder.filter(d => d !== name);
    pdService.updateDispatchers(updatedDisp);
    pdService.updateDispatchersOrder(updatedOrder);
    toast('Диспетчер удален', 'success');
  };

  const handleMove = (name: string, direction: 'up' | 'down') => {
    const idx = dispatchersOrder.indexOf(name);
    if (idx === -1) return;
    const newOrder = [...dispatchersOrder];
    
    if (direction === 'up' && idx > 0) {
      const temp = newOrder[idx];
      newOrder[idx] = newOrder[idx - 1];
      newOrder[idx - 1] = temp;
    } else if (direction === 'down' && idx < newOrder.length - 1) {
      const temp = newOrder[idx];
      newOrder[idx] = newOrder[idx + 1];
      newOrder[idx + 1] = temp;
    }

    pdService.updateDispatchersOrder(newOrder);
  };

  return (
    <div className="bg-white/60 backdrop-blur-2xl rounded-[2.5rem] p-6 lg:p-8 border border-white/40 shadow-xl space-y-6 w-full select-none mt-6">
      
      {/* Block Header */}
      <div className="border-b border-white/40 pb-4">
        <span className="bg-indigo-600 text-white font-black text-[9px] px-2.5 py-0.5 rounded-full uppercase font-mono tracking-wider">
          Dispatchers Configuration
        </span>
        <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 mt-2 flex items-center gap-1.5">
          Диспетчеры (План Дохода)
        </h2>
        <p className="text-[10px] text-slate-500 font-medium mt-1 leading-relaxed">
          Управление списком и порядком вывода диспетчеров в модуле плана доходов.
        </p>
      </div>

      <div className="flex gap-2.5">
        <input
          type="text"
          placeholder="Поиск диспетчера..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="flex-1 bg-white/40 border border-white/45 shadow-sm px-4 py-2.5 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 transition"
        />
        <input
          type="text"
          placeholder="Имя диспетчера..."
          value={newDispatcherName}
          onChange={e => setNewDispatcherName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddDispatcher()}
          className="flex-1 bg-white/40 border border-white/45 shadow-sm px-4 py-2.5 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 transition"
        />
        <button
          onClick={handleAddDispatcher}
          className="flex items-center gap-1 text-[10px] uppercase font-black tracking-widest text-white bg-indigo-600 px-4 py-2.5 rounded-xl hover:bg-indigo-755 active:scale-95 shadow-md transition cursor-pointer"
        >
          <Plus size={12}/> Добавить
        </button>
      </div>

      <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
        {filteredDispatchers.map((disp, idx) => {
          return (
            <div key={disp} className="flex justify-between items-center py-2.5 px-4 border border-white/45 rounded-xl bg-white/40 backdrop-blur-md hover:bg-white/50 transition">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-2">
                👤 {disp}
              </span>
              <div className="flex gap-1 items-center">
                <button 
                  onClick={() => handleMove(disp, 'up')} 
                  disabled={idx === 0 || searchQuery !== ''} 
                  className="p-1 hover:bg-white border border-transparent hover:border-white/40 transition rounded-lg text-slate-400 disabled:opacity-20 cursor-pointer"
                >
                  <ArrowUp size={12}/>
                </button>
                <button 
                  onClick={() => handleMove(disp, 'down')} 
                  disabled={idx === filteredDispatchers.length - 1 || searchQuery !== ''} 
                  className="p-1 hover:bg-white border border-transparent hover:border-white/40 transition rounded-lg text-slate-400 disabled:opacity-20 cursor-pointer"
                >
                  <ArrowDown size={12}/>
                </button>
                {disp !== 'All' && disp !== 'Все' && disp !== 'Все диспетчеры' && (
                  <button 
                    onClick={() => handleDeleteDispatcher(disp)} 
                    className="p-1 text-rose-500 hover:bg-rose-500/10 rounded-lg cursor-pointer transition-colors"
                  >
                    <Trash2 size={14}/>
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {filteredDispatchers.length === 0 && (
          <div className="text-[10px] uppercase font-black tracking-widest text-slate-400 text-center py-6 font-mono">
            Диспетчеры не найдены
          </div>
        )}
      </div>
    </div>
  );
}
