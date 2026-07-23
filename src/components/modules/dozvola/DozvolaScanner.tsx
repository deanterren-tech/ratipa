import React, {useState, useRef, useEffect} from 'react'
import {UserProfile} from '../../../types'
import {ScanLine, UploadCloud, X, Loader2, Sparkles} from 'lucide-react'
import {useFirebase, database} from '../../../firebase'
import {ref, push, set} from 'firebase/database'

interface DozvolaScannerProps {
    user: UserProfile;
    customTypesKeys: string[];
    customTypesMap: Record<string, string>;
}

export default function DozvolaScanner({ user, customTypesKeys, customTypesMap }: DozvolaScannerProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [previewUrls, setPreviewUrls] = useState<string[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [results, setResults] = useState<any[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            addFiles(Array.from(e.dataTransfer.files));
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            addFiles(Array.from(e.target.files));
        }
    };

    const addFiles = (files: File[]) => {
        const imageFiles = files.filter(f => f.type.startsWith('image/'));
        if (imageFiles.length === 0) {
            alert('Пожалуйста, выберите только изображения (сканы).');
            return;
        }

        setSelectedFiles(prev => [...prev, ...imageFiles]);
        
        const newPreviewUrls = imageFiles.map(file => URL.createObjectURL(file));
        setPreviewUrls(prev => [...prev, ...newPreviewUrls]);
    };

    const removeFile = (index: number) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
        setPreviewUrls(prev => {
            const newUrls = [...prev];
            URL.revokeObjectURL(newUrls[index]);
            newUrls.splice(index, 1);
            return newUrls;
        });
    };

    useEffect(() => {
        return () => {
            // Cleanup URLs
            previewUrls.forEach(url => URL.revokeObjectURL(url));
        };
    }, []);

    const processImages = async () => {
        if (selectedFiles.length === 0) return;
        setIsProcessing(true);

        try {
            const formData = new FormData();
            selectedFiles.forEach((file) => {
                formData.append('images', file);
            });
            
            const typesStr = Object.values(customTypesMap).join(', ');
            formData.append('types', typesStr);

            const response = await fetch('/api/parse-dozvola', {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Failed to process images');
            }

            if (data.results && Array.isArray(data.results)) {
                const preparedResults = data.results.map((r: any) => ({
                    ...r,
                    status: 'office', // default status
                    mode: 'create', // default mode
                    isCopy: false,
                    comment: ''
                }));
                setResults(prev => [...prev, ...preparedResults]);
                
                // Clear selected files after successful process
                setSelectedFiles([]);
                setPreviewUrls([]);
            }
        } catch (error: any) {
            alert('Ошибка распознавания: ' + error.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const logAction = (type: string, number: string, action: string, meta: string) => {
        if (!useFirebase) return;
        const logist = localStorage.getItem('ratipa_auth_user') || "Система";
        push(ref(database, 'dozvolsHistoryV4'), {
            time: new Date().toLocaleString("ru-RU"),
            logist,
            doc: `${type} №${number}`,
            action,
            meta
        });
    };

    const saveResults = () => {
        if (results.length === 0) return;

        results.forEach(item => {
             if (useFirebase && item.number) {
                 const newKey = push(ref(database, 'dozvolsRegistryV4')).key;
                 if (newKey) {
                     set(ref(database, 'dozvolsRegistryV4/' + newKey), { 
                         id: newKey, 
                         type: item.type || 'RUS', 
                         number: item.number, 
                         issueDate: new Date().toISOString().split('T')[0], 
                         status: item.status, 
                         isCopy: item.isCopy, 
                         car: item.car || '', 
                         comment: item.comment || "Добавлено из скана" 
                     });
                     
                     let statusLabel = item.status === 'office' ? 'В офисе' : item.status === 'hand' ? 'В рейсе' : item.status;
                     logAction(item.type || 'RUS', item.number, "Добавление из скана", `Статус: ${statusLabel}`);
                 }
             }
        });

        alert("Бланки успешно внесены в базу!");
        setResults([]);
    };

    return (
        <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col gap-6">
            
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-black tracking-tight text-slate-800 flex items-center gap-2">
                        <ScanLine className="w-5 h-5 text-indigo-500" />
                        Распознавание сканов (ИИ)
                    </h2>
                    <p className="text-sm text-slate-500 mt-1 font-medium">Загрузите фотографии или сканы дозволов, ИИ автоматически извлечет данные.</p>
                </div>
            </div>

            {/* Dropzone */}
            <div 
                className={`relative border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center transition-colors cursor-pointer min-h-[200px] ${
                    isDragging ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-300 hover:border-indigo-400 bg-slate-50/50'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
            >
                <input 
                    type="file" 
                    multiple 
                    accept="image/*" 
                    className="hidden" 
                    ref={fileInputRef} 
                    onChange={handleFileSelect}
                />
                <div className="w-16 h-16 bg-white rounded-full shadow-sm border border-slate-200/50 flex items-center justify-center mb-4">
                    <UploadCloud className={`w-8 h-8 ${isDragging ? 'text-indigo-500' : 'text-slate-400'}`} />
                </div>
                <h3 className="text-sm font-bold text-slate-700">Нажмите или перетащите сканы сюда</h3>
                <p className="text-xs text-slate-500 mt-2 font-medium">Поддерживаются JPG, PNG (до 10 загрузок за раз)</p>

                {isProcessing && (
                    <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center z-10">
                        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-3" />
                        <span className="text-sm font-black tracking-tight text-slate-800 animate-pulse">Идет распознавание...</span>
                    </div>
                )}
            </div>

            {/* Selected files preview */}
            {previewUrls.length > 0 && !isProcessing && (
                <div className="flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                        <span className="text-xs font-black uppercase text-slate-500">Выбрано файлов: {previewUrls.length}</span>
                        <button 
                            onClick={processImages}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-xs font-black tracking-wide shadow-sm flex items-center gap-2 transition"
                        >
                            <Sparkles className="w-4 h-4" /> Анализировать ИИ
                        </button>
                    </div>
                    <div className="flex gap-4 overflow-x-auto pb-4">
                        {previewUrls.map((url, i) => (
                            <div key={i} className="relative w-24 h-32 flex-shrink-0 group rounded-lg overflow-hidden border border-slate-200 shadow-sm bg-slate-100">
                                <img src={url} alt="preview" className="w-full h-full object-cover" />
                                <button 
                                    onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                                    className="absolute top-1 right-1 bg-black/60 text-white p-1 rounded hover:bg-rose-500 transition opacity-0 group-hover:opacity-100"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Parsing Results Table */}
            {results.length > 0 && (
                <div className="mt-4 pt-4 border-t-2 border-dashed border-slate-200/80 animate-in fade-in slide-in-from-bottom-4">
                    <div className="text-[13px] font-black text-emerald-700 mb-3 flex justify-between items-center">
                        <span>📋 ПОДТВЕРЖДЕНИЕ СКАНИРОВАНИЯ:</span>
                        <button 
                            onClick={() => setResults([])}
                            className="bg-rose-50 text-rose-500 hover:bg-rose-100 px-3 py-1.5 rounded-lg text-[10px] uppercase cursor-pointer"
                        >
                            Очистить
                        </button>
                    </div>
                    
                    <div className="overflow-x-auto bg-white rounded-xl border border-slate-200/50 p-1.5 shadow-sm">
                        <table className="w-full text-left border-collapse min-w-[700px]">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="p-2 text-[10px] uppercase font-black text-slate-400">Вид дозвола</th>
                                    <th className="p-2 text-[10px] uppercase font-black text-slate-400">Номер бланка</th>
                                    <th className="p-2 text-[10px] uppercase font-black text-slate-400">Привязка к авто</th>
                                    <th className="p-2 text-[10px] uppercase font-black text-slate-400">Статус</th>
                                    <th className="p-2 w-8"></th>
                                </tr>
                            </thead>
                            <tbody className="text-xs font-semibold">
                                {results.map((item, index) => {
                                    const allTypes = [...new Set([...Object.values(customTypesMap), item.type])].filter(Boolean);
                                    
                                    return (
                                        <tr key={index} className="border-t border-slate-100 hover:bg-slate-50/50">
                                            <td className="p-2">
                                                <select 
                                                    className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] focus:outline-none"
                                                    value={item.type || 'RUS'}
                                                    onChange={(e) => {
                                                        const newArr = [...results];
                                                        newArr[index].type = e.target.value;
                                                        setResults(newArr);
                                                    }}
                                                >
                                                    {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
                                                </select>
                                            </td>
                                            <td className="p-2">
                                                <input 
                                                    className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] focus:outline-none"
                                                    value={item.number || ''}
                                                    onChange={e => {
                                                        const newArr = [...results];
                                                        newArr[index].number = e.target.value.trim();
                                                        setResults(newArr);
                                                    }}
                                                />
                                            </td>
                                            <td className="p-2">
                                                <input 
                                                    className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] focus:outline-none placeholder-slate-300"
                                                    placeholder="Не распознано"
                                                    value={item.car || ''}
                                                    onChange={e => {
                                                        const newArr = [...results];
                                                        newArr[index].car = e.target.value.trim().toUpperCase();
                                                        setResults(newArr);
                                                    }}
                                                />
                                            </td>
                                            <td className="p-2">
                                                <select 
                                                    className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] focus:outline-none"
                                                    value={item.status || 'office'}
                                                    onChange={(e) => {
                                                        const newArr = [...results];
                                                        newArr[index].status = e.target.value;
                                                        setResults(newArr);
                                                    }}
                                                >
                                                    <option value="office">В офисе</option>
                                                    <option value="hand">В рейсе</option>
                                                    <option value="office_return">Сдан в офис</option>
                                                    <option value="used">Сдан в транспортную инспекцию</option>
                                                    <option value="expired">Аннулирован</option>
                                                </select>
                                            </td>
                                            <td className="p-2">
                                                <button 
                                                    onClick={() => {
                                                        const newArr = [...results];
                                                        newArr.splice(index, 1);
                                                        setResults(newArr);
                                                    }}
                                                    className="p-1 rounded hover:bg-rose-50 text-rose-500 cursor-pointer"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    
                    <div className="flex justify-end mt-4">
                        <button 
                            onClick={saveResults}
                            className="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl text-xs font-black tracking-wide shadow-sm transition"
                        >
                            Добавить в реестр дозволов ✓
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

