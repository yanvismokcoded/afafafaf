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
 *   BOT_TOKEN=токен_от_BotFather
 *   OWNER_CHAT_ID=ваш_telegram_id_или_id_чата_для_заказов
 *   PORT=3000
 *
 * OWNER_CHAT_ID: напишите боту любое сообщение, затем откройте
 * https://api.telegram.org/bot<ВАШ_ТОКЕН>/getUpdates и возьмите message.chat.id.
 *
 * Хранилище: здесь всё в памяти (Map), для реального запуска замените на
 * БД (Postgres/SQLite/Redis) — иначе баланс и история обнулятся при рестарте.
 */

require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN || !OWNER_CHAT_ID) {
  console.error('Заполните BOT_TOKEN и OWNER_CHAT_ID в .env');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();
app.use(express.json());
app.use(express.static(__dirname)); // раздаёт index.html как есть

/* ---------- Каталог (дублируем с фронтендом) ----------
   Цена и сумма ВСЕГДА пересчитываются здесь из qty — клиенту нельзя
   доверять присланную цену, иначе её можно подменить в консоли браузера. */
const SERVICES = {
  sub_real:      { price1000: 45,  min: 100, max: 50000 },
  sub_premium:   { price1000: 120, min: 50,  max: 20000 },
  views_instant: { price1000: 8,   min: 500, max: 1000000 },
  views_smooth:  { price1000: 6,   min: 500, max: 1000000 },
  react_random:  { price1000: 15,  min: 20,  max: 5000 },
  react_premium: { price1000: 25,  min: 20,  max: 5000 },
};

const PROMO_CODES = {
  SMM10:    { type: 'percent', value: 10,  label: 'Промокод SMM10 — скидка 10%' },
  START500: { type: 'fixed',   value: 500, label: 'Промокод START500 — скидка 500 ⭐' },
};

// userId -> { balance, orders: [] }
const users = new Map();
function getUser(id) {
  if (!users.has(id)) users.set(id, { balance: 0, orders: [] });
  return users.get(id);
}

// orderId -> { userId, items, subtotal, promoCode, useBalance, finalTotal }
const pendingOrders = new Map();

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

function recomputeSubtotal(items) {
  return items.reduce((sum, i) => {
    const svc = SERVICES[i.serviceId];
    if (!svc) return sum;
    const qty = Math.min(svc.max, Math.max(svc.min, Number(i.qty) || svc.min));
    return sum + Math.max(1, Math.round(qty / 1000 * svc.price1000));
  }, 0);
}

/* ---------- Профиль: баланс + история заказов ---------- */
app.get('/api/profile', (req, res) => {
  const tgUser = verifyInitData(req.query.initData);
  if (!tgUser) return res.status(401).json({ error: 'Не удалось проверить пользователя' });
  const user = getUser(tgUser.id);
  res.json({ balance: user.balance, orders: user.orders });
});

/* ---------- Промокод ---------- */
app.post('/api/apply-promo', (req, res) => {
  const { code } = req.body;
  const promo = PROMO_CODES[String(code || '').toUpperCase()];
  if (!promo) return res.json({ valid: false, message: 'Такого промокода нет' });
  res.json({ valid: true, ...promo });
});

/* ---------- Создание инвойса ---------- */
app.post('/api/create-invoice', async (req, res) => {
  try {
    const { items, promoCode, useBalance, initData } = req.body;
    const tgUser = verifyInitData(initData);
    if (!tgUser) return res.status(401).json({ error: 'Не удалось проверить пользователя' });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Корзина пуста' });
    }

    const user = getUser(tgUser.id);
    const subtotal = recomputeSubtotal(items);

    let discount = 0;
    const promo = promoCode ? PROMO_CODES[String(promoCode).toUpperCase()] : null;
    if (promo) discount = promo.type === 'percent' ? Math.round(subtotal * promo.value / 100) : promo.value;
    discount = Math.min(discount, subtotal);

    const afterPromo = subtotal - discount;
    const balanceUsed = useBalance ? Math.min(user.balance, afterPromo) : 0;
    const finalTotal = Math.max(0, afterPromo - balanceUsed);

    const orderId = 'order_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    pendingOrders.set(orderId, { userId: tgUser.id, items, subtotal, discount, balanceUsed, finalTotal });

    // Если баланс/промокод полностью покрыли сумму — платить Stars не нужно,
    // списываем баланс сразу и не создаём инвойс.
    if (finalTotal <= 0) {
      user.balance -= balanceUsed;
      user.orders.unshift(orderToHistoryEntry(items, subtotal - discount, 'Оплачен'));
      pendingOrders.delete(orderId);
      await notifyOwner(tgUser, items, subtotal - discount, 'баланс/промокод, без Stars');
      return res.json({ invoiceLink: null, orderId, paidWithBalanceOnly: true });
    }

    const description = items.map(i => `${i.name} × ${i.qty}`).join(', ').slice(0, 250);
    const invoiceLink = await bot.createInvoiceLink(
      'Продвижение в Telegram',
      description,
      orderId,
      '',        // provider_token — пусто для Stars
      'XTR',     // currency — обязательно XTR для Stars
      [{ label: 'Заказ', amount: finalTotal }] // для Stars — ровно один элемент
    );

    res.json({ invoiceLink, orderId });
  } catch (err) {
    console.error('create-invoice error:', err);
    res.status(500).json({ error: 'Не удалось создать инвойс' });
  }
});

function orderToHistoryEntry(items, total, status) {
  return {
    date: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
    items: items.map(i => ({ name: i.name, qty: i.qty })),
    link: items.map(i => i.link).join(', '),
    total,
    status,
  };
}

async function notifyOwner(tgUser, items, total, method) {
  const itemsText = items.map(i => `• ${i.name} — ${i.qty} шт, ссылка: ${i.link}`).join('\n');
  const text =
    `🆕 Новый оплаченный заказ (${method})\n` +
    `Сумма: ${total} ⭐\n` +
    `Покупатель: ${tgUser.first_name || ''} ${tgUser.username ? '@' + tgUser.username : '(id ' + tgUser.id + ')'}\n\n` +
    `${itemsText}`;
  await bot.sendMessage(OWNER_CHAT_ID, text);
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

  // Кешбэк 5% от оплаченной суммы начисляется на баланс магазина
  user.balance = Math.max(0, user.balance - (order?.balanceUsed || 0)) + Math.round(payment.total_amount * 0.05);
  user.orders.unshift(orderToHistoryEntry(order?.items || [], payment.total_amount, 'Оплачен'));

  await notifyOwner(buyer, order?.items || [], payment.total_amount, 'Stars, transaction ' + payment.telegram_payment_charge_id);
  await bot.sendMessage(msg.chat.id, 'Спасибо за заказ! Мы уже начали выполнение — обновления пришлём в этот чат.');

  // Здесь же можно вызвать API вашей SMM-панели (сервис, который реально
  // накручивает подписчиков/просмотры/реакции), чтобы запустить выполнение
  // автоматически, без ручной обработки.
});

app.listen(PORT, () => console.log(`Server on :${PORT}`));
