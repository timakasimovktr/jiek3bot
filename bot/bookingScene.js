//bookingScene.js

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

function generateColonyKeyboard() {
  const keyboard = [];
  for (let i = 0; i < colonies.length; i += 3) {
    const row = colonies
      .slice(i, i + 3)
      .map((c) => Markup.button.callback(`🏛 ${c}-сон ${c === "23" ? "MUIK" : "JIEK"}`, `colony_${c}`));
    keyboard.push(row);
  }
  return Markup.inlineKeyboard(keyboard);
}

const bookingWizard = new Scenes.WizardScene(
  "booking-wizard",

  // Step 0: Проверка и запрос телефона
  async (ctx) => {
    try {
      console.log(`Step 0: Starting for user ${ctx.from.id}`);

      if (!ctx.wizard) {
        console.error(`ctx.wizard is undefined for user ${ctx.from.id}`);
        await ctx.reply(
          "❌ Внутренняя ошибка бота. Пожалуйста, попробуйте снова."
        );
        return ctx.scene.leave();
      }

      ctx.wizard.state = {};

      // Check for active bookings only in bookings
      const [rows] = await pool.query(
        `SELECT id, status, created_at
       FROM bookings
       WHERE user_id = ? AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
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

      // Check for saved phone number only in bookings
      const [userRows] = await pool.query(
        `SELECT phone_number
       FROM bookings
       WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 1`,
        [ctx.from.id]
      );
      console.log(
        `Step 0: Phone query result for user ${ctx.from.id}:`,
        userRows
      );

      if (userRows.length > 0 && userRows[0].phone_number) {
        ctx.wizard.state.phone = userRows[0].phone_number;
        ctx.wizard.state.offerRequested = true;
        await ctx.reply(
          `✅ Telefon raqamingiz saqlangan. Ofertani qabul qiling.`,
          Markup.removeKeyboard()
        );
        await ctx.reply(
          `📜 Iltimos, OMAVIY OFERTANI o‘qing 
va qabul qilish uchun 'Qabul qilaman' tugmasini bosing:`,
          Markup.inlineKeyboard([
            [
              Markup.button.url(
                "📖 OMAVIY OFERTANI o‘qish",
                "https://telegra.ph/PUBLICHNAYA-OFERTA-09-14-7"
              ),
            ],
            [Markup.button.callback("✅ Qabul qilaman", "accept_offer")],
          ])
        );
        console.log(
          `Step 0: Moving to Step 2 for user ${ctx.from.id} with phone ${ctx.wizard.state.phone}`
        );
        return ctx.wizard.selectStep(2);
      }

      ctx.wizard.state.offerRequested = false;
      await ctx.reply(
        "📲 Iltimos, telefon raqamingizni tugma orqali yuboring:",
        Markup.keyboard([
          [Markup.button.contactRequest("🟢➡️ 📞 Raqamni yuborish ⬅️🟢")],
        ])
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

      ctx.wizard.state.phone = ctx.message.contact.phone_number;
      ctx.wizard.state.offerRequested = true;
      await ctx.reply(
        "✅ Telefon raqamingiz qabul qilindi.",
        Markup.removeKeyboard()
      );
      console.log(
        `Step 1: Phone received for user ${ctx.from.id}: ${ctx.wizard.state.phone}`
      );

      await ctx.reply(
        `📜 Iltimos, OMAVIY OFERTANI o‘qing 
va qabul qilish uchun 'Qabul qilaman' tugmasini bosing:`,
        Markup.inlineKeyboard([
          [
            Markup.button.url(
              "📖 OMAVIY OFERTANI o‘qish",
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
      await ctx.reply(
        `📜 Iltimos, OMAVIY OFERTANI o‘qing 
va qabul qilish uchun 'Qabul qilaman' tugmasini bosing:`,
        Markup.inlineKeyboard([
          [
            Markup.button.url(
              "📖 OMAVIY OFERTANI o‘qish",
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

    await ctx.reply(
      "🏛 Iltimos, KOLONIYANI tanlang:",
      generateColonyKeyboard()
    );
    console.log(`Step 2: Moving to colony selection for user ${ctx.from.id}`);
    return ctx.wizard.next();
  },

  // Step 3: Выбор колонии
  async (ctx) => {
    console.log(
      `Step 3: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}, message: ${ctx.message?.text}`
    );

    const data = ctx.callbackQuery?.data;

    if (
      !ctx.callbackQuery?.data ||
      !ctx.callbackQuery.data.startsWith("colony_")
    ) {
      await ctx.reply(
        "❌ Iltimos, KOLONIYANI tanlang:",
        generateColonyKeyboard()
      );
      return;
    }

    await ctx.answerCbQuery();
    ctx.wizard.state.colony = ctx.callbackQuery.data.replace("colony_", "");

    ctx.wizard.state.relatives = [];
    ctx.wizard.state.currentRelative = {};
    ctx.wizard.state.prisoner_name = null;
    ctx.wizard.state.visit_type = null;

    await ctx.reply(
      "⏲️ Iltimos, UCHRASHUV turini tanlang:",
      Markup.inlineKeyboard([
        [Markup.button.callback("🔵 1-kunlik", "short"), Markup.button.callback("🟢 2-kunlik", "long")]
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
        "❌ Iltimos, UCHRASHUV turini tanlang:",
        Markup.inlineKeyboard([
          [Markup.button.callback("🔵 1-kunlik", "short"), Markup.button.callback("🟢 2-kunlik", "long")]
        ])
      );
      return;
    }

    await ctx.answerCbQuery();
    ctx.wizard.state.visit_type = ctx.callbackQuery.data;

    await ctx.reply("👤 Iltimos, to‘liq ismingizni kiriting: (FAMILIYA ISM SHARIFI)");
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
        `👥 Siz kim bilan uchrashmoqchisiz? 
Mahbusning to‘liq ismini kiriting: (FAMILIYA ISM SHARIFI)`
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

async function askAddMore(ctx) {
  // if (ctx.wizard.state.relatives.length < MAX_RELATIVES) {
  //   await ctx.reply(
  //     "➕ Yana qarindosh qo‘shishni xohlaysizmi? (maksimal 3 ta)",
  //     Markup.inlineKeyboard([
  //       [Markup.button.callback("Ha, qo‘shaman", "add_more")],
  //       [Markup.button.callback("Yo‘q", "done")],
  //     ])
  //   );
  //   return ctx.wizard.selectStep(8);
  // } else {
  //   await ctx.reply("⚠️ Maksimal 3 ta qarindosh qo‘shildi.");
  //   return showSummary(ctx);
  // }
  return showSummary(ctx);
}

async function showSummary(ctx) {
  const { prisoner_name, relatives, colony } = ctx.wizard.state;
  let text = "📋 Arizangiz tafsilotlari:\n";
  text += `🏛 Koloniya: ${colony} ${colony === "23" ? "(MUIK)" : "(JIEK)"}\n`;
  text += `👤 Mahbus:\n 
${prisoner_name}\n`;
  relatives.forEach((r, i) => {
    text += `👥 Qarindosh ${i + 1}:\n${r.full_name}\n`;
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

async function saveBooking(ctx) {
  const { prisoner_name, relatives, visit_type, colony } = ctx.wizard.state;
  const chatId = ctx.chat.id;
  try {
    // Выбираем таблицу в зависимости от колонии
    // const tableName = colony === "5" ? "bookings5" : "bookings";

    // Вставляем запись в соответствующую таблицу
    const [result] = await pool.query(
      `INSERT INTO bookings (user_id, phone_number, visit_type, prisoner_name, relatives, colony, status, telegram_chat_id) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
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

    await sendApplicationToAdmin(ctx, {
      relatives,
      prisoner: prisoner_name,
      id: bookingId,
      visit_type,
      colony,
    });

    // Проверяем позицию в очереди в соответствующей таблице
    const [rows] = await pool.query(
      `SELECT * FROM bookings WHERE status = 'pending' AND colony = ? ORDER BY id ASC`,
      [colony]
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

    switch (colony) {
      case "1":
        groupUrl = "https://t.me/SmartJIEK1";
        break;
      case "2":
        groupUrl = "https://t.me/SmartJIEK2";
        break;
      case "3":
        groupUrl = "https://t.me/SmartJIEK3";
        break;
      case "4":
        groupUrl = "https://t.me/SmartJIEK4";
        break;
      case "5":
        groupUrl = "https://t.me/SmartJIEK5";
        break;
      case "6":
        groupUrl = "https://t.me/SmartJIEK6";
        break;
      case "7":
        groupUrl = "https://t.me/SmartJIEK7";
        break;
      case "10":
        groupUrl = "https://t.me/SmartJIEK8";
        break;
      case "11":
        groupUrl = "https://t.me/SmartJIEK9";
        break;
      case "12":
        groupUrl = "https://t.me/SmartJIEK10";
        break;
      case "13":
        groupUrl = "https://t.me/SmartJIEK11";
        break;
      case "14":
        groupUrl = "https://t.me/SmartJIEK12";
        break;
      case "17":
        groupUrl = "https://t.me/SmartJIEK17";
        break;
      case "20":
        groupUrl = "https://t.me/SmartJIEK20";
        break;
      case "21":
        groupUrl = "https://t.me/SmartJIEK21";
        break;
      case "22":
        groupUrl = "https://t.me/SmartJIEK22";
        break;
      case "23":
        groupUrl = "https://t.me/SmartJIEK23";
        break;
      case "24":
        groupUrl = "https://t.me/SmartJIEK24";
        break;
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
  const text = `📌 Yangi ariza. №: ${application.id}
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
