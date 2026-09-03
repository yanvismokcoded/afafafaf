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

// Провайдер оплаты картой (Smart Glocal), подключённый в @BotFather →
// Bot Settings → Payments → Smart Glocal. Токен там же (для теста и для
// боевого режима — токены разные, не перепутайте).
const SMARTGLOCAL_PROVIDER_TOKEN = process.env.SMARTGLOCAL_PROVIDER_TOKEN;
// Курс конвертации ⭐ → ₽ для оплаты картой (весь магазин ценообразован в
// Stars, а Smart Glocal принимает рубли — поэтому при оплате картой сумма
// заказа в Stars пересчитывается в рубли по этому курсу, а начисления на
// баланс идут обратно в Stars по нему же). ОБЯЗАТЕЛЬНО подставьте свой
// актуальный курс в .env (STARS_TO_RUB) — значение ниже лишь заглушка.
const STARS_TO_RUB = Number(process.env.STARS_TO_RUB) || 2;
// Минимальная сумма инвойса в копейках — у платёжных провайдеров обычно
// есть нижний порог; 10000 = 100 ₽. При необходимости поменяйте в .env.
const SMARTGLOCAL_MIN_KOPECKS = Number(process.env.SMARTGLOCAL_MIN_KOPECKS) || 10000;

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
if (!SMARTGLOCAL_PROVIDER_TOKEN) {
  console.warn(
    'SMARTGLOCAL_PROVIDER_TOKEN не задан в .env — оплата картой (Smart Glocal) будет недоступна,\n' +
    'останется только оплата Telegram Stars. Возьмите токен в @BotFather → Bot Settings → Payments → Smart Glocal.'
  );
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
   Сам каталог — в services-catalog.js (67 подкатегорий Telegram, собрано
   автоматически из вашего аккаунта twiboost, наценка +1 к цене за 1000
   уже применена). Чтобы обновить цены — см. инструкцию в начале того файла. */
const { SERVICES, TWIBOOST_SERVICE_MAP } = require('./services-catalog');

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

// Сколько копеек нужно выставить в инвойсе Smart Glocal, чтобы списать
// эквивалент suniStars ⭐ по курсу STARS_TO_RUB, с округлением вверх (чтобы
// магазин никогда не терял на округлении — как и с округлением Stars) и не
// ниже минимума провайдера.
function starsToRubKopecks(stars) {
  const kopecks = Math.ceil(stars * STARS_TO_RUB * 100 - 1e-9);
  return Math.max(SMARTGLOCAL_MIN_KOPECKS, kopecks);
}

// Обратная конвертация: сколько ⭐ считать зачисленными на баланс за
// реально списанную сумму. currency — 'XTR' (Stars, сумма уже в целых
// звёздах, копеек не бывает) или 'RUB' (сумма в копейках).
function chargedAmountToStars(amountMinorUnits, currency) {
  if (currency === 'RUB') return round2((amountMinorUnits / 100) / STARS_TO_RUB);
  return amountMinorUnits; // XTR
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
    const { items, useBalance, initData, provider } = req.body;
    const tgUser = verifyInitData(initData);
    if (!tgUser) return res.status(401).json({ error: 'Не удалось проверить пользователя' });
    if (!(await isSubscribed(tgUser.id))) {
      return res.status(403).json({ error: 'subscription_required', message: `Подпишитесь на ${NEWS_CHANNEL}, чтобы оформить заказ`, channel: NEWS_CHANNEL });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Корзина пуста' });
    }
    // provider: 'stars' (по умолчанию) или 'card' (Smart Glocal, оплата в ₽).
    const payProvider = provider === 'card' ? 'card' : 'stars';
    if (payProvider === 'card' && !SMARTGLOCAL_PROVIDER_TOKEN) {
      return res.status(400).json({ error: 'card_unavailable', message: 'Оплата картой временно недоступна, выберите оплату Stars' });
    }

    const user = getUser(tgUser.id);
    const subtotal = recomputeSubtotal(items);
    const finalTotal = subtotal; // скидок по промокоду больше нет — цена заказа не меняется
    const balanceUsed = useBalance ? Math.min(user.balance, finalTotal) : 0;
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

    const description = items.map(i => `${i.name} × ${i.qty}`).join(', ').slice(0, 250);

    if (payProvider === 'card') {
      // Smart Glocal принимает только реальную валюту (₽), а не Stars —
      // конвертируем сумму заказа в копейки по курсу STARS_TO_RUB, с
      // округлением вверх; переплату из-за округления/минимальной суммы
      // (roundingCredit, в ⭐) вернём на баланс сразу после оплаты.
      const chargedKopecks = starsToRubKopecks(total);
      const roundingCredit = round2(chargedAmountToStars(chargedKopecks, 'RUB') - total);

      pendingOrders.set(orderId, {
        type: 'order', userId: tgUser.id, items, subtotal, balanceUsed,
        finalTotal: total, currency: 'RUB', chargedKopecks, roundingCredit,
      });

      const invoiceLink = await bot.createInvoiceLink(
        'Продвижение в Telegram',
        description,
        orderId,
        SMARTGLOCAL_PROVIDER_TOKEN, // provider_token — обязателен для реальной валюты
        'RUB',                      // валюта Smart Glocal
        [{ label: 'Заказ', amount: chargedKopecks }] // сумма в копейках
      );

      return res.json({ invoiceLink, orderId });
    }

    // Telegram Stars (XTR) принимают только ЦЕЛОЕ число звёзд в инвойсе —
    // дробную сумму выставить нельзя. Поэтому округляем сумму к оплате
    // ВВЕРХ до целой звезды (чтобы магазин никогда не терял на округлении),
    // а разницу между тем, что реально списалось, и точной ценой заказа
    // (roundingCredit) зачисляем покупателю на баланс сразу после успешной
    // оплаты — раньше эта разница просто пропадала.
    const starsCharged = Math.max(1, Math.ceil(total - 1e-9));
    const roundingCredit = round2(starsCharged - total);

    pendingOrders.set(orderId, { type: 'order', userId: tgUser.id, items, subtotal, balanceUsed, finalTotal: total, currency: 'XTR', starsCharged, roundingCredit });

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
    const { amount, initData, provider } = req.body;
    const tgUser = verifyInitData(initData);
    if (!tgUser) return res.status(401).json({ error: 'Не удалось проверить пользователя' });
    if (!(await isSubscribed(tgUser.id))) {
      return res.status(403).json({ error: 'subscription_required', message: `Подпишитесь на ${NEWS_CHANNEL}, чтобы пополнить баланс`, channel: NEWS_CHANNEL });
    }

    const stars = Math.round(Number(amount));
    if (!Number.isFinite(stars) || stars <= 0 || stars > 100000) {
      return res.status(400).json({ error: 'Некорректная сумма' });
    }

    const payProvider = provider === 'card' ? 'card' : 'stars';
    if (payProvider === 'card' && !SMARTGLOCAL_PROVIDER_TOKEN) {
      return res.status(400).json({ error: 'card_unavailable', message: 'Оплата картой временно недоступна, выберите оплату Stars' });
    }

    const orderId = 'topup_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    if (payProvider === 'card') {
      const chargedKopecks = starsToRubKopecks(stars);
      pendingOrders.set(orderId, { type: 'topup', userId: tgUser.id, amount: stars, currency: 'RUB', chargedKopecks });

      const invoiceLink = await bot.createInvoiceLink(
        'Пополнение баланса',
        `Пополнение баланса SMM Store на ${stars} ⭐`,
        orderId,
        SMARTGLOCAL_PROVIDER_TOKEN,
        'RUB',
        [{ label: 'Пополнение', amount: chargedKopecks }]
      );
      return res.json({ invoiceLink, orderId });
    }

    pendingOrders.set(orderId, { type: 'topup', userId: tgUser.id, amount: stars, currency: 'XTR' });

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

  // Заказ мог быть оплачен либо Stars (currency 'XTR', total_amount — целое
  // число звёзд), либо картой через Smart Glocal (currency 'RUB',
  // total_amount — сумма в копейках). Баланс в приложении всегда в ⭐,
  // поэтому реально списанную сумму переводим в Stars-эквивалент по курсу
  // STARS_TO_RUB и везде дальше работаем уже с ним.
  const currency = order?.currency || 'XTR';
  const paidStars = chargedAmountToStars(payment.total_amount, currency);
  const methodLabel = currency === 'RUB' ? 'картой (Smart Glocal)' : 'Stars';

  if (order?.type === 'topup') {
    // Это пополнение баланса — товаров нет, просто зачисляем Stars-эквивалент целиком
    user.balance = round2(user.balance + paidStars);
    user.orders.unshift(orderToHistoryEntry(
      buyer.id,
      [{ name: 'Пополнение баланса', qty: paidStars }],
      paidStars,
      'Выполнен'
    ));
    saveData();

    try {
      await bot.sendMessage(OWNER_CHAT_ID,
        `💰 Пополнение баланса на ${paidStars} ⭐ (оплата ${methodLabel})\n` +
        `Пользователь: ${buyer.first_name || ''} ${buyer.username ? '@' + buyer.username : '(id ' + buyer.id + ')'}\n` +
        `ID транзакции: ${chargeId}`
      );
    } catch (err) {
      console.error('Не удалось отправить уведомление владельцу:', err.message);
    }
    await bot.sendMessage(msg.chat.id, `Баланс пополнен на ${paidStars} ⭐. Спасибо!`);
    return;
  }

  // Обычный заказ услуги.
  // На баланс возвращается: (1) roundingCredit — переплата из-за округления
  // суммы вверх (до целой звезды для Stars, до копеек/минимума для карты —
  // см. /api/create-invoice), и (2) кешбэк 5% от оплаченной суммы.
  user.balance = round2(
    Math.max(0, user.balance - (order?.balanceUsed || 0))
    + (order?.roundingCredit || 0)
    + paidStars * 0.05
  );
  const historyEntry = orderToHistoryEntry(buyer.id, order?.items || [], paidStars, 'Оплачен');
  user.orders.unshift(historyEntry);
  saveData();

  await notifyOwner(buyer, order?.items || [], paidStars, methodLabel + ', transaction ' + chargeId);
  await bot.sendMessage(msg.chat.id, 'Спасибо за заказ! Мы уже начали выполнение — обновления пришлём в этот чат.');

  // Автовыдача: создаём заказ(ы) в панели twiboost.com через её API.
  // Если для услуги нет мапинга в TWIBOOST_SERVICE_MAP или запрос к API
  // упал с ошибкой — заказ остаётся у вас в чате на ручную обработку,
  // ничего не теряется.
  await fulfillOrder(historyEntry, order?.items || []);
});

app.listen(PORT, () => console.log(`Server on :${PORT}`));
