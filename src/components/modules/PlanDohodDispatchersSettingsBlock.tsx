import {useState, useEffect} from 'react';
import {UserProfile} from '../../types';
import {directoryService} from '../../api';
import {Plus, Trash2, ArrowUp, ArrowDown} from 'lucide-react';
import {useToast} from '../ToastProvider';

interface Props {
  user: UserProfile;
}

interface DispObj {
  id: string;
  name: string;
  color?: string;
}

export default function PlanDohodDispatchersSettingsBlock({ user }: Props) {
  const { toast } = useToast();
  const [dispatchers, setDispatchers] = useState<DispObj[]>([]);
  const [newDispatcherName, setNewDispatcherName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    return directoryService.getDispatchersObjects((list) => {
      setDispatchers((list || []).map((d) => ({ id: d.id, name: d.name, color: d.color })));
    });
  }, []);

  const filteredDispatchers = dispatchers.filter(d =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAddDispatcher = () => {
    const trimmed = newDispatcherName.trim();
    if (!trimmed) {
      toast('Введите имя диспетчера', 'error');
      return;
    }
    if (dispatchers.some((d) => d.name.toLowerCase() === trimmed.toLowerCase())) {
      toast('Такой диспетчер уже существует', 'error');
      return;
    }

    const id = 'disp_' + Date.now().toString();
    directoryService.saveDirItem('dispatchers', { id, name: trimmed, color: '#70FC8E' }, user.name, user.role);
    setNewDispatcherName('');
    toast('Диспетчер добавлен', 'success');
  };

  const handleDeleteDispatcher = (disp: DispObj) => {
    directoryService.deleteDirItem('dispatchers', disp.id, user.name, user.role);
    toast('Диспетчер удалён', 'success');
  };

  const handleMove = (disp: DispObj, direction: 'up' | 'down') => {
    const idx = dispatchers.findIndex((d) => d.id === disp.id);
    if (idx === -1) return;
    const newList = [...dispatchers];
    if (direction === 'up' && idx > 0) {
      [newList[idx - 1], newList[idx]] = [newList[idx], newList[idx - 1]];
    } else if (direction === 'down' && idx < newList.length - 1) {
      [newList[idx + 1], newList[idx]] = [newList[idx], newList[idx + 1]];
    } else {
      return;
    }
    // Persist new order by rewriting the whole dispatchers collection in new order.
    newList.forEach((d) =>
      directoryService.saveDirItem('dispatchers', d, user.name, user.role)
    );
    setDispatchers(newList);
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
          Управление списком и порядком вывода диспетчеров. Единый справочник (директория directories/dispatchers).
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
            <div key={disp.id} className="flex justify-between items-center py-2.5 px-4 border border-white/45 rounded-xl bg-white/40 backdrop-blur-md hover:bg-white/50 transition">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: disp.color || '#94a3b8' }}></span>
                👤 {disp.name}
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
                {disp.name !== 'All' && disp.name !== 'Все' && disp.name !== 'Все диспетчеры' && (
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
