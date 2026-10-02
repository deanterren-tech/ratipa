
import React, { useState, useEffect, useRef } from 'react'
import { UserProfile, DISPATCHER_COLORS_PRESETS } from '../types'
import { dbService } from '../api'
import { useToast } from './ToastProvider'
import { useModalKeyboard } from '../hooks/useModalKeyboard'
import UserAvatar from './UserAvatar'
import { getUserFullName } from '../utils/userName'
import { APP_VERSION_LABEL } from '../version'
import { ACCENT_PRESETS, DEFAULT_ACCENT_ID, applyAccentTheme, resolveAccentTheme } from '../theme/accent'
import AvatarCropModal from './AvatarCropModal'
import { readImageFileForCrop, AVATAR_MAX_EDGE, CropSource } from '../utils/imageUpload'
import { X, User as UserIcon, Palette, ShieldCheck, Clock, AlertTriangle, Loader2, Camera, Trash2, ImagePlus } from 'lucide-react'

/**
 * Настройки учётной записи.
 *
 * Показываем только то, что текущая система авторизации умеет сохранять:
 *  - имя (логин) — ТОЛЬКО ЧТЕНИЕ: по нему выполняется вход в AuthScreen;
 *  - роль, даты — только чтение (управляются администратором);
 *  - фотография профиля и цвет аватара — личные настройки.
 *
 * Контактный адрес и идентификатор убраны из интерфейса: это служебные данные,
 * они остаются в профиле и в системе авторизации без изменений.
 *
 * Фотография: можно выбрать файл любого разрешения и размера. Перед сохранением
 * открывается кадрирование под круглый аватар, а в профиль уходит уменьшенная
 * и сжатая версия — исходный файл не сохраняется.
 *
 * Пароль здесь не редактируется: система хранит его в профиле и не умеет
 * безопасно менять его из интерфейса.
 */
export default function AccountSettingsModal({
  isOpen,
  user,
  onClose,
}: {
  isOpen: boolean;
  user: UserProfile;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [color, setColor] = useState(user.color || '');
  // Акцентная тема: личный выбор пользователя, применяется сразу, сохраняется по кнопке
  const [accent, setAccent] = useState(user.accentColor || DEFAULT_ACCENT_ID);
  const [photo, setPhoto] = useState(user.avatarPhoto || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isReadingPhoto, setIsReadingPhoto] = useState(false);
  const [cropSource, setCropSource] = useState<CropSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Тема, которую только что сохранили: при закрытии окна её не откатываем. */
  const savedAccentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setColor(user.color || '');
    setAccent(user.accentColor || DEFAULT_ACCENT_ID);
    setPhoto(user.avatarPhoto || '');
    setCropSource(null);
    setError(null);
  }, [isOpen, user.color, user.avatarPhoto, user.accentColor]);

  // Закрытие без сохранения возвращает тему, записанную в профиле.
  // После сохранения оставляем выбранную: иначе она откатывалась к прежнему цвету,
  // пока из профиля не подтянутся новые данные.
  useEffect(() => {
    if (!isOpen) {
      const keep = savedAccentRef.current;
      savedAccentRef.current = null;
      applyAccentTheme(keep || user.accentColor || null);
    }
  }, [isOpen, user.accentColor]);

  // Пока открыто кадрирование, окно настроек не перехватывает Escape и Enter
  useModalKeyboard({
    isOpen: isOpen && !cropSource,
    onClose: handleClose,
    onConfirm: isOpen ? () => handleSave() : undefined,
    canConfirm: true,
  });

  /** Выбор цвета: сразу показываем результат, сохранение — по кнопке. */
  function handleAccentPick(id: string) {
    setAccent(id);
    applyAccentTheme(id);
    setError(null);
  }

  /** Закрытие без сохранения: возвращаем тему, записанную в профиле. */
  function handleClose() {
    applyAccentTheme(user.accentColor || null);
    onClose();
  }

  if (!isOpen) return null;

  const isDirty = color !== (user.color || '') || photo !== (user.avatarPhoto || '')
    || accent !== (user.accentColor || DEFAULT_ACCENT_ID);

  const handlePhotoPick = async (file: File | undefined) => {
    if (!file) return;
    setIsReadingPhoto(true);
    setError(null);
    try {
      // Общее чтение изображений портала (utils/imageUpload). Размер файла не
      // ограничиваем: изображение уменьшается до рабочего размера для выбора кадра.
      const source = await readImageFileForCrop(file);
      setCropSource(source);
    } catch (e) {
      // Текущая фотография и цвет остаются без изменений
      setError(e instanceof Error ? e.message : 'Не удалось загрузить фотографию.');
    } finally {
      setIsReadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  async function handleSave() {
    if (isSaving) return;
    setError(null);
    setIsSaving(true);
    try {
      // Сохранение через существующий механизм приложения (merge по uid).
      // Права: запись идёт в собственный профиль пользователя.
      await Promise.resolve(dbService.saveUser({ ...user, color, avatarPhoto: photo, accentColor: accent } as UserProfile));
      // Тема применяется сразу, не дожидаясь, пока изменение профиля вернётся из базы.
      savedAccentRef.current = accent;
      applyAccentTheme(accent);
      dbService.logAction(user.name, user.role, 'Изменён профиль', 'Auth', user.uid, 'Настройки учётной записи');
      toast('Настройки учётной записи сохранены', 'success');
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError('Не удалось сохранить: ' + msg);
      toast('Настройки не сохранены', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  const roleLabel = user.role === 'root_admin' ? 'Разработчик (Root)'
    : user.role === 'admin' ? 'Администратор'
    : user.role === 'dispatcher' ? 'Диспетчер'
    : 'Сотрудник';

  const createdAt = user.createdAt ? new Date(user.createdAt).toLocaleDateString('ru-RU').replace(/\./g, '/') : '—';
  const lastActive = user.lastActive ? new Date(user.lastActive).toLocaleString('ru-RU') : '—';

  const ghostBtn = 'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg text-xs font-medium text-[#4B5563] bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] disabled:opacity-50 disabled:cursor-not-allowed';
  const dangerBtn = 'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg text-xs font-medium text-rose-600 bg-white border border-[#E5E7EB] hover:bg-rose-50 hover:border-rose-200 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div data-scroll-lock="modal" className="fixed inset-0 z-[5000] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4 sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Настройки учётной записи"
        className="relative z-10 w-full max-w-lg bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.12)] flex flex-col max-h-[90vh] overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#F3F4F6] text-[var(--accent-ink)] rounded-lg shrink-0">
              <UserIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#121316]">Настройки учётной записи</h3>
              <p className="text-xs text-[#6B7280] mt-0.5">{getUserFullName(user)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Закрыть"
            className="p-1.5 text-[#9CA3AF] hover:text-[#121316] rounded-lg hover:bg-[#F3F4F6] transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 py-5 flex flex-col gap-5">
          {/* Аватар: предпросмотр и действия */}
          <div>
            <span className="text-[10px] font-semibold text-[#9CA3AF] tracking-wider uppercase select-none block mb-2.5">
              Аватар
            </span>
            <div className="flex items-center gap-4">
              <UserAvatar
                firstName={user.firstName}
                lastName={user.lastName}
                name={getUserFullName(user)}
                color={color}
                photo={photo || null}
                size={64}
                textClassName="text-lg"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isReadingPhoto}
                    className={ghostBtn}
                  >
                    {isReadingPhoto
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      : (photo ? <Camera className="h-3.5 w-3.5" aria-hidden="true" /> : <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />)}
                    {photo ? 'Заменить фотографию' : 'Загрузить фотографию'}
                  </button>
                  {photo && (
                    <button
                      type="button"
                      onClick={() => { setPhoto(''); setError(null); }}
                      className={dangerBtn}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Удалить фотографию
                    </button>
                  )}
                </div>
                <span className="text-[10px] text-[#9CA3AF] mt-1.5 block leading-relaxed">
                  PNG, JPEG, WebP или GIF — любое разрешение и размер. Кадр выбирается вручную,
                  затем фотография уменьшается до {AVATAR_MAX_EDGE}×{AVATAR_MAX_EDGE} и хранится в профиле.
                </span>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => handlePhotoPick(e.target.files?.[0])}
            />
          </div>

          {/* Цвет аватара — используется, когда фотографии нет */}
          <div>
            <span className="text-[11px] font-medium text-[#6B7280] mb-1.5 flex items-center gap-1.5">
              <Palette className="w-3 h-3 text-[#9CA3AF]" aria-hidden="true" />
              Цвет аватара
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setColor('')}
                title="По умолчанию"
                aria-label="Цвет по умолчанию"
                className={`h-8 px-2.5 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] ${
                  !color ? 'border-[var(--accent-ui)] text-[var(--accent-ink)] bg-[var(--accent-10)]' : 'border-[#E5E7EB] text-[#6B7280] hover:bg-[#F3F4F6]'
                }`}
              >
                По умолчанию
              </button>
              {DISPATCHER_COLORS_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => setColor(preset.key)}
                  title={preset.name}
                  aria-label={preset.name}
                  aria-pressed={color === preset.key}
                  className={`h-8 w-8 rounded-lg border-2 flex items-center justify-center transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] ${
                    color === preset.key ? 'border-[#121316] scale-105' : 'border-[#E5E7EB] hover:scale-105'
                  }`}
                  style={{ backgroundColor: preset.colorCode }}
                >
                  {color === preset.key && <CheckIcon />}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-[#9CA3AF] mt-1.5 block">
              Показывается вместо фотографии, если она не загружена
            </span>
          </div>

          {/* Акцентная тема интерфейса — личная настройка пользователя */}
          <div>
            <span className="text-[11px] font-medium text-[#6B7280] mb-1.5 flex items-center gap-1.5">
              <Palette className="w-3 h-3 text-[var(--accent-ui)]" aria-hidden="true" />
              Акцентный цвет интерфейса
            </span>
            <div
              className="grid grid-cols-10 gap-1.5"
              role="group"
              aria-label="Акцентный цвет интерфейса"
            >
              {ACCENT_PRESETS.map((preset) => {
                const active = accent === preset.id;
                const theme = resolveAccentTheme(preset.id);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleAccentPick(preset.id)}
                    title={preset.name}
                    aria-label={preset.name}
                    aria-pressed={active}
                    className={`h-7 w-full rounded-lg border-2 flex items-center justify-center transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] ${
                      active ? 'border-[#121316] scale-105' : 'border-[#E5E7EB] hover:scale-105'
                    }`}
                    style={{ backgroundColor: preset.hex }}
                  >
                    {active && (
                      <CheckIcon color={theme.on} />
                    )}
                  </button>
                );
              })}
            </div>
            <span className="text-[10px] text-[#9CA3AF] mt-1.5 block">
              Сейчас: {ACCENT_PRESETS.find((p) => p.id === accent)?.name || 'по умолчанию'}. Цвет применяется к
              акцентным элементам портала, текст и элементы управления остаются читаемыми.
            </span>
          </div>

          {/* Профиль — из системы авторизации, менять нельзя */}
          <div>
            <span className="text-[10px] font-semibold text-[#9CA3AF] tracking-wider uppercase select-none block mb-2.5">
              Данные профиля
            </span>
            <div className="border border-[#E5E7EB] rounded-xl divide-y divide-[#F3F4F6]">
              <ReadRow icon={UserIcon} label="Имя и фамилия" value={getUserFullName(user)} hint="Вход выполняется по этому имени — изменить его можно только у администратора" />
              <ReadRow icon={ShieldCheck} label="Роль" value={roleLabel} />
              <ReadRow icon={Clock} label="Создан" value={createdAt} />
              <ReadRow icon={Clock} label="Последняя активность" value={lastActive} />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5" role="alert">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="text-[11px] text-rose-700">{error}</span>
            </div>
          )}

          <p className="text-[10px] text-[#9CA3AF] leading-relaxed border-t border-[#F3F4F6] pt-3">
            Пароль из этого окна не меняется: система авторизации не поддерживает безопасную смену пароля.
            Обратитесь к администратору.
          </p>

          {/* Версия приложения — то же значение, что в package.json */}
          <div className="text-center">
            <span className="text-[10px] font-medium text-[#9CA3AF] tabular-nums">{APP_VERSION_LABEL}</span>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[#E5E7EB] flex justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-9 rounded-lg text-xs font-medium text-[#4B5563] bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className="inline-flex items-center gap-1.5 px-5 h-9 rounded-lg text-xs font-medium text-[var(--accent-on)] bg-[var(--accent-solid)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
          >
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Сохранить
          </button>
        </div>
      </div>

      {/* Кадрирование открывается поверх окна настроек: сюда же уходит готовый кадр */}
      <AvatarCropModal
        isOpen={!!cropSource}
        source={cropSource}
        onCancel={() => setCropSource(null)}
        onApply={(dataUrl) => {
          setPhoto(dataUrl);
          setCropSource(null);
          setError(null);
        }}
      />
    </div>
  );
}

function ReadRow({ icon: Icon, label, value, hint, mono }: { icon: any; label: string; value: string; hint?: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 px-3.5 py-2.5">
      <Icon className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0 mt-0.5" aria-hidden="true" />
      <span className="text-[11px] text-[#6B7280] w-[132px] shrink-0">{label}</span>
      <div className="min-w-0 flex-1">
        <span className={`text-xs text-[#121316] ${mono ? 'font-mono select-all' : ''} break-words`}>{value}</span>
        {hint && <span className="text-[10px] text-[#9CA3AF] block mt-0.5">{hint}</span>}
      </div>
    </div>
  );
}

function CheckIcon({ color = '#FFFFFF' }: { color?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5 drop-shadow"
      style={{ color }}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
