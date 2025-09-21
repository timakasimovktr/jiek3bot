const { Telegraf, Scenes, session, Markup } = require("telegraf");
const pool = require("../db");

const MAX_RELATIVES = 3;

const colonies = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "10",
  "11",
  "12",
  "13",
  "14",
  "17",
  "20",
  "21",
  "22",
  "23",
  "24",
];

function generateColonyKeyboard(page) {
  const perPage = 6;
  const start = page * perPage;
  const end = start + perPage;
  const pageColonies = colonies.slice(start, end);

  let keyboard = [];
  for (let i = 0; i < pageColonies.length; i += 3) {
    let row = pageColonies
      .slice(i, i + 3)
      .map((c) => Markup.button.callback(`${c}-сон JIEK`, `colony_${c}`));
    keyboard.push(row);
  }

  let navRow = [];
  if (page > 0) navRow.push(Markup.button.callback("Oldingi", "prev_colony"));
  if (end < colonies.length)
    navRow.push(Markup.button.callback("Keyingi", "next_colony"));

  if (navRow.length > 0) keyboard.push(navRow);

  return Markup.inlineKeyboard(keyboard);
}

const bookingWizard = new Scenes.WizardScene(
  "booking-wizard",

  // Step 0: Проверка и запрос телефона
  async (ctx) => {
    try {
      console.log(`Step 0: Starting for user ${ctx.from.id}`);

      // Проверяем, что ctx.wizard существует
      if (!ctx.wizard) {
        console.error(`ctx.wizard is undefined for user ${ctx.from.id}`);
        await ctx.reply(
          "❌ Внутренняя ошибка бота. Пожалуйста, попробуйте снова."
        );
        return ctx.scene.leave();
      }

      // Сбрасываем состояние сцены
      ctx.wizard.state = {};

      // Проверяем активные заявки
      const [rows] = await pool.query(
        "SELECT * FROM bookings WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
        [ctx.from.id]
      );
      console.log(`Step 0: Pending bookings for user ${ctx.from.id}:`, rows);

      if (rows.length > 0) {
        await ctx.reply(
          "⚠️ Sizda hali tugallanmagan ariza mavjud. Yangi ariza yaratish uchun uni yakunlang yoki bekor qiling.",
          Markup.keyboard([
            ["📊 Navbat holati"],
            ["❌ Arizani bekor qilish"],
          ]).resize()
        );
        return ctx.scene.leave();
      }

      // Проверяем, есть ли сохранённый номер телефона
      const [userRows] = await pool.query(
        "SELECT phone_number FROM bookings WHERE user_id = ? ORDER BY id DESC LIMIT 1",
        [ctx.from.id]
      );
      console.log(
        `Step 0: Phone query result for user ${ctx.from.id}:`,
        userRows
      );

      if (userRows.length > 0 && userRows[0].phone_number) {
        ctx.wizard.state.phone = userRows[0].phone_number;
        ctx.wizard.state.offerRequested = true; // Устанавливаем флаг, чтобы избежать повторного запроса
        await ctx.reply(
          `✅ Telefon raqamingiz saqlangan. Ofertani qabul qiling.`,
          Markup.removeKeyboard()
        );
        // Явно отправляем запрос на принятие оферты
        await ctx.reply(
          "📜 Iltimos, publychnaya ofertani o‘qing va qabul qilish uchun 'Qabul qilaman' tugmasini bosing:",
          Markup.inlineKeyboard([
            [
              Markup.button.url(
                "📖 Ofertani o‘qish",
                "https://telegra.ph/PUBLICHNAYA-OFERTA-09-14-7"
              ),
            ],
            [Markup.button.callback("✅ Qabul qilaman", "accept_offer")],
          ])
        );
        console.log(
          `Step 0: Moving to Step 2 for user ${ctx.from.id} with phone ${ctx.wizard.state.phone}`
        );
        return ctx.wizard.selectStep(2); // Пропускаем шаг 1, так как номер уже есть
      }

      // Если номера нет → просим ввести
      ctx.wizard.state.offerRequested = false; // Сбрасываем флаг для новых пользователей
      await ctx.reply(
        "📲 Iltimos, telefon raqamingizni yuboring:",
        Markup.keyboard([[Markup.button.contactRequest("📞 Raqamni yuborish")]])
          .resize()
          .oneTime()
      );
      console.log(`Step 0: Requesting phone number for user ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      console.error(`Error in Step 0 for user ${ctx.from.id}:`, err);
      await ctx.reply(
        "❌ Xatolik yuz berdi. Iltimos, keyinroq urinib ko‘ring."
      );
      return ctx.scene.leave();
    }
  },

  // Step 1: Принимаем только контакт
  async (ctx) => {
    try {
      console.log(
        `Step 1: Starting for user ${ctx.from.id}, message:`,
        ctx.message,
        `wizard state:`,
        ctx.wizard.state
      );

      // Проверяем, что пользователь отправил контакт
      if (!ctx.message?.contact?.phone_number) {
        ctx.wizard.state.retryCount = (ctx.wizard.state.retryCount || 0) + 1;

        if (ctx.wizard.state.retryCount > 2) {
          await ctx.reply(
            "❌ Siz ko‘p marta noto‘g‘ri ma’lumot yubordingiz. Iltimos, /start buyrug‘i bilan qaytadan boshlang.",
            Markup.removeKeyboard()
          );
          console.log(`Step 1: Too many retries for user ${ctx.from.id}`);
          return ctx.scene.leave();
        }

        await ctx.reply(
          "📱 Telefon raqamingizni faqat tugma orqali yuboring. Raqamni matn sifatida yozmang:",
          Markup.keyboard([
            [Markup.button.contactRequest("📞 Raqamni yuborish")],
          ])
            .resize()
            .oneTime()
        );
        console.log(`Step 1: Requesting phone retry for user ${ctx.from.id}`);
        return;
      }

      // Успешная отправка контакта
      ctx.wizard.state.phone = ctx.message.contact.phone_number;
      ctx.wizard.state.offerRequested = true; // Устанавливаем флаг
      await ctx.reply(
        "✅ Telefon raqamingiz qabul qilindi.",
        Markup.removeKeyboard()
      );
      console.log(
        `Step 1: Phone received for user ${ctx.from.id}: ${ctx.wizard.state.phone}`
      );

      // Запрашиваем принятие публичной оферты
      await ctx.reply(
        "📜 Iltimos, publychnaya ofertani o‘qing va qabul qilish uchun 'Qabul qilaman' tugmasini bosing:",
        Markup.inlineKeyboard([
          [
            Markup.button.url(
              "📖 Ofertani o‘qish",
              "https://telegra.ph/PUBLICHNAYA-OFERTA-09-14-7"
            ),
          ],
          [Markup.button.callback("✅ Qabul qilaman", "accept_offer")],
        ])
      );
      console.log(`Step 1: Offer requested for user ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      console.error(`Error in Step 1 for user ${ctx.from.id}:`, err);
      await ctx.reply(
        "❌ Xatolik yuz berdi. Iltimos, keyinroq urinib ko‘ring."
      );
      return ctx.scene.leave();
    }
  },

  // Step 2: Принятие публичной оферты
  async (ctx) => {
    console.log(
      `Step 2: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}, message: ${ctx.message?.text}`
    );

    if (!ctx.callbackQuery?.data || ctx.callbackQuery.data !== "accept_offer") {
      // Игнорируем текстовые сообщения и повторяем запрос на оферту
      await ctx.reply(
        "📜 Iltimos, publychnaya ofertani o‘qing va qabul qilish uchun 'Qabul qilaman' tugmasini bosing:",
        Markup.inlineKeyboard([
          [
            Markup.button.url(
              "📖 Ofertani o‘qish",
              "https://telegra.ph/PUBLICHNAYA-OFERTA-09-14-7"
            ),
          ],
          [Markup.button.callback("✅ Qabul qilaman", "accept_offer")],
        ])
      );
      return;
    }

    await ctx.answerCbQuery();
    ctx.wizard.state.offer_accepted = true;
    ctx.wizard.state.page = 0; // Инициализируем страницу для пагинации

    // Запрашиваем выбор колонии с пагинацией
    await ctx.reply(
      "🏛 Iltimos, koloniyani tanlang:",
      generateColonyKeyboard(ctx.wizard.state.page)
    );
    console.log(`Step 2: Moving to colony selection for user ${ctx.from.id}`);
    return ctx.wizard.next();
  },

  // Остальные шаги остаются без изменений
  // Step 3: Выбор колонии
  async (ctx) => {
    console.log(
      `Step 3: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}, message: ${ctx.message?.text}`
    );

    ctx.wizard.state.page = ctx.wizard.state.page || 0; // На случай, если page не установлен

    const data = ctx.callbackQuery?.data;

    if (data === "prev_colony") {
      ctx.wizard.state.page = Math.max(0, ctx.wizard.state.page - 1);
      await ctx.editMessageReplyMarkup({
        reply_markup: generateColonyKeyboard(ctx.wizard.state.page)
          .reply_markup,
      });
      return;
    }

    if (data === "next_colony") {
      const maxPage = Math.ceil(colonies.length / 6) - 1;
      ctx.wizard.state.page = Math.min(maxPage, ctx.wizard.state.page + 1);
      await ctx.editMessageReplyMarkup({
        reply_markup: generateColonyKeyboard(ctx.wizard.state.page)
          .reply_markup,
      });
      return;
    }

    if (
      !ctx.callbackQuery?.data ||
      !ctx.callbackQuery.data.startsWith("colony_")
    ) {
      await ctx.reply(
        "❌ Iltimos, koloniyani tanlang:",
        generateColonyKeyboard(ctx.wizard.state.page)
      );
      return;
    }

    await ctx.answerCbQuery();
    ctx.wizard.state.colony = ctx.callbackQuery.data.replace("colony_", "");

    // Инициализируем данные
    ctx.wizard.state.relatives = [];
    ctx.wizard.state.currentRelative = {};
    ctx.wizard.state.prisoner_name = null;
    ctx.wizard.state.visit_type = null;

    await ctx.reply(
      "📅 Iltimos, uchrashuv turini tanlang:",
      Markup.inlineKeyboard([
        [Markup.button.callback("🔵 1-kunlik", "short")],
        [Markup.button.callback("🟢 2-kunlik", "long")],
      ])
    );
    return ctx.wizard.next();
  },

  // Step 4: Выбор типа визита
  async (ctx) => {
    console.log(
      `Step 4: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}`
    );
    if (
      !ctx.callbackQuery?.data ||
      (ctx.callbackQuery.data !== "long" && ctx.callbackQuery.data !== "short")
    ) {
      await ctx.reply(
        "❌ Iltimos, uchrashuv turini tanlang:",
        Markup.inlineKeyboard([
          [Markup.button.callback("🔵 1-kunlik", "short")],
          [Markup.button.callback("🟢 2-kunlik", "long")],
        ])
      );
      return;
    }

    await ctx.answerCbQuery();
    ctx.wizard.state.visit_type = ctx.callbackQuery.data;

    await ctx.reply("👤 Iltimos, to‘liq ismingiz va familiyangizni kiriting:");
    return ctx.wizard.next();
  },

  // Step 5: Ism va familiya
  async (ctx) => {
    console.log(`Step 5: User ${ctx.from.id} sent text: ${ctx.message?.text}`);
    if (ctx.message?.text === "❌ Bekor qilish ariza") {
      await ctx.reply(
        "❌ Uchrashuv yozuvi bekor qilindi.",
        Markup.keyboard([["📅 Uchrashuvga yozilish"]]).resize()
      );
      return ctx.scene.leave();
    }

    if (!ctx.message?.text) {
      await ctx.reply("❌ Iltimos, ism va familiyani matn shaklida yuboring.");
      return ctx.wizard.selectStep(5);
    }

    ctx.wizard.state.currentRelative.full_name = ctx.message.text.toUpperCase();
    ctx.wizard.state.currentRelative.passport = "AC1234567";
    ctx.wizard.state.relatives.push(ctx.wizard.state.currentRelative);

    if (!ctx.wizard.state.prisoner_name) {
      await ctx.reply(
        "👥 Siz kim bilan uchrashmoqchisiz? Mahbusning to‘liq ismini kiriting:"
      );
      return ctx.wizard.selectStep(7);
    } else {
      return askAddMore(ctx);
    }
  },

  // Step 6: Placeholder (not used)
  async (ctx) => {
    return ctx.wizard.next();
  },

  // Step 7: Mahbus ismi
  async (ctx) => {
    console.log(`Step 7: User ${ctx.from.id} sent text: ${ctx.message?.text}`);
    if (!ctx.message?.text) {
      await ctx.reply("❌ Iltimos, mahbusning ismini matn shaklida yuboring.");
      return ctx.wizard.selectStep(7);
    }

    ctx.wizard.state.prisoner_name = ctx.message.text.toUpperCase();
    return askAddMore(ctx);
  },

  // Step 8: Qo‘shimcha qarindosh yoki yakunlash
  async (ctx) => {
    console.log(
      `Step 8: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}`
    );
    if (ctx.callbackQuery) await ctx.answerCbQuery();

    if (ctx.callbackQuery?.data === "add_more") {
      if (ctx.wizard.state.relatives.length < MAX_RELATIVES) {
        ctx.wizard.state.currentRelative = {};
        await ctx.reply(
          "👤 Yangi qarindoshning ismi va familiyasini kiriting:"
        );
        return ctx.wizard.selectStep(5);
      } else {
        await ctx.reply("⚠️ Maksimal 3 ta qarindosh qo‘shildi.");
        return showSummary(ctx);
      }
    } else if (ctx.callbackQuery?.data === "done") {
      return showSummary(ctx);
    } else {
      // Handle unexpected inputs
      await ctx.reply(
        "❌ Iltimos, quyidagi tugmalardan birini bosing:",
        Markup.inlineKeyboard([
          [Markup.button.callback("Ha, qo‘shaman", "add_more")],
          [Markup.button.callback("Yo‘q", "done")],
        ])
      );
      return;
    }
  },

  // Step 9: Yakuniy tasdiqlash yoki bekor qilish
  async (ctx) => {
    console.log(
      `Step 9: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}, message: ${ctx.message?.text}`
    );
    if (ctx.callbackQuery) await ctx.answerCbQuery();

    if (ctx.callbackQuery?.data === "confirm") {
      return saveBooking(ctx);
    } else if (ctx.callbackQuery?.data === "cancel") {
      await ctx.reply(
        "❌ Uchrashuv yozuvi bekor qilindi.",
        Markup.inlineKeyboard([
          [Markup.button.callback("📅 Uchrashuvga yozilish", "start_booking")],
        ])
      );
      return ctx.scene.leave();
    } else {
      // Handle unexpected inputs (e.g., text messages)
      await ctx.reply(
        "❌ Iltimos, quyidagi tugmalardan birini bosing:",
        Markup.inlineKeyboard([
          [Markup.button.callback("✅ Tasdiqlash", "confirm")],
          [Markup.button.callback("❌ Bekor qilish ariza", "cancel")],
        ])
      );
      return;
    }
  }
);

// helper: qo‘shish yoki yakunlash
async function askAddMore(ctx) {
  if (ctx.wizard.state.relatives.length < MAX_RELATIVES) {
    await ctx.reply(
      "➕ Yana qarindosh qo‘shishni xohlaysizmi? (maksimal 3 ta)",
      Markup.inlineKeyboard([
        [Markup.button.callback("Ha, qo‘shaman", "add_more")],
        [Markup.button.callback("Yo‘q", "done")],
      ])
    );
    return ctx.wizard.selectStep(8);
  } else {
    await ctx.reply("⚠️ Maksimal 3 ta qarindosh qo‘shildi.");
    return showSummary(ctx);
  }
}

// helper: ko‘rsatish summary
async function showSummary(ctx) {
  const { prisoner_name, relatives, colony } = ctx.wizard.state;
  let text = "📋 Arizangiz tafsilotlari:\n\n";
  text += `🏛 Koloniya: ${colony}\n`;
  text += `👥 Mahbus: ${prisoner_name}\n\n`;
  relatives.forEach((r, i) => {
    text += `👤 Qarindosh ${i + 1}:\n- Ism Familiya: ${r.full_name}\n`;
  });
  text += "❓ Ushbu ma’lumotlarni tasdiqlaysizmi?";

  await ctx.reply(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Tasdiqlash", "confirm")],
      [Markup.button.callback("❌ Bekor qilish ariza", "cancel")],
    ])
  );
  return ctx.wizard.selectStep(9);
}

// helper: save booking to DB
async function saveBooking(ctx) {
  const { prisoner_name, relatives, visit_type, colony } = ctx.wizard.state;
  const chatId = ctx.chat.id;
  try {
    const [result] = await pool.query(
      "INSERT INTO bookings (user_id, phone_number, visit_type, prisoner_name, relatives, colony, status, telegram_chat_id) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
      [
        ctx.from.id,
        ctx.wizard.state.phone,
        visit_type,
        prisoner_name,
        JSON.stringify(relatives),
        colony,
        chatId,
      ]
    );

    const bookingId = result.insertId;

    await ctx.scene.leave();

    // Отправка в админ-группу
    await sendApplicationToAdmin(ctx, {
      relatives,
      prisoner: prisoner_name,
      id: bookingId,
      visit_type,
      colony,
    });

    // Получаем позицию в очереди
    const [rows] = await pool.query(
      "SELECT * FROM bookings WHERE status = 'pending' ORDER BY id ASC"
    );
    const myIndex = rows.findIndex((b) => b.id === bookingId);
    if (myIndex === -1) {
      console.error("Booking ID not found in pending bookings");
      await ctx.reply("❌ Xatolik: Arizangiz topilmadi.");
      return;
    }
    const position = myIndex + 1;

    await ctx.reply(
      `✅ Uchrashuv muvaffaqiyatli bron qilindi!\n\n📊 Sizning navbatingiz: ${position}`,
      Markup.keyboard([
        ["📊 Navbat holati"],
        [`❌ Arizani bekor qilish #${bookingId}`],
      ])
        .resize()
        .oneTime(false)
    );

    let groupUrl = "https://t.me/smartdunyomeet";
    if (colony === "5") {
      groupUrl = "https://t.me/SmartJIEK5";
    }

    await ctx.reply(
      "📱 Grupaga qo'shing",
      Markup.inlineKeyboard([[Markup.button.url("📌 Grupaga otish", groupUrl)]])
    );
  } catch (err) {
    console.error("Error in saveBooking:", err);
    await ctx.reply("❌ Xatolik yuz berdi. Iltimos, keyinroq urinib ko‘ring.");
  }
}

async function sendApplicationToAdmin(ctx, application) {
  const adminChatId = process.env.ADMIN_CHAT_ID;
  const firstRelative = application.relatives[0];
  const text = `📌 Yangi ariza. Nomer: ${application.id}
👤 Arizachi: ${firstRelative ? `${firstRelative.full_name}` : "Noma'lum"}
🏛 Koloniya: ${application.colony}
📅 Berilgan sana: ${new Date().toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })}
⏲️ Turi: ${application.visit_type === "long" ? "2-kunlik" : "1-kunlik"}
🟡 Holat: Tekshiruvni kutish`;

  try {
    await ctx.reply(text);
    await ctx.telegram.sendMessage(adminChatId, text, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    if (err.response && err.response.error_code === 403) {
      console.warn(
        `⚠️ Admin chat ${adminChatId} blocked the bot, message not sent`
      );
    } else {
      console.error("Error sending to admin:", err);
    }
  }
}

module.exports = bookingWizard;
