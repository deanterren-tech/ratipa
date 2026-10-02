import { htmlToTextPdfBytes } from './pdf/htmlToTextPdf';

/**
 * Формирование PDF для документов портала.
 *
 * PDF собирается как НАСТОЯЩИЙ документ: заголовки, абзацы, таблицы, поля и
 * линии уходят в файл текстовыми командами и векторными примитивами
 * (см. utils/pdf/htmlToTextPdf). Текст в готовом файле можно выделять,
 * копировать и находить поиском — снимков экрана в PDF больше нет.
 *
 * Кириллица обеспечивается встроенным шрифтом документа; файл формируется
 * в браузере и скачивается напрямую — диалог печати не открывается.
 */

/** Сформировать PDF из HTML-шаблона документа. Возвращает Blob — скачивается напрямую. */
export async function htmlToPdfBlob(html: string, _options: { quality?: number } = {}): Promise<Blob> {
  if (!html || !html.trim()) {
    throw new Error('Шаблон документа пуст — PDF не сформирован.');
  }
  const bytes = await htmlToTextPdfBytes(html);
  if (!bytes || bytes.length === 0) {
    throw new Error('Документ не содержит страниц — PDF не сформирован.');
  }
  return new Blob([bytes], { type: 'application/pdf' });
}

/** Скачать готовый файл напрямую, без диалога печати и новой вкладки. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // ссылку освобождаем после того, как браузер начал скачивание
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default htmlToPdfBlob;
