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

  useEffect(() => {
    return pdService.subscribeDispatchers((disp, order) => {
      setDispatchers(disp);
      setDispatchersOrder(order);
    });
  }, []);

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
    <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] mt-6">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-5">
        <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
          Диспетчеры (План Дохода)
        </h2>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Имя диспетчера..."
          value={newDispatcherName}
          onChange={e => setNewDispatcherName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddDispatcher()}
          className="flex-1 bg-slate-50 border border-slate-200 px-3 py-2.5 rounded-xl text-xs font-bold outline-none focus:border-blue-400"
        />
        <button
          onClick={handleAddDispatcher}
          className="flex items-center gap-1 text-[10px] uppercase font-black tracking-widest text-slate-950 bg-[#70FC8E] px-4 py-2.5 rounded-xl hover:bg-[#5be378] transition cursor-pointer"
        >
          <Plus size={12}/> Добавить
        </button>
      </div>

      <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
        {dispatchersOrder.map((disp, idx) => {
          return (
            <div key={disp} className="flex justify-between items-center py-2 px-3 border border-slate-100 rounded-xl bg-slate-50 hover:bg-slate-100/50 transition">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-2">
                👤 {disp}
              </span>
              <div className="flex gap-1 items-center">
                <button 
                  onClick={() => handleMove(disp, 'up')} 
                  disabled={idx === 0} 
                  className="p-1 hover:bg-white border border-transparent hover:border-slate-200 transition rounded-lg text-slate-400 disabled:opacity-20 cursor-pointer"
                >
                  <ArrowUp size={12}/>
                </button>
                <button 
                  onClick={() => handleMove(disp, 'down')} 
                  disabled={idx === dispatchersOrder.length - 1} 
                  className="p-1 hover:bg-white border border-transparent hover:border-slate-200 transition rounded-lg text-slate-400 disabled:opacity-20 cursor-pointer"
                >
                  <ArrowDown size={12}/>
                </button>
                {disp !== 'All' && disp !== 'Все' && disp !== 'Все диспетчеры' && (
                  <button 
                    onClick={() => handleDeleteDispatcher(disp)} 
                    className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer"
                  >
                    <Trash2 size={14}/>
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {dispatchersOrder.length === 0 && (
          <div className="text-[10px] uppercase font-black tracking-widest text-slate-400 text-center py-6 font-mono">
            Диспетчеры не добавлены
          </div>
        )}
      </div>
    </div>
  );
}
