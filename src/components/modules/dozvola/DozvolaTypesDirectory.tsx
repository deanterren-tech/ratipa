import {useDialog} from '../../DialogProvider'
import {useToast} from '../../ToastProvider'
import React, {useState, useEffect, useMemo} from 'react'
import {UserProfile} from '../../../types'
import {Plus, Trash2, X, Edit, ChevronUp, ChevronDown, Loader2, AlertTriangle, ArrowLeftRight, Info} from 'lucide-react'
import { useFirebase, database, onValue } from '../../../firebase'
import { ref, set, remove, push } from 'firebase/database'
import { useModalKeyboard } from '../../../hooks/useModalKeyboard'

interface DozvolaTypesDirectoryProps {
  user: UserProfile;
}

/**
 * Справочник видов дозволов.
 *
 * Данные и операции не менялись: те же пути базы (dozvolsTypesV4,
 * dozvolsTypesOrderV4, dozvolsPermitPrintMappingsV1) и те же действия.
 * Изменены оформление и два дефекта:
 *  - перемещение позиции работало по полному списку, а индекс приходил из
 *    отфильтрованного — при расхождении двигался не тот вид;
 *  - отсутствовали состояния загрузки и ошибки, а пустой ввод игнорировался молча.
 */
export default function DozvolaTypesDirectory({ user }: DozvolaTypesDirectoryProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [types, setTypes] = useState<any>({});
  const [typesOrder, setTypesOrder] = useState<string[]>([]);
  const [printMappings, setPrintMappings] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isEditingType, setIsEditingType] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [typeName, setTypeName] = useState("");
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!useFirebase) { setLoading(false); return; }
    const subs: (() => void)[] = [];
    const listen = (
      path: string,
      setter: (val: any) => void,
      onErr?: (e: any) => void,
    ) => {
      const dbRef = ref(database, path);
      const unsub = onValue(
        dbRef,
        (snap) => setter(snap.val() || (Array.isArray(snap.val()) ? [] : {})),
        onErr,
      );
      subs.push(() => unsub());
    };

    const fail = (err: any) => {
      setLoadError(err?.message || 'Не удалось загрузить справочник.');
      setLoading(false);
    };

    listen("dozvolsTypesV4", setTypes, fail);
    listen("dozvolsTypesOrderV4", (val) => setTypesOrder(Array.isArray(val) ? val : Object.keys(val || {})), fail);
    listen("dozvolsPermitPrintMappingsV1", setPrintMappings, fail);
    setLoading(false);

    return () => subs.forEach(s => s());
  }, []);

  /**
   * Отображаемый порядок: только записи, у которых есть данные.
   * Перемещение работает по этому же списку — иначе индекс не совпадает
   * с позицией в полном typesOrder и двигается не тот вид.
   */
  const visibleIds = useMemo(
    () => typesOrder.filter((id) => types[id]),
    [typesOrder, types],
  );

  const openEditor = (id: string) => {
      setFormError(null);
      setEditingId(id);
      if (id) {
          const tName = types[id]?.name || '';
          setTypeName(tName);
          const map = printMappings[tName] || {};
          setCountry(map.country || '');
          setCategory(map.category || '');
          setYear(parseInt(map.year) || new Date().getFullYear());
      } else {
          setTypeName("");
          setCountry("");
          setCategory("");
          setYear(new Date().getFullYear());
      }
      setIsEditingType(true);
  };

  const handleSaveType = async (e: React.FormEvent) => {
      e.preventDefault();
      if (isSaving) return;

      const tName = typeName.trim();
      if (!tName) {
          setFormError('Укажите название вида — без него запись не сохранится.');
          return;
      }
      // Название используется как ключ в маппинге печати и в реестре
      const duplicate = Object.values(types).some(
        (t: any) => t?.id !== editingId && String(t?.name || '').trim().toLowerCase() === tName.toLowerCase(),
      );
      if (duplicate) {
          setFormError(`Вид «${tName}» уже есть в справочнике — названия должны различаться.`);
          return;
      }

      setIsSaving(true);
      try {
        const oldName = editingId ? types[editingId]?.name : '';
        let newId = editingId;
        if (!newId) {
            newId = push(ref(database, 'dozvolsTypesV4')).key || Date.now().toString();
            if (useFirebase) {
                await set(ref(database, `dozvolsTypesV4/${newId}`), { id: newId, name: tName });
                await set(ref(database, 'dozvolsTypesOrderV4'), [...typesOrder, newId]);
            }
        } else {
            if (useFirebase && oldName && oldName !== tName) {
                // Меняем имя в справочнике типов
                await set(ref(database, `dozvolsTypesV4/${newId}/name`), tName);
                // Удаляем СТАРЫЙ маппинг, чтобы не плодить записи
                await remove(ref(database, `dozvolsPermitPrintMappingsV1/${oldName}`));
            }
        }

        if (useFirebase) {
            await set(ref(database, `dozvolsPermitPrintMappingsV1/${tName}`), {
                country: country.trim(),
                category: category.trim(),
                year
            });
        }

        toast(editingId ? `Вид «${tName}» обновлён` : `Вид «${tName}» создан`, 'success');
        setIsEditingType(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setFormError('Не удалось сохранить: ' + msg);
        toast('Изменения справочника не сохранены', 'error');
      } finally {
        setIsSaving(false);
      }
  };

  const handleDeleteType = async (id: string, name: string) => {
      const ok = await showConfirm(
        `Вид «${name}» пропадёт из вкладок и настроек квот. В реестре записи останутся как текст.`,
        'Удалить вид дозвола',
        { variant: 'danger', confirmLabel: 'Удалить вид' },
      );
      if (!ok) return;
      if (useFirebase) {
          remove(ref(database, `dozvolsTypesV4/${id}`));
          remove(ref(database, `dozvolsPermitPrintMappingsV1/${name}`));
          set(ref(database, 'dozvolsTypesOrderV4'), typesOrder.filter(fid => fid !== id));
      }
  };

  const moveItem = (index: number, direction: number) => {
      if (index + direction < 0 || index + direction >= visibleIds.length) return;
      const a = visibleIds[index];
      const b = visibleIds[index + direction];
      // Меняем местами позиции этих двух id в полном порядке, остальные не трогаем
      const newOrder = [...typesOrder];
      const ia = newOrder.indexOf(a);
      const ib = newOrder.indexOf(b);
      if (ia < 0 || ib < 0) return;
      newOrder[ia] = b;
      newOrder[ib] = a;
      if (useFirebase) set(ref(database, 'dozvolsTypesOrderV4'), newOrder);
  };

  useModalKeyboard({
    isOpen: isEditingType,
    onClose: () => setIsEditingType(false),
    onConfirm: () => { const form = document.getElementById('dozvola-type-form') as HTMLFormElement | null; form?.requestSubmit(); },
    canConfirm: true,
  });

  const canWrite = user.permissions?.dozvola === "write" || user.role === 'root_admin';

  const inputCls = 'block w-full mt-1.5 h-9 px-3 bg-white border border-[#E5E7EB] rounded-lg text-xs text-[#121316] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition-colors';
  const labelCls = 'text-[11px] font-medium text-[#6B7280] block';
  const ghostBtn = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium text-[#4B5563] bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]';
  const accentBtn = 'inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-xs font-medium text-[var(--accent-on)] bg-[var(--accent-solid)] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="w-full flex flex-col">

      {/* Заголовок страницы: название, описание, основное действие */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-[#E5E7EB]">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[#121316] tracking-tight">
            Справочник видов дозволов
          </h2>
          <p className="text-xs text-[#6B7280] mt-1 leading-relaxed">
            Список видов для вкладок реестра и автозаполнения документов. Порядок в списке совпадает
            с порядком вкладок в реестре.
          </p>
        </div>

        {canWrite && (
          <button type="button" onClick={() => openEditor('')} className={`${accentBtn} shrink-0`}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Создать вид
          </button>
        )}
      </div>

      {/* Подсказка о прокрутке — только на узких экранах */}
      <div className="lg:hidden flex items-center justify-center gap-1.5 py-2.5 text-[11px] text-[#6B7280] border-b border-[#F3F4F6]">
        <ArrowLeftRight className="h-3.5 w-3.5 text-[#9CA3AF]" aria-hidden="true" />
        Таблица прокручивается вправо
      </div>

      {/* Ошибка загрузки не подменяется пустым списком */}
      {loadError ? (
        <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 mt-4" role="alert">
          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-xs font-medium text-rose-700">Не удалось загрузить справочник</p>
            <p className="text-[11px] text-rose-600 mt-0.5">{loadError}</p>
          </div>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-[#9CA3AF] text-xs">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Загрузка справочника…
        </div>
      ) : (
        /* Таблица прямо на фоне рабочей области — без карточки */
        <div className="overflow-x-auto custom-scrollbar mt-3">
          <table className="w-full text-left border-separate border-spacing-0 min-w-[680px]">
            {/* Шапка как в таблице квот: таблица на border-separate, поэтому
                граница держится на каждой ячейке, а не на строке. Подписи
                не переносятся, чтобы шапка не «прыгала» по высоте. */}
            <thead>
              <tr className="text-left text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none">
                <th scope="col" className="px-3 py-2.5 font-semibold border-b border-[#E5E7EB] whitespace-nowrap w-[112px]">
                  <span title="Порядок видов совпадает с порядком вкладок в реестре">
                    Позиция
                  </span>
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold border-b border-[#E5E7EB] whitespace-nowrap min-w-[180px]">
                  Название вида
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold border-b border-[#E5E7EB] whitespace-nowrap">
                  Страна
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold border-b border-[#E5E7EB] whitespace-nowrap">
                  Категория ЕВРО
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold border-b border-[#E5E7EB] whitespace-nowrap w-[108px]">
                  Год бланка
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold border-b border-[#E5E7EB] whitespace-nowrap w-[1%] text-right">
                  Управление
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleIds.map((id, index) => {
                const t = types[id];
                const printMap = printMappings[t.name] || {};
                const isFirst = index === 0;
                const isLast = index === visibleIds.length - 1;

                return (
                  <tr key={id} className="hover:bg-[#F9FAFB] transition-colors group">
                    {/* Позиция: подъём/опускание с подсказками и доступными именами */}
                    <td className="px-3 py-2 align-middle border-b border-[#F3F4F6]">
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={isFirst || !canWrite}
                          onClick={() => moveItem(index, -1)}
                          title={isFirst ? 'Уже первая позиция' : 'Поднять выше'}
                          aria-label={`Поднять «${t.name}» выше`}
                          className="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-lg text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#121316] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
                        >
                          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <span className="w-6 text-center text-[11px] font-mono tabular-nums text-[#9CA3AF]" aria-hidden="true">
                          {index + 1}
                        </span>
                        <button
                          type="button"
                          disabled={isLast || !canWrite}
                          onClick={() => moveItem(index, 1)}
                          title={isLast ? 'Уже последняя позиция' : 'Опустить ниже'}
                          aria-label={`Опустить «${t.name}» ниже`}
                          className="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-lg text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#121316] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
                        >
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </td>

                    {/* Название: длинные значения обрезаются, полное — в подсказке */}
                    <td className="px-3 py-2 align-middle border-b border-[#F3F4F6]">
                      <button
                        type="button"
                        onClick={() => canWrite && openEditor(t.id)}
                        title={t.name}
                        className={`max-w-[220px] truncate text-xs font-medium text-[#121316] text-left ${canWrite ? 'hover:text-[var(--accent-ink)] cursor-pointer' : 'cursor-default'} transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] rounded`}
                      >
                        {t.name}
                      </button>
                    </td>

                    <td className="px-3 py-2 align-middle border-b border-[#F3F4F6]">
                      {printMap.country ? (
                        <span className="text-xs text-[#4B5563] truncate inline-block max-w-[200px] align-middle" title={printMap.country}>
                          {printMap.country}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-[#9CA3AF]" title="Страна не задана — подставляется автоматически из названия вида">
                          <Info className="h-3 w-3" aria-hidden="true" />
                          авто
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-2 align-middle border-b border-[#F3F4F6]">
                      {printMap.category ? (
                        <span className="inline-block bg-[#F3F4F6] border border-[#E5E7EB] text-[#4B5563] px-2 py-0.5 rounded-md font-mono text-[10px] truncate max-w-[180px] align-middle"
                              title={printMap.category}>
                          {printMap.category}
                        </span>
                      ) : (
                        <span className="text-[11px] text-[#9CA3AF]">—</span>
                      )}
                    </td>

                    <td className="px-3 py-2 align-middle border-b border-[#F3F4F6]">
                      <span className="text-xs font-mono tabular-nums text-[#6B7280]">{printMap.year || new Date().getFullYear()}</span>
                    </td>

                    <td className="px-3 py-2 align-middle border-b border-[#F3F4F6] w-[1%]">
                      <div className="flex items-center justify-end gap-0.5">
                        {canWrite && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditor(t.id)}
                              title="Редактировать вид"
                              aria-label={`Редактировать «${t.name}»`}
                              className="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-lg text-[var(--accent-ink)] hover:bg-[var(--accent-15)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
                            >
                              <Edit className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteType(t.id, t.name)}
                              title="Удалить вид"
                              aria-label={`Удалить «${t.name}»`}
                              className="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {visibleIds.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center">
                    <p className="text-xs text-[#6B7280]">Справочник пуст</p>
                    {canWrite && (
                      <p className="text-[11px] text-[#9CA3AF] mt-1">
                        Добавьте первый вид — он появится вкладкой в реестре.
                      </p>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Форма создания и редактирования */}
      {isEditingType && (
        <div data-scroll-lock="modal" className="fixed inset-0 z-[5000] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4 sm:p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? 'Редактирование вида' : 'Новый вид дозвола'}
            className="relative z-10 w-full max-w-md bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.12)] flex flex-col max-h-[90vh] overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB] shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-[#F3F4F6] text-[var(--accent-ink)] rounded-lg shrink-0">
                  <Edit className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#121316]">
                    {editingId ? 'Редактирование вида' : 'Новый вид дозвола'}
                  </h3>
                  <p className="text-xs text-[#6B7280] mt-0.5">
                    {editingId ? 'Изменения применяются к вкладке и документам' : 'Название станет вкладкой в реестре'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEditingType(false)}
                aria-label="Закрыть"
                className="p-1.5 text-[#9CA3AF] hover:text-[#121316] rounded-lg hover:bg-[#F3F4F6] transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form id="dozvola-type-form" onSubmit={handleSaveType} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 py-5 flex flex-col gap-4">
              <div>
                <label htmlFor="dt-name" className={labelCls}>Название вида</label>
                <input
                  id="dt-name"
                  required
                  type="text"
                  value={typeName}
                  onChange={e => { setTypeName(e.target.value); setFormError(null); }}
                  className={inputCls}
                  placeholder="TR B, CHN 2…"
                />
              </div>

              <div>
                <label htmlFor="dt-country" className={labelCls}>Страна для документов</label>
                <input
                  id="dt-country"
                  type="text"
                  value={country}
                  onChange={e => setCountry(e.target.value)}
                  className={inputCls}
                  placeholder="Турция, Китай…"
                />
                <span className="text-[10px] text-[#9CA3AF] mt-1 block">
                  Подставляется в печатные формы. Пусто — страна определяется по названию вида.
                </span>
              </div>

              <div className="flex gap-3">
                <div className="flex-1 min-w-0">
                  <label htmlFor="dt-category" className={labelCls}>Категория ЕВРО</label>
                  <input
                    id="dt-category"
                    type="text"
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className={inputCls}
                    placeholder="двухсторонн…"
                  />
                </div>
                <div className="w-[104px] shrink-0">
                  <label htmlFor="dt-year" className={labelCls}>Год бланка</label>
                  <input
                    id="dt-year"
                    type="number"
                    min="2000"
                    max="2100"
                    value={Number.isFinite(year) ? year : ''}
                    onChange={e => {
                      const v = parseInt(e.target.value, 10);
                      setYear(Number.isFinite(v) ? v : new Date().getFullYear());
                    }}
                    className={inputCls}
                  />
                </div>
              </div>

              {formError && (
                <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5" role="alert">
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <span className="text-[11px] text-rose-700">{formError}</span>
                </div>
              )}
            </form>

            <div className="px-5 py-4 border-t border-[#E5E7EB] flex justify-end gap-2.5 shrink-0">
              <button type="button" onClick={() => setIsEditingType(false)} className={ghostBtn}>
                Отмена
              </button>
              <button
                type="submit"
                form="dozvola-type-form"
                disabled={isSaving}
                className={accentBtn}
              >
                {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                {editingId ? 'Сохранить изменения' : 'Создать вид'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
