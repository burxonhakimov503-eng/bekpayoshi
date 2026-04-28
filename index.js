require('dotenv').config();
const { Telegraf, session, Scenes, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

// Atrof-muhit o'zgaruvchilari
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

if (!BOT_TOKEN) {
    console.error("BOT_TOKEN mavjud emas! Iltimos .env faylini tekshiring.");
    process.exit(1);
}

// Botni initsializatsiya qilish
const bot = new Telegraf(BOT_TOKEN);

// Spamdan himoya tizimi (Rate Limiting)
const userLimits = new Map();
bot.use((ctx, next) => {
    if (!ctx.from) return next();
    const userId = ctx.from.id;
    const now = Date.now();
    const user = userLimits.get(userId) || { count: 0, lastMessage: now };
    
    if (now - user.lastMessage > 2000) {
        user.count = 1;
        user.lastMessage = now;
    } else {
        user.count++;
    }
    userLimits.set(userId, user);
    
    // Agar foydalanuvchi qisqa vaqt ichida juda ko'p xabar yuborsa
    if (user.count > 4) {
        return; 
    }
    return next();
});

// Ma'lumotlar bazasi bilan ishlash (PostgreSQL)
const { Pool } = require('pg');

let pool;
if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
}

let memoryData = { users: [], orders: 0, loads: [] };

// Ma'lumotlarni faylga yozish (zaxira va local test uchun)
const dataFile = path.join(__dirname, 'data.json');

async function initDB() {
    if (!pool) {
        if (fs.existsSync(dataFile)) {
            memoryData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
            if (!memoryData.loads) memoryData.loads = [];
        }
        return;
    }
    
    await pool.query(`
        CREATE TABLE IF NOT EXISTS app_state (
            id SERIAL PRIMARY KEY,
            data JSONB NOT NULL
        );
    `);
    
    const res = await pool.query('SELECT data FROM app_state WHERE id = 1');
    if (res.rows.length > 0) {
        memoryData = res.rows[0].data;
        if (!memoryData.loads) memoryData.loads = [];
    } else {
        await pool.query('INSERT INTO app_state (id, data) VALUES (1, $1)', [memoryData]);
    }
}

// Baza bilan ishlash funksiyalari
function readData() {
    return memoryData;
}

function writeData(data) {
    memoryData = data;
    if (pool) {
        pool.query('UPDATE app_state SET data = $1 WHERE id = 1', [memoryData]).catch(err => console.error("DB yozishda xato:", err));
    } else {
        const tmpFile = dataFile + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
        fs.renameSync(tmpFile, dataFile);
    }
}

function addUser(userId) {
    const data = readData();
    if (!data.users.includes(userId)) {
        data.users.push(userId);
        writeData(data);
    }
}

function addOrder(order) {
    const data = readData();
    data.orders += 1;
    data.loads.push(order);
    writeData(data);
}

// --- Joylashuv ma'lumotlari strukturalangan ---
const locationsData = {
    "O'zbekiston": [
        "Toshkent shahar",
        "Toshkent viloyati",
        "Qoraqalpog'iston",
        "Samarqand",
        "Andijon",
        "Buxoro",
        "Farg'ona",
        "Jizzax",
        "Xorazm",
        "Namangan",
        "Navoiy",
        "Qashqadaryo",
        "Surxondaryo",
        "Sirdaryo"
    ],
    "Rossiya": [
        "Moskva", "Sankt-Peterburg", "Moskva viloyati", "Leningrad viloyati", 
        "Tatariston Respublikasi", "Boshqirdiston Respublikasi", "Krasnodar oʻlkasi", 
        "Rostov viloyati", "Sverdlovsk viloyati", "Novosibirsk viloyati", 
        "Samara viloyati", "Chelyabinsk viloyati"
    ],
    "Qozog'iston": [
        "Astana", "Olmaota", "Olmaota viloyati", "Turkiston viloyati", 
        "Chimkent shahri", "Qaragʻanda viloyati", "Aqtobe viloyati", 
        "Atyrau viloyati", "Mangʻistau viloyati", "Sharqiy Qozogʻiston viloyati"
    ],
    "Turkmaniston": [
        "Ashxobod", "Ahal viloyati", "Balkan viloyati", 
        "Dashoguz viloyati", "Lebap viloyati", "Mary viloyati"
    ],
    "Qirg'iziston": [
        "Bishkek", "Oʻsh", "Chuy viloyati", "Oʻsh viloyati", 
        "Jalolobod viloyati", "Issiqkoʻl viloyati", "Norin viloyati", "Talas viloyati"
    ],
    "Tojikiston": [
        "Dushanbe", "Sugʻd viloyati", "Xatlon viloyati"
    ],
    "Xitoy": ["Pekin", "Shanxay", "Guanchjou", "Urumchi"]
};

// Joylashuv tugmalarini yaratish yordamchi funksiyalari
function getCountryKeyboard(prefix) {
    const countries = Object.keys(locationsData);
    const buttons = [];
    for (let i = 0; i < countries.length; i += 2) {
        const row = [];
        row.push(Markup.button.callback(countries[i], `${prefix}_c_${countries[i]}`));
        if (countries[i+1]) {
            row.push(Markup.button.callback(countries[i+1], `${prefix}_c_${countries[i+1]}`));
        }
        buttons.push(row);
    }
    return Markup.inlineKeyboard(buttons);
}

function getRegionKeyboard(prefix, country) {
    const regions = locationsData[country] || [];
    const buttons = [];
    for (let i = 0; i < regions.length; i += 2) {
        const row = [];
        row.push(Markup.button.callback(regions[i], `${prefix}_r_${country}_${regions[i]}`));
        if (regions[i+1]) {
            row.push(Markup.button.callback(regions[i+1], `${prefix}_r_${country}_${regions[i+1]}`));
        }
        buttons.push(row);
    }
    buttons.push([Markup.button.callback("⬅️ Ortga", `${prefix}_back_country`)]);
    return Markup.inlineKeyboard(buttons);
}

// Xavfsizlik: HTML belgilarni tozalash (XSS himoya)
function escapeHTML(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Yordamchi funksiya: yuk ma'lumotini chiroyli formatlash
function formatLoadText(order, title) {
    const phone = (order.telefon || '').startsWith('+') ? order.telefon : '+' + order.telefon;
    return `
${title}

📍 Qayerdan: ${escapeHTML(order.qayerdan)}
🏁 Qayerga: ${escapeHTML(order.qayerga)}
🚛 Transport turi: ${escapeHTML(order.mashina_turi)}
📦 Yuk turi: ${escapeHTML(order.yuk_turi)}
⚖️ Og'irligi va hajmi: ${escapeHTML(order.hajm_ogirlik)}
💰 Narx: ${escapeHTML(order.narx)}
💳 To'lov turi: ${escapeHTML(order.tolov_turi)}
📞 Aloqa: <a href="tel:${escapeHTML(phone)}">${escapeHTML(phone)}</a>
    `;
}

// ----- SCENE (SO'ROVNOMA QADAMLARI) -----
const orderWizard = new Scenes.WizardScene(
    'ORDER_WIZARD',
    
    // Qadam 0: Yuk turini so'rash
    async (ctx) => {
        ctx.wizard.state.order = {};
        await ctx.reply("1️⃣ Iltimos, yukingiz turini yozing (masalan: Qurilish mollari, Mebel):", Markup.removeKeyboard());
        return ctx.wizard.next(); // cursor -> 1
    },

    // Qadam 1: Yuk turini qabul qilish va Qayerdan so'rash
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) {
            await ctx.reply("Iltimos, yozma ravishda yuk turini kiriting.");
            return;
        }
        ctx.wizard.state.order.yuk_turi = ctx.message.text;
        await ctx.reply("2️⃣ Qayerdan yuklanadi? Davlatni tanlang:", getCountryKeyboard('from'));
        return ctx.wizard.next(); // cursor -> 2
    },

    // Qadam 2: Qayerdan kutish (faqat callback orqali o'tiladi)
    async (ctx) => {
        if (ctx.message) {
            await ctx.reply("⚠️ Iltimos, faqat tugmalardan foydalaning!");
        }
        return;
    },

    // Qadam 3: Qayerga kutish (faqat callback orqali o'tiladi)
    async (ctx) => {
        if (ctx.message) {
            await ctx.reply("⚠️ Iltimos, faqat tugmalardan foydalaning!");
        }
        return;
    },

    // Qadam 4: Hajm va og'irlik kutish
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) {
            await ctx.reply("Iltimos, yozma ravishda og'irlik va hajmni kiriting.");
            return;
        }
        ctx.wizard.state.order.hajm_ogirlik = ctx.message.text;
        
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("Fura", "car_Fura"), Markup.button.callback("Isuzu 5t", "car_Isuzu 5t")],
            [Markup.button.callback("Isuzu 10t", "car_Isuzu 10t"), Markup.button.callback("Chakman", "car_Chakman")],
            [Markup.button.callback("Fura Tent", "car_Fura Tent"), Markup.button.callback("Fura Ref", "car_Fura Ref")],
            [Markup.button.callback("Boshqa", "car_Boshqa")]
        ]);
        await ctx.reply("5️⃣ Qanday turdagi mashina kerak?", keyboard);
        return ctx.wizard.next(); // cursor -> 5
    },

    // Qadam 5: Mashina turi kutish (faqat callback orqali)
    async (ctx) => {
        if (ctx.message) {
            await ctx.reply("⚠️ Iltimos, faqat tugmalardan foydalaning!");
        }
        return;
    },

    // Qadam 6: Sana kutish (faqat callback orqali)
    async (ctx) => {
        if (ctx.message) {
            await ctx.reply("⚠️ Iltimos, faqat tugmalardan foydalaning!");
        }
        return;
    },

    // Qadam 7: To'lov turi kutish (faqat callback orqali)
    async (ctx) => {
        if (ctx.message) {
            await ctx.reply("⚠️ Iltimos, faqat tugmalardan foydalaning!");
        }
        return;
    },

    // Qadam 8: Narx kutish (callback yoki text)
    async (ctx) => {
        if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith('price_')) {
             ctx.wizard.state.order.narx = "Kelishiladi";
             await ctx.answerCbQuery();
        } else if (ctx.message && ctx.message.text) {
             ctx.wizard.state.order.narx = ctx.message.text;
        } else {
             await ctx.reply("Iltimos faqat to'g'ri tugmani bosing yoki yozing.");
             return;
        }

        const contactKeyboard = Markup.keyboard([
            [Markup.button.contactRequest("📞 Telefon raqamni jo'natish")]
        ]).resize().oneTime();

        await ctx.reply("✅ Va nihoyat, telefon raqamingizni yuboring (faqat tugma orqali):", contactKeyboard);
        return ctx.wizard.next(); // cursor -> 9
    },

    // Qadam 9: Telefon raqamni saqlash va adminga jo'natish
    async (ctx) => {
        if (!ctx.message || !ctx.message.contact) {
            await ctx.reply("⚠️ Iltimos, pastdagi '📞 Telefon raqamni jo'natish' tugmasi orqali raqamingizni yuboring, yozib yuborish qabul qilinmaydi!");
            return;
        }

        ctx.wizard.state.order.telefon = ctx.message.contact.phone_number;
        ctx.wizard.state.order.buyurtmachi_id = ctx.from.id;
        ctx.wizard.state.order.id = Date.now().toString();
        ctx.wizard.state.order.broadcasts = [];
        
        const order = ctx.wizard.state.order;

        // Yukni bazaga qo'shish
        addOrder(order);

        // Formatlangan matn
        const loadText = formatLoadText(order, "🔥 DIQQAT YUK !");
        const inlineKeyboard = Markup.inlineKeyboard([
            [Markup.button.url("💬 Telegram orqali yozish", `tg://user?id=${ctx.from.id}`)]
        ]);

        // Barcha haydovchilarga yuborish va admin uchun xabar ID larni saqlash
        const data = readData();
        const promises = [];

        // Adminga xabar jo'natish
        if (ADMIN_CHAT_ID) {
            promises.push(
                bot.telegram.sendMessage(ADMIN_CHAT_ID, loadText, { parse_mode: 'HTML', ...inlineKeyboard })
                    .then(msg => ({ chat_id: ADMIN_CHAT_ID, message_id: msg.message_id }))
                    .catch(err => null)
            );
        }

        // Boshqa foydalanuvchilarga yuborish
        for (const userId of data.users) {
            if (userId !== ctx.from.id) {
                promises.push(
                    bot.telegram.sendMessage(userId, loadText, { parse_mode: 'HTML', ...inlineKeyboard })
                        .then(msg => ({ chat_id: userId, message_id: msg.message_id }))
                        .catch(e => null)
                );
            }
        }

        Promise.all(promises).then(results => {
            const validBroadcasts = results.filter(r => r !== null);
            if (validBroadcasts.length > 0) {
                const currentData = readData();
                const targetOrder = currentData.loads.find(l => l.id === order.id);
                if (targetOrder) {
                    if (!targetOrder.broadcasts) targetOrder.broadcasts = [];
                    targetOrder.broadcasts.push(...validBroadcasts);
                    writeData(currentData);
                }
            }
        });

        await ctx.reply("✅ Buyurtmangiz qabul qilindi va barcha haydovchilarga yuborildi. Tez orada siz bilan bog'lanishadi!", Markup.removeKeyboard());
        
        // Bosh menyuga qaytish
        const menuKeyboard = Markup.keyboard([
            ['📦 Yuk joylash', '🔍 Yuk topish'],
            ['❌ Yukni bekor qilish']
        ]).resize();
        await ctx.reply("Yana yuk joylash uchun pastdagi tugmani bosing.", menuKeyboard);
        
        return ctx.scene.leave();
    }
);

// Joylashuv Inline tugmalari navigatsiyasi (FROM)
orderWizard.action(/from_c_(.+)/, async (ctx) => {
    const country = ctx.match[1];
    await ctx.editMessageText(`Siz tanladingiz: ${country}\nEndi viloyatni tanlang:`, getRegionKeyboard('from', country));
});
orderWizard.action(/from_back_country/, async (ctx) => {
    await ctx.editMessageText("Qayerdan yuklanadi? Davlatni tanlang:", getCountryKeyboard('from'));
});
// Yakuniy FROM tanlovi
orderWizard.action(/from_r_(.+)_(.+)/, async (ctx) => {
    if (ctx.wizard.cursor !== 2) return;
    const country = ctx.match[1];
    const region = ctx.match[2];
    ctx.wizard.state.order.qayerdan = `${country}, ${region}`;
    await ctx.editMessageText(`✅ Saqlandi: ${ctx.wizard.state.order.qayerdan}`);
    
    // Keyingi savol (TO)
    await ctx.reply("3️⃣ Qayerga yetkazilishi kerak? Davlatni tanlang:", getCountryKeyboard('to'));
    ctx.wizard.next(); // cursor -> 3
});

// Joylashuv Inline tugmalari navigatsiyasi (TO)
orderWizard.action(/to_c_(.+)/, async (ctx) => {
    const country = ctx.match[1];
    await ctx.editMessageText(`Siz tanladingiz: ${country}\nEndi viloyatni tanlang:`, getRegionKeyboard('to', country));
});
orderWizard.action(/to_back_country/, async (ctx) => {
    await ctx.editMessageText("Qayerga yetkazilishi kerak? Davlatni tanlang:", getCountryKeyboard('to'));
});
// Yakuniy TO tanlovi
orderWizard.action(/to_r_(.+)_(.+)/, async (ctx) => {
    if (ctx.wizard.cursor !== 3) return;
    const country = ctx.match[1];
    const region = ctx.match[2];
    ctx.wizard.state.order.qayerga = `${country}, ${region}`;
    await ctx.editMessageText(`✅ Saqlandi: ${ctx.wizard.state.order.qayerga}`);
    
    // Keyingi savol
    await ctx.reply("4️⃣ Yukning taxminiy og'irligi va hajmini yozing (masalan: 20 tonna, 80 kub):");
    ctx.wizard.next(); // cursor -> 4
});

// Mashina turi tanlovi
orderWizard.action(/car_(.+)/, async (ctx) => {
    if (ctx.wizard.cursor !== 5) return;
    ctx.wizard.state.order.mashina_turi = ctx.match[1];
    await ctx.editMessageText(`✅ Mashina turi tanlandi: ${ctx.match[1]}`);
    
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("Bugun", "date_Bugun"), Markup.button.callback("Ertaga", "date_Ertaga")],
        [Markup.button.callback("Indinga", "date_Indinga"), Markup.button.callback("Yuklashga tayyor", "date_Tayyor")]
    ]);
    await ctx.reply("6️⃣ Yuklanish sanasini tanlang:", keyboard);
    ctx.wizard.next(); // cursor -> 6
});

// Sana tanlovi
orderWizard.action(/date_(.+)/, async (ctx) => {
    if (ctx.wizard.cursor !== 6) return;
    ctx.wizard.state.order.sana = ctx.match[1];
    await ctx.editMessageText(`✅ Sana tanlandi: ${ctx.match[1]}`);
    
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("Naqd", "pay_Naqd"), Markup.button.callback("Kartaga", "pay_Kartaga")]
    ]);
    await ctx.reply("7️⃣ To'lov turini tanlang:", keyboard);
    ctx.wizard.next(); // cursor -> 7
});

// To'lov turi tanlovi
orderWizard.action(/pay_(.+)/, async (ctx) => {
    if (ctx.wizard.cursor !== 7) return;
    ctx.wizard.state.order.tolov_turi = ctx.match[1];
    await ctx.editMessageText(`✅ To'lov turi tanlandi: ${ctx.match[1]}`);
    
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("Narx kelishiladi", "price_Kelishiladi")]
    ]);
    await ctx.reply("8️⃣ Necha pul berishini yozing yoki tugmani bosing:", keyboard);
    ctx.wizard.next(); // cursor -> 8
});


// ----- SCENE (YUK QIDIRISH) -----
const searchWizard = new Scenes.WizardScene(
    'SEARCH_WIZARD',
    async (ctx) => {
        ctx.wizard.state.search = {};
        await ctx.reply("1️⃣ Qayerdan yuk olib ketmoqchisiz? Davlatni tanlang:", getCountryKeyboard('sfrom'));
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message) await ctx.reply("⚠️ Iltimos, faqat tugmalardan foydalaning!");
        return;
    },
    async (ctx) => {
        if (ctx.message) await ctx.reply("⚠️ Iltimos, faqat tugmalardan foydalaning!");
        return;
    }
);

// Search FROM
searchWizard.action(/sfrom_c_(.+)/, async (ctx) => {
    const country = ctx.match[1];
    await ctx.editMessageText(`Siz tanladingiz: ${country}\nEndi viloyatni tanlang:`, getRegionKeyboard('sfrom', country));
});
searchWizard.action(/sfrom_back_country/, async (ctx) => {
    await ctx.editMessageText("Qayerdan yuk olib ketmoqchisiz? Davlatni tanlang:", getCountryKeyboard('sfrom'));
});
searchWizard.action(/sfrom_r_(.+)_(.+)/, async (ctx) => {
    if (ctx.wizard.cursor !== 1) return;
    const country = ctx.match[1];
    const region = ctx.match[2];
    ctx.wizard.state.search.qayerdan = `${country}, ${region}`;
    await ctx.editMessageText(`✅ Saqlandi: ${ctx.wizard.state.search.qayerdan}`);
    
    await ctx.reply("2️⃣ Qayerga bormoqchisiz? Davlatni tanlang:", getCountryKeyboard('sto'));
    ctx.wizard.next();
});

// Search TO
searchWizard.action(/sto_c_(.+)/, async (ctx) => {
    const country = ctx.match[1];
    await ctx.editMessageText(`Siz tanladingiz: ${country}\nEndi viloyatni tanlang:`, getRegionKeyboard('sto', country));
});
searchWizard.action(/sto_back_country/, async (ctx) => {
    await ctx.editMessageText("Qayerga bormoqchisiz? Davlatni tanlang:", getCountryKeyboard('sto'));
});
searchWizard.action(/sto_r_(.+)_(.+)/, async (ctx) => {
    if (ctx.wizard.cursor !== 2) return;
    const country = ctx.match[1];
    const region = ctx.match[2];
    ctx.wizard.state.search.qayerga = `${country}, ${region}`;
    await ctx.editMessageText(`✅ Saqlandi: ${ctx.wizard.state.search.qayerga}`);
    
    // Qidirish logikasi
    const { qayerdan, qayerga } = ctx.wizard.state.search;
    const data = readData();
    const loads = data.loads || [];
    
    const matchingLoads = loads.filter(l => l.qayerdan === qayerdan && l.qayerga === qayerga);
    
    const resultsToTrack = [];
    
    if (matchingLoads.length > 0) {
        await ctx.reply(`✅ Aynan shu yo'nalishda ${matchingLoads.length} ta yuk topildi:`);
        for (const l of matchingLoads.slice(-5)) { // Oxirgi 5 tasini ko'rsatamiz
            const text = formatLoadText(l, "🟢 FAOL YUK");
            const kb = Markup.inlineKeyboard([[Markup.button.url("💬 Telegram orqali yozish", `tg://user?id=${l.buyurtmachi_id}`)]]);
            const msg = await ctx.reply(text, { parse_mode: 'HTML', ...kb });
            resultsToTrack.push({ loadId: l.id, chatId: ctx.from.id, msgId: msg.message_id });
        }
    } else {
        await ctx.reply(`Afsuski, aynan siz qidirgan ${qayerdan} -> ${qayerga} yo'nalishida hozircha yuk topilmadi.\n\nBoshqa yo'nalishlardagi so'nggi yuklar:`);
        const recentLoads = loads.slice(-5);
        if (recentLoads.length === 0) {
            await ctx.reply("Hozircha tizimda hech qanday yuk yo'q.");
        } else {
            for (const l of recentLoads) {
                const text = formatLoadText(l, "🟢 FAOL YUK");
                const kb = Markup.inlineKeyboard([[Markup.button.url("💬 Telegram orqali yozish", `tg://user?id=${l.buyurtmachi_id}`)]]);
                const msg = await ctx.reply(text, { parse_mode: 'HTML', ...kb });
                resultsToTrack.push({ loadId: l.id, chatId: ctx.from.id, msgId: msg.message_id });
            }
        }
    }
    
    if (resultsToTrack.length > 0) {
        const currentData = readData();
        for (const res of resultsToTrack) {
            const targetOrder = currentData.loads.find(l => l.id === res.loadId);
            if (targetOrder) {
                if (!targetOrder.broadcasts) targetOrder.broadcasts = [];
                targetOrder.broadcasts.push({ chat_id: res.chatId, message_id: res.msgId });
            }
        }
        writeData(currentData);
    }
    
    const menuKeyboard = Markup.keyboard([
        ['📦 Yuk joylash', '🔍 Yuk topish'],
        ['❌ Yukni bekor qilish']
    ]).resize();
    await ctx.reply("Bosh menyu:", menuKeyboard);
    return ctx.scene.leave();
});

const stage = new Scenes.Stage([orderWizard, searchWizard]);
bot.use(session());
// /start komandasi sahnadan oldin ushlanadi, bu so'rovnomalarni to'xtatadi
bot.start((ctx) => {
    ctx.session = null; // Sahnadan va keshdan chiqarib yuborish
    addUser(ctx.from.id);
    const userName = ctx.from.first_name || 'Foydalanuvchi';
    const menuKeyboard = Markup.keyboard([
        ['📦 Yuk joylash', '🔍 Yuk topish'],
        ['❌ Yukni bekor qilish']
    ]).resize();

    ctx.reply(`Salom, ${userName}! Logistika botimizga xush kelibsiz.\nQuyidagi menyudan kerakli bo'limni tanlang:`, menuKeyboard);
});

bot.use(stage.middleware());

// /statistika komandasi
bot.command('statistika', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_CHAT_ID) {
        return ctx.reply("⛔ Kechirasiz, siz admin emassiz.");
    }
    
    const data = readData();
    const text = `
📊 <b>Bot Statistikasi</b>

👥 <b>Jami foydalanuvchilar:</b> ${data.users.length} ta
📦 <b>Jami buyurtmalar:</b> ${data.orders} ta
    `;
    ctx.reply(text, { parse_mode: 'HTML' });
});

// Yuk joylash tugmasi
bot.hears('📦 Yuk joylash', (ctx) => {
    ctx.scene.enter('ORDER_WIZARD');
});

// Yuk topish tugmasi
bot.hears('🔍 Yuk topish', (ctx) => {
    ctx.scene.enter('SEARCH_WIZARD');
});

// Global Xatoliklarni ushlash
bot.catch((err, ctx) => {
    console.error(`Xatolik yuz berdi ${ctx.updateType}`, err);
});

// Yukni bekor qilish tugmasi
bot.hears('❌ Yukni bekor qilish', async (ctx) => {
    const data = readData();
    const myLoads = data.loads.filter(l => l.buyurtmachi_id === ctx.from.id);
    if (myLoads.length === 0) {
        return ctx.reply("Sizda hozircha faol yuklar yo'q.");
    }
    await ctx.reply("Sizning faol yuklaringiz. O'chirish uchun '❌ Tugatish' ni bosing:");
    for (const load of myLoads) {
        const text = formatLoadText(load, "🟢 FAOL YUK");
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("❌ Tugatish", `cancel_load_${load.id}`)]
        ]);
        await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }
});

bot.action(/cancel_load_(.+)/, async (ctx) => {
    const loadId = ctx.match[1];
    const data = readData();
    const loadIndex = data.loads.findIndex(l => l.id === loadId);
    
    if (loadIndex === -1) {
        return ctx.answerCbQuery("Bu yuk allaqachon bekor qilingan yoki topilmadi.", { show_alert: true });
    }
    
    const load = data.loads[loadIndex];
    if (load.buyurtmachi_id !== ctx.from.id) {
        return ctx.answerCbQuery("Siz bu yukni bekor qila olmaysiz!", { show_alert: true });
    }
    
    // Habarlarni hamma chatlardan o'chirish
    if (load.broadcasts) {
        for (const b of load.broadcasts) {
            try {
                await bot.telegram.deleteMessage(b.chat_id, b.message_id);
            } catch(e) {}
        }
    }
    
    // Baza dan o'chirish
    data.loads.splice(loadIndex, 1);
    writeData(data);
    
    await ctx.editMessageText("✅ Bu yuk muvaffaqiyatli bekor qilindi va barcha chatlardan o'chirildi.");
    ctx.answerCbQuery("Yuk o'chirildi.");
});
// Botni ishga tushirish
initDB().then(() => {
    bot.launch().then(async () => {
        console.log("Bot muvaffaqiyatli ishga tushdi!");
    try {
        // Hamma uchun komandalar
        await bot.telegram.setMyCommands([
            { command: 'start', description: 'Botni ishga tushirish' }
        ]);
        
        // Faqat admin uchun komandalar
        if (ADMIN_CHAT_ID) {
            await bot.telegram.setMyCommands([
                { command: 'start', description: 'Botni ishga tushirish' },
                { command: 'statistika', description: 'Bot statistikasi' }
            ], { scope: { type: 'chat', chat_id: ADMIN_CHAT_ID } });
        }
    } catch (err) {
        console.error("Komandalarni o'rnatishda xatolik:", err);
    }
});
});

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
