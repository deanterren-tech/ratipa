import {useState, useEffect, useMemo, useRef} from 'react'
import {useDialog} from '../../DialogProvider'
import {useToast} from '../../ToastProvider'
import {dbService} from '../../../api'
import {Navigation, Trash2, Plus, Search, Pencil, ArrowUpDown, ArrowUp, ArrowDown, Globe, AlertTriangle, Download, Upload, Check, X, MapPin} from 'lucide-react'
import {UserProfile, DistancePreset} from '../../../types'

interface Props { user: UserProfile }

// City → country mapping (Latin + Cyrillic)
const CITY_COUNTRY: Record<string, string> = {
  minsk:'BY', brest:'BY', grodno:'BY', vitebsk:'BY', gomel:'BY', mogilev:'BY', bobruysk:'BY', baranovichi:'BY', pinsk:'BY', orsha:'BY', novopolotsk:'BY', mozyr:'BY',
  минск:'BY', брест:'BY', гродно:'BY', витебск:'BY', гомель:'BY', могилев:'BY', бобруйск:'BY', барановичи:'BY', пинск:'BY', орша:'BY', новополоцк:'BY', мозырь:'BY',
  moscow:'RUS', 'saint petersburg':'RUS', spb:'RUS', smolensk:'RUS', kaliningrad:'RUS', bryansk:'RUS', pskov:'RUS', tver:'RUS',
  'nizhny novgorod':'RUS', kazan:'RUS', samara:'RUS', rostov:'RUS', krasnodar:'RUS', novosibirsk:'RUS', ekaterinburg:'RUS',
  voronezh:'RUS', volgograd:'RUS', saratov:'RUS', chelyabinsk:'RUS', omsk:'RUS', ufa:'RUS', perm:'RUS',
  vladivostok:'RUS', irkutsk:'RUS', krasnoyarsk:'RUS', tomsk:'RUS', tyumen:'RUS', lipetsk:'RUS', tula:'RUS', yaroslavl:'RUS',
  sochi:'RUS', novorossiysk:'RUS', murmansk:'RUS', vladikavkaz:'RUS', makhachkala:'RUS',
  москва:'RUS', 'санкт-петербург':'RUS', смоленск:'RUS', калининград:'RUS', брянск:'RUS', псков:'RUS', тверь:'RUS',
  'нижний новгород':'RUS', казань:'RUS', самара:'RUS', ростов:'RUS', краснодар:'RUS', новосибирск:'RUS', екатеринбург:'RUS',
  воронеж:'RUS', волгоград:'RUS', саратов:'RUS', челябинск:'RUS', омск:'RUS', уфа:'RUS', пермь:'RUS',
  владивосток:'RUS', иркутск:'RUS', красноярск:'RUS', томск:'RUS', тюмень:'RUS', липецк:'RUS', тула:'RUS', ярославль:'RUS',
  сочи:'RUS', новороссийск:'RUS', мурманск:'RUS', владикавказ:'RUS', махачкала:'RUS',
  almaty:'KZ', 'nur-sultan':'KZ', aktau:'KZ', atyrau:'KZ', shymkent:'KZ', karaganda:'KZ', pavlodar:'KZ', semey:'KZ', kostanay:'KZ', taraz:'KZ', kyzlorda:'KZ',
  алматы:'KZ', 'нур-султан':'KZ', актау:'KZ', атырау:'KZ', шымкент:'KZ', караганда:'KZ', павлодар:'KZ', семей:'KZ', костанай:'KZ', тараз:'KZ', кызылорда:'KZ',
  tashkent:'UZ', samarkand:'UZ', bukhara:'UZ', fergana:'UZ', namangan:'UZ', andijan:'UZ', nukus:'UZ', termez:'UZ',
  ташкент:'UZ', самарканд:'UZ', бухара:'UZ', фергана:'UZ', наманган:'UZ', андижан:'UZ', нукус:'UZ', термез:'UZ',
  dushanbe:'TJ', khujand:'TJ', kulob:'TJ', bokhtar:'TJ', khorog:'TJ', istaravshan:'TJ', panjakent:'TJ',
  душанбе:'TJ', худжанд:'TJ', куляб:'TJ', бохтар:'TJ', хорог:'TJ', истаравшан:'TJ', панджакент:'TJ',
  bishkek:'KG', osh:'KG', jalabad:'KG', karakol:'KG', naryn:'KG', talas:'KG', batken:'KG',
  бишкек:'KG', ош:'KG', 'джалал-абад':'KG', каракол:'KG', нарын:'KG', талас:'KG', баткен:'KG',
  ulaanbaatar:'MN', darkhan:'MN', erdenet:'MN', choibalsan:'MN', murun:'MN', khovd:'MN', ulaangom:'MN',
  'улан-батор':'MN', дархан:'MN', эрдэнэт:'MN', чойбалсан:'MN', мурэн:'MN', ховд:'MN', улангом:'MN',
  beijing:'CN', shanghai:'CN', urumqi:'CN', guangzhou:'CN', shenzhen:'CN', chengdu:'CN', wuhan:'CN', xian:'CN', chongqing:'CN', shenyang:'CN', harbin:'CN',
  nanjing:'CN', hangzhou:'CN', fuzhou:'CN', xiamen:'CN', qingdao:'CN', dalian:'CN', tianjin:'CN',
  пекин:'CN', шанхай:'CN', урумчи:'CN', гуанчжоу:'CN', шэньчжэнь:'CN', чэнду:'CN', ухань:'CN', сиань:'CN', чунцин:'CN', шэньян:'CN', харбин:'CN',
  нанкин:'CN', ханчжоу:'CN', фучжоу:'CN', сямэнь:'CN', циндао:'CN', далянь:'CN', тяньцзинь:'CN',
  istanbul:'TR', ankara:'TR', izmir:'TR', antalya:'TR', bursa:'TR', mersin:'TR', trabzon:'TR', hopa:'TR', sarp:'TR',
  adana:'TR', gaziantep:'TR', konya:'TR',
  стамбул:'TR', анкара:'TR', измир:'TR', анталья:'TR', бурса:'TR', мерсин:'TR', трабзон:'TR', хопа:'TR', сарп:'TR',
  адана:'TR', газиантеп:'TR', конья:'TR',
  tehran:'IR', tabriz:'IR', rasht:'IR', astara:'IR', bazargan:'IR',
  тегеран:'IR', тебриз:'IR', рашт:'IR', астара:'IR', базарган:'IR',
  tbilisi:'GE', batumi:'GE', kutaisi:'GE', rustavi:'GE', poti:'GE',
  тбилиси:'GE', батуми:'GE', кутаиси:'GE', рустави:'GE', поти:'GE',
  yerevan:'AM', gyumri:'AM', vanadzor:'AM',
  ереван:'AM', гюмри:'AM', ванадзор:'AM',
  baku:'AZ', ganja:'AZ', sumgayit:'AZ', lankaran:'AZ',
  баку:'AZ', гянджа:'AZ', сумгаит:'AZ', ленкорань:'AZ',

  // Hyphen/space-free fallbacks
  санктпетербург:'RUS', нижнийновгород:'RUS', ростовнадону:'RUS', горноалтайск:'RUS',
  каменскуральский:'RUS', новыйуренгой:'RUS', джалалабад:'KG', уланбатор:'MN',
  нурултан:'KZ', 'нурсултан':'KZ',
}

const COUNTRY_NAMES: Record<string, string> = {
  BY: 'Беларусь', RUS: 'Россия', KZ: 'Казахстан',
  UZ: 'Узбекистан', TJ: 'Таджикистан', KG: 'Кыргызстан',
  MN: 'Монголия', CN: 'Китай', TR: 'Турция',
  IR: 'Иран', GE: 'Грузия', AM: 'Армения', AZ: 'Азербайджан',
}

const COUNTRY_FLAGS: Record<string, string> = {
  BY: '🇧🇾', RUS: '🇷🇺', KZ: '🇰🇿',
  UZ: '🇺🇿', TJ: '🇹🇯', KG: '🇰🇬',
  MN: '🇲🇳', CN: '🇨🇳', TR: '🇹🇷',
  IR: '🇮🇷', GE: '🇬🇪', AM: '🇦🇲',
  AZ: '🇦🇿',
}

const getCountry = (city: string): string => {
  var key = city.trim().toLowerCase().replace(/[^a-zа-яё-]/g, '');
  var result = CITY_COUNTRY[key];
  if (result) return result;
  // Fallback: remove hyphens and try again
  key = key.replace(/-/g, '');
  return CITY_COUNTRY[key] || '—';
};

const normalizePair = (a: string, b: string): [string, string] => {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
};

export default function DistanceDirectoryBlock({ user }: Props) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [items, setItems] = useState<DistancePreset[]>([]);
  const [allCheckpoints, setAllCheckpoints] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<DistancePreset | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sortKey, setSortKey] = useState<string>('from');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [inlineEdit, setInlineEdit] = useState<{ id: string; field: string } | null>(null);
  const [inlineVal, setInlineVal] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [showCpDropdown, setShowCpDropdown] = useState(false);
  const cpInputRef = useRef<HTMLInputElement>(null);
  const [cpDropdownRect, setCpDropdownRect] = useState<{top: number; left: number; width: number} | null>(null);
  const inlineRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsub1 = dbService.getDistances((list) => setItems(list || []));
    const unsub2 = dbService.getCheckpoints((list) => setAllCheckpoints(list || []));
    return () => { unsub1(); unsub2(); };
  }, []);

  const allCities = useMemo(() => {
    const cities = new Set<string>();
    items.forEach(d => { if (d.from) cities.add(d.from); if (d.to) cities.add(d.to); });
    return Array.from(cities).sort();
  }, [items]);

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach(d => {
      const c1 = d.countryFrom || getCountry(d.from);
      const c2 = d.countryTo || getCountry(d.to);
      if (c1 !== '—') set.add(c1);
      if (c2 !== '—') set.add(c2);
    });
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((d) => `${d.from} ${d.to} ${d.distance || ''} ${(d.checkpoints || []).join(' ')}`.toLowerCase().includes(q));
    }
    if (countryFilter !== 'all') {
      list = list.filter((d) => (d.countryFrom || getCountry(d.from)) === countryFilter || (d.countryTo || getCountry(d.to)) === countryFilter);
    }
    return list;
  }, [items, search, countryFilter]);

  const grouped = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let valA: string, valB: string;
      if (sortKey === 'distance') { valA = String(a.distance || 0).padStart(10, '0'); valB = String(b.distance || 0).padStart(10, '0'); }
      else if (sortKey === 'to') { valA = a.to || ''; valB = b.to || ''; }
      else { valA = a.from || ''; valB = b.from || ''; }
      const cmp = valA.localeCompare(valB, 'ru');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    const groups: { country: string; items: DistancePreset[] }[] = [];
    const countryMap = new Map<string, DistancePreset[]>();
    list.forEach(d => {
      const c = d.countryFrom || getCountry(d.from);
      const key = c === '—' ? 'Другие' : (COUNTRY_NAMES[c] || c);
      if (!countryMap.has(key)) countryMap.set(key, []);
      countryMap.get(key)!.push(d);
    });
    countryMap.forEach((vals, key) => groups.push({ country: key, items: vals }));
    groups.sort((a, b) => {
      if (a.country === 'Другие') return 1;
      if (b.country === 'Другие') return -1;
      return a.country.localeCompare(b.country, 'ru');
    });
    return groups;
  }, [filtered, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const SortIcon = ({ colKey }: { colKey: string }) => {
    if (sortKey !== colKey) return <ArrowUpDown className="w-3.5 h-3.5 text-slate-300 ml-1 inline" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3.5 h-3.5 text-slate-600 ml-1 inline" />
      : <ArrowDown className="w-3.5 h-3.5 text-slate-600 ml-1 inline" />;
  };

  const openAdd = () => {
    setDraft({ from: '', to: '', distance: '', checkpoints: '', countryFrom: '', countryTo: '', cpInput: '' });
    setEditing({ id: '', from: '', to: '', distance: 0 });
  };

  const openEdit = (d: DistancePreset) => {
    setDraft({
      from: d.from, to: d.to, distance: String(d.distance),
      id: d.id, dbKey: (d as any).dbKey || '',
      checkpoints: (d.checkpoints || []).join(', '),
      countryFrom: d.countryFrom || '', countryTo: d.countryTo || '',
      cpInput: '',
    });
    setEditing(d);
  };

  const handleSave = () => {
    if (isSubmitting) return;
    const rec: any = { ...draft };
    if (!rec.id) rec.id = (rec.dbKey as string) || 'dist_' + Date.now().toString();
    if (rec.from && rec.to) {
      const [a, b] = normalizePair(rec.from, rec.to);
      rec.from = a; rec.to = b;
    }
    if (!rec.countryFrom || rec.countryFrom === '—') rec.countryFrom = getCountry(rec.from) !== '—' ? getCountry(rec.from) : '';
    if (!rec.countryTo || rec.countryTo === '—') rec.countryTo = getCountry(rec.to) !== '—' ? getCountry(rec.to) : '';
    rec.distance = parseFloat(rec.distance || '0') || 0;
    if (rec.distance <= 0) { toast('Укажите расстояние больше 0', 'error'); return; }
    if (rec.checkpoints) {
      rec.checkpoints = rec.checkpoints.split(',').map((s: string) => s.trim()).filter(Boolean);
    } else { rec.checkpoints = []; }
    if (!editing?.id) {
      const exists = items.some(x => x.from?.toLowerCase() === rec.from?.toLowerCase() && x.to?.toLowerCase() === rec.to?.toLowerCase());
      if (exists) { toast('Маршрут уже существует!', 'error'); return; }
    }
    setIsSubmitting(true);
    dbService.saveDistance(rec as DistancePreset, user.name, user.role);
    // Optimistic update — сразу обновляем таблицу
    setItems(prev => {
      const idx = prev.findIndex(x => x.id === rec.id);
      if (idx >= 0) {
        const u = [...prev];
        // Обновляем только нужные поля, не затирая лишним
        u[idx] = {
          ...u[idx],
          from: rec.from,
          to: rec.to,
          distance: rec.distance,
          countryFrom: rec.countryFrom || '',
          countryTo: rec.countryTo || '',
          checkpoints: rec.checkpoints || [],
        };
        return u;
      }
      return [...prev, { ...rec, checkpoints: rec.checkpoints || [] }];
    });
    setEditing(null);
    setIsSubmitting(false);
    toast('Маршрут сохранён', 'success');
  };

  const handleDelete = async (d: DistancePreset) => {
    if (await showConfirm('Удалить маршрут "' + d.from + ' ↔ ' + d.to + '"?')) {
      setItems(prev => prev.filter(x => x.id !== d.id));
      dbService.deleteDistance((d as any).dbKey || d.id, user.name, user.role);
      toast('Удалено', 'success');
    }
  };

  const startInlineEdit = (d: DistancePreset, field: string) => {
    setInlineEdit({ id: d.id, field });
    setInlineVal(field === 'distance' ? String(d.distance || 0) : d[field as keyof DistancePreset] as string || '');
    setTimeout(() => inlineRef.current?.focus(), 50);
  };

  const saveInlineEdit = () => {
    if (!inlineEdit) return;
    const item = items.find(d => d.id === inlineEdit.id);
    if (!item) return setInlineEdit(null);
    const updated = { ...item };
    if (inlineEdit.field === 'distance') updated.distance = parseFloat(inlineVal) || 0;
    else if (inlineEdit.field === 'from' || inlineEdit.field === 'to') {
      (updated as any)[inlineEdit.field] = inlineVal;
      if (updated.from && updated.to) { const [a, b] = normalizePair(updated.from, updated.to); updated.from = a; updated.to = b; }
    }
    dbService.saveDistance(updated as DistancePreset, user.name, user.role);
    setInlineEdit(null);
  };

  const handleBulkAdd = () => {
    const lines = bulkText.split('\n').filter(Boolean);
    let added = 0;
    lines.forEach(line => {
      let parts: string[];
      const m = line.match(/^([^-]+)\s*[-–—]\s*([^\d]+?)\s*(\d+)\s*$/);
      if (m) parts = [m[1].trim(), m[2].trim(), m[3].trim()];
      else return;
      if (parts.length < 3) return;
      const [a, b] = normalizePair(parts[0], parts[1]);
      const dist = parseFloat(parts[2]) || 0;
      if (!a || !b || dist <= 0) return;
      if (items.some(x => x.from?.toLowerCase() === a.toLowerCase() && x.to?.toLowerCase() === b.toLowerCase())) return;
      const id = 'dist_' + Date.now().toString() + '_' + Math.random().toString(36).slice(2, 6);
      dbService.saveDistance({ id, from: a, to: b, distance: dist } as DistancePreset, user.name, user.role);
      added++;
    });
    toast('Добавлено маршрутов: ' + added, 'success');
    setBulkText('');
    setShowBulk(false);
  };

  const handleExport = () => {
    const header = 'from,to,distance,checkpoints,countryFrom,countryTo';
    const rows = items.map(d => {
      const chk = (d.checkpoints || []).join(';');
      return '"' + d.from + '","' + d.to + '",' + d.distance + ',"' + chk + '","' + (d.countryFrom || '') + '","' + (d.countryTo || '') + '"';
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ratipa_distances.csv'; a.click();
    URL.revokeObjectURL(url);
    toast('Выгружено маршрутов: ' + items.length, 'success');
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.csv';
    input.onchange = async (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      const text = await file.text();
      const lines = text.split('\n').filter(Boolean);
      let added = 0;
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',').map(s => s.replace(/^"|"$/g, '').trim());
        if (parts.length < 3) continue;
        const [a, b] = normalizePair(parts[0], parts[1]);
        const dist = parseFloat(parts[2]) || 0;
        if (!a || !b || dist <= 0) continue;
        if (items.some(x => x.from?.toLowerCase() === a.toLowerCase() && x.to?.toLowerCase() === b.toLowerCase())) continue;
        const checkpoints = parts[3] ? parts[3].split(';').filter(Boolean) : [];
        const countryFrom = parts[4] || ''; const countryTo = parts[5] || '';
        const id = 'dist_' + Date.now().toString() + '_' + Math.random().toString(36).slice(2, 6);
        dbService.saveDistance({ id, from: a, to: b, distance: dist, checkpoints, countryFrom, countryTo }, user.name, user.role);
        added++;
      }
      toast('Импортировано маршрутов: ' + added, 'success');
    };
    input.click();
  };

  const kmColor = (km: number) => {
    if (km <= 200) return 'text-emerald-600';
    if (km <= 500) return 'text-sky-600';
    if (km <= 1000) return 'text-amber-600';
    if (km <= 2000) return 'text-orange-600';
    return 'text-rose-600';
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/50 overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center">
            <Navigation className="w-4 h-4 text-slate-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Стандартные расстояния</h3>
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">{items.length} маршрутов</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="inline-flex items-center gap-1.5 bg-white text-slate-600 text-xs font-semibold px-3 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition shrink-0 cursor-pointer" title="Экспорт CSV">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={handleImport} className="inline-flex items-center gap-1.5 bg-white text-slate-600 text-xs font-semibold px-3 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition shrink-0 cursor-pointer" title="Импорт CSV">
            <Upload className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={() => setShowBulk(!showBulk)} className="inline-flex items-center gap-1.5 bg-white text-slate-600 text-xs font-semibold px-3 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition shrink-0 cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> Массовый
          </button>
          <button onClick={openAdd}
            className="inline-flex items-center gap-1.5 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-xl hover:bg-slate-800 shadow-sm transition shrink-0 cursor-pointer">
            <Plus className="w-4 h-4" /> Добавить
          </button>
        </div>
      </div>

      {/* Bulk entry panel */}
      {showBulk && (
        <div className="border-b border-slate-100 bg-slate-50/50 px-5 py-4 space-y-2">
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Массовый ввод маршрутов</div>
          <p className="text-[10px] text-slate-400">Формат: Город1 - Город2 1200</p>
          <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)}
            placeholder={'Минск - Берлин 1100\nВаршава - Берлин 580'}
            className="w-full p-3 text-xs rounded-xl border border-slate-200 outline-none focus:border-slate-400 bg-white font-mono min-h-[100px]" />
          <div className="flex gap-2">
            <button onClick={handleBulkAdd} className="inline-flex items-center gap-1.5 bg-slate-900 text-white text-xs font-semibold px-4 py-2 rounded-xl hover:bg-slate-800 transition cursor-pointer">
              <Check className="w-3.5 h-3.5" /> Добавить
            </button>
            <button onClick={() => setShowBulk(false)} className="inline-flex items-center gap-1.5 bg-white text-slate-500 text-xs font-semibold px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 transition cursor-pointer">
              <X className="w-3.5 h-3.5" /> Отмена
            </button>
          </div>
        </div>
      )}

      {/* Stats dashboard */}
      <div className="grid grid-cols-3 gap-px bg-slate-100 border-b border-slate-200/60">
        <div className="bg-white px-5 py-3">
          <div className="text-xl font-bold font-sans text-slate-900">{items.length}</div>
          <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5">Маршрутов</div>
        </div>
        <div className="bg-white px-5 py-3">
          <div className="text-xl font-bold font-sans text-slate-900">{allCities.length}</div>
          <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5">Городов</div>
        </div>
        <div className="bg-white px-5 py-3">
          <div className="text-xl font-bold font-sans text-slate-900">{countryOptions.length}</div>
          <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5">Стран</div>
        </div>
      </div>

      {/* Country filter + search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-3 border-b border-slate-100">
        <div className="flex items-center gap-1.5 overflow-x-auto flex-nowrap flex-1 min-w-0">
          <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <button onClick={() => setCountryFilter('all')}
            className={'px-2.5 py-1.5 text-[10px] font-semibold rounded-lg whitespace-nowrap transition cursor-pointer ' + (countryFilter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
            Все страны
          </button>
          {countryOptions.map(c => (
            <button key={c} onClick={() => setCountryFilter(c)}
              className={'px-2.5 py-1.5 text-[10px] font-semibold rounded-lg whitespace-nowrap transition cursor-pointer ' + (countryFilter === c ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
              {c}
            </button>
          ))}
          {countryFilter !== 'all' && (
            <button onClick={() => setCountryFilter('all')} className="text-[10px] text-slate-400 hover:text-slate-600 px-1.5 py-1 font-medium cursor-pointer">✕</button>
          )}
        </div>
        <div className="relative sm:w-56 shrink-0">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по городу, КПП..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 outline-none focus:border-slate-300 focus:bg-white transition" />
        </div>
      </div>

      {/* Empty state */}
      {grouped.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <Navigation className="w-10 h-10 mb-3 text-slate-300" />
          <div className="text-sm font-medium">Нет маршрутов</div>
          <div className="text-xs mt-1">{search ? 'Попробуйте другой поиск' : 'Нажмите «Добавить»'}</div>
        </div>
      )}

      {/* Groups + Table */}
      {grouped.map(group => (
        <div key={group.country}>
          {/* Group header */}
          <div className="px-5 py-2.5 border-b border-t border-slate-200/40 text-xs font-bold uppercase tracking-wider flex items-center gap-2 sticky top-0 bg-slate-50/90 z-10 text-slate-600">
            <Globe className="w-3.5 h-3.5" />
            <span>{group.country}</span>
            <span className="text-[10px] font-normal opacity-60">{group.items.length} маршрутов</span>
          </div>

          {/* Table header */}
          <div className="grid grid-cols-[1fr_1fr_100px_1fr_80px] gap-0 text-[10px] font-semibold uppercase tracking-wider bg-slate-50 border-b border-slate-200/60 select-none">
            <div className="px-5 py-3 cursor-pointer hover:bg-slate-100/50 flex items-center gap-1 text-slate-500" onClick={() => handleSort('from')}>
              От <SortIcon colKey="from" />
            </div>
            <div className="px-5 py-3 cursor-pointer hover:bg-slate-100/50 flex items-center gap-1 text-slate-500" onClick={() => handleSort('to')}>
              До <SortIcon colKey="to" />
            </div>
            <div className="px-5 py-3 cursor-pointer hover:bg-slate-100/50 flex items-center gap-1 text-slate-500 justify-end" onClick={() => handleSort('distance')}>
              Км <SortIcon colKey="distance" />
            </div>
            <div className="px-5 py-3 text-slate-400 text-[10px]">КПП</div>
            <div className="px-5 py-3"></div>
          </div>

          {/* Items */}
          <div className="divide-y divide-slate-100">
            {group.items.map((d) => {
              const isEditing = inlineEdit?.id === d.id;
              return (
                <div key={d.id} className={'grid grid-cols-[1fr_1fr_100px_1fr_80px] gap-0 items-center px-5 py-2.5 hover:bg-slate-50 group transition text-sm ' + (kmColor(d.distance || 0).replace('text-', 'bg-').replace('-600', '-50/50'))}>
                  {/* From */}
                  <div className="font-semibold text-slate-800 truncate min-h-[28px] flex items-center">
                    {isEditing && inlineEdit?.field === 'from' ? (
                      <input ref={inlineRef} value={inlineVal} onChange={(e) => setInlineVal(e.target.value)}
                        onBlur={saveInlineEdit} onKeyDown={(e) => { if (e.key === 'Enter') saveInlineEdit(); if (e.key === 'Escape') setInlineEdit(null); }}
                        className="w-full px-1.5 py-0.5 text-sm rounded border border-slate-400 outline-none bg-white" />
                    ) : (
                      <span onClick={() => startInlineEdit(d, 'from')} className="cursor-pointer hover:bg-slate-200/50 px-1 -mx-1 rounded transition truncate flex items-center gap-1">
                        {(d.countryFrom || getCountry(d.from)) !== '—' && <span className="text-[10px]">{COUNTRY_FLAGS[d.countryFrom || getCountry(d.from)] || ''}</span>}
                        {d.from}
                      </span>
                    )}
                  </div>
                  {/* To */}
                  <div className="text-slate-700 truncate min-h-[28px] flex items-center">
                    {isEditing && inlineEdit?.field === 'to' ? (
                      <input ref={inlineRef} value={inlineVal} onChange={(e) => setInlineVal(e.target.value)}
                        onBlur={saveInlineEdit} onKeyDown={(e) => { if (e.key === 'Enter') saveInlineEdit(); if (e.key === 'Escape') setInlineEdit(null); }}
                        className="w-full px-1.5 py-0.5 text-sm rounded border border-slate-400 outline-none bg-white" />
                    ) : (
                      <span className="truncate block w-full">
                        <span className="text-slate-300 mr-1">↔</span>
                        <span onClick={() => startInlineEdit(d, 'to')} className="cursor-pointer hover:bg-slate-200/50 px-1 -mx-1 rounded transition inline-flex items-center gap-1">
                          {(d.countryTo || getCountry(d.to)) !== '—' && <span className="text-[10px]">{COUNTRY_FLAGS[d.countryTo || getCountry(d.to)] || ''}</span>}
                          {d.to}
                        </span>
                      </span>
                    )}
                  </div>
                  {/* Distance */}
                  <div className="min-h-[28px] flex items-center justify-end">
                    {isEditing && inlineEdit?.field === 'distance' ? (
                      <input ref={inlineRef} value={inlineVal} onChange={(e) => setInlineVal(e.target.value)}
                        onBlur={saveInlineEdit} onKeyDown={(e) => { if (e.key === 'Enter') saveInlineEdit(); if (e.key === 'Escape') setInlineEdit(null); }}
                        type="number" className="w-20 px-1.5 py-0.5 text-sm rounded border border-slate-400 outline-none bg-white text-right" />
                    ) : (
                      <span onClick={() => startInlineEdit(d, 'distance')} className={'font-mono font-bold ' + kmColor(d.distance || 0) + ' cursor-pointer hover:bg-slate-200/50 px-1.5 -mx-1.5 rounded transition'}>
                        {d.distance || 0} <span className="text-[10px] text-slate-400 font-medium">км</span>
                      </span>
                    )}
                  </div>
                  {/* Checkpoints */}
                  <div className="text-[10px] text-slate-500 truncate min-h-[28px] flex items-center">
                    {d.checkpoints && d.checkpoints.length > 0 ? (
                      <span className="flex gap-1 flex-wrap">
                        {d.checkpoints.map((cp, i) => {
                          const cpInfo = allCheckpoints.find((c: any) => c.name?.toLowerCase() === cp.toLowerCase());
                          return (
                            <span key={i} className="px-1.5 py-0.5 bg-slate-100 rounded text-[9px] font-medium text-slate-600 cursor-default" title={cpInfo ? (cpInfo.countryFrom || '') + '→' + (cpInfo.countryTo || '') : ''}>
                              {cp}
                              {cpInfo && cpInfo.countryFrom && cpInfo.countryTo && (
                                <span className="ml-0.5 text-[8px] text-slate-400">{cpInfo.countryFrom}→{cpInfo.countryTo}</span>
                              )}
                            </span>
                          );
                        })}
                      </span>
                    ) : (
                      <span className="text-slate-300 italic">—</span>
                    )}
                  </div>
                  {/* Actions */}
                  <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button onClick={() => openEdit(d)} className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer" title="Изменить"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => handleDelete(d)} className="text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-50 cursor-pointer" title="Удалить"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Modal */}
      {editing && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-6 space-y-4 my-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-slate-900">{editing?.id ? 'Изменить маршрут' : 'Добавить маршрут'}</h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Город A</label>
                <input type="text" value={draft.from || ''} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                  placeholder="Откуда" className="w-full mt-1 px-3 py-2.5 text-sm rounded-xl border border-slate-200 outline-none focus:border-slate-400 bg-white transition" />
                <div className="mt-1 flex items-center gap-1.5">
                  <select value={draft.countryFrom || (getCountry(draft.from || '') !== '—' ? getCountry(draft.from || '') : '')}
                    onChange={(e) => setDraft((d) => ({ ...d, countryFrom: e.target.value }))}
                    className={'flex-1 px-2 py-1.5 text-[10px] font-semibold rounded-lg border border-slate-200 outline-none focus:border-slate-400 bg-white transition cursor-pointer ' + (draft.countryFrom || getCountry(draft.from || '') !== '—' ? 'text-slate-700' : 'text-slate-400')}>
                    <option value="">Страна</option>
                    {['BY','RUS','KZ','UZ','TJ','KG','MN','CN','TR','IR','GE','AM','AZ'].map(c => (
                      <option key={c} value={c}>{COUNTRY_FLAGS[c] || ''} {c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Город B</label>
                <input type="text" value={draft.to || ''} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                  placeholder="Куда" className="w-full mt-1 px-3 py-2.5 text-sm rounded-xl border border-slate-200 outline-none focus:border-slate-400 bg-white transition" />
                <div className="mt-1 flex items-center gap-1.5">
                  <select value={draft.countryTo || (getCountry(draft.to || '') !== '—' ? getCountry(draft.to || '') : '')}
                    onChange={(e) => setDraft((d) => ({ ...d, countryTo: e.target.value }))}
                    className={'flex-1 px-2 py-1.5 text-[10px] font-semibold rounded-lg border border-slate-200 outline-none focus:border-slate-400 bg-white transition cursor-pointer ' + (draft.countryTo || getCountry(draft.to || '') !== '—' ? 'text-slate-700' : 'text-slate-400')}>
                    <option value="">Страна</option>
                    {['BY','RUS','KZ','UZ','TJ','KG','MN','CN','TR','IR','GE','AM','AZ'].map(c => (
                      <option key={c} value={c}>{COUNTRY_FLAGS[c] || ''} {c}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Расстояние (км)</label>
              <input type="number" min="1" value={draft.distance || ''} onChange={(e) => setDraft((d) => ({ ...d, distance: e.target.value }))}
                placeholder="0" className="w-full mt-1 px-3 py-2.5 text-sm rounded-xl border border-slate-200 outline-none focus:border-slate-400 bg-white transition" />
            </div>

            {/* Checkpoints */}
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Погранпереходы
              </label>
              <div className="flex flex-wrap gap-1 mt-1 mb-1.5">
                {(draft.checkpoints || '').split(',').filter(Boolean).map((cp, i) => (
                  <span key={i} className="px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-700 rounded-lg flex items-center gap-1">
                    {cp.trim()}
                    <button type="button" onClick={() => {
                      const list = (draft.checkpoints || '').split(',').filter(Boolean);
                      list.splice(i, 1);
                      setDraft((d) => ({ ...d, checkpoints: list.join(', ') }));
                    }} className="text-slate-400 hover:text-rose-500 cursor-pointer">×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1">
                <input type="text" value={draft.cpInput || ''} ref={cpInputRef}
                  onChange={(e) => setDraft((d) => ({ ...d, cpInput: e.target.value }))}
                  onFocus={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setCpDropdownRect({ top: rect.bottom + 4, left: rect.left, width: rect.width });
                    setShowCpDropdown(true);
                  }}
                  onBlur={() => setTimeout(() => setShowCpDropdown(false), 200)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const val = (draft.cpInput || '').trim();
                      if (val) {
                        const existing = (draft.checkpoints || '').split(',').filter(Boolean).map(s => s.trim());
                        if (!existing.includes(val)) {
                          setDraft((d) => ({ ...d, checkpoints: [...existing, val].join(', '), cpInput: '' }));
                        }
                      }
                    }
                  }}
                  placeholder="Начните ввод или выберите из списка..."
                  className="flex-1 px-3 py-2 text-sm rounded-xl border border-slate-200 outline-none focus:border-slate-400 bg-white transition" />
                <button type="button" onClick={() => {
                  const val = (draft.cpInput || '').trim();
                  if (val) {
                    const existing = (draft.checkpoints || '').split(',').filter(Boolean).map(s => s.trim());
                    if (!existing.includes(val)) {
                      setDraft((d) => ({ ...d, checkpoints: [...existing, val].join(', '), cpInput: '' }));
                    }
                  }
                }} className="px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition cursor-pointer">+</button>
                {showCpDropdown && cpDropdownRect && (
                  <div style={{ position: 'fixed', top: cpDropdownRect.top, left: cpDropdownRect.left, width: cpDropdownRect.width, zIndex: 110 }}
                    className="bg-white border border-slate-200 rounded-xl shadow-xl max-h-[200px] overflow-y-auto" onMouseDown={(e) => e.preventDefault()}>
                    {(draft.cpInput || '').trim().length > 0 ? (
                      allCheckpoints.filter((c: any) => {
                        const existing = (draft.checkpoints || '').split(',').filter(Boolean).map(s => s.trim().toLowerCase());
                        return !existing.includes(c.name.toLowerCase()) && c.name.toLowerCase().includes((draft.cpInput || '').toLowerCase().trim());
                      }).slice(0, 15).map((c: any) => (
                        <button key={c.id} type="button" onClick={() => {
                          const existing = (draft.checkpoints || '').split(',').filter(Boolean).map(s => s.trim());
                          if (!existing.includes(c.name)) {
                            setDraft((d) => ({ ...d, checkpoints: [...existing, c.name].join(', '), cpInput: '' }));
                          }
                        }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition flex items-center gap-2 border-b border-slate-100 last:border-0 cursor-pointer"
                        >
                          <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{c.name}</span>
                          {c.countryFrom && c.countryTo && (
                            <span className="ml-auto text-[9px] text-slate-400 shrink-0">{c.countryFrom}→{c.countryTo}</span>
                          )}
                        </button>
                      ))
                    ) : (
                      allCheckpoints.filter((c: any) => {
                        const existing = (draft.checkpoints || '').split(',').filter(Boolean).map(s => s.trim().toLowerCase());
                        return !existing.includes(c.name.toLowerCase());
                      }).slice(0, 20).map((c: any) => (
                        <button key={c.id} type="button" onClick={() => {
                          const existing = (draft.checkpoints || '').split(',').filter(Boolean).map(s => s.trim());
                          if (!existing.includes(c.name)) {
                            setDraft((d) => ({ ...d, checkpoints: [...existing, c.name].join(', '), cpInput: '' }));
                          }
                        }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition flex items-center gap-2 border-b border-slate-100 last:border-0 cursor-pointer"
                        >
                          <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{c.name}</span>
                          {c.countryFrom && c.countryTo && (
                            <span className="ml-auto text-[9px] text-slate-400 shrink-0">{c.countryFrom}→{c.countryTo}</span>
                          )}
                        </button>
                      ))
                    )}
                    {allCheckpoints.length === 0 && (
                      <div className="px-3 py-2 text-xs text-slate-400">Нет КПП в справочнике</div>
                    )}
                  </div>
                )}
              </div>
              <p className="text-[9px] text-slate-400 mt-1">КПП указываются по порядку следования маршрута. При обратном направлении — порядок КПП будет обратным. КПП двусторонние.</p>
            </div>

            {draft.from && draft.to && (
              <div className="text-[10px] text-slate-500 bg-slate-50 rounded-xl px-3 py-2 border border-slate-200">
                <span className="font-semibold">Страны: </span>
                {draft.countryFrom || getCountry(draft.from)} ↔ {draft.countryTo || getCountry(draft.to)}
              </div>
            )}

            <div className="bg-blue-50/50 border border-blue-200/50 rounded-xl px-3 py-2.5 text-[10px] text-blue-700 flex items-center gap-2">
              <Navigation className="w-3.5 h-3.5 shrink-0 text-blue-500" />
              <span>Маршрут двусторонний: <strong>{draft.from || 'A'} ↔ {draft.to || 'B'}</strong></span>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-xs font-medium text-slate-500 rounded-xl hover:bg-slate-100 transition cursor-pointer">Отмена</button>
              <button onClick={handleSave} disabled={isSubmitting} className={`inline-flex items-center gap-1.5 ${isSubmitting ? 'bg-slate-400 cursor-not-allowed' : 'bg-slate-900 hover:bg-slate-800'} text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-sm transition cursor-pointer`}>
                <Plus className="w-3.5 h-3.5" /> {isSubmitting ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}