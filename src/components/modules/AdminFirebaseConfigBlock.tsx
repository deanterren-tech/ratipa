import  { useState } from 'react';
import { Database } from 'lucide-react';
import { firebaseConfig as activeConfig, getCustomFirebaseConfig } from '../../firebaseConfig';
import { UI } from '../../ui/kit';
import { SectionHeader } from '../../ui/components';

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
    <div className="flex flex-col gap-4">
      <SectionHeader
        icon={<Database className="w-4 h-4" />}
        tone="graphite"
        title="Настройки Firebase (только для этого браузера)"
        subtitle="Кастомные ключи Firebase применяются локально. После изменения страница перезагрузится."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
         {(['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'] as const).map(key => (
            <div key={key} className="space-y-1.5">
                <label className="text-[11px] font-medium text-[#6B7280] block font-mono">{key}</label>
                <input 
                    type="text" 
                    value={config[key] || ''} 
                    onChange={e => setConfig(prev => ({...prev, [key]: e.target.value}))}
                    className={`${UI.input} font-mono`}
                />
            </div>
         ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
         <button onClick={handleSave} className={`${UI.buttonPrimary} flex-1`}>
             Сохранить и перезагрузить
         </button>
         <button onClick={handleReset} className={`${UI.buttonDanger} flex-1`}>
             Сбросить по умолчанию
         </button>
      </div>

    </div>
  );
}
