import React, { useState } from 'react';
import { Database } from 'lucide-react';
import { firebaseConfig as activeConfig } from '../../firebase';

export default function AdminFirebaseConfigBlock() {
  const [config, setConfig] = useState(() => {
     const stored = localStorage.getItem('ratipa_custom_firebase_config');
     if (stored) {
         try { return JSON.parse(stored); } catch(e) {}
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
    <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] mt-6 space-y-4">
      <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
        <Database className="h-4.5 w-4.5 text-slate-900 font-bold" />
        Настройки Firebase (Только для этого браузера)
      </h2>
      <p className="text-xs text-slate-500 mb-4">Установка кастомных ключей Firebase применяется только локально. При изменении потребуется перезагрузка страницы.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
         {(['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'] as const).map(key => (
            <div key={key}>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-2 block">{key}</label>
                <input 
                    type="text" 
                    value={config[key] || ''} 
                    onChange={e => setConfig(prev => ({...prev, [key]: e.target.value}))}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:border-blue-500 transition" 
                />
            </div>
         ))}
      </div>

      <div className="flex gap-2">
         <button onClick={handleSave} className="flex-1 bg-slate-950 hover:bg-slate-800 text-[#70FC8E] rounded-xl text-xs font-black uppercase px-4 py-3 cursor-pointer transition">
             Сохранить и перезагрузить
         </button>
         <button onClick={handleReset} className="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl text-xs font-black uppercase px-4 py-3 cursor-pointer transition">
             Сбросить по умолчанию
         </button>
      </div>

    </div>
  );
}
