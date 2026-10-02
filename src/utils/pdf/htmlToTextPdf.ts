import { PDFDocument, PDFFont, PDFPage, PDFPageDrawTextOptions, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

/**
 * Превращение HTML-шаблона документа в PDF с НАСТОЯЩИМ текстом.
 *
 * Раньше «Скачать PDF» отрисовывало страницу в canvas и складывало снимки в файл:
 * текст в таком PDF не выделялся и не искался. Здесь тот же HTML раскладывается
 * вручную: абзацы, заголовки, таблицы, рамки и линии уходят в PDF текстовыми
 * командами и векторными примитивами, поэтому текст остаётся текстом —
 * его можно выделить, скопировать и найти поиском в любой программе.
 *
 * Кириллица обеспечивается встроенным шрифтом (Tinos — метрически совпадает
 * с Times New Roman, лицензия Apache-2.0), он подмножественно встраивается
 * в файл: в PDF попадают только использованные знаки.
 */

const MM = 72 / 25.4;

/** A4 в типографских пунктах. */
const A4 = { width: 595.28, height: 841.89 };

type Margins = { top: number; right: number; bottom: number; left: number };

const DEFAULT_MARGINS: Margins = { top: 16 * MM, right: 18 * MM, bottom: 16 * MM, left: 18 * MM };

/** Разобранные свойства оформления элемента. */
type Style = {
  fontSize: number;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  color: { r: number; g: number; b: number };
  marginTop: number;
  marginBottom: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  widthPercent?: number;
  height?: number;
  marginLeftPercent?: number;
  lineHeight: number;
  letterSpacing: number;
  borderTop: boolean;
  borderBottom: boolean;
  borderAll: boolean;
  verticalMiddle: boolean;
  whiteSpaceNowrap: boolean;
};

const BASE_STYLE: Style = {
  fontSize: 12,
  bold: false,
  italic: false,
  align: 'left',
  color: { r: 0, g: 0, b: 0 },
  marginTop: 0,
  marginBottom: 0,
  paddingTop: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  paddingRight: 0,
  lineHeight: 1.15,
  letterSpacing: 0,
  borderTop: false,
  borderBottom: false,
  borderAll: false,
  verticalMiddle: false,
  whiteSpaceNowrap: false,
};

type CssRule = { selectors: string[]; props: Record<string, string>; order: number };

/** Разбор значения длины: mm, pt, px, % (для ширин) и просто числа. */
function parseLength(value: string | undefined, base = 12): number | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  const num = parseFloat(v);
  if (Number.isNaN(num)) return undefined;
  if (v.endsWith('mm')) return num * MM;
  if (v.endsWith('pt')) return num;
  if (v.endsWith('px')) return (num * 72) / 96;
  if (v.endsWith('rem')) return num * 12;
  if (v.endsWith('em')) return num * base;
  if (v.endsWith('cm')) return num * 10 * MM;
  if (v.endsWith('%')) return num;
  return num;
}

/** Свойства из атрибута style="..." или из правила CSS. */
function propsFromText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  text.split(';').forEach((part) => {
    const i = part.indexOf(':');
    if (i < 0) return;
    const key = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (key && value) out[key] = value;
  });
  return out;
}

/** Собираем CSS: правила из <style>, отдельно — параметры страницы @page. */
function extractCss(doc: Document) {
  const rules: CssRule[] = [];
  let pageRule = '';
  let order = 0;
  doc.querySelectorAll('style').forEach((styleEl) => {
    let css = styleEl.textContent || '';
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    // @page — размер и поля страницы
    css = css.replace(/@page\s*\{([^}]*)\}/g, (_m, body: string) => {
      pageRule += ' ' + body;
      return '';
    });
    // @media не поддерживаем: правила внутри пропускаем
    css = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(css))) {
      const selectors = m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const props = propsFromText(m[2]);
      if (selectors.length && Object.keys(props).length) {
        rules.push({ selectors, props, order: order++ });
      }
    }
  });
  return { rules, pageRule };
}

/**
 * Простое звено селектора: тег, .класс, #id или их сочетание.
 *
 * Важно: разбираем через регулярные выражения, а не split('.'): при разбиении
 * терялась ведущая точка, и класс «.permit-table» сравнивался с именем тега —
 * из-за этого не применялись правила вида «.permit-table td { border: ... }»
 * и рамки таблиц не попадали в PDF.
 */
function simpleMatches(el: Element, selector: string): boolean {
  const sel = selector.trim();
  if (!sel || sel === '*') return true;

  const idMatch = sel.match(/#([^.#]+)/);
  if (idMatch && el.id !== idMatch[1]) return false;

  const classMatches = sel.match(/\.[^.#]+/g) || [];
  if (classMatches.some((cls) => !el.classList.contains(cls.slice(1)))) return false;

  const tagMatch = sel.match(/^[a-zA-Z][a-zA-Z0-9]*/);
  if (tagMatch && el.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) return false;

  return true;
}

/**
 * Сопоставление селектора с элементом, включая потомков: «.permit-table th»
 * применяется только к заголовкам внутри таблицы разрешений, а не ко всем th
 * на странице — иначе рамки появлялись бы у шапки бланка.
 */
function selectorMatches(el: Element, selector: string): boolean {
  const sel = selector.trim();
  if (!sel || sel === '*') return true;
  const parts = sel.split(/\s+/).filter(Boolean);
  const last = parts.pop() as string;
  if (!simpleMatches(el, last)) return false;
  let node: Element | null = el.parentElement;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    let found = false;
    while (node) {
      if (simpleMatches(node, part)) {
        found = true;
        node = node.parentElement;
        break;
      }
      node = node.parentElement;
    }
    if (!found) return false;
  }
  return true;
}

/** Итоговое оформление элемента: базовое ← правила CSS ← унаследованное ← inline. */
function resolveStyle(el: Element, rules: CssRule[], inherited: Style): Style {
  const s: Style = { ...inherited };
  const matched = rules
    .filter((rule) => rule.selectors.some((sel) => selectorMatches(el, sel)))
    .sort((a, b) => a.order - b.order);

  const apply = (props: Record<string, string>) => {
    if (props['font-size']) {
      const size = parseLength(props['font-size'], s.fontSize);
      if (size) s.fontSize = size;
    }
    if (props['font-weight'] && /bold|[6-9]00/.test(props['font-weight'])) s.bold = true;
    if (props['font-weight'] && /normal|[1-5]00/.test(props['font-weight'])) s.bold = false;
    if (props['font-style'] === 'italic') s.italic = true;
    if (props['text-align']) s.align = props['text-align'] as Style['align'];
    if (props['color']) Object.assign(s.color, parseColor(props['color']) || s.color);
    if (props['margin-top']) s.marginTop = parseLength(props['margin-top'], s.fontSize) || 0;
    if (props['margin-bottom']) s.marginBottom = parseLength(props['margin-bottom'], s.fontSize) || 0;
    if (props['margin-left']) {
      const v = props['margin-left'];
      s.marginLeftPercent = v.includes('%') ? parseFloat(v) : undefined;
      if (!v.includes('%')) s.paddingLeft += parseLength(v, s.fontSize) || 0;
    }
    if (props['margin']) {
      const parts = props['margin'].trim().split(/\s+/);
      if (parts[0]) s.marginTop = parseLength(parts[0], s.fontSize) || 0;
      if (parts[0]) s.marginBottom = parseLength(parts[0], s.fontSize) || 0;
      if (parts[3] || parts[1]) {
        const lr = parts[3] || parts[1];
        s.paddingLeft += parseLength(lr, s.fontSize) || 0;
        s.paddingRight += parseLength(lr, s.fontSize) || 0;
      }
    }
    if (props['padding']) {
      const parts = props['padding'].trim().split(/\s+/);
      const top = parseLength(parts[0], s.fontSize) || 0;
      const right = parseLength(parts[1] ?? parts[0], s.fontSize) || 0;
      const bottom = parseLength(parts[2] ?? parts[0], s.fontSize) || 0;
      const left = parseLength(parts[3] ?? parts[1] ?? parts[0], s.fontSize) || 0;
      s.paddingTop += top;
      s.paddingRight += right;
      s.paddingBottom += bottom;
      s.paddingLeft += left;
    }
    if (props['padding-top']) s.paddingTop += parseLength(props['padding-top'], s.fontSize) || 0;
    if (props['padding-bottom']) s.paddingBottom += parseLength(props['padding-bottom'], s.fontSize) || 0;
    if (props['padding-left']) s.paddingLeft += parseLength(props['padding-left'], s.fontSize) || 0;
    if (props['padding-right']) s.paddingRight += parseLength(props['padding-right'], s.fontSize) || 0;
    if (props['width'] && props['width'].includes('%')) s.widthPercent = parseFloat(props['width']);
    if (props['height']) s.height = parseLength(props['height'], s.fontSize);
    if (props['line-height']) {
      const lh = parseFloat(props['line-height']);
      if (!Number.isNaN(lh)) s.lineHeight = lh;
    }
    if (props['letter-spacing']) {
      const ls = parseLength(props['letter-spacing'], s.fontSize);
      if (ls) s.letterSpacing = ls;
    }
    if (props['border-top']) s.borderTop = hasVisibleBorder(props['border-top']);
    if (props['border-bottom']) s.borderBottom = hasVisibleBorder(props['border-bottom']);
    if (props['border']) s.borderAll = hasVisibleBorder(props['border']);
    if (props['border-left'] && hasVisibleBorder(props['border-left'])) s.borderAll = true;
    if (props['border-right'] && hasVisibleBorder(props['border-right'])) s.borderAll = true;
    if (props['vertical-align'] === 'middle') s.verticalMiddle = true;
    if (props['white-space'] === 'nowrap') s.whiteSpaceNowrap = true;
  };

  matched.forEach((rule) => apply(rule.props));
  const inline = el.getAttribute('style');
  if (inline) apply(propsFromText(inline));
  return s;
}

/**
 * Есть ли у значения border видимая линия.
 *
 * Важно: в `border:1px solid #000` ноль есть только в цвете — раньше такая
 * строка считалась рамкой «толщиной 0», и рамки таблиц пропадали в PDF.
 */
function hasVisibleBorder(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  if (!v || v === 'none' || v === 'hidden') return false;
  const width = v.match(/^([\d.]+)\s*(px|pt|mm|cm|em|rem)?/);
  if (width && parseFloat(width[1]) === 0) return false;
  // остаются значения вида "solid #000", "1px solid" и т.п.
  return /solid|dashed|dotted|double|groove|ridge|inset|outset|[\d.]+\s*(px|pt|mm|em|rem)?/.test(v);
}

function parseColor(value: string) {
  const v = value.trim().toLowerCase();
  if (v === 'black') return { r: 0, g: 0, b: 0 };
  if (v === 'white') return { r: 1, g: 1, b: 1 };
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
    };
  }
  const rgba = v.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b] = rgba[1].split(',').map((x) => parseFloat(x));
    return { r: r / 255, g: g / 255, b: b / 255 };
  }
  return null;
}

/** Кусок текста с начертанием. */
type Run = { text: string; bold: boolean; italic: boolean };

/** Инлайновое содержимое элемента: текст, <br>, жирный и курсив. */
function collectRuns(el: Element, style: Style, rules: CssRule[]): Run[] {
  const runs: Run[] = [];
  const push = (text: string, bold: boolean, italic: boolean) => {
    if (!text) return;
    const prev = runs[runs.length - 1];
    if (prev && prev.bold === bold && prev.italic === italic) prev.text += text;
    else runs.push({ text, bold, italic });
  };
  const walk = (node: Node, bold: boolean, italic: boolean) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        push((child.textContent || '').replace(/\s+/g, ' '), bold, italic);
        return;
      }
      if (child.nodeType !== 1) return;
      const childEl = child as Element;
      const tag = childEl.tagName.toLowerCase();
      if (tag === 'br') {
        push('\n', bold, italic);
        return;
      }
      if (tag === 'style' || tag === 'script') return;
      const childStyle = resolveStyle(childEl, rules, style);
      walk(childEl, childStyle.bold, childStyle.italic);
      // Инлайновый блок фиксированной ширины (например, место под подпись)
      if (childStyle.whiteSpaceNowrap) push(' ', bold, italic);
    });
  };
  walk(el, style.bold, style.italic);
  return runs;
}

/** Разбивка строк по ширине с учётом жирного/обычного начертания. */
function wrapRuns(
  runs: Run[],
  fonts: { regular: PDFFont; bold: PDFFont },
  size: number,
  maxWidth: number,
  letterSpacing: number,
): Run[][] {
  const widthOf = (text: string, bold: boolean) =>
    (bold ? fonts.bold : fonts.regular).widthOfTextAtSize(text, size) + text.length * letterSpacing;

  const lines: Run[][] = [];
  let current: Run[] = [];
  let currentWidth = 0;

  const pushLine = () => {
    lines.push(current);
    current = [];
    currentWidth = 0;
  };

  runs.forEach((run) => {
    const chunks = run.text.split('\n');
    chunks.forEach((chunk, index) => {
      if (index > 0) pushLine();
      const words = chunk.split(' ');
      words.forEach((word, wordIndex) => {
        const piece = wordIndex === 0 ? word : ' ' + word;
        if (!piece) return;
        const w = widthOf(piece, run.bold);
        if (currentWidth + w > maxWidth && (current.length || wordIndex > 0)) {
          // переносим слово на новую строку
          pushLine();
          const trimmed = piece.replace(/^ /, '');
          current.push({ ...run, text: trimmed });
          currentWidth = widthOf(trimmed, run.bold);
          return;
        }
        if (currentWidth + w > maxWidth && piece.length > 1) {
          // очень длинное слово — режем по символам
          let rest = piece.replace(/^ /, '');
          while (rest.length) {
            let take = rest.length;
            while (take > 1 && widthOf(rest.slice(0, take), run.bold) > maxWidth) take -= 1;
            current.push({ ...run, text: rest.slice(0, take) });
            rest = rest.slice(take);
            if (rest.length) pushLine();
          }
          currentWidth = current.reduce(
            (sum, r) => sum + widthOf(r.text, r.bold),
            0,
          );
          return;
        }
        current.push({ ...run, text: piece });
        currentWidth += w;
      });
    });
  });
  pushLine();
  return lines.filter((line, index, arr) => !(line.length === 0 && index === arr.length - 1 && arr.length > 1));
}

type Section = 'body' | 'thead' | 'tbody' | 'tfoot';

/** Рендерер: раскладывает DOM в страницы PDF. */
class HtmlPdfRenderer {
  private doc!: PDFDocument;
  private page!: PDFPage;
  private y = 0;
  private margins: Margins = { ...DEFAULT_MARGINS };
  private fonts!: { regular: PDFFont; bold: PDFFont };
  private rules: CssRule[] = [];
  private baseStyle: Style = { ...BASE_STYLE };

  constructor(private html: string) {}

  async render(): Promise<Uint8Array> {
    const parsed = new DOMParser().parseFromString(this.html, 'text/html');
    const { rules, pageRule } = extractCss(parsed);
    this.rules = rules;
    this.margins = this.marginsFromPageRule(pageRule);

    const bodyEl = parsed.body;
    this.baseStyle = bodyEl ? resolveStyle(bodyEl, rules, BASE_STYLE) : { ...BASE_STYLE };
    // Поля страницы из @page имеют приоритет над body padding
    this.baseStyle.paddingLeft = 0;
    this.baseStyle.paddingRight = 0;

    this.doc = await PDFDocument.create();
    this.doc.registerFontkit(fontkit);
    this.fonts = await loadDocumentFonts(this.doc);
    this.newPage();

    if (bodyEl) this.renderChildren(bodyEl, this.baseStyle, this.margins.left, this.contentWidth());

    return this.doc.save();
  }

  private marginsFromPageRule(pageRule: string): Margins {
    const props = propsFromText(pageRule);
    const margins = { ...DEFAULT_MARGINS };
    const m = props['margin'];
    if (m) {
      const parts = m.trim().split(/\s+/);
      const top = parseLength(parts[0]) ?? margins.top;
      const right = parseLength(parts[1] ?? parts[0]) ?? margins.right;
      const bottom = parseLength(parts[2] ?? parts[0]) ?? margins.bottom;
      const left = parseLength(parts[3] ?? parts[1] ?? parts[0]) ?? margins.left;
      margins.top = top;
      margins.right = right;
      margins.bottom = bottom;
      margins.left = left;
    }
    if (props['margin-top']) margins.top = parseLength(props['margin-top']) ?? margins.top;
    if (props['margin-bottom']) margins.bottom = parseLength(props['margin-bottom']) ?? margins.bottom;
    if (props['margin-left']) margins.left = parseLength(props['margin-left']) ?? margins.left;
    if (props['margin-right']) margins.right = parseLength(props['margin-right']) ?? margins.right;
    return margins;
  }

  private contentWidth() {
    return A4.width - this.margins.left - this.margins.right;
  }

  private newPage() {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.y = A4.height - this.margins.top;
  }

  /** Гарантировать место по высоте; при нехватке — новая страница. */
  private ensure(height: number) {
    if (this.y - height < this.margins.bottom) this.newPage();
  }

  private fontFor(bold: boolean): PDFFont {
    return bold ? this.fonts.bold : this.fonts.regular;
  }

  /** Высота строки текста для начертания. */
  private lineHeight(size: number, lineHeightFactor: number) {
    return size * lineHeightFactor;
  }

  /** Дорисовать блок текста в текущем месте; возвращает высоту. */
  private drawText(
    runs: Run[],
    style: Style,
    x: number,
    width: number,
    options: { allowSplit?: boolean } = {},
  ): number {
    const lines = wrapRuns(runs, this.fonts, style.fontSize, width, style.letterSpacing);
    const lh = this.lineHeight(style.fontSize, style.lineHeight);
    const total = lines.length * lh;

    if (options.allowSplit !== false) {
      // Разбиваем длинный блок между страницами построчно
      let drawn = 0;
      for (const line of lines) {
        if (this.y - lh < this.margins.bottom) {
          this.newPage();
        }
        this.drawLine(line, style, x, width);
        this.y -= lh;
        drawn += lh;
      }
      return drawn;
    }

    this.ensure(total);
    lines.forEach((line) => {
      this.drawLine(line, style, x, width);
      this.y -= lh;
    });
    return total;
  }

  private drawLine(line: Run[], style: Style, x: number, width: number) {
    const text = line.map((r) => r.text).join('');
    if (!text.trim()) return;
    const size = style.fontSize;
    let lineWidth = 0;
    line.forEach((run) => {
      lineWidth += this.fontFor(run.bold).widthOfTextAtSize(run.text, size) + run.text.length * style.letterSpacing;
    });

    let offset = 0;
    if (style.align === 'center') offset = Math.max(0, (width - lineWidth) / 2);
    else if (style.align === 'right') offset = Math.max(0, width - lineWidth);

    let cursor = x + offset;
    line.forEach((run) => {
      const font = this.fontFor(run.bold);
      const options: PDFPageDrawTextOptions = {
        x: cursor,
        y: this.y - size * 0.8,
        size,
        font,
        color: rgb(style.color.r, style.color.g, style.color.b),
      };
      this.page.drawText(run.text, options);
      cursor += font.widthOfTextAtSize(run.text, size) + run.text.length * style.letterSpacing;
    });
  }

  /** Горизонтальная линия (правило `.line`, hr, границы ячеек). */
  private drawHLine(x1: number, x2: number, y: number = this.y, thickness = 0.8) {
    this.page.drawLine({
      start: { x: x1, y },
      end: { x: x2, y },
      thickness,
      color: rgb(0, 0, 0),
    });
  }

  private drawVLine(x: number, y1: number, y2: number, thickness = 0.8) {
    this.page.drawLine({
      start: { x, y: y1 },
      end: { x, y: y2 },
      thickness,
      color: rgb(0, 0, 0),
    });
  }

  /** Обход детей элемента как блоков. */
  private renderChildren(el: Element | Document, style: Style, x: number, width: number, section: Section = 'body') {
    Array.from(el.childNodes).forEach((node) => {
      if (node.nodeType === 3) {
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) this.drawText([{ text, bold: style.bold, italic: style.italic }], style, x, width);
        return;
      }
      if (node.nodeType !== 1) return;
      const child = node as Element;
      const tag = child.tagName.toLowerCase();
      if (tag === 'style' || tag === 'script' || tag === 'head' || tag === 'meta' || tag === 'link') return;
      this.renderBlock(child, style, x, width, section);
    });
  }

  private renderBlock(el: Element, parentStyle: Style, x: number, width: number, section: Section) {
    const tag = el.tagName.toLowerCase();
    const style = resolveStyle(el, this.rules, parentStyle);
    const hasInline = el.querySelector('br, span, strong, b, em') !== null;

    if (style.marginTop) this.y -= style.marginTop;

    if (tag === 'table') {
      this.renderTable(el, style, x, width, section);
      this.y -= style.marginBottom;
      return;
    }

    if (tag === 'hr') {
      this.ensure(6);
      this.y -= 3;
      this.drawHLine(x, x + width);
      this.y -= 6;
      return;
    }

    // Вложенные блочные элементы (div/p внутри div)
    const blockChildren = Array.from(el.children).filter((c) =>
      ['div', 'p', 'table', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'hr', 'tr'].includes(c.tagName.toLowerCase()),
    );

    const runs = collectRuns(el, style, this.rules);
    const textContent = runs.map((r) => r.text).join('').trim();
    const isLineOnly = style.borderTop && !textContent;
    const isSignatureCell = style.borderBottom && !textContent;

    const innerX = x + (style.marginLeftPercent ? (width * style.marginLeftPercent) / 100 : 0) + style.paddingLeft;
    const innerWidth = Math.max(
      8,
      width - (style.marginLeftPercent ? (width * style.marginLeftPercent) / 100 : 0) - style.paddingLeft - style.paddingRight,
    );

    if (isLineOnly) {
      this.ensure(6);
      this.y -= 3;
      this.drawHLine(innerX, innerX + innerWidth);
      this.y -= 6;
      return;
    }

    if (style.borderAll || style.borderBottom || style.borderTop) {
      // Блок с рамкой: рисуем прямоугольник вокруг содержимого
      const textHeight = textContent
        ? wrapRuns(runs, this.fonts, style.fontSize, innerWidth, style.letterSpacing).length *
          this.lineHeight(style.fontSize, style.lineHeight)
        : 0;
      const boxHeight = (style.height || 0) || textHeight + style.paddingTop + style.paddingBottom;
      this.ensure(boxHeight);
      const top = this.y;
      if (style.borderAll) {
        this.page.drawRectangle({
          x: innerX,
          y: top - boxHeight,
          width: innerWidth,
          height: boxHeight,
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.8,
        });
      }
      if (!style.borderAll) {
        if (style.borderTop) this.drawHLine(innerX, innerX + innerWidth, top);
        if (style.borderBottom) this.drawHLine(innerX, innerX + innerWidth, top - boxHeight);
      }
      this.y -= style.paddingTop;
      if (textContent) this.drawText(runs, style, innerX, innerWidth);
      this.y -= style.paddingBottom;
      this.y -= style.marginBottom;
      return;
    }

    if (textContent && !hasInline && blockChildren.length === 0) {
      this.y -= style.paddingTop;
      this.drawText(runs, style, innerX, innerWidth);
      this.y -= style.paddingBottom + style.marginBottom;
      return;
    }

    if (textContent && blockChildren.length === 0) {
      this.y -= style.paddingTop;
      this.drawText(runs, style, innerX, innerWidth);
      this.y -= style.paddingBottom + style.marginBottom;
      return;
    }

    if (textContent && blockChildren.length > 0) {
      this.y -= style.paddingTop;
      this.drawText(runs, style, innerX, innerWidth);
      this.y -= style.paddingBottom;
    }

    if (blockChildren.length) {
      blockChildren.forEach((child) => this.renderBlock(child, style, innerX, innerWidth, section));
    }
    this.y -= style.marginBottom;
  }

  /** Таблицы: колонки, рамки, перенос текста в ячейках. */
  private renderTable(table: Element, style: Style, x: number, width: number, section: Section) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return;
    this.y -= style.marginTop;

    const firstRowCells = Array.from(rows[0].children);
    const columns = this.columnWidths(firstRowCells, width);
    const columnX: number[] = [];
    let acc = x;
    columns.forEach((w) => {
      columnX.push(acc);
      acc += w;
    });

    rows.forEach((row) => {
      const cells = Array.from(row.children) as Element[];
      const cellStyles = cells.map((cell) => resolveStyle(cell, this.rules, style));
      const cellRuns = cells.map((cell) => collectRuns(cell, resolveStyle(cell, this.rules, style), this.rules));

      // Высота строки: наибольшая из ячеек (или заданная height)
      let rowHeight = 0;
      let columnIndex = 0;
      cells.forEach((cell, i) => {
        const cs = cellStyles[i];
        const span = parseInt(cell.getAttribute('colspan') || '1', 10);
        const cellWidth = columns.slice(columnIndex, columnIndex + span).reduce((a, b) => a + b, 0);
        columnIndex += span;
        const lh = this.lineHeight(cs.fontSize, cs.lineHeight);
        const lines = cellRuns[i].map((r) => r.text).join('').trim()
          ? wrapRuns(cellRuns[i], this.fonts, cs.fontSize, Math.max(8, cellWidth - cs.paddingLeft - cs.paddingRight), cs.letterSpacing)
          : [];
        const textHeight = lines.length * lh;
        rowHeight = Math.max(rowHeight, (cs.height || 0), textHeight + cs.paddingTop + cs.paddingBottom);
      });
      rowHeight = Math.max(rowHeight, 12);

      if (this.y - rowHeight < this.margins.bottom) this.newPage();

      const rowTop = this.y;
      let ci = 0;
      cells.forEach((cell, i) => {
        const cs = cellStyles[i];
        const span = parseInt(cell.getAttribute('colspan') || '1', 10);
        const cellX = columnX[ci] ?? x;
        const cellWidth = columns.slice(ci, ci + span).reduce((a, b) => a + b, 0);
        ci += span;

        if (cs.borderAll) {
          this.page.drawRectangle({
            x: cellX,
            y: rowTop - rowHeight,
            width: cellWidth,
            height: rowHeight,
            borderColor: rgb(0, 0, 0),
            borderWidth: 0.8,
          });
        } else {
          if (cs.borderBottom) this.drawHLine(cellX, cellX + cellWidth, rowTop - rowHeight);
          if (cs.borderTop) this.drawHLine(cellX, cellX + cellWidth, rowTop);
        }

        const innerWidth = Math.max(8, cellWidth - cs.paddingLeft - cs.paddingRight);
        const lines = wrapRuns(cellRuns[i], this.fonts, cs.fontSize, innerWidth, cs.letterSpacing);
        const lh = this.lineHeight(cs.fontSize, cs.lineHeight);
        const textHeight = lines.length * lh;
        // Верх строки текста: по центру ячейки или от верхнего отступа
        let lineY = cs.verticalMiddle ? rowTop - (rowHeight - textHeight) / 2 : rowTop - cs.paddingTop;

        lines.forEach((line) => {
          if (line.length) {
            const lineWidth = line.reduce(
              (sum, run) =>
                sum + this.fontFor(run.bold).widthOfTextAtSize(run.text, cs.fontSize) + run.text.length * cs.letterSpacing,
              0,
            );
            let offset = 0;
            if (cs.align === 'center') offset = Math.max(0, (innerWidth - lineWidth) / 2);
            else if (cs.align === 'right') offset = Math.max(0, innerWidth - lineWidth);
            let cursor = cellX + cs.paddingLeft + offset;
            line.forEach((run) => {
              const font = this.fontFor(run.bold);
              this.page.drawText(run.text, {
                x: cursor,
                y: lineY - cs.fontSize * 0.8,
                size: cs.fontSize,
                font,
                color: rgb(cs.color.r, cs.color.g, cs.color.b),
              });
              cursor += font.widthOfTextAtSize(run.text, cs.fontSize) + run.text.length * cs.letterSpacing;
            });
          }
          lineY -= lh;
        });
      });

      this.y = rowTop - rowHeight;
    });

    this.y -= style.marginBottom;
  }

  /** Ширины колонок по первым ячейкам или поровну. */
  private columnWidths(cells: Element[], totalWidth: number): number[] {
    const declared = cells.map((cell) => {
      const inline = propsFromText(cell.getAttribute('style') || '');
      const w = inline['width'];
      return w && w.includes('%') ? parseFloat(w) : undefined;
    });
    const span = cells.reduce((sum, cell) => sum + parseInt(cell.getAttribute('colspan') || '1', 10), 0);
    const knownSum = declared.reduce((sum, v) => sum + (v || 0), 0);
    const unknown = declared.filter((v) => v === undefined).length;
    const fallback = unknown > 0 ? Math.max(0, (100 - knownSum) / unknown) : 0;
    const percents = declared.map((v) => (v === undefined ? fallback : v));
    const widths = percents.map((p) => (totalWidth * p) / 100);
    const sum = widths.reduce((a, b) => a + b, 0);
    if (!sum) return new Array(span).fill(totalWidth / Math.max(1, span));
    return widths.map((w) => (w / sum) * totalWidth);
  }
}

let fontCache: { regular: ArrayBuffer; bold: ArrayBuffer } | null = null;

/** Загрузка встроенных шрифтов документа (кэшируется между вызовами). */
async function loadDocumentFonts(doc: PDFDocument) {
  if (!fontCache) {
    const load = async (path: string) => {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`Не удалось загрузить шрифт документа (${path}).`);
      return res.arrayBuffer();
    };
    fontCache = {
      regular: await load('/fonts/Tinos-Regular.ttf'),
      bold: await load('/fonts/Tinos-Bold.ttf'),
    };
  }
  const regular = await doc.embedFont(fontCache.regular, { subset: true });
  const bold = await doc.embedFont(fontCache.bold, { subset: true });
  return { regular, bold };
}

/** Собрать PDF с настоящим текстом из HTML-шаблона документа. */
export async function htmlToTextPdfBytes(html: string): Promise<Uint8Array> {
  return new HtmlPdfRenderer(html).render();
}


/** Отладочный доступ к разбору CSS (используется только в проверках). */
export const __debugPdf = { extractCss, selectorMatches, resolveStyle, hasVisibleBorder, BASE_STYLE, simpleMatchesForProbe: simpleMatches };
