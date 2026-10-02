import React from 'react';
import { DISPATCHER_COLORS_PRESETS } from '../types';
import { getInitials, getInitialsFromFullName } from '../utils/userName';

/**
 * Аватар пользователя: фотография, если она загружена, иначе выбранный цвет
 * с инициалами. Один компонент на весь портал — шапка, меню пользователя,
 * настройки, списки пользователей. Второй системы отображения аватара нет.
 *
 * Фотография обрезается по центру (object-cover object-center): пропорции
 * сохраняются, изображение не растягивается, композиция остаётся по центру.
 */
export default function UserAvatar({
  name,
  firstName,
  lastName,
  color,
  photo,
  size = 28,
  textClassName,
  className = '',
  title,
}: {
  name?: string;
  /** Имя и фамилия профиля — из них строятся инициалы, если нет фотографии. */
  firstName?: string;
  lastName?: string;
  color?: string;
  photo?: string | null;
  /** Сторона аватара в пикселях. */
  size?: number;
  /** Размер шрифта инициалов; по умолчанию подбирается по стороне. */
  textClassName?: string;
  className?: string;
  title?: string;
}) {
  const label = String(name || '').trim();
  const preset = DISPATCHER_COLORS_PRESETS.find((p) => p.key === color);
  const tint = preset
    ? `${preset.bg} ${preset.darkText}`
    : 'bg-[var(--accent-15)] text-[var(--accent-ink)]';
  // Инициалы: первая буква имени + первая буква фамилии. Если известны только
  // строка полного имени — она разбирается тем же правилом.
  const initials =
    (firstName || lastName ? getInitials(firstName, lastName) : getInitialsFromFullName(label)) || '—';
  const text = textClassName || (size >= 32 ? 'text-xs' : 'text-[11px]');

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full border border-[#E5E7EB] select-none overflow-hidden shrink-0 ${photo ? '' : tint} ${text} font-semibold ${className}`}
      style={{ width: size, height: size }}
      title={title ?? label}
      aria-hidden={label ? undefined : true}
    >
      {photo ? (
        <img
          src={photo}
          alt={label ? `Фото профиля: ${label}` : 'Фото профиля'}
          className="block h-full w-full object-cover object-center"
          draggable={false}
        />
      ) : (
        initials
      )}
    </span>
  );
}
