import React, { useState } from 'react';
import { UserProfile } from '../../types';
import DozvolaRegistryList from './dozvola/DozvolaRegistryList';
import DozvolaDocuments from './dozvola/DozvolaDocuments';
import DozvolaTypesDirectory from './dozvola/DozvolaTypesDirectory';
import DozvolaHistory from './dozvola/DozvolaHistory';

interface DozvolaModuleProps {
  user: UserProfile;
}

export default function DozvolaModule({ user }: DozvolaModuleProps) {
  const [activeTab, setActiveTab] = useState<'registry' | 'documents' | 'types' | 'history'>('registry');

  return (
    <div className="w-full space-y-4">
      {/* Tab Navigation */}
      <div className="flex items-center gap-2 p-1.5 bg-slate-100 rounded-2xl w-fit overflow-x-auto shadow-inner border border-slate-200/50">
        <button
          onClick={() => setActiveTab('registry')}
          className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-tight transition whitespace-nowrap ${
            activeTab === 'registry' 
              ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80' 
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
          }`}
        >
          Реестр Дозволов
        </button>
        <button
          onClick={() => setActiveTab('documents')}
          className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-tight transition whitespace-nowrap ${
            activeTab === 'documents' 
              ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80' 
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
          }`}
        >
          Документы
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-tight transition whitespace-nowrap ${
            activeTab === 'history' 
              ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80' 
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
          }`}
        >
          Журнал операций
        </button>
        <button
          onClick={() => setActiveTab('types')}
          className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-tight transition whitespace-nowrap ${
            activeTab === 'types' 
              ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80' 
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
          }`}
        >
          Справочник Видов
        </button>
      </div>

      {/* Active Tab Content */}
      <div className="mt-4">
        <div className={activeTab === 'registry' ? '' : 'hidden'}>
          <DozvolaRegistryList user={user} />
        </div>
        <div className={activeTab === 'documents' ? '' : 'hidden'}>
          <DozvolaDocuments user={user} />
        </div>
        <div className={activeTab === 'history' ? '' : 'hidden'}>
          <DozvolaHistory user={user} />
        </div>
        <div className={activeTab === 'types' ? '' : 'hidden'}>
          <DozvolaTypesDirectory user={user} />
        </div>
      </div>
    </div>
  );
}
