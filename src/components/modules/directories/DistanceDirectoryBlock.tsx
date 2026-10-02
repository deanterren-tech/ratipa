import {useState, useEffect, useMemo, useRef} from 'react'
import {useDialog} from '../../DialogProvider'
import {useToast} from '../../ToastProvider'
import {dbService} from '../../../api'
import {Navigation, Trash2, Plus, Pencil, ArrowUpDown, ArrowUp, ArrowDown, Globe, Download, Upload, Check, X, MapPin, MoveHorizontal} from 'lucide-react'
import {UserProfile, DistancePreset} from '../../../types'
import {UI} from '../../../ui/kit'
import {SectionHeader, SearchField, FilterPills, EmptyState, ModalShell} from '../../../ui/components'

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

const COUNTRY_CODES = ['BY','RUS','KZ','UZ','TJ','KG','MN','CN','TR','IR','GE','AM','AZ'];

/** Компактный селект страны в форме маршрута. */
const COUNTRY_SELECT_CLS =
  'w-full bg-white border border-[#E5E7EB] rounded-lg px-2 py-1.5 text-[11px] text-[#4B5563] outline-none transition-colors cursor-pointer focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)]';

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
    if (sortKey !== colKey) return <ArrowUpDown className="w-3.5 h-3.5 text-[#D1D5DB] ml-1 inline" aria-hidden="true" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3.5 h-3.5 text-[#4B5563] ml-1 inline" aria-hidden="true" />
      : <ArrowDown className="w-3.5 h-3.5 text-[#4B5563] ml-1 inline" aria-hidden="true" />;
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

  const countryBadge = (code: string) => (code && code !== '—' ? code : '');

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {/* Header */}
      <SectionHeader
        icon={<Navigation className="w-4 h-4" />}
        tone="graphite"
        title="Стандартные расстояния"
        subtitle={`${items.length} маршрутов в справочнике`}
      >
        <button type="button" onClick={handleExport} title="Экспорт CSV" className={UI.buttonGhost}>
          <Download className="w-3.5 h-3.5" aria-hidden="true" /> CSV
        </button>
        <button type="button" onClick={handleImport} title="Импорт CSV" className={UI.buttonGhost}>
          <Upload className="w-3.5 h-3.5" aria-hidden="true" /> CSV
        </button>
        <button type="button" onClick={() => setShowBulk(!showBulk)} className={UI.buttonGhost}>
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Массовый
        </button>
        <button type="button" onClick={openAdd} className={UI.buttonPrimary}>
          <Plus className="w-4 h-4" aria-hidden="true" /> Добавить
        </button>
      </SectionHeader>

      {/* Bulk entry panel */}
      {showBulk && (
        <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-4 flex flex-col gap-2.5">
          <div className={UI.caption}>Массовый ввод маршрутов</div>
          <p className={UI.hint}>Формат: Город1 - Город2 1200</p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={'Минск - Берлин 1100\nВаршава - Берлин 580'}
            className={`${UI.textarea} font-mono min-h-[100px]`}
          />
          <div className="flex gap-2">
            <button type="button" onClick={handleBulkAdd} className={UI.buttonPrimary}>
              <Check className="w-3.5 h-3.5" aria-hidden="true" /> Добавить
            </button>
            <button type="button" onClick={() => setShowBulk(false)} className={UI.buttonGhost}>
              <X className="w-3.5 h-3.5" aria-hidden="true" /> Отмена
            </button>
          </div>
        </div>
      )}

      {/* Compact stats */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 pb-4 border-b border-[#E5E7EB]">
        <Stat label="Маршрутов" value={items.length} />
        <Stat label="Городов" value={allCities.length} />
        <Stat label="Стран" value={countryOptions.length} />
      </div>

      {/* Country filter + search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto flex-nowrap flex-1 min-w-0 scrollbar-none">
          <Globe className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" aria-hidden="true" />
          <FilterPills
            items={[
              { key: 'all', label: 'Все страны' },
              ...countryOptions.map(c => ({ key: c, label: c })),
            ]}
            active={countryFilter}
            onChange={setCountryFilter}
            ariaLabel="Фильтр по странам"
          />
          {countryFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setCountryFilter('all')}
              aria-label="Сбросить фильтр страны"
              title="Сбросить фильтр страны"
              className="inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Поиск по городу, КПП…"
          ariaLabel="Поиск по маршрутам"
          className="sm:max-w-[16rem]"
        />
      </div>

      {/* Empty state */}
      {grouped.length === 0 && (
        <EmptyState
          kind={search.trim() || countryFilter !== 'all' ? 'no-results' : 'empty'}
          query={search}
          title={search.trim() || countryFilter !== 'all' ? undefined : 'Нет маршрутов'}
          hint={search.trim() || countryFilter !== 'all' ? undefined : 'Нажмите «Добавить» или «Массовый», чтобы заполнить справочник.'}
          actionLabel={search.trim() || countryFilter !== 'all' ? undefined : 'Добавить маршрут'}
          onAction={search.trim() || countryFilter !== 'all' ? undefined : openAdd}
        />
      )}

      {/* Groups + Table */}
      {grouped.map(group => (
        <div key={group.country}>
          {/* Group header */}
          <div className="flex items-center gap-2 py-2 border-b border-[#E5E7EB] text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none">
            <Globe className="w-3.5 h-3.5 text-[#9CA3AF]" aria-hidden="true" />
            <span>{group.country}</span>
            <span className="font-mono text-[10px] text-[#9CA3AF]">{group.items.length} маршрутов</span>
          </div>

          {/* Table header */}
          <div className="grid grid-cols-[1fr_1fr_100px_1fr_80px] gap-0 border-b border-[#E5E7EB] text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none">
            <div className="px-3 py-2.5 min-h-[44px] cursor-pointer hover:text-[#121316] select-none whitespace-nowrap flex items-center gap-1" onClick={() => handleSort('from')}>
              От <SortIcon colKey="from" />
            </div>
            <div className="px-3 py-2.5 min-h-[44px] cursor-pointer hover:text-[#121316] select-none whitespace-nowrap flex items-center gap-1" onClick={() => handleSort('to')}>
              До <SortIcon colKey="to" />
            </div>
            <div className="px-3 py-2.5 min-h-[44px] cursor-pointer hover:text-[#121316] select-none whitespace-nowrap flex items-center gap-1 justify-end" onClick={() => handleSort('distance')}>
              Км <SortIcon colKey="distance" />
            </div>
            <div className="px-3 py-2.5 min-h-[44px] whitespace-nowrap flex items-center">КПП</div>
            <div className="px-3 py-2.5 min-h-[44px]"></div>
          </div>

          {/* Items */}
          <div className="divide-y divide-[#E5E7EB]">
            {group.items.map((d) => {
              const isEditing = inlineEdit?.id === d.id;
              const codeFrom = countryBadge(d.countryFrom || getCountry(d.from));
              const codeTo = countryBadge(d.countryTo || getCountry(d.to));
              return (
                <div
                  key={d.id}
                  className="grid grid-cols-[1fr_1fr_100px_1fr_80px] gap-0 items-center px-3 py-2.5 hover:bg-[#F9FAFB] transition-colors text-xs"
                >
                  {/* From */}
                  <div className="font-semibold text-[#121316] truncate min-h-[28px] flex items-center gap-1">
                    {isEditing && inlineEdit?.field === 'from' ? (
                      <input ref={inlineRef} value={inlineVal} onChange={(e) => setInlineVal(e.target.value)}
                        onBlur={saveInlineEdit} onKeyDown={(e) => { if (e.key === 'Enter') saveInlineEdit(); if (e.key === 'Escape') setInlineEdit(null); }}
                        className="w-full bg-white border border-[#E5E7EB] rounded-lg px-1.5 py-1 text-xs text-[#121316] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)]" />
                    ) : (
                      <span onClick={() => startInlineEdit(d, 'from')} className="cursor-pointer hover:bg-[#F3F4F6] px-1 -mx-1 rounded-lg transition-colors truncate flex items-center gap-1.5">
                        {codeFrom && <span className="text-[10px] font-mono text-[#9CA3AF]">{codeFrom}</span>}
                        {d.from}
                      </span>
                    )}
                  </div>
                  {/* To */}
                  <div className="text-[#4B5563] truncate min-h-[28px] flex items-center gap-1.5">
                    {isEditing && inlineEdit?.field === 'to' ? (
                      <input ref={inlineRef} value={inlineVal} onChange={(e) => setInlineVal(e.target.value)}
                        onBlur={saveInlineEdit} onKeyDown={(e) => { if (e.key === 'Enter') saveInlineEdit(); if (e.key === 'Escape') setInlineEdit(null); }}
                        className="w-full bg-white border border-[#E5E7EB] rounded-lg px-1.5 py-1 text-xs text-[#121316] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)]" />
                    ) : (
                      <span className="truncate flex items-center gap-1.5">
                        <MoveHorizontal className="w-3 h-3 text-[#9CA3AF] shrink-0" aria-hidden="true" />
                        <span onClick={() => startInlineEdit(d, 'to')} className="cursor-pointer hover:bg-[#F3F4F6] px-1 -mx-1 rounded-lg transition-colors inline-flex items-center gap-1.5">
                          {codeTo && <span className="text-[10px] font-mono text-[#9CA3AF]">{codeTo}</span>}
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
                        type="number" className="w-20 bg-white border border-[#E5E7EB] rounded-lg px-1.5 py-1 text-xs text-[#121316] text-right outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)]" />
                    ) : (
                      <span onClick={() => startInlineEdit(d, 'distance')} className={'font-mono font-semibold ' + kmColor(d.distance || 0) + ' cursor-pointer hover:bg-[#F3F4F6] px-1.5 -mx-1.5 rounded-lg transition-colors'}>
                        {d.distance || 0} <span className="text-[10px] text-[#9CA3AF] font-medium">км</span>
                      </span>
                    )}
                  </div>
                  {/* Checkpoints */}
                  <div className="text-[10px] text-[#6B7280] truncate min-h-[28px] flex items-center">
                    {d.checkpoints && d.checkpoints.length > 0 ? (
                      <span className="flex gap-1 flex-wrap">
                        {d.checkpoints.map((cp, i) => {
                          const cpInfo = allCheckpoints.find((c: any) => c.name?.toLowerCase() === cp.toLowerCase());
                          return (
                            <span key={i} className={UI.chip} title={cpInfo ? (cpInfo.countryFrom || '') + '→' + (cpInfo.countryTo || '') : ''}>
                              {cp}
                              {cpInfo && cpInfo.countryFrom && cpInfo.countryTo && (
                                <span className="ml-1 text-[10px] text-[#9CA3AF]">{cpInfo.countryFrom}→{cpInfo.countryTo}</span>
                              )}
                            </span>
                          );
                        })}
                      </span>
                    ) : (
                      <span className="text-[#D1D5DB]">—</span>
                    )}
                  </div>
                  {/* Actions */}
                  <div className="flex items-center justify-center gap-1">
                    <button type="button" onClick={() => openEdit(d)} aria-label="Изменить" title="Изменить" className={UI.buttonIcon}>
                      <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(d)}
                      aria-label="Удалить"
                      title="Удалить"
                      className="inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Modal */}
      <ModalShell
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Изменить маршрут' : 'Добавить маршрут'}
        icon={<Navigation className="w-4 h-4" aria-hidden="true" />}
        ariaLabel={editing?.id ? 'Изменить маршрут' : 'Добавить маршрут'}
        maxWidth="max-w-md"
        footer={
          <>
            <button type="button" onClick={() => setEditing(null)} className={UI.buttonGhost}>Отмена</button>
            <button type="button" onClick={handleSave} disabled={isSubmitting} className={UI.buttonPrimary}>
              {isSubmitting ? 'Сохранение…' : 'Сохранить'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <label className={UI.fieldLabel}>Город A</label>
              <input type="text" value={draft.from || ''} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                placeholder="Откуда" className={UI.input} />
              <select value={draft.countryFrom || (getCountry(draft.from || '') !== '—' ? getCountry(draft.from || '') : '')}
                onChange={(e) => setDraft((d) => ({ ...d, countryFrom: e.target.value }))}
                className={COUNTRY_SELECT_CLS}>
                <option value="">Страна</option>
                {COUNTRY_CODES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className={UI.fieldLabel}>Город B</label>
              <input type="text" value={draft.to || ''} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                placeholder="Куда" className={UI.input} />
              <select value={draft.countryTo || (getCountry(draft.to || '') !== '—' ? getCountry(draft.to || '') : '')}
                onChange={(e) => setDraft((d) => ({ ...d, countryTo: e.target.value }))}
                className={COUNTRY_SELECT_CLS}>
                <option value="">Страна</option>
                {COUNTRY_CODES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className={UI.fieldLabel}>Расстояние (км)</label>
            <input type="number" min="1" value={draft.distance || ''} onChange={(e) => setDraft((d) => ({ ...d, distance: e.target.value }))}
              placeholder="0" className={UI.input} />
          </div>

          {/* Checkpoints */}
          <div className="flex flex-col gap-2">
            <label className={`${UI.fieldLabel} flex items-center gap-1`}>
              <MapPin className="w-3 h-3" aria-hidden="true" /> Погранпереходы
            </label>
            <div className="flex flex-wrap gap-1">
              {(draft.checkpoints || '').split(',').filter(Boolean).map((cp, i) => (
                <span key={i} className={`${UI.chip} inline-flex items-center gap-1`}>
                  {cp.trim()}
                  <button type="button" onClick={() => {
                    const list = (draft.checkpoints || '').split(',').filter(Boolean);
                    list.splice(i, 1);
                    setDraft((d) => ({ ...d, checkpoints: list.join(', ') }));
                  }} aria-label="Убрать погранпереход" className="text-[#9CA3AF] hover:text-rose-600 cursor-pointer">
                    <X className="w-3 h-3" aria-hidden="true" />
                  </button>
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
                placeholder="Начните ввод или выберите из списка…"
                className={`${UI.input} flex-1`} />
              <button type="button" onClick={() => {
                const val = (draft.cpInput || '').trim();
                if (val) {
                  const existing = (draft.checkpoints || '').split(',').filter(Boolean).map(s => s.trim());
                  if (!existing.includes(val)) {
                    setDraft((d) => ({ ...d, checkpoints: [...existing, val].join(', '), cpInput: '' }));
                  }
                }
              }} aria-label="Добавить погранпереход" className={UI.buttonGhost}>
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              {showCpDropdown && cpDropdownRect && (
                <div style={{ position: 'fixed', top: cpDropdownRect.top, left: cpDropdownRect.left, width: cpDropdownRect.width, zIndex: 110 }}
                  className="bg-white border border-[#E5E7EB] rounded-xl shadow-[0_16px_40px_rgba(15,23,42,0.16)] max-h-[200px] overflow-y-auto custom-scrollbar" onMouseDown={(e) => e.preventDefault()}>
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
                        className="w-full text-left px-3 py-2 text-xs font-medium text-[#4B5563] hover:bg-[#F9FAFB] transition-colors flex items-center gap-2 border-b border-[#E5E7EB] last:border-0 cursor-pointer"
                      >
                        <MapPin className="w-3 h-3 text-[#9CA3AF] shrink-0" aria-hidden="true" />
                        <span>{c.name}</span>
                        {c.countryFrom && c.countryTo && (
                          <span className="ml-auto text-[10px] text-[#9CA3AF] shrink-0">{c.countryFrom}→{c.countryTo}</span>
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
                        className="w-full text-left px-3 py-2 text-xs font-medium text-[#4B5563] hover:bg-[#F9FAFB] transition-colors flex items-center gap-2 border-b border-[#E5E7EB] last:border-0 cursor-pointer"
                      >
                        <MapPin className="w-3 h-3 text-[#9CA3AF] shrink-0" aria-hidden="true" />
                        <span>{c.name}</span>
                        {c.countryFrom && c.countryTo && (
                          <span className="ml-auto text-[10px] text-[#9CA3AF] shrink-0">{c.countryFrom}→{c.countryTo}</span>
                        )}
                      </button>
                    ))
                  )}
                  {allCheckpoints.length === 0 && (
                    <div className="px-3 py-2 text-xs text-[#6B7280]">Нет КПП в справочнике</div>
                  )}
                </div>
              )}
            </div>
            <p className={UI.hint}>КПП указываются по порядку следования маршрута. При обратном направлении — порядок КПП будет обратным. КПП двусторонние.</p>
          </div>

          {draft.from && draft.to && (
            <div className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 text-xs text-[#4B5563]">
              <span className="font-semibold text-[#121316]">Страны: </span>
              <span>{draft.countryFrom || getCountry(draft.from)}</span>
              <MoveHorizontal className="w-3 h-3 text-[#9CA3AF]" aria-hidden="true" />
              <span>{draft.countryTo || getCountry(draft.to)}</span>
            </div>
          )}

          <div className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 text-[11px] text-[#4B5563]">
            <Navigation className="w-3.5 h-3.5 shrink-0 text-[#9CA3AF]" aria-hidden="true" />
            <span>Маршрут двусторонний: <strong className="text-[#121316]">{draft.from || 'A'} ↔ {draft.to || 'B'}</strong></span>
          </div>
        </div>
      </ModalShell>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={UI.hint}>{label}</span>
      <span className="text-xs font-semibold font-mono tabular-nums text-[#121316]">{value}</span>
    </div>
  );
}
