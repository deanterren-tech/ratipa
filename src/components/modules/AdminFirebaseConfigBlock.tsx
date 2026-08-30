import  { useState } from 'react';
import { Database } from 'lucide-react';
import { firebaseConfig as activeConfig, getCustomFirebaseConfig } from '../../firebaseConfig';

export default function AdminFirebaseConfigBlock() {
  const [config, setConfig] = useState(() => {
     const stored = getCustomFirebaseConfig();
     if (stored) {
         return stored;
     }
     return { ...activeConfig };
  });

  const handleSave = () => {
     localStorage.setItem('ratipa_custom_firebase_config', JSON.stringify(config));
     window.location.reload();
  };
  
  const handleReset = () => {
     localStorage.removeItem('ratipa_custom_firebase_config');
     window.location.reload();
  };

  return (
 <div className="bg-white rounded-[2.5rem] p-6 lg:p-8 border border-slate-200 shadow-xl mt-6 space-y-4 select-none">
      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-white/40 pb-3 mb-4">
        <Database className="h-4.5 w-4.5 text-slate-850" />
        Настройки Firebase (Только для этого браузера)
      </h2>
      <p className="text-xs text-slate-500 mb-4 font-medium leading-relaxed">Установка кастомных ключей Firebase применяется только локально. При изменении потребуется перезагрузка страницы.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
         {(['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'] as const).map(key => (
            <div key={key}>
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-2 block">{key}</label>
                <input 
                    type="text" 
                    value={config[key] || ''} 
                    onChange={e => setConfig(prev => ({...prev, [key]: e.target.value}))}
 className="w-full bg-white border border-slate-200 shadow-inner text-slate-800 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white transition-all"
                />
            </div>
         ))}
      </div>

      <div className="flex gap-2.5 pt-2">
         <button onClick={handleSave} className="flex-1 bg-slate-900 hover:bg-slate-800 active:scale-98 text-white shadow-md rounded-xl text-xs font-semibold uppercase tracking-wider px-4 py-3.5 cursor-pointer transition-all">
             Сохранить и перезагрузить
         </button>
         <button onClick={handleReset} className="flex-1 bg-rose-50 hover:bg-rose-100 active:scale-98 text-rose-600 rounded-xl text-xs font-semibold uppercase tracking-wider px-4 py-3.5 cursor-pointer transition-all border border-rose-200">
             Сбросить по умолчанию
         </button>
      </div>

    </div>
  );
}