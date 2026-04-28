require('dotenv').config();
const { Telegraf, Markup, session, Scenes } = require('telegraf');
const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const multer = require('multer');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
// Note: express.json() only for non-multipart routes
const PORT = process.env.PORT || 3000;

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });
app.use('/uploads', express.static('uploads'));
let webAppUrl = ''; 

// --- DATABASE SETUP ---
const usersFile = path.join(__dirname, 'users.json');
let userPhones = {};
if (fs.existsSync(usersFile)) {
    userPhones = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
}
function saveUsers() {
    fs.writeFileSync(usersFile, JSON.stringify(userPhones, null, 2));
}

const productsFile = path.join(__dirname, 'products.json');
let products = [];
if (fs.existsSync(productsFile)) {
    products = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
}
function saveProducts() {
    fs.writeFileSync(productsFile, JSON.stringify(products, null, 2));
}

// --- PROMO IMAGES ---
const promoFile = path.join(__dirname, 'promo.json');
let promoImages = [];
if (fs.existsSync(promoFile)) {
    promoImages = JSON.parse(fs.readFileSync(promoFile, 'utf8'));
}
function savePromoImages() {
    fs.writeFileSync(promoFile, JSON.stringify(promoImages, null, 2));
}

// --- NEWS SETUP ---
const newsFile = path.join(__dirname, 'news.json');
let news = [];
if (fs.existsSync(newsFile)) {
    news = JSON.parse(fs.readFileSync(newsFile, 'utf8'));
}
function saveNews() {
    fs.writeFileSync(newsFile, JSON.stringify(news, null, 2));
}

// --- ORDERS SETUP ---
const ordersFile = path.join(__dirname, 'orders.json');
let orders = [];
if (fs.existsSync(ordersFile)) {
    orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
}
function saveOrders() {
    fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
}

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ ok: true, products: products.length, promo: promoImages.length });
});

// --- EXPRESS SERVER ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'webapp.html'));
});

// API endpoint for WebApp to load products
app.get('/api/products', (req, res) => {
    res.json(products);
});

// Proxy for Telegram images to hide Bot Token from frontend
app.get('/api/image/:file_id', async (req, res) => {
    try {
        const fileUrl = await bot.telegram.getFileLink(req.params.file_id);
        https.get(fileUrl, (response) => {
            res.setHeader('Content-Type', 'image/jpeg');
            response.pipe(res);
        });
    } catch(e) {
        res.status(404).send('Not found');
    }
});

// Promo slides API — mini app tomonidan chaqiriladi
app.get('/api/promo', (req, res) => {
    const result = promoImages.map(p => ({
        image: p.image_file_id ? '/api/image/' + p.image_file_id : p.image_url
    }));
    res.json(result);
});

// Bot avatar proxy
app.get('/api/bot-avatar', async (req, res) => {
    try {
        const me = await bot.telegram.getMe();
        const photos = await bot.telegram.getUserProfilePhotos(me.id);
        if (photos.total_count > 0) {
            const fileId = photos.photos[0][photos.photos[0].length - 1].file_id;
            const fileUrl = await bot.telegram.getFileLink(fileId);
            const url = typeof fileUrl === 'string' ? fileUrl : fileUrl.href;
            https.get(url, (response) => {
                res.setHeader('Content-Type', 'image/jpeg');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                response.pipe(res);
            }).on('error', () => res.status(404).send('No avatar'));
        } else {
            res.status(404).send('No avatar');
        }
    } catch(e) {
        console.error('Bot avatar xatosi:', e.message);
        res.status(404).send('Error');
    }
});

// Upload promo image API
app.post('/api/upload-promo', upload.single('photo'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');
    const imageUrl = '/uploads/' + req.file.filename;
    promoImages.push({ image_file_id: null, image_url: imageUrl });
    savePromoImages();
    res.json({ success: true, imageUrl });
});

// Admin: Delete promo image
app.delete('/api/admin/delete-promo/:index', (req, res) => {
    const index = parseInt(req.params.index);
    if (index >= 0 && index < promoImages.length) {
        promoImages.splice(index, 1);
        savePromoImages();
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: 'Not found' });
    }
});

// Admin: Add product
app.post('/api/admin/add-product', upload.single('photo'), (req, res) => {
    try {
        const name = req.body.name;
        const price = req.body.price;
        const category = req.body.category;
        const desc = req.body.desc || '';
        const imageUrl = req.file ? '/uploads/' + req.file.filename : null;

        if (!name || !price || !category || !imageUrl) {
            console.log('Missing fields:', { name, price, category, imageUrl, file: !!req.file });
            return res.status(400).json({ success: false, message: 'Barcha maydonlarni to\'ldiring!' });
        }

        const newProduct = {
            id: Date.now().toString(),
            name,
            price: parseInt(price),
            category,
            desc,
            image_file_id: null,
            image_url: imageUrl
        };
        products.push(newProduct);
        saveProducts();
        console.log('Product added:', newProduct.name);
        res.json({ success: true, product: newProduct });
    } catch (err) {
        console.error('Add product error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Admin: Delete product
app.delete('/api/admin/delete-product/:id', (req, res) => {
    products = products.filter(p => p.id !== req.params.id);
    saveProducts();
    res.json({ success: true });
});

// Orders API for specific user
app.get('/api/orders/:user_id', (req, res) => {
    const user_id = req.params.user_id;
    const userOrders = orders.filter(o => o.user_id.toString() === user_id.toString());
    res.json(userOrders);
});

// Admin Analytics API
app.get('/api/admin/stats', (req, res) => {
    try {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay())).getTime();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

        const totalUsers = Object.keys(userPhones).length;
        const totalOrders = orders.length;
        
        let totalRevenue = 0;
        let todayRevenue = 0, todayOrders = 0;
        let weekRevenue = 0, weekOrders = 0;
        let monthRevenue = 0, monthOrders = 0;

        const productSales = {};
        const hourlyStats = Array(24).fill(0);

        orders.forEach(order => {
            const orderTime = new Date(order.date).getTime();
            const orderTotal = parseInt(order.total) || 0;
            
            totalRevenue += orderTotal;

            // Time-based stats
            if (orderTime >= today) { todayRevenue += orderTotal; todayOrders++; }
            if (orderTime >= startOfWeek) { weekRevenue += orderTotal; weekOrders++; }
            if (orderTime >= startOfMonth) { monthRevenue += orderTotal; monthOrders++; }

            // Product aggregation
            order.items.forEach(item => {
                productSales[item.name] = (productSales[item.name] || 0) + (parseInt(item.quantity) || 0);
            });

            // Hourly distribution
            const hour = new Date(order.date).getHours();
            hourlyStats[hour]++;
        });

        const topProducts = Object.entries(productSales)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }));

        res.json({
            success: true,
            totalUsers,
            totalOrders,
            totalRevenue,
            periods: {
                today: { revenue: todayRevenue, count: todayOrders },
                week: { revenue: weekRevenue, count: weekOrders },
                month: { revenue: monthRevenue, count: monthOrders }
            },
            topProducts,
            hourlyStats,
            recentOrders: orders.slice(0, 10)
        });
    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Admin: Add News
app.post('/api/admin/add-news', upload.single('photo'), (req, res) => {
    const { title, text } = req.body;
    const imageUrl = req.file ? '/uploads/' + req.file.filename : null;

    const newNews = {
        id: Date.now().toString(),
        title,
        text,
        image_url: imageUrl,
        date: new Date().toISOString()
    };
    news.unshift(newNews);
    saveNews();
    res.json({ success: true, news: newNews });
});

// Admin: Delete News
app.delete('/api/admin/delete-news/:id', (req, res) => {
    news = news.filter(n => n.id !== req.params.id);
    saveNews();
    res.json({ success: true });
});

function startTunnel() {
    console.log('HTTPS Tunnel yaratilmoqda...');
    
    const tunnel = spawn('ssh', [
        '-R', '80:localhost:3000', 
        'nokey@localhost.run', 
        '-T', 
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ServerAliveInterval=60'
    ]);
    
    tunnel.stdout.on('data', (data) => extractUrl(data.toString()));
    tunnel.stderr.on('data', (data) => extractUrl(data.toString()));

    function extractUrl(text) {
        const match = text.match(/https:\/\/[a-zA-Z0-9.-]+\.lhr\.life/);
        if (match && webAppUrl !== match[0]) {
            webAppUrl = match[0];
            console.log(`\n✅ WEBAPP TAYYOR! Manzil: ${webAppUrl}\n`);
            console.log('Menu button yangilanmoqda...');
            bot.telegram.setChatMenuButton({
                menu_button: { type: 'web_app', text: '🍽 Menyu', web_app: { url: webAppUrl } }
            }).then(() => {
                console.log("✅ Menu button muvaffaqiyatli yangilandi!");
            }).catch(err => console.log("❌ Menu button yangilashda xato:", err.message));
        }
    }

    tunnel.on('close', (code) => {
        console.log(`Tunnel uzildi (kod: ${code}). 5 soniyadan so'ng qayta ulanadi...`);
        setTimeout(startTunnel, 5000);
    });
}

app.listen(PORT, () => {
    console.log(`Web server running on port ${PORT}`);
    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        webAppUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
        console.log(`\n✅ RAILWAY WEBAPP TAYYOR! Manzil: ${webAppUrl}\n`);
        bot.telegram.setChatMenuButton({
            menu_button: { type: 'web_app', text: '🍽 Menyu', web_app: { url: webAppUrl } }
        }).then(() => {
            console.log("✅ Menu button muvaffaqiyatli yangilandi!");
        }).catch(err => console.log("❌ Menu button yangilashda xato:", err.message));
    } else {
        startTunnel();
    }
});

// --- ADMIN SCENES ---
const addMenuWizard = new Scenes.WizardScene(
    'ADD_MENU_WIZARD',
    (ctx) => {
        ctx.wizard.state.product = {};
        ctx.reply("📸 Yangi taom rasmini yuboring (Bekor qilish uchun /cancel):", Markup.removeKeyboard());
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === '/cancel') return cancelScene(ctx);
        if (!ctx.message || !ctx.message.photo) return ctx.reply("Iltimos, faqat rasm yuboring!");
        
        ctx.wizard.state.product.image_file_id = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        ctx.reply("📝 Taom nomini yozing (Masalan: To'y oshi):");
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === '/cancel') return cancelScene(ctx);
        if (!ctx.message || !ctx.message.text) return ctx.reply("Iltimos, matn yozing!");
        
        ctx.wizard.state.product.name = ctx.message.text;
        ctx.reply("💰 Narxini yozing (faqat raqam bilan, masalan: 45000):");
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === '/cancel') return cancelScene(ctx);
        if (!ctx.message || !ctx.message.text || isNaN(ctx.message.text)) return ctx.reply("Iltimos, faqat raqam yozing (masalan: 45000):");
        
        ctx.wizard.state.product.price = parseInt(ctx.message.text);
        
        ctx.reply("📂 Kategoriyani tanlang:", Markup.keyboard([
            ['Osh', 'Salatlar'],
            ['Ichimliklar', "Qo'shimcha"]
        ]).resize().oneTime());
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === '/cancel') return cancelScene(ctx);
        if (!ctx.message || !ctx.message.text) return ctx.reply("Kategoriyani tanlang!");
        
        ctx.wizard.state.product.category = ctx.message.text;
        ctx.reply("ℹ️ Taom haqida qisqacha izoh yozing:", Markup.removeKeyboard());
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.message && ctx.message.text === '/cancel') return cancelScene(ctx);
        if (!ctx.message || !ctx.message.text) return ctx.reply("Iltimos, izoh yozing!");
        
        ctx.wizard.state.product.desc = ctx.message.text;
        
        // DB ga saqlash
        const newProduct = {
            id: Date.now().toString(),
            category: ctx.wizard.state.product.category,
            name: ctx.wizard.state.product.name,
            price: ctx.wizard.state.product.price,
            desc: ctx.wizard.state.product.desc,
            image_file_id: ctx.wizard.state.product.image_file_id
        };
        products.push(newProduct);
        saveProducts();
        
        ctx.reply(`✅ <b>${newProduct.name}</b> muvaffaqiyatli menyuga qo'shildi va WebApp da darhol paydo bo'ldi!`, { parse_mode: 'HTML' });
        
        // Admin menyuni qaytarish
        ctx.reply("Admin menyusi:", Markup.inlineKeyboard([
            [Markup.button.callback("📜 Menular", "admin_menus"), Markup.button.callback("➕ Yangi menu", "admin_add_menu")]
        ]));
        
        return ctx.scene.leave();
    }
);

function cancelScene(ctx) {
    ctx.reply("❌ Jarayon bekor qilindi.", Markup.inlineKeyboard([
        [Markup.button.callback("📜 Menular", "admin_menus"), Markup.button.callback("➕ Yangi menu", "admin_add_menu")]
    ]));
    return ctx.scene.leave();
}

// Edit Price Scene
const editPriceWizard = new Scenes.WizardScene(
    'EDIT_PRICE_WIZARD',
    (ctx) => {
        ctx.reply("Yangi narxni yozing (faqat raqam):");
        return ctx.wizard.next();
    },
    (ctx) => {
        if (!ctx.message || !ctx.message.text || isNaN(ctx.message.text)) return ctx.reply("Faqat raqam yozing!");
        const newPrice = parseInt(ctx.message.text);
        const productId = ctx.scene.state.productId;
        
        const index = products.findIndex(p => p.id === productId);
        if (index !== -1) {
            products[index].price = newPrice;
            saveProducts();
            ctx.reply(`✅ Narx yangilandi: ${newPrice} UZS`);
        } else {
            ctx.reply("Mahsulot topilmadi.");
        }
        return ctx.scene.leave();
    }
);

const stage = new Scenes.Stage([addMenuWizard, editPriceWizard]);
bot.use(session());
bot.use(stage.middleware());

// --- ADMIN COMMANDS ---
bot.command('admin', (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return ctx.reply("Siz admin emassiz!");
    
    ctx.reply("🛠 <b>Admin Paneliga xush kelibsiz!</b>\nQuyidagi tugmalardan foydalaning:", {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: "📜 Menular (Mavjudlari)", callback_data: "admin_menus" }],
                [{ text: "➕ Yangi menu qo'shish", callback_data: "admin_add_menu" }]
            ]
        }
    });
});


bot.action('admin_add_menu', (ctx) => {
    ctx.answerCbQuery();
    ctx.scene.enter('ADD_MENU_WIZARD');
});

bot.action('admin_menus', async (ctx) => {
    ctx.answerCbQuery();
    if (products.length === 0) return ctx.reply("Hozircha menuda hech qanday taom yo'q.");
    
    ctx.reply("<b>Mavjud taomlar:</b>", { parse_mode: 'HTML' });
    
    for (const p of products) {
        const text = `🍲 <b>${p.name}</b>\n📂 Kategoriya: ${p.category}\n💰 Narxi: ${p.price} UZS\n📝 Izoh: ${p.desc || ''}`;
        await ctx.replyWithPhoto(p.image_file_id, {
            caption: text,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "✏️ Tahrirlash (Narxni)", callback_data: `edit_${p.id}` },
                        { text: "❌ Tugatish", callback_data: `delete_${p.id}` }
                    ]
                ]
            }
        });
    }
});

bot.action(/delete_(.+)/, (ctx) => {
    const id = ctx.match[1];
    products = products.filter(p => p.id !== id);
    saveProducts();
    ctx.deleteMessage().catch(()=>{});
    ctx.answerCbQuery("✅ Taom o'chirildi va WebApp'dan olib tashlandi!");
});

bot.action(/edit_(.+)/, (ctx) => {
    ctx.answerCbQuery();
    ctx.scene.enter('EDIT_PRICE_WIZARD', { productId: ctx.match[1] });
});

// --- BOT COMMANDS ---
bot.start((ctx) => {
    if (userPhones[ctx.from.id]) {
        const kb = webAppUrl ? 
            Markup.keyboard([[Markup.button.webApp("🍽 Menyuni ochish", webAppUrl)]]).resize() :
            Markup.keyboard([["⏳ Tizim ulanmoqda, kuting..."]]).resize();
        return ctx.reply(`Assalomu alaykum <a href="tg://user?id=${ctx.from.id}">${ctx.from.first_name}</a>!\n\nXush kelibsiz! Buyurtma berish uchun menyuni oching:`, { parse_mode: 'HTML', ...kb });
    }

    ctx.reply(`Assalomu alaykum <a href="tg://user?id=${ctx.from.id}">${ctx.from.first_name}</a>!\n\nIltimos, botdan to'liq foydalanish va buyurtma berish uchun telefon raqamingizni yuboring. (Pastdagi tugmani bosing)`, { 
        parse_mode: 'HTML', 
        reply_markup: {
            keyboard: [[{ text: "📱 Raqamni yuborish", request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true
        }
    });
});

bot.on('contact', (ctx) => {
    const contact = ctx.message.contact;
    userPhones[ctx.from.id] = contact.phone_number;
    saveUsers();
    
    const kb = webAppUrl ? 
        Markup.keyboard([[Markup.button.webApp("🍽 Menyuni ochish", webAppUrl)]]).resize() :
        Markup.keyboard([["⏳ Tizim ulanmoqda, kuting..."]]).resize();

    ctx.reply("✅ Raqamingiz saqlandi! Endi menyuni ochib buyurtma berishingiz mumkin:", kb);
});

bot.hears("⏳ Tizim ulanmoqda, kuting...", (ctx) => {
    if (webAppUrl) {
        ctx.reply("Tizim ulandi! Menyuni ochishingiz mumkin:", Markup.keyboard([[Markup.button.webApp("🍽 Menyuni ochish", webAppUrl)]]).resize());
    } else {
        ctx.reply("Hali ulanmadi, iltimos biroz kuting...");
    }
});

bot.on('web_app_data', (ctx) => {
    try {
        const data = JSON.parse(ctx.message.web_app_data.data);
        
        if (data.type === 'order') {
            const adminId = process.env.ADMIN_ID;
            const phone = userPhones[ctx.from.id] || "Noma'lum";
            const formattedPhone = phone.startsWith('+') ? phone : '+' + phone;

            const orderTypeStr = data.orderType === 'delivery' ? "🚚 Yetkazib berish" : "🏃 O'zim olib ketaman";
            
            let message = `🛒 <b>YANGI BUYURTMA!</b>\n\n`;
            message += `👤 <b>Xaridor:</b> <a href="tg://user?id=${ctx.from.id}">${ctx.from.first_name}</a>\n`;
            message += `📞 <b>Raqami:</b> <a href="tel:${formattedPhone}">${formattedPhone}</a>\n`;
            message += `📦 <b>Tur:</b> ${orderTypeStr}\n`;
            
            if (data.orderType === 'delivery') {
                message += `📍 <b>Manzil:</b> ${data.address || "Belgilanmagan"}\n`;
                if (data.addressDetails) {
                    const d = data.addressDetails;
                    if (d.title) message += `🏷 <b>Sarlavha:</b> ${d.title}\n`;
                    if (d.house || d.apartment) message += `🏠 <b>Uy/Xonadon:</b> ${d.house || '-'}/${d.apartment || '-'}\n`;
                    if (d.floor || d.entrance) message += `🏢 <b>Qavat/Kirish:</b> ${d.floor || '-'}/${d.entrance || '-'}\n`;
                    if (d.comment) message += `💬 <b>Izoh:</b> ${d.comment}\n`;
                }
                if (data.location) {
                    const mapLink = `https://www.google.com/maps?q=${data.location[0]},${data.location[1]}`;
                    message += `🗺 <b>Lokatsiya:</b> <a href="${mapLink}">Xaritada ko'rish</a>\n`;
                }
            }
            
            message += `\n📋 <b>Mahsulotlar:</b>\n`;
            data.items.forEach(item => {
                message += `▪️ ${item.name} x ${item.quantity} = ${(item.price * item.quantity).toLocaleString()} UZS\n`;
            });
            
            message += `\n💰 <b>Jami summa:</b> ${data.total.toLocaleString()} UZS`;
            
            // Save to DB
            const newOrder = {
                id: Date.now().toString(),
                user_id: ctx.from.id,
                user_name: ctx.from.first_name,
                items: data.items,
                total: data.total,
                date: new Date().toISOString(),
                status: 'pending'
            };
            orders.unshift(newOrder);
            saveOrders();

            ctx.reply("✅ Buyurtmangiz qabul qilindi! Tez orada siz bilan bog'lanamiz.");
            
            if (adminId) {
                const inlineKeyboard = [[{ text: "💬 Telegramdan yozish", url: `tg://user?id=${ctx.from.id}` }]];
                
                if (data.orderType === 'delivery' && data.location) {
                    inlineKeyboard.push([{ text: "📍 Xaritada ochish", url: `https://www.google.com/maps?q=${data.location[0]},${data.location[1]}` }]);
                }

                bot.telegram.sendMessage(adminId, message, { 
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: inlineKeyboard
                    }
                }).catch(err => {
                    console.log("Adminga xabar yuborishda xatolik:", err.message);
                });
            }
        }
    } catch (e) {
        console.error("WebApp data parse error:", e);
    }
});

console.log("Bot launch qilinmoqda...");
bot.launch().then(() => {
    console.log("🤖 Telegram Bot ishga tushdi!");
}).catch(err => {
    console.error("Bot ishga tushishida xatolik:", err);
});

process.once('SIGINT', () => {
    console.log("SIGINT qabul qilindi, bot to'xtatilmoqda...");
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    console.log("SIGTERM qabul qilindi, bot to'xtatilmoqda...");
    bot.stop('SIGTERM');
});
