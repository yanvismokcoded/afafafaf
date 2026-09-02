/**
 * Каталог услуг Telegram — сгенерирован автоматически из вашего аккаунта
 * twiboost.com (скрипт fetch-twiboost-telegram-services.js, 67 подкатегорий).
 *
 * Наценка уже применена: price1000 (на вашем сайте) = ceil(цена twiboost за 1000) + 1.
 *
 * Чтобы обновить цены/добавить новые подкатегории — снова запустите
 * fetch-twiboost-telegram-services.js и замените этот файл целиком.
 *
 * Хотите выбрать другой вариант внутри какой-то подкатегории (не самый
 * дешёвый, а другой ID) — посмотрите список альтернатив в
 * telegram-services-generated.js (там для каждой подкатегории перечислены
 * все остальные варианты с их ID и ценами) и просто замените нужную строку
 * ниже на выбранный ID/цену.
 */

const SERVICES = {
  telegram_голоса_в_опрос: { price1000: 9, min: 1, max: 50000 }, // twiboost #2812, было 7.38/1000 у twiboost
  telegram_истории: { price1000: 3, min: 1, max: 150000 }, // twiboost #3171, было 1.48/1000 у twiboost
  telegram_premium_старты_бота: { price1000: 267, min: 100, max: 20000 }, // twiboost #2061, было 265.59/1000 у twiboost
  telegram_бусты: { price1000: 2067, min: 10, max: 100000 }, // twiboost #4328, было 2065.68/1000 у twiboost
  telegram_подписчики: { price1000: 4, min: 1, max: 1000000 }, // twiboost #3036, было 2.21/1000 у twiboost
  telegram_репосты: { price1000: 4, min: 1, max: 150000 }, // twiboost #1527, было 2.95/1000 у twiboost
  telegram_просмотры: { price1000: 2, min: 10, max: 50000 }, // twiboost #2735, было 0.12/1000 у twiboost
  telegram_просмотры_таргетированные_высок: { price1000: 4, min: 1, max: 150000 }, // twiboost #4210, было 2.95/1000 у twiboost
  telegram_просмотры_россия_на_несколько_п: { price1000: 16, min: 100, max: 100000000 }, // twiboost #1695, было 14.75/1000 у twiboost
  telegram_подписчики_россия: { price1000: 44, min: 10, max: 100000 }, // twiboost #2700, было 42.02/1000 у twiboost
  telegram_premium_старты_бота_активность: { price1000: 149, min: 10, max: 300000 }, // twiboost #3051, было 147.55/1000 у twiboost
  telegram_рефералы_для_ботов: { price1000: 1701, min: 1, max: 300000 }, // twiboost #2224, было 1700/1000 у twiboost
  telegram_старты_бота_низкое_качество: { price1000: 22, min: 100, max: 100000 }, // twiboost #2231, было 20.97/1000 у twiboost
  telegram_старты_бота_россия: { price1000: 30, min: 50, max: 100000 }, // twiboost #3917, было 28.03/1000 у twiboost
  telegram_подписчики_таргетированные: { price1000: 66, min: 500, max: 100000 }, // twiboost #2595, было 64.92/1000 у twiboost
  telegram_premium_просмотры_поста_россия: { price1000: 53, min: 100, max: 60000 }, // twiboost #3165, было 51.64/1000 у twiboost
  telegram_premium_подписчики_таргетирован: { price1000: 370, min: 500, max: 10000 }, // twiboost #5270, было 368.87/1000 у twiboost
  telegram_premium_просмотры_поста_таргети: { price1000: 149, min: 10, max: 100000 }, // twiboost #2609, было 147.55/1000 у twiboost
  telegram_premium_старты_бота_таргетирова: { price1000: 149, min: 50, max: 100000 }, // twiboost #3999, было 147.55/1000 у twiboost
  telegram_premium_подписчики_1_7_дней_pre: { price1000: 221, min: 1, max: 45000 }, // twiboost #2667, было 219.85/1000 у twiboost
  telegram_premium_подписчики_8_14_дней_pr: { price1000: 341, min: 50, max: 90000 }, // twiboost #4606, было 339.36/1000 у twiboost
  telegram_старты_бота_высокое_качество_бы: { price1000: 10, min: 1, max: 1000000 }, // twiboost #4604, было 8.68/1000 у twiboost
  telegram_premium_старты_бота_активность_: { price1000: 149, min: 50, max: 100000 }, // twiboost #3990, было 147.55/1000 у twiboost
  telegram_premium_старты_бота_россия: { price1000: 592, min: 100, max: 20000 }, // twiboost #4007, было 590.2/1000 у twiboost
  telegram_premium_подписчики_15_30_дней_p: { price1000: 282, min: 500, max: 20000 }, // twiboost #5026, было 280.34/1000 у twiboost
  telegram_premium_просмотры_историй: { price1000: 31, min: 10, max: 100000 }, // twiboost #2690, было 29.51/1000 у twiboost
  telegram_premium_репосты: { price1000: 149, min: 10, max: 200000 }, // twiboost #2691, было 147.55/1000 у twiboost
  telegram_подписчики_арабские: { price1000: 145, min: 10, max: 100000 }, // twiboost #4419, было 143.12/1000 у twiboost
  telegram_просмотры_таргетированные_живые: { price1000: 9, min: 50, max: 50000 }, // twiboost #2746, было 7.38/1000 у twiboost
  telegram_реакции: { price1000: 3, min: 1, max: 150000 }, // twiboost #2817, было 1.48/1000 у twiboost
  telegram_premium_подписчики_россия: { price1000: 225, min: 10, max: 100000 }, // twiboost #4626, было 223.6/1000 у twiboost
  telegram_комментарии: { price1000: 153, min: 1, max: 500 }, // twiboost #4932, было 152/1000 у twiboost
  telegram_авто_просмотры: { price1000: 2, min: 10, max: 1000000 }, // twiboost #3302, было 0.25/1000 у twiboost
  telegram_авто_реакции: { price1000: 3, min: 1, max: 150000 }, // twiboost #3303, было 1.48/1000 у twiboost
  telegram_premium_просмотры_поста: { price1000: 14, min: 10, max: 150000 }, // twiboost #4726, было 12.39/1000 у twiboost
  telegram_premium_подписчики_личная_свежа: { price1000: 577, min: 1, max: 50000 }, // twiboost #3427, было 575.44/1000 у twiboost
  telegram_жалобы_на_канал_группу_чат_пост: { price1000: 356, min: 1, max: 50000 }, // twiboost #5254, было 354.12/1000 у twiboost
  telegram_старты_бота_высокое_качество_бы_2: { price1000: 27, min: 50, max: 40000 }, // twiboost #3576, было 25.23/1000 у twiboost
  telegram_старты_бота_активность_для_выво: { price1000: 16, min: 50, max: 100000 }, // twiboost #3992, было 14.75/1000 у twiboost
  telegram_просмотры_для_закрытых_каналов_: { price1000: 4, min: 1, max: 150000 }, // twiboost #3740, было 2.95/1000 у twiboost
  telegram_подарки: { price1000: 60931, min: 1, max: 250 }, // twiboost #3772, было 60929.02/1000 у twiboost
  telegram_подписчики_живые_с_рекламы: { price1000: 2891, min: 10, max: 100000 }, // twiboost #3948, было 2890/1000 у twiboost
  telegram_premium_старты_бота_украина: { price1000: 149, min: 50, max: 100000 }, // twiboost #3988, было 147.55/1000 у twiboost
  telegram_старты_бота_активность_таргетир: { price1000: 16, min: 50, max: 100000 }, // twiboost #3995, было 14.75/1000 у twiboost
  telegram_подписчики_украина: { price1000: 31, min: 10, max: 100000 }, // twiboost #4699, было 29.44/1000 у twiboost
  telegram_premium_подписчики_31_день_prem: { price1000: 856, min: 500, max: 70000 }, // twiboost #4937, было 854.31/1000 у twiboost
  telegram_premium_подписчики_живые_с_рекл: { price1000: 17341, min: 10, max: 100000 }, // twiboost #4140, было 17340/1000 у twiboost
  telegram_реакции_для_закрытых_каналов_ба: { price1000: 18, min: 1, max: 1000 }, // twiboost #4336, было 16.15/1000 у twiboost
  telegram_умные_просмотры_для_tgstat_и_te: { price1000: 6, min: 1, max: 100000 }, // twiboost #4702, было 4.43/1000 у twiboost
  telegram_просмотры_выбор_скорости_в_мину: { price1000: 6, min: 1, max: 100000 }, // twiboost #4405, было 4.43/1000 у twiboost
  telegram_реакции_с_premium_аккаунтов: { price1000: 149, min: 10, max: 50000 }, // twiboost #4474, было 147.55/1000 у twiboost
  telegram_подписчики_держатся_online: { price1000: 149, min: 100, max: 15000 }, // twiboost #4486, было 147.55/1000 у twiboost
  telegram_просмотры_на_несколько_постов: { price1000: 31, min: 1, max: 150000 }, // twiboost #4732, было 29.51/1000 у twiboost
  telegram_просмотры_таргетированные_низко: { price1000: 2, min: 10, max: 1000000 }, // twiboost #4812, было 0.35/1000 у twiboost
  telegram_просмотры_для_закрытых_каналов__2: { price1000: 31, min: 1, max: 150000 }, // twiboost #4878, было 29.51/1000 у twiboost
  telegram_просмотры_для_закрытых_каналов__3: { price1000: 31, min: 1, max: 150000 }, // twiboost #4887, было 29.51/1000 у twiboost
  telegram_старты_бота_через_поиск_ключевы: { price1000: 61, min: 10, max: 1000000 }, // twiboost #4910, было 59.02/1000 у twiboost
  telegram_premium_старты_бота_через_поиск: { price1000: 724, min: 10, max: 500000 }, // twiboost #4920, было 722.99/1000 у twiboost
  telegram_подписчики_авто_просмотры_росси: { price1000: 72, min: 10, max: 100000 }, // twiboost #5347, было 70.09/1000 у twiboost
  telegram_ии_premium_подписчики: { price1000: 739, min: 500, max: 200000 }, // twiboost #4936, было 737.74/1000 у twiboost
  telegram_подписчики_для_продвижения_груп: { price1000: 1993, min: 1, max: 13000 }, // twiboost #5380, было 1991.91/1000 у twiboost
  telegram_клики_по_рекламе_tg_ads: { price1000: 37, min: 1, max: 50000 }, // twiboost #5021, было 35.41/1000 у twiboost
  telegram_старты_бота_активность: { price1000: 69, min: 10, max: 500000 }, // twiboost #5034, было 67.54/1000 у twiboost
  telegram_подписчики_ru_ua_cn_с_выбором_п: { price1000: 81, min: 1, max: 50000 }, // twiboost #5178, было 79.68/1000 у twiboost
  telegram_реакции_для_закрытых_каналов_ба_2: { price1000: 8, min: 1, max: 50000 }, // twiboost #5221, было 6.64/1000 у twiboost
  telegram_реакции_просмотры: { price1000: 3, min: 1, max: 150000 }, // twiboost #5238, было 1.48/1000 у twiboost
  telegram_старты_приложения_mini_app: { price1000: 2192, min: 10, max: 100000 }, // twiboost #5520, было 2190.66/1000 у twiboost
};

const TWIBOOST_SERVICE_MAP = {
  telegram_голоса_в_опрос: 2812,
  telegram_истории: 3171,
  telegram_premium_старты_бота: 2061,
  telegram_бусты: 4328,
  telegram_подписчики: 3036,
  telegram_репосты: 1527,
  telegram_просмотры: 2735,
  telegram_просмотры_таргетированные_высок: 4210,
  telegram_просмотры_россия_на_несколько_п: 1695,
  telegram_подписчики_россия: 2700,
  telegram_premium_старты_бота_активность: 3051,
  telegram_рефералы_для_ботов: 2224,
  telegram_старты_бота_низкое_качество: 2231,
  telegram_старты_бота_россия: 3917,
  telegram_подписчики_таргетированные: 2595,
  telegram_premium_просмотры_поста_россия: 3165,
  telegram_premium_подписчики_таргетирован: 5270,
  telegram_premium_просмотры_поста_таргети: 2609,
  telegram_premium_старты_бота_таргетирова: 3999,
  telegram_premium_подписчики_1_7_дней_pre: 2667,
  telegram_premium_подписчики_8_14_дней_pr: 4606,
  telegram_старты_бота_высокое_качество_бы: 4604,
  telegram_premium_старты_бота_активность_: 3990,
  telegram_premium_старты_бота_россия: 4007,
  telegram_premium_подписчики_15_30_дней_p: 5026,
  telegram_premium_просмотры_историй: 2690,
  telegram_premium_репосты: 2691,
  telegram_подписчики_арабские: 4419,
  telegram_просмотры_таргетированные_живые: 2746,
  telegram_реакции: 2817,
  telegram_premium_подписчики_россия: 4626,
  telegram_комментарии: 4932,
  telegram_авто_просмотры: 3302,
  telegram_авто_реакции: 3303,
  telegram_premium_просмотры_поста: 4726,
  telegram_premium_подписчики_личная_свежа: 3427,
  telegram_жалобы_на_канал_группу_чат_пост: 5254,
  telegram_старты_бота_высокое_качество_бы_2: 3576,
  telegram_старты_бота_активность_для_выво: 3992,
  telegram_просмотры_для_закрытых_каналов_: 3740,
  telegram_подарки: 3772,
  telegram_подписчики_живые_с_рекламы: 3948,
  telegram_premium_старты_бота_украина: 3988,
  telegram_старты_бота_активность_таргетир: 3995,
  telegram_подписчики_украина: 4699,
  telegram_premium_подписчики_31_день_prem: 4937,
  telegram_premium_подписчики_живые_с_рекл: 4140,
  telegram_реакции_для_закрытых_каналов_ба: 4336,
  telegram_умные_просмотры_для_tgstat_и_te: 4702,
  telegram_просмотры_выбор_скорости_в_мину: 4405,
  telegram_реакции_с_premium_аккаунтов: 4474,
  telegram_подписчики_держатся_online: 4486,
  telegram_просмотры_на_несколько_постов: 4732,
  telegram_просмотры_таргетированные_низко: 4812,
  telegram_просмотры_для_закрытых_каналов__2: 4878,
  telegram_просмотры_для_закрытых_каналов__3: 4887,
  telegram_старты_бота_через_поиск_ключевы: 4910,
  telegram_premium_старты_бота_через_поиск: 4920,
  telegram_подписчики_авто_просмотры_росси: 5347,
  telegram_ии_premium_подписчики: 4936,
  telegram_подписчики_для_продвижения_груп: 5380,
  telegram_клики_по_рекламе_tg_ads: 5021,
  telegram_старты_бота_активность: 5034,
  telegram_подписчики_ru_ua_cn_с_выбором_п: 5178,
  telegram_реакции_для_закрытых_каналов_ба_2: 5221,
  telegram_реакции_просмотры: 5238,
  telegram_старты_приложения_mini_app: 5520,
};

module.exports = { SERVICES, TWIBOOST_SERVICE_MAP };
