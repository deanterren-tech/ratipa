// Уведомление дежурного о критических ошибках портала.
//
// Клиент сам пишет событие в базу (appErrors — для дашборда «Ошибки»), а сюда
// приходит только за уведомлением: функция отправляет сообщение в Telegram.
// Токен живёт только в переменных окружения сервера (TELEGRAM_BOT_TOKEN,
// TELEGRAM_CHAT_ID) и никогда не попадает в клиент.
//
// Функция самодостаточна (как api/agent.ts и api/drive-list.ts): без импортов из
// проекта — серверные функции Vercel собираются отдельно.

type AnyReq = { method?: string; body?: any };
type AnyRes = {
  status: (code: number) => AnyRes;
  json: (body: any) => void;
};

/** Не больше 10 уведомлений в минуту с одного экземпляра функции. */
const recent: number[] = [];
function allowed(): boolean {
  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= 10) return false;
  recent.push(now);
  return true;
}

function cut(value: unknown, max: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

export default async function handler(req: AnyReq, res: AnyRes) {
  if ((req.method || 'GET').toUpperCase() !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  let body: any = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch { body = {}; }
  }
  body = body && typeof body === 'object' ? body : {};

  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_CHAT_ID || '';
  // Не настроено — тихо выходим: сбор ошибок в базу работает и без Telegram.
  if (!token || !chatId) {
    res.status(200).json({ ok: true, notified: false, reason: 'not_configured' });
    return;
  }
  if (!allowed()) {
    res.status(200).json({ ok: true, notified: false, reason: 'rate_limited' });
    return;
  }

  const when = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' });
  const lines = [
    '🔴 Ошибка в портале Ratipa',
    `Когда: ${when}`,
    `Раздел: ${cut(body.scope, 60)}`,
    `Что: ${cut(body.message, 300)}`,
    body.path ? `Узел: ${cut(body.path, 120)}` : '',
    body.role ? `Роль: ${cut(body.role, 40)}` : '',
    body.build ? `Версия: ${cut(body.build, 20)}` : '',
    body.url ? `Адрес: ${cut(body.url, 160)}` : '',
  ].filter(Boolean);

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), disable_web_page_preview: true }),
    });
    const data = await response.json().catch(() => null);
    res.status(200).json({ ok: true, notified: Boolean(data && data.ok) });
  } catch {
    // Ошибки доставки уведомления не должны ломать клиент.
    res.status(200).json({ ok: true, notified: false, reason: 'telegram_unreachable' });
  }
}
