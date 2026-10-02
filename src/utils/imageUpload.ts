/**
 * Чтение изображений из файла: единая точка для всего портала.
 *
 * Раньше чтение файла было записано прямо в модуле документов (скриншот поручения).
 * Чтобы не появилось второй независимой системы загрузки, общая логика вынесена сюда:
 * проверка формата, чтение в data URL, уменьшение и обрезка. Модуль документов
 * пользуется этой же функцией.
 *
 * Для фотографии профиля добавлен путь с кадрированием:
 *   readImageFileForCrop → (интерактивный выбор кадра) → cropToSquareDataUrl.
 * В хранилище профиля уходит только обработанная уменьшенная версия, исходный
 * файл никогда не сохраняется целиком.
 */

/** Форматы, которые браузер умеет показать в <img> без конвертации. */
export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Размер готового аватара: квадрат до 512×512. */
export const AVATAR_MAX_EDGE = 512;
/** Качество JPEG для готового аватара: заметно меньше веса при том же виде. */
export const AVATAR_JPEG_QUALITY = 0.9;
/**
 * Предел стороны исходника для интерактивного кадрирования.
 * Сам файл может быть любого размера и разрешения — ограничение касается только
 * картинки, которую браузер держит в памяти во время выбора кадра.
 */
export const CROP_SOURCE_MAX_EDGE = 2400;

export type ImageCrop = {
  /** Увеличение относительно минимального кадра, который уже полностью закрывает область. */
  zoom: number;
  /** Смещение центра кадра от центра изображения, в пикселях области просмотра. */
  offsetX: number;
  offsetY: number;
};

export const DEFAULT_IMAGE_CROP: ImageCrop = { zoom: 1, offsetX: 0, offsetY: 0 };

export type CropSource = {
  /** data URL изображения, подготовленного для кадрирования. */
  src: string;
  width: number;
  height: number;
};

/**
 * Геометрия кадра — единственный источник правды для предпросмотра и записи.
 *
 * Предпросмотр и файл считаются из ЭТИХ чисел, поэтому не могут разойтись:
 *   scale  — сколько пикселей области предпросмотра приходится на пиксель исходника;
 *   drawW/H, left/top — как изображение лежит в области предпросмотра;
 *   source — та же видимая область, но в координатах ИСХОДНОГО изображения.
 * Пиксели исходника берутся из naturalWidth/naturalHeight: размеры, в которые
 * браузер отрисовал превью на экране, к кадру отношения не имеют.
 */
export type CropGeometry = {
  scale: number;
  drawW: number;
  drawH: number;
  left: number;
  top: number;
  source: { x: number; y: number; size: number };
};

/** Размеры изображения в пикселях исходника (с учётом ориентации из метаданных). */
export function naturalSizeOf(img: HTMLImageElement): { width: number; height: number } {
  return {
    width: Math.max(1, img.naturalWidth || img.width),
    height: Math.max(1, img.naturalHeight || img.height),
  };
}

/** Положение изображения и выбранная область в координатах исходника. */
export function computeCropGeometry(
  natural: { width: number; height: number },
  view: number,
  crop: ImageCrop,
): CropGeometry {
  const w = Math.max(1, natural.width);
  const h = Math.max(1, natural.height);
  const side = Math.max(1, view);
  const base = Math.max(side / w, side / h);
  const scale = base * Math.max(1, crop.zoom);
  const drawW = w * scale;
  const drawH = h * scale;
  const left = (side - drawW) / 2 + crop.offsetX;
  const top = (side - drawH) / 2 + crop.offsetY;

  // Видимая область — ровно то, что оказалось внутри квадрата предпросмотра
  const size = side / scale;
  const x = Math.min(Math.max(-left / scale, 0), Math.max(0, w - size));
  const y = Math.min(Math.max(-top / scale, 0), Math.max(0, h - size));
  return { scale, drawW, drawH, left, top, source: { x, y, size } };
}

type ReadImageOptions = {
  /** Предел размера исходного файла в байтах. */
  maxBytes?: number;
  /** Максимальная сторона результата. Без значения изображение не уменьшается. */
  maxEdge?: number;
  /** Обрезать по центру до квадрата. */
  square?: boolean;
  /** Качество JPEG для уменьшенных изображений. */
  quality?: number;
  /** Разрешённые типы. По умолчанию — поддерживаемые браузером форматы изображений. */
  allowedTypes?: string[];
  /** Человекочитаемое имя назначения для текста ошибок. */
  label?: string;
};

const humanSize = (bytes: number) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} МБ`;

/** Проверка типа файла до чтения: одинаковый текст ошибок для всех мест портала. */
function assertImageFile(file: File | undefined, label: string, allowedTypes: string[]) {
  if (!file || !file.type) {
    throw new Error(`Файл не выбран или его тип не определён — выберите ${label} заново.`);
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('Это не изображение. Поддерживаются PNG, JPEG, WebP и GIF.');
  }
  if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
    throw new Error('Формат не поддерживается. Загрузите PNG, JPEG, WebP или GIF.');
  }
}

/** Прочитать файл в data URL. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result && typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Не удалось прочитать файл. Попробуйте другой.'));
    };
    reader.onerror = () => reject(new Error('Ошибка чтения файла. Попробуйте другой файл.'));
    reader.readAsDataURL(file);
  });
}

/** Открыть data URL как изображение — заодно проверка, что файл действительно декодируется. */
export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error('Не удалось открыть изображение — файл повреждён или это не изображение.'));
    image.src = dataUrl;
  });
}

/** Записать изображение (или его часть) в квадратный JPEG нужного размера. */
function drawSquare(
  img: HTMLImageElement,
  source: { x: number; y: number; size: number },
  edge: number,
  quality: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Браузер не смог обработать изображение. Аватар не изменён.');

  // Белая подложка: прозрачность PNG в JPEG стала бы чёрной
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, edge, edge);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, source.x, source.y, source.size, source.size, 0, 0, edge, edge);

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  if (!dataUrl || dataUrl.length < 32) {
    throw new Error('Браузер не смог обработать изображение. Аватар не изменён.');
  }
  return dataUrl;
}

/**
 * Прочитать файл изображения и вернуть data URL.
 * Бросает Error с понятным текстом — вызывающий код показывает его пользователю.
 */
export async function readImageFile(file: File, options: ReadImageOptions = {}): Promise<string> {
  const {
    maxBytes,
    maxEdge,
    square = false,
    quality = 0.9,
    allowedTypes = SUPPORTED_IMAGE_TYPES,
    label = 'изображение',
  } = options;

  assertImageFile(file, label, allowedTypes);
  if (maxBytes && file.size > maxBytes) {
    throw new Error(`Файл больше ${humanSize(maxBytes)} (сейчас ${humanSize(file.size)}). Выберите изображение меньшего размера.`);
  }

  const dataUrl = await readAsDataUrl(file);
  if (!maxEdge) return dataUrl;

  const img = await loadImage(dataUrl);

  // Размеры — в пикселях исходника (naturalWidth/naturalHeight), не в пикселях
  // вёрстки: изображение может быть показано где-то уменьшенным.
  const natural = naturalSizeOf(img);

  // Пропорции сохраняются: при square=true берётся центральный квадрат,
  // остальное отбрасывается, поэтому изображение не растягивается.
  const side = square ? Math.min(natural.width, natural.height) : 0;
  const sourceWidth = square ? side : natural.width;
  const sourceHeight = square ? side : natural.height;

  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl; // canvas недоступен — отдаём исходное изображение

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(
    img,
    square ? Math.round((natural.width - side) / 2) : 0,
    square ? Math.round((natural.height - side) / 2) : 0,
    sourceWidth,
    sourceHeight,
    0,
    0,
    targetWidth,
    targetHeight,
  );

  const mime = file.type === 'image/gif' ? 'image/png' : 'image/jpeg';
  return canvas.toDataURL(mime, quality);
}

/** Прочитать файл изображения без уменьшения — для распознавания скриншотов. */
export async function readImageFileFull(file: File): Promise<string> {
  return readImageFile(file, { label: 'скриншот или фото' });
}

/**
 * Прочитать файл для кадрирования аватара.
 *
 * Размер исходного файла не ограничивается: изображение любого разрешения
 * уменьшается до рабочего размера для выбора кадра. В профиль попадёт только
 * результат кадрирования — исходник не сохраняется.
 */
export async function readImageFileForCrop(file: File | undefined): Promise<CropSource> {
  assertImageFile(file, 'фотографию профиля', SUPPORTED_IMAGE_TYPES);

  const dataUrl = await readAsDataUrl(file as File);
  let img: HTMLImageElement;
  try {
    img = await loadImage(dataUrl);
  } catch {
    throw new Error('Не удалось открыть изображение — файл повреждён или это не изображение. Текущий аватар не изменён.');
  }
  const natural = naturalSizeOf(img);
  if (!img.naturalWidth && !img.width) {
    throw new Error('У изображения не удалось определить размеры. Текущий аватар не изменён.');
  }

  const longest = Math.max(natural.width, natural.height);
  if (longest <= CROP_SOURCE_MAX_EDGE) {
    return { src: dataUrl, width: natural.width, height: natural.height };
  }

  // Очень большое разрешение уменьшаем до рабочего: кадрирование остаётся точным,
  // а память и прокрутка кадра не страдают.
  const scale = CROP_SOURCE_MAX_EDGE / longest;
  const width = Math.max(1, Math.round(natural.width * scale));
  const height = Math.max(1, Math.round(natural.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { src: dataUrl, width: natural.width, height: natural.height };

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  return { src: canvas.toDataURL('image/jpeg', 0.92), width, height };
}

/**
 * Вырезать выбранный кадр в квадратный JPEG для аватара.
 *
 * viewport — сторона квадратной области выбора в пикселях: та же геометрия,
 * что видит пользователь в предпросмотре, поэтому кадр совпадает с увиденным.
 */
export function cropToSquareDataUrl(
  img: HTMLImageElement,
  crop: ImageCrop,
  viewport: number,
  options: { maxEdge?: number; quality?: number } = {},
): string {
  const { maxEdge = AVATAR_MAX_EDGE, quality = AVATAR_JPEG_QUALITY } = options;
  // Кадр берётся из той же геометрии, что показана пользователем: область
  // уже выражена в координатах исходника, повторной обрезки со смещением нет.
  const { source } = computeCropGeometry(naturalSizeOf(img), viewport, crop);
  return drawSquare(img, { x: source.x, y: source.y, size: source.size }, maxEdge, quality);
}

/**
 * Предпросмотр ровно того же кадра, что уйдёт в файл: отличие только в размере
 * полотна. Используется в окне кадрирования, чтобы пользователь видел результат.
 */
export function cropPreviewDataUrl(
  img: HTMLImageElement,
  crop: ImageCrop,
  viewport: number,
  edge = 128,
): string {
  return cropToSquareDataUrl(img, crop, viewport, { maxEdge: edge, quality: AVATAR_JPEG_QUALITY });
}
