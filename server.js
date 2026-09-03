/**
 * SMM Store — пример бэкенда: оплата Stars, профиль (баланс + история),
 * промокоды.
 *
 * Установка:
 *   npm init -y
 *   npm install express node-telegram-bot-api dotenv
 *   node server.js
 *
 * .env:
 *   BOT_TOKEN=8924068346:AAESrQU4ZIPTve5JJ-Xe2p4Lw8Qjf5505Cc
 *   OWNER_CHAT_ID=@irlmetalbat
 *   PORT=3000
 *   TWIBOOST_API_KEY=ваш_ключ_из_ЛК_twiboost.com   (необязательно — без него автовыдачи не будет)
 *
 * OWNER_CHAT_ID: напишите боту любое сообщение, затем откройте
 * https://api.telegram.org/bot<ВАШ_ТОКЕН>/getUpdates и возьмите message.chat.id.
 *
 * Автовыдача заказов через twiboost.com: нужен Node.js 18+ (используется
 * встроенный fetch). Впишите соответствие ваших услуг ID услуг twiboost в
 * TWIBOOST_SERVICE_MAP ниже — иначе заказы, как и раньше, будут просто
 * приходить вам в чат для ручной обработки.
 *
 * Хранилище: здесь всё в памяти (Map), для реального запуска замените на
 * БД (Postgres/SQLite/Redis) — иначе баланс и история обнулятся при рестарте.
 */

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;
const WEBAPP_URL = process.env.WEBAPP_URL; // публичный https-адрес, где хостится index.html
const PORT = process.env.PORT || 3000;
const TWIBOOST_API_KEY = process.env.TWIBOOST_API_KEY; // ключ из личного кабинета twiboost.com → API
const TWIBOOST_API_URL = 'https://twiboost.com/api/v2';

// Файл, в котором хранятся балансы/история заказов/использование промокодов —
// переживает перезапуск процесса (в отличие от простого Map в памяти).
// ВАЖНО: на хостингах с "эфемерной" файловой системой (часть бесплатных
// тарифов Heroku/Render и т.п., где диск сбрасывается при каждом деплое/сне)
// файл тоже будет теряться — там нужна подключаемая БД или persistent disk.
// Можно переопределить путь через .env (DATA_FILE), например на смонтированный
// постоянный volume.
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

if (!BOT_TOKEN || !OWNER_CHAT_ID) {
  console.error('Заполните BOT_TOKEN и OWNER_CHAT_ID в .env');
  process.exit(1);
}
if (!TWIBOOST_API_KEY) {
  console.warn(
    'TWIBOOST_API_KEY не задан в .env — автовыдача заказов работать не будет,\n' +
    'заказы будут только приходить вам в чат для ручной обработки, как раньше.'
  );
}
if (!WEBAPP_URL) {
  console.warn(
    'WEBAPP_URL не задан в .env — кнопка открытия Mini App работать не будет.\n' +
    'Укажите публичный https-адрес (например, из Render/Railway/ngrok), где доступен index.html.'
  );
} else if (!/^https:\/\//i.test(WEBAPP_URL)) {
  console.warn('WEBAPP_URL должен начинаться с https:// — Telegram не откроет Mini App по http-ссылке.');
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Страховка: одна неудачная отправка сообщения (например, боту закрыли
// личку) не должна ронять весь сервер и уводить его в краш-луп с потерей
// уже оплаченных заказов. Логируем и продолжаем работу.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err && err.message ? err.message : err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err && err.message ? err.message : err);
});
const app = express();
app.use(express.json());
app.use(express.static(__dirname)); // раздаёт index.html как есть

/* ---------- Каталог (дублируем с фронтендом) ----------
   Цена и сумма ВСЕГДА пересчитываются здесь из qty — клиенту нельзя
   доверять присланную цену, иначе её можно подменить в консоли браузера.
   Сам каталог — в services-catalog.js (Telegram, собрано автоматически из
   вашего аккаунта twiboost, наценка +10% к цене уже применена). Чтобы
   обновить цены/категории — см. инструкцию в начале того файла.

   Другие "сети" (например TikTok) живут в отдельных файлах такого же
   формата (tiktok-services-catalog.js) и генерируются скриптом
   fetch-twiboost-services.js — см. инструкцию в начале того скрипта.
   Каталоги объединяются здесь: если файл сети ещё не сгенерирован,
   просто пропускаем его (сайт продолжит работать с тем, что есть). */
const telegramCatalog = require('./services-catalog');
const catalogFiles = ['./tiktok-services-catalog']; // добавляйте сюда новые сети по мере генерации
const SERVICES = { ...telegramCatalog.SERVICES };
const TWIBOOST_SERVICE_MAP = { ...telegramCatalog.TWIBOOST_SERVICE_MAP };
for (const file of catalogFiles) {
  try {
    const cat = require(file);
    Object.assign(SERVICES, cat.SERVICES);
    Object.assign(TWIBOOST_SERVICE_MAP, cat.TWIBOOST_SERVICE_MAP);
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
    console.warn(`Каталог ${file} ещё не сгенерирован — раздел будет пуст, пока вы не запустите fetch-twiboost-services.js`);
  }
}

/* ---------- Услуги с ручной выдачей ----------
   ID услуг twiboost, для которых автоотправка в панель ОТКЛЮЧЕНА:
   заказ всё равно приходит и оплачивается как обычно, владелец получает
   уведомление (см. notifyOwner), но createTwiboostOrder для них не
   вызывается — обрабатывайте такие заказы руками.
   4188 — «Премиум реакции Telegram» (кастомные), по просьбе владельца. */
const MANUAL_FULFILLMENT_TWIBOOST_IDS = new Set([4188]);

/* ---------- Промокоды ----------
   Промокод больше не даёт скидку на заказ — при активации он сразу
   зачисляет фиксированное количество Stars на баланс покупателя.
   uses/redeemedBy — общий счётчик использований и список ID уже
   воспользовавшихся (каждый пользователь может применить код один раз,
   пока не кончится общий лимit maxUses). Хранится в памяти — как и
   users/pendingOrders, при рестарте сервера обнуляется (см. комментарий
   про Map выше по файлу — для прода нужна БД). */
const BALANCE_PROMO_CODES = {
  WAVEFLAIR: { value: 20, maxUses: 10, uses: 0, redeemedBy: new Set(), label: 'Промокод WAVEFLAIR — +20 ⭐ на баланс' },
};

// Канал, подписка на который обязательна для использования магазина.
// ВАЖНО: чтобы проверка подписки работала, бот должен быть добавлен
// администратором канала @yanvismokcoded (иначе Bot API вернёт ошибку
// на getChatMember, и это будет видно в логах сервера).
const NEWS_CHANNEL = '@yanvismokcoded';
const SUPPORT_USERNAME = '@irlmetalbat';

// userId -> { balance, orders: [] }
const users = new Map();
function getUser(id) {
  if (!users.has(id)) users.set(id, { balance: 0, orders: [] });
  return users.get(id);
}

// orderId -> { userId, items, subtotal, promoCode, useBalance, finalTotal }
const pendingOrders = new Map();

/* ---------- Персистентное хранилище (файл data.json) ----------
   Раньше users и статистика промокодов жили только в оперативной памяти
   (Map/Set) — при каждом рестарте процесса (деплой, падение, "засыпание"
   на бесплатном хостинге) баланс и история заказов у всех пользователей
   обнулялись. Теперь состояние загружается из файла при старте и
   сохраняется на диск после каждого изменения. pendingOrders намеренно
   НЕ сохраняются — это короткоживущие "заказы в процессе оплаты", которые
   и раньше не переживали рестарт ровно на середине оплаты; это не то же
   самое, из-за чего терялись баланс/история. */
function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(raw.users)) {
      for (const [id, u] of raw.users) {
        users.set(id, { balance: u.balance || 0, orders: Array.isArray(u.orders) ? u.orders : [] });
      }
    }
    if (raw.promoState) {
      for (const [code, state] of Object.entries(raw.promoState)) {
        if (BALANCE_PROMO_CODES[code]) {
          BALANCE_PROMO_CODES[code].uses = state.uses || 0;
          BALANCE_PROMO_CODES[code].redeemedBy = new Set(state.redeemedBy || []);
        }
      }
    }
    console.log(`Данные загружены из ${DATA_FILE}: пользователей ${users.size}`);
  } catch (err) {
    console.error(`Не удалось загрузить ${DATA_FILE}, стартуем с чистого состояния:`, err.message);
  }
}

function saveData() {
  try {
    const promoState = {};
    for (const [code, promo] of Object.entries(BALANCE_PROMO_CODES)) {
      promoState[code] = { uses: promo.uses, redeemedBy: [...promo.redeemedBy] };
    }
    const payload = JSON.stringify({ users: [...users.entries()], promoState }, null, 2);
    // Пишем во временный файл и переименовываем — так при падении сервера
    // ровно в момент записи старые данные не окажутся повреждены/обрезаны.
    const tmpFile = DATA_FILE + '.tmp';
    fs.writeFileSync(tmpFile, payload, 'utf8');
    fs.renameSync(tmpFile, DATA_FILE);
  } catch (err) {
    console.error(`Не удалось сохранить ${DATA_FILE}:`, err.message);
  }
}

loadData();

/** Официальная проверка подписи initData от Telegram Mini Apps.
 *  https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app */
function verifyInitData(initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computedHash !== hash) return null;
  try { return JSON.parse(params.get('user')); } catch { return null; }
}

// Округление до копеек/сотых звезды — убирает мусор от float-арифметики
// (0.1+0.2 и т.п.), но НЕ округляет цену до целой звезды. Целые Stars
// нужны только в момент выставления инвойса (см. ниже).
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function recomputeSubtotal(items) {
  return round2(items.reduce((sum, i) => {
    const svc = SERVICES[i.serviceId];
    if (!svc) return sum;
    const qty = Math.min(svc.max, Math.max(svc.min, Number(i.qty) || svc.min));
    // Точная цена позиции, БЕЗ округления и БЕЗ принудительного минимума
    // в 1 звезду за позицию — раньше это округление применялось к каждой
    // строке корзины ДО суммирования, из-за чего при недорогих услугах
    // (например 0.22 ⭐ за 1000) покупатель переплачивал вплоть до 1 ⭐
    // за позицию, и эта переплата нигде не сохранялась.
    return sum + (qty / 1000) * svc.price1000;
  }, 0));
}

/** Проверка подписки пользователя на новостной канал (обязательное условие
 *  для пользования магазином). Требует, чтобы бот был администратором
 *  канала NEWS_CHANNEL — иначе getChatMember вернёт ошибку доступа. */
async function isSubscribed(userId) {
  try {
    const member = await bot.getChatMember(NEWS_CHANNEL, userId);
    return ['creator', 'administrator', 'member'].includes(member.status);
  } catch (err) {
    console.error('Не удалось проверить подписку на канал:', err && err.message);
    return false;
  }
}

/* ---------- Профиль: баланс + история заказов ---------- */
app.get('/api/profile', (req, res) => {
  const tgUser = verifyInitData(req.query.initData);
  if (!tgUser) return res.status(401).json({ error: 'Не удалось проверить пользователя' });
  const user = getUser(tgUser.id);
  res.json({ balance: user.balance, orders: user.orders, supportUsername: SUPPORT_USERNAME });
});

/* ---------- Проверка обязательной подписки на канал ---------- */
app.get('/api/check-subscription', async (req, res) => {
  const tgUser = verifyInitData(req.query.initData);
  if (!tgUser) return res.status(401).json({ error: 'Не удалось проверить пользователя' });
  const subscribed = await isSubscribed(tgUser.id);
  res.json({ subscribed, channel: NEWS_CHANNEL });
});

/* ---------- Промокод: зачисление Stars на баланс ---------- */
app.post('/api/redeem-promo', async (req, res) => {
  const { code, initData } = req.body;
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'Не удалось проверить пользователя' });
  if (!(await isSubscribed(tgUser.id))) {
    return res.status(403).json({ error: 'subscription_required', message: `Подпишитесь на ${NEWS_CHANNEL}, чтобы использовать промокод`, channel: NEWS_CHANNEL });
  }

  const key = String(code || '').trim().toUpperCase();
  const promo = BALANCE_PROMO_CODES[key];
  if (!promo) return res.json({ success: false, message: 'Такого промокода нет' });
  if (promo.redeemedBy.has(tgUser.id)) {
    return res.json({ success: false, message: 'Вы уже использовали этот промокод' });
  }
  if (promo.uses >= promo.maxUses) {
    return res.json({ success: false, message: 'Промокод исчерпан — закончились использования' });
  }

  promo.uses += 1;
  promo.redeemedBy.add(tgUser.id);

  const user = getUser(tgUser.id);
  user.balance = round2(user.balance + promo.value);
  user.orders.unshift({
    id: crypto.randomUUID(),
    userId: tgUser.id,
    date: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
    items: [{ name: `Промокод ${key}`, qty: 1 }],
    link: '',
    total: promo.value,
    status: 'Начислено',
  });
  saveData();

  res.json({
    success: true,
    message: `+${promo.value} ⭐ зачислено на баланс`,
    balance: user.balance,
    remaining: promo.maxUses - promo.uses,
  });
});

/* ---------- Создание инвойса ---------- */
app.post('/api/create-invoice', async (req, res) => {
  try {
    const { items, useBalance, initData } = req.body;
    const tgUser = verifyInitData(initData);
    if (!tgUser) return res.status(401).json({ error: 'Не удалось проверить пользователя' });
    if (!(await isSubscribed(tgUser.id))) {
      return res.status(403).json({ error: 'subscription_required', message: `Подпишитесь на ${NEWS_CHANNEL}, чтобы оформить заказ`, channel: NEWS_CHANNEL });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Корзина пуста' });
    }

    const user = getUser(tgUser.id);
    const subtotal = recomputeSubtotal(items);
    const finalTotal = subtotal; // скидок по промокоду больше нет — цена заказа не меняется
    // Баланс списывается автоматически, если на нём есть средства.
    // useBalance от клиента теперь работает только как явный ОТКАЗ
    // (useBalance === false) — если поле не пришло вовсе или пришло true,
    // считаем, что списание включено, чтобы это работало даже со старой
    // закэшированной версией фронтенда.
    const useBalanceEffective = useBalance !== false;
    const balanceUsed = useBalanceEffective ? Math.min(user.balance, finalTotal) : 0;
    const total = round2(Math.max(0, finalTotal - balanceUsed));

    const orderId = 'order_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    // Если баланса хватило на всю сумму — платить Stars не нужно,
    // списываем баланс сразу и не создаём инвойс.
    if (total <= 0) {
      pendingOrders.set(orderId, { type: 'order', userId: tgUser.id, items, subtotal, balanceUsed, finalTotal: total, starsCharged: 0, roundingCredit: 0 });
      user.balance = round2(user.balance - balanceUsed);
      const historyEntry = orderToHistoryEntry(tgUser.id, items, subtotal, 'Оплачен');
      user.orders.unshift(historyEntry);
      pendingOrders.delete(orderId);
      saveData();
      await notifyOwner(tgUser, items, subtotal, 'баланс, без Stars');
      await fulfillOrder(historyEntry, items);
      return res.json({ invoiceLink: null, orderId, paidWithBalanceOnly: true });
    }

    // Telegram Stars (XTR) принимают только ЦЕЛОЕ число звёзд в инвойсе —
    // дробную сумму выставить нельзя. Поэтому округляем сумму к оплате
    // ВВЕРХ до целой звезды (чтобы магазин никогда не терял на округлении),
    // а разницу между тем, что реально списалось, и точной ценой заказа
    // (roundingCredit) зачисляем покупателю на баланс сразу после успешной
    // оплаты — раньше эта разница просто пропадала.
    const starsCharged = Math.max(1, Math.ceil(total - 1e-9));
    const roundingCredit = round2(starsCharged - total);

    pendingOrders.set(orderId, { type: 'order', userId: tgUser.id, items, subtotal, balanceUsed, finalTotal: total, currency: 'XTR', providerLabel: 'Stars', starsCharged, roundingCredit });

    const description = items.map(i => `${i.name} × ${i.qty}`).join(', ').slice(0, 250);
    const invoiceLink = await bot.createInvoiceLink(
      'Продвижение в Telegram',
      description,
      orderId,
      '',        // provider_token — пусто для Stars
      'XTR',     // currency — обязательно XTR для Stars
      [{ label: 'Заказ', amount: starsCharged }] // для Stars — ровно один элемент, целое число
    );

    res.json({ invoiceLink, orderId });
  } catch (err) {
    console.error('create-invoice error:', err);
    res.status(500).json({ error: 'Не удалось создать инвойс' });
  }
});

/* ---------- Пополнение баланса (без товаров, просто зачисление Stars) ---------- */
app.post('/api/create-topup-invoice', async (req, res) => {
  try {
    const { amount, initData } = req.body;
    const tgUser = verifyInitData(initData);
    if (!tgUser) return res.status(401).json({ error: 'Не удалось проверить пользователя' });
    if (!(await isSubscribed(tgUser.id))) {
      return res.status(403).json({ error: 'subscription_required', message: `Подпишитесь на ${NEWS_CHANNEL}, чтобы пополнить баланс`, channel: NEWS_CHANNEL });
    }

    const stars = Math.round(Number(amount));
    if (!Number.isFinite(stars) || stars <= 0 || stars > 100000) {
      return res.status(400).json({ error: 'Некорректная сумма' });
    }

    const orderId = 'topup_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    pendingOrders.set(orderId, { type: 'topup', userId: tgUser.id, amount: stars, currency: 'XTR', providerLabel: 'Stars' });

    const invoiceLink = await bot.createInvoiceLink(
      'Пополнение баланса',
      `Пополнение баланса SMM Store на ${stars} ⭐`,
      orderId,
      '',     // provider_token — пусто для Stars
      'XTR',  // currency — обязательно XTR для Stars
      [{ label: 'Пополнение', amount: stars }]
    );

    res.json({ invoiceLink, orderId });
  } catch (err) {
    console.error('create-topup-invoice error:', err);
    res.status(500).json({ error: 'Не удалось создать инвойс' });
  }
});

function orderToHistoryEntry(userId, items, total, status) {
  return {
    id: crypto.randomUUID(),
    userId,
    date: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
    items: items.map(i => ({ name: i.name, qty: i.qty })),
    link: items.map(i => i.link).join(', '),
    total,
    status,
  };
}

/* ---------- Автовыдача через API twiboost.com ---------- */

/** Один запрос к API панели (form-urlencoded, как требует twiboost). */
async function twiboostRequest(params) {
  const res = await fetch(TWIBOOST_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ key: TWIBOOST_API_KEY, ...params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/** Создать заказ в twiboost. Возвращает numeric order id панели. */
async function createTwiboostOrder(serviceId, link, quantity) {
  const data = await twiboostRequest({
    action: 'add',
    service: String(serviceId),
    link,
    quantity: String(quantity),
  });
  return data.order;
}

/** Статусы пачки заказов одним запросом: {orderId: {status, remains, ...}} */
async function getTwiboostStatuses(orderIds) {
  if (orderIds.length === 0) return {};
  const data = await twiboostRequest({ action: 'status', orders: orderIds.join(',') });
  // API отдаёт массив [{order, status, ...}] или объект {orderId: {...}} —
  // приводим к единому виду {orderId: {...}}.
  if (Array.isArray(data)) {
    const map = {};
    for (const row of data) map[row.order] = row;
    return map;
  }
  return data;
}

// historyEntryId -> { userId, twiboostOrderIds: number[] } — что нужно опрашивать на статус
const pollingOrders = new Map();

/** Пытается автоматически выдать каждую позицию заказа через twiboost.
 *  Позиции, для которых нет мапинга в TWIBOOST_SERVICE_MAP, или те, что
 *  упали с ошибкой API, просто остаются на ручную обработку — как и раньше,
 *  вы уже получили уведомление в чат через notifyOwner(). */
async function fulfillOrder(historyEntry, items) {
  if (!TWIBOOST_API_KEY) return; // автовыдача не настроена — молча пропускаем

  const twiboostOrderIds = [];
  const results = [];

  for (const item of items) {
    const twiboostServiceId = TWIBOOST_SERVICE_MAP[item.serviceId];
    if (!twiboostServiceId) {
      results.push(`⚠️ ${item.name} — нет мапинга на услугу twiboost, выдайте вручную`);
      continue;
    }
    if (MANUAL_FULFILLMENT_TWIBOOST_IDS.has(twiboostServiceId)) {
      results.push(`✋ ${item.name} (twiboost #${twiboostServiceId}) — для этой услуги настроена ручная выдача, автоотправка в панель пропущена`);
      continue;
    }
    try {
      const orderId = await createTwiboostOrder(twiboostServiceId, item.link, item.qty);
      twiboostOrderIds.push(orderId);
      results.push(`✅ ${item.name} — заявка twiboost #${orderId} создана`);
    } catch (err) {
      console.error('twiboost create order error:', err.message);
      results.push(`❌ ${item.name} — ошибка автовыдачи (${err.message}), выдайте вручную`);
    }
  }

  historyEntry.status = twiboostOrderIds.length === items.length ? 'В обработке (авто)' : 'Требует внимания';
  historyEntry.twiboostOrderIds = twiboostOrderIds;

  try {
    await bot.sendMessage(OWNER_CHAT_ID, `🤖 Автовыдача заказа:\n${results.join('\n')}`);
  } catch (err) {
    console.error('Не удалось отправить отчёт по автовыдаче:', err.message);
  }

  if (twiboostOrderIds.length > 0) {
    pollingOrders.set(historyEntry.id, { userId: historyEntry.userId, twiboostOrderIds });
  }
}

/** Раз в 5 минут обходит все заказы, отданные в twiboost, и подтягивает
 *  актуальный статус выполнения в историю заказов пользователя. */
async function pollTwiboostStatuses() {
  if (!TWIBOOST_API_KEY || pollingOrders.size === 0) return;

  const allIds = [...new Set([...pollingOrders.values()].flatMap(v => v.twiboostOrderIds))];
  let statuses;
  try {
    statuses = await getTwiboostStatuses(allIds);
  } catch (err) {
    console.error('twiboost status poll error:', err.message);
    return;
  }

  for (const [historyEntryId, meta] of pollingOrders) {
    const user = users.get(meta.userId);
    if (!user) { pollingOrders.delete(historyEntryId); continue; }
    const entry = user.orders.find(o => o.id === historyEntryId);
    if (!entry) { pollingOrders.delete(historyEntryId); continue; }

    const rows = meta.twiboostOrderIds.map(id => statuses[id]).filter(Boolean);
    if (rows.length === 0) continue;

    if (rows.every(r => String(r.status).toLowerCase() === 'completed')) {
      entry.status = 'Выполнен';
      pollingOrders.delete(historyEntryId);
    } else if (rows.some(r => ['canceled', 'cancelled', 'error'].includes(String(r.status).toLowerCase()))) {
      entry.status = 'Ошибка выполнения — уточните вручную';
      pollingOrders.delete(historyEntryId);
    } else {
      entry.status = `В обработке (${rows[0].status})`;
    }
  }
  saveData();
}
setInterval(() => { pollTwiboostStatuses().catch(err => console.error('pollTwiboostStatuses:', err.message)); }, 5 * 60 * 1000);

async function notifyOwner(tgUser, items, total, method) {
  const itemsText = items.map(i => `• ${i.name} — ${i.qty} шт, ссылка: ${i.link}`).join('\n');
  const text =
    `🆕 Новый оплаченный заказ (${method})\n` +
    `Сумма: ${total} ⭐\n` +
    `Покупатель: ${tgUser.first_name || ''} ${tgUser.username ? '@' + tgUser.username : '(id ' + tgUser.id + ')'}\n\n` +
    `${itemsText}`;
  try {
    await bot.sendMessage(OWNER_CHAT_ID, text);
  } catch (err) {
    // Не роняем процесс, если уведомление владельцу не доставилось
    // (неверный OWNER_CHAT_ID, бот заблокирован и т.п.) — заказ уже оплачен
    // и сохранён у пользователя, потерять его из-за этого нельзя.
    console.error('Не удалось отправить уведомление владельцу:', err.message);
  }
}

/* ---------- Открытие Mini App через инлайн-кнопку ---------- */
bot.onText(/\/start/, async (msg) => {
  if (!WEBAPP_URL) {
    return bot.sendMessage(msg.chat.id, 'Магазин временно недоступен: администратор ещё не подключил WEBAPP_URL.');
  }
  await bot.sendMessage(
    msg.chat.id,
    '☀️ SMM Store — подписчики, просмотры и реакции с оплатой в Telegram Stars.\n\nНажмите кнопку ниже, чтобы открыть магазин:',
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '🛍 Открыть магазин', web_app: { url: WEBAPP_URL } },
        ]],
      },
    }
  );
});

// Постоянная кнопка меню слева от поля ввода (открывает Mini App в один тап).
// Необязательная фича — если она по какой-то причине не срабатывает,
// это не должно ронять сервер: инлайн-кнопка из /start и так открывает магазин.
if (WEBAPP_URL && typeof bot.setChatMenuButton === 'function') {
  try {
    Promise.resolve(bot.setChatMenuButton({
      menu_button: { type: 'web_app', text: 'Магазин', web_app: { url: WEBAPP_URL } },
    }))
      .then(() => console.log('Кнопка меню установлена'))
      .catch((err) => console.warn('Не удалось установить кнопку меню:', err && err.message));
  } catch (err) {
    console.warn('Не удалось установить кнопку меню (синхронная ошибка):', err && err.message);
  }
}

// Обязательно ответить в течение 10 секунд
bot.on('pre_checkout_query', async (query) => {
  const order = pendingOrders.get(query.invoice_payload);
  const ok = !!order;
  await bot.answerPreCheckoutQuery(query.id, ok, ok ? undefined : { error_message: 'Заказ не найден, попробуйте оформить заново' });
});

// Приходит ТОЛЬКО после реального списания Stars — вот здесь заказ ваш
bot.on('message', async (msg) => {
  if (!msg.successful_payment) return;
  const payment = msg.successful_payment;
  const order = pendingOrders.get(payment.invoice_payload);
  pendingOrders.delete(payment.invoice_payload);

  const buyer = msg.from;
  const user = getUser(buyer.id);
  const chargeId = payment.telegram_payment_charge_id;

  if (order?.type === 'topup') {
    // Это пополнение баланса — товаров нет, просто зачисляем Stars целиком
    user.balance += payment.total_amount;
    user.orders.unshift(orderToHistoryEntry(
      buyer.id,
      [{ name: 'Пополнение баланса', qty: payment.total_amount }],
      payment.total_amount,
      'Выполнен'
    ));
    saveData();

    try {
      await bot.sendMessage(OWNER_CHAT_ID,
        `💰 Пополнение баланса на ${payment.total_amount} ⭐\n` +
        `Пользователь: ${buyer.first_name || ''} ${buyer.username ? '@' + buyer.username : '(id ' + buyer.id + ')'}\n` +
        `ID транзакции: ${chargeId}`
      );
    } catch (err) {
      console.error('Не удалось отправить уведомление владельцу:', err.message);
    }
    await bot.sendMessage(msg.chat.id, `Баланс пополнен на ${payment.total_amount} ⭐. Спасибо!`);
    return;
  }

  // Обычный заказ услуги.
  // На баланс возвращается: (1) roundingCredit — переплата из-за того, что
  // Stars можно списать только целым числом (см. /api/create-invoice), и
  // (2) кешбэк 5% от оплаченной суммы.
  user.balance = round2(
    Math.max(0, user.balance - (order?.balanceUsed || 0))
    + (order?.roundingCredit || 0)
    + payment.total_amount * 0.05
  );
  const historyEntry = orderToHistoryEntry(buyer.id, order?.items || [], payment.total_amount, 'Оплачен');
  user.orders.unshift(historyEntry);
  saveData();

  await notifyOwner(buyer, order?.items || [], payment.total_amount, 'Stars, transaction ' + chargeId);
  await bot.sendMessage(msg.chat.id, 'Спасибо за заказ! Мы уже начали выполнение — обновления пришлём в этот чат.');

  // Автовыдача: создаём заказ(ы) в панели twiboost.com через её API.
  // Если для услуги нет мапинга в TWIBOOST_SERVICE_MAP или запрос к API
  // упал с ошибкой — заказ остаётся у вас в чате на ручную обработку,
  // ничего не теряется.
  await fulfillOrder(historyEntry, order?.items || []);
});

app.listen(PORT, () => console.log(`Server on :${PORT}`));
