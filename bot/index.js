const { Telegraf, Scenes, session, Markup } = require("telegraf");
require("dotenv").config();
const pool = require("../db");
const bookingWizard = require("./bookingScene");
const { message } = require("telegraf/filters");
const adminChatId = process.env.ADMIN_CHAT_ID;

const bot = new Telegraf(process.env.BOT_TOKEN);
const stage = new Scenes.Stage([bookingWizard]);

const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");

bot.use(session());
bot.use(stage.middleware());

bot.use((ctx, next) => {
  if (ctx.chat?.type !== "private") {
    return;
  }
  return next();
});

bot.use(async (ctx, next) => {
  console.log(
    `Middleware: user ${ctx.from?.id}, ctx.wizard exists: ${!!ctx.wizard}, scene: ${
      ctx.scene?.current?.id || "none"
    }`
  );
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.language) {
    const latest = await getLatestBooking(ctx.from?.id);
    ctx.session.language = latest?.language || "uzl"; // По умолчанию uzl
  }
  return next();
});

const texts = {
  ru: {
    greeting:
      "👋 Здравствуйте!\nЧерез эту платформу вы можете записаться на встречу с заключёнными в тюрьме.",
    process_canceled: "❌ Процесс отменён.",
    error_occurred: "❌ Произошла ошибка.",
    main_menu: "Основное меню:",
    already_in_process:
      "❌ Вы уже в процессе. Пожалуйста, завершите текущий процесс или используйте /cancel.",
    approved_status: `🎉 Заявка одобрена. №: {id}\n👤 Заявитель: {name}`,
    pending_status: `📊 Ваша очередь: {pos}`,
    queue_not_found: "❌ Очередь не найдена.",
    no_pending_application: "❌ У вас нет активной заявки.",
    approved_details: `🎉 Заявка одобрена. №: {id}\n👤 Заявитель: {name}\n📅 Дата подачи: {created}\n⌚️ Дата посещения: {visit}\n🏛️ Колония: {colony}\n🟢 Статус: Утверждено`,
    status_unknown: "❌ Статус заявки неизвестен.",
    no_booking_found: "❌ Заявка не найдена.",
    group_join_prompt: "🫂 Нажмите кнопку:",
    group_join_button: "📌 Перейти в группу",
    no_active_application: "❌ У вас нет активной заявки.",
    coordinates_not_found: "❌ Координаты колонии не найдены.",
    colony_location: "🏛 Локация колонии {colony}",
    cancel_confirm: "❓ Вы уверены, что хотите отменить заявку?",
    cancel_no: "✅ Заявка не отменена.",
    no_cancel_booking: "❌ Нет заявки для отмены.",
    booking_not_found_or_canceled: "❌ Заявка не найдена или уже отменена.",
    application_canceled: "❌ Ваша заявка отменена.",
    new_booking_prompt: "🔄 Для записи на новую встречу нажмите кнопку в меню.",
    unexpected_text_ignore:
      "User {id} in scene {scene}, ignoring unexpected text: {text}",
    global_error_reply:
      "❌ Произошла ошибка, пожалуйста, отправьте /start заново.",
    existing_application:
      "❌ У вас уже есть заявка (№: {id}, Статус: {status}, Заявитель: {name}). Чтобы подать новую, сначала отмените текущую.",
    booking_canceled: "❌ Запись на встречу отменена.",
    no_application: "❌ У вас нет активной заявки.",
    file_not_found: "❌ Файл не найден.",
    additional_info:
      "📗 Дополнительная информация: Здесь может быть полезный текст или ссылки.", // Placeholder
    language_prompt: "🌐 Пожалуйста, выберите язык:",
    queue_status: "📊 Статус очереди",
    group_join: "🫂 Перейти в группу",
    application_copy: "🖨️ Получить копию заявки",
    additional_info_button: "📗 Дополнительная информация",
    visitor_reminder: "📃 Памятка для посетителей",
    colony_location_button: "🏛️ Локация колонии",
    cancel_application: "❌ Отменить заявку #{id}",
    book_meeting: "📅 Записаться на встречу",
    yes: "✅ Да",
    no: "❌ Нет",
    status_approved: "одобрено",
    status_pending: "ожидает",
    change_language: "🌐 Сменить язык",
  },
  uz: {
    // Uzbek Cyrillic
    greeting:
      "👋 Ассалому алайкум!\nБу платформа орқали сиз қамоқхона маҳбуслари билан учрашувга ёзилишингиз мумкин.",
    process_canceled: "❌ Жараён бекор қилинди.",
    error_occurred: "❌ Хатолик юз берди.",
    main_menu: "Асосий меню:",
    already_in_process:
      "❌ Сиз аллақачон жараёндасиз. Илтимос, жорий жараённи якунланг ёки /cancel буйруғини ишлатинг.",
    approved_status: `🎉 Ариза тасдиқланган. №: {id}\n👤 Аризачи: {name}`,
    pending_status: `📊 Сизнинг навбатингиз: {pos}`,
    queue_not_found: "❌ Навбат топилмади.",
    no_pending_application: "❌ Сизда ҳозирда кутаётган ариза йўқ.",
    approved_details: `🎉 Ариза тасдиқланган. №: {id}\n👤 Аризачи: {name}\n📅 Берилган сана: {created}\n⌚️ Келиши сана: {visit}\n🏛️ Колония: {colony}\n🟢 Ҳолат: Тасдиқланган`,
    status_unknown: "❌ Ариза ҳолати номаълум.",
    no_booking_found: "❌ Ҳозирда ариза топилмади.",
    group_join_prompt: "🫂 Тугмасини босинг:",
    group_join_button: "📌 Гуруҳга ўтиш",
    no_active_application: "❌ Сизда ҳозирда фаол ариза йўқ.",
    coordinates_not_found: "❌ Колониа координаталари топилмади.",
    colony_location: "🏛 {colony}-сон ЖИЭК локацияси",
    cancel_confirm: "❓ Аризани бекор қилмоқчимисиз?",
    cancel_no: "✅ Ариза бекор қилинмади.",
    no_cancel_booking: "❌ Ҳозир бекор қилиш учун ариза топилмади.",
    booking_not_found_or_canceled:
      "❌ Ариза топилмади ёки аллақачон бекор қилинган.",
    application_canceled: "❌ Сизнинг аризангиз бекор қилинди.",
    new_booking_prompt:
      "🔄 Янги учрашувга ёзилиш учун менюдаги тугмани босинг.",
    unexpected_text_ignore:
      "User {id} in scene {scene}, ignoring unexpected text: {text}",
    global_error_reply:
      "❌ Хатолик юз берди, илтимос, /start буйруғини қайта юборинг.",
    existing_application:
      "❌ Сизда аллақачон ариза мавжуд (№: {id}, Ҳолат: {status}, Аризачи: {name}). Янги ариза юбориш учун аввал жорий аризани бекор қилинг.",
    booking_canceled: "❌ Учрашув ёзуви бекор қилинди.",
    no_application: "❌ Сизда ҳозирда кутаётган ариза йўқ.",
    file_not_found: "❌ Файл топилмади.",
    additional_info:
      "📗 Қўшимча маълумот: Бу ерда фойдали матн ёки ҳаволалар бўлиши мумкин.", // Placeholder
    language_prompt: "🌐 Илтимос, тилни танланг:",
    queue_status: "📊 Навбат ҳолати",
    group_join: "🫂 Гуруҳга ўтиш",
    application_copy: "🖨️ Ариза нусхасини олиш",
    additional_info_button: "📗 Қўшимча маълумот",
    visitor_reminder: "📃 Ташриф буюрувчилар учун эслатма",
    colony_location_button: "🏛️ Колониа локацияси",
    cancel_application: "❌ Аризани бекор қилиш #{id}",
    book_meeting: "📅 Учрашувга ёзилиш",
    yes: "✅ Ҳа",
    no: "❌ Йўқ",
    status_approved: "тасдиқланган",
    status_pending: "кутмоқда",
    change_language: "🌐 Тилни ўзгартириш",
  },
  uzl: {
    // Uzbek Latin (original)
    greeting:
      "👋 Assalomu alaykum!\nBu platforma orqali siz qamoqxona mahbuslari bilan uchrashuvga yozilishingiz mumkin.",
    process_canceled: "❌ Jarayon bekor qilindi.",
    error_occurred: "❌ Xatolik yuz berdi.",
    main_menu: "Asosiy menu:",
    already_in_process:
      "❌ Siz allaqachon jarayondasiz. Iltimos, joriy jarayonni yakunlang yoki /cancel buyrug‘ini ishlating.",
    approved_status: `🎉 Ariza tasdiqlangan. №: {id}\n👤 Arizachi: {name}`,
    pending_status: `📊 Sizning navbatingiz: {pos}`,
    queue_not_found: "❌ Navbat topilmadi.",
    no_pending_application: "❌ Sizda hozirda kutayotgan ariza yo‘q.",
    approved_details: `🎉 Ariza tasdiqlangan. №: {id}\n👤 Arizachi: {name}\n📅 Berilgan sana: {created}\n⌚️ Kelishi sana: {visit}\n🏛️ Koloniya: {colony}\n🟢 Holat: Tasdiqlangan`,
    status_unknown: "❌ Ariza holati noma'lum.",
    no_booking_found: "❌ Hozirda ariza topilmadi.",
    group_join_prompt: "🫂 Tugmasini bosing:",
    group_join_button: "📌 Grupaga otish",
    no_active_application: "❌ Sizda hozirda faol ariza yo‘q.",
    coordinates_not_found: "❌ Koloniya koordinatalari topilmadi.",
    colony_location: "🏛 {colony}-son JIEK lokatsiyasi",
    cancel_confirm: "❓ Arizani bekor qilmoqchimisiz?",
    cancel_no: "✅ Ariza bekor qilinmadi.",
    no_cancel_booking: "❌ Hozir bekor qilish uchun ariza topilmadi.",
    booking_not_found_or_canceled:
      "❌ Ariza topilmadi yoki allaqachon bekor qilingan.",
    application_canceled: "❌ Sizning arizangiz bekor qilindi.",
    new_booking_prompt:
      "🔄 Yangi uchrashuvga yozilish uchun menyudagi tugmani bosing.",
    unexpected_text_ignore:
      "User {id} in scene {scene}, ignoring unexpected text: {text}",
    global_error_reply:
      "❌ Xatolik yuz berdi, iltimos, /start buyrug‘ini qayta yuboring.",
    existing_application:
      "❌ Sizda allaqachon ariza mavjud (№: {id}, Holat: {status}, Arizachi: {name}). Yangi ariza yuborish uchun avval joriy arizani bekor qiling.",
    booking_canceled: "❌ Uchrashuv yozuvi bekor qilindi.",
    no_application: "❌ Sizda hozirda kutayotgan ariza yo‘q.",
    file_not_found: "❌ Fayl topilmadi.",
    additional_info:
      "📗 Qo‘shimcha ma’lumot: Bu yerda foydali matn yoki havolalar bo‘lishi mumkin.", // Placeholder
    language_prompt: "🌐 Iltimos, tilni tanlang:",
    queue_status: "📊 Navbat holati",
    group_join: "🫂 Grupaga otish",
    application_copy: "🖨️ Ariza nusxasini olish",
    additional_info_button: "📗 Qo‘shimcha ma’lumot",
    visitor_reminder: "📃 Tashrif buyuruvchilar uchun eslatma",
    colony_location_button: "🏛️ Koloniya lokatsiyasi",
    cancel_application: "❌ Arizani bekor qilish #{id}",
    book_meeting: "📅 Uchrashuvga yozilish",
    yes: "✅ Ha",
    no: "❌ Yo‘q",
    status_approved: "tasdiqlangan",
    status_pending: "kutmoqda",
    change_language: "🌐 Tilni o‘zgartirish",
  },
};

async function getLatestPendingOrApprovedId(userId) {
  try {
    const [rows] = await pool.query(
      `SELECT colony_application_number
       FROM bookings
       WHERE status IN ('pending', 'approved') AND user_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    return rows.length ? rows[0].colony_application_number : null;
  } catch (err) {
    console.error("Error in getLatestPendingOrApprovedId:", err);
    throw err;
  }
}

async function getLatestBooking(userId) {
  try {
    const [rows] = await pool.query(
      `SELECT id, user_id, prisoner_name, colony, relatives, status, created_at, start_datetime, colony_application_number, language
       FROM bookings
       WHERE user_id = ? AND status IN ('pending', 'approved')
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    return rows.length ? rows[0] : null;
  } catch (err) {
    console.error("Error in getLatestBooking:", err);
    throw err;
  }
}

async function getUserBookingStatus(userId) {
  return await getLatestBooking(userId); // Reuse the function
}

function buildMainMenu(lang, latestPendingNumber) {
  let rows = [];
  if (latestPendingNumber) {  // Полное меню с кнопкой смены языка
    rows = [
      [texts[lang].queue_status, texts[lang].group_join],
      [texts[lang].application_copy, texts[lang].additional_info_button],
      [texts[lang].visitor_reminder, texts[lang].colony_location_button],
    ];
    rows.push([
      texts[lang].cancel_application.replace("{id}", latestPendingNumber),
    ]);
    rows.push([texts[lang].change_language]);  // Добавлено: кнопка смены языка в полном меню
  } else {  
    rows = [
      [texts[lang].book_meeting],
      [texts[lang].change_language],
    ];
  }

  return Markup.keyboard(rows).resize().persistent();
}

async function getQueuePosition(bookingId) {
  try {
    const [bookingsRows] = await pool.query(
      "SELECT colony, colony_application_number FROM bookings WHERE id = ?",
      [bookingId]
    );

    if (!bookingsRows.length) {
      console.log(`getQueuePosition: No booking found for ID ${bookingId}`);
      return null;
    }

    const colony = bookingsRows[0].colony;
    const colonyApplicationNumber = bookingsRows[0].colony_application_number;

    if (String(colony) === "5") {
      console.error(`Inconsistency: bookings has colony 5`);
    }

    const [rows] = await pool.query(
      "SELECT colony_application_number FROM bookings WHERE status = 'pending' AND colony = ? ORDER BY colony_application_number ASC",
      [colony]
    );
    console.log(
      `getQueuePosition: Fetched ${rows.length} pending bookings from bookings for colony ${colony}`
    );

    const numbers = rows.map((row) => row.colony_application_number);
    const position = numbers.indexOf(colonyApplicationNumber);
    return position !== -1 ? position + 1 : null;
  } catch (err) {
    console.error("Error in getQueuePosition:", err);
    throw err;
  }
}

async function resetSessionAndScene(ctx) {
  try {
    console.log(`Resetting session and scene for user ${ctx.from?.id}`);
    if (ctx.scene && ctx.scene.current) {
      console.log(`Leaving scene: ${ctx.scene.current.id}`);
      await ctx.scene.leave();
    }
    ctx.session = ctx.session || {};
    delete ctx.session.__scenes;
    console.log(`Session after reset:`, ctx.session);
  } catch (err) {
    console.error("Error in resetSessionAndScene:", err);
    throw err;
  }
}

bot.command("cancel", async (ctx) => {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);
    await ctx.reply(
      texts[lang].process_canceled,
      buildMainMenu(lang, latestId)
    );
  } catch (err) {
    console.error("Error in /cancel:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
});

bot.command("menu", async (ctx) => {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);
    await ctx.reply(texts[lang].main_menu, buildMainMenu(lang, latestId));
  } catch (err) {
    console.error("Error in /menu:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
});

bot.start(async (ctx) => {
  try {
    const lang = ctx.session.language;
    if (ctx.scene.current) {
      await ctx.reply(texts[lang].already_in_process);
      return;
    }

    await resetSessionAndScene(ctx);

    const userId = ctx.from.id;
    const latestBooking = await getLatestBooking(userId);
    const latestNumber = await getLatestPendingOrApprovedId(userId);

    if (latestBooking && latestBooking.status !== "canceled") {
      let relatives = [];
      try {
        relatives = JSON.parse(latestBooking.relatives || "[]");
      } catch (err) {
        relatives = [];
      }
      const rel1 = relatives[0] || {};
      const name =
        rel1.full_name ||
        (lang === "ru"
          ? "Неизвестно"
          : lang === "uz"
          ? "Номаълум"
          : "Noma'lum");

      if (latestBooking.status === "approved") {
        await ctx.reply(
          texts[lang].approved_status
            .replace("{id}", latestNumber) 
            .replace("{name}", name),
          buildMainMenu(lang, latestNumber)
        );
      } else if (latestBooking.status === "pending") {
        const pos = await getQueuePosition(latestBooking.id); // Передаем id, так как getQueuePosition работает с id
        await ctx.reply(
          pos
            ? texts[lang].pending_status.replace("{pos}", pos)
            : texts[lang].queue_not_found,
          buildMainMenu(lang, latestNumber)
        );
      }
    } else {
      await ctx.reply(texts[lang].greeting, buildMainMenu(lang, null));
    }
  } catch (err) {
    console.error("Error in /start:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
});

bot.hears(texts.uzl.book_meeting, async (ctx) => handleBookMeeting(ctx));
bot.hears(texts.uz.book_meeting, async (ctx) => handleBookMeeting(ctx));
bot.hears(texts.ru.book_meeting, async (ctx) => handleBookMeeting(ctx));

async function handleBookMeeting(ctx) {
  try {
    await resetSessionAndScene(ctx);
    const latest = await getLatestBooking(ctx.from.id);

    if (latest && latest.language && !ctx.session.language) {
      // Устанавливаем язык из последней заявки, только если язык не выбран
      ctx.session.language = latest.language;
    }

    if (!ctx.session.language) {
      // Спрашиваем язык, если он не установлен
      await ctx.reply(
        texts[ctx.session.language || "uzl"].language_prompt,
        Markup.inlineKeyboard([
          [Markup.button.callback("🇺🇿 O‘zbekcha (lotin)", "lang_uzl")],
          [Markup.button.callback("🇺🇿 Ўзбекча (кирилл)", "lang_uz")],
          [Markup.button.callback("🇷🇺 Русский", "lang_ru")],
        ])
      );
    } else {
      // Входим в сцену, если язык уже установлен
      await ctx.scene.enter("booking-wizard");
    }
  } catch (err) {
    console.error("Error in book meeting:", err);
    await ctx.reply(texts[ctx.session.language || "uzl"].error_occurred);
  }
}

bot.action("choose_language", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    texts[ctx.session.language].language_prompt,
    Markup.inlineKeyboard([
      [Markup.button.callback("🇺🇿 O‘zbekcha (lotin)", "lang_uzl")],
      [Markup.button.callback("🇺🇿 Ўзбекча (кирилл)", "lang_uz")],
      [Markup.button.callback("🇷🇺 Русский", "lang_ru")],
    ])
  );
});

bot.action(["lang_uzl", "lang_uz", "lang_ru"], async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });

    ctx.session.language = ctx.match[0].replace("lang_", "");
    delete ctx.session.__scenes;

    console.log(
      `Entering booking-wizard for user ${ctx.from.id} with language ${ctx.session.language}`
    );
    await ctx.scene.enter("booking-wizard");
  } catch (err) {
    console.error(`Error in language selection for user ${ctx.from.id}:`, err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
});

bot.action("start_booking", async (ctx) => {
  try {
    const lang = ctx.session.language;
    const userId = ctx.from.id;
    const existingBookingId = await getLatestPendingOrApprovedId(userId);

    if (existingBookingId) {
      const booking = await getLatestBooking(userId);
      let relatives = [];
      try {
        relatives = JSON.parse(booking.relatives || "[]");
      } catch (err) {
        console.error(
          `JSON parse error for booking ${existingBookingId}:`,
          err
        );
        relatives = [];
      }
      const rel1 = relatives[0] || {};
      const name =
        rel1.full_name ||
        (lang === "ru"
          ? "Неизвестно"
          : lang === "uz"
          ? "Номаълум"
          : "Noma'lum");
      const statusText =
        booking.status === "approved"
          ? texts[lang].status_approved
          : texts[lang].status_pending;

      await ctx.answerCbQuery();
      return ctx.reply(
        texts[lang].existing_application
          .replace("{id}", existingBookingId)
          .replace("{status}", statusText)
          .replace("{name}", name),
        buildMainMenu(lang, existingBookingId)
      );
    }

    const language_before_reset = ctx.session.language;
    await resetSessionAndScene(ctx);
    ctx.session.language = language_before_reset;
    console.log(`Entering booking-wizard for user ${ctx.from.id}`);
    await ctx.answerCbQuery();
    await ctx.scene.enter("booking-wizard");
  } catch (err) {
    console.error("Error in start_booking:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
});

bot.action("cancel", async (ctx) => {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);
    await ctx.answerCbQuery();
    await ctx.reply(
      texts[lang].booking_canceled,
      buildMainMenu(lang, latestId)
    );
  } catch (err) {
    console.error("Error in cancel action:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
});

bot.hears(texts.uzl.queue_status, async (ctx) => handleQueueStatus(ctx));
bot.hears(texts.uz.queue_status, async (ctx) => handleQueueStatus(ctx));
bot.hears(texts.ru.queue_status, async (ctx) => handleQueueStatus(ctx));

async function handleQueueStatus(ctx) {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const latestBooking = await getLatestBooking(ctx.from.id);
    if (!latestBooking || latestBooking.status === "canceled") {
      return ctx.reply(
        texts[lang].no_pending_application,
        buildMainMenu(lang, null)
      );
    }
    const latestId = latestBooking.id;  // Для getQueuePosition нужен primary id
    const latestNumber = latestBooking.colony_application_number;  // Изменено: для меню используем colony_application_number
    const colony = latestBooking.colony;
    let relatives = [];
    try {
      relatives = JSON.parse(latestBooking.relatives || "[]");
    } catch (err) {
      console.error(`JSON parse error for booking ${latestId}:`, err);
      relatives = [];
    }
    const rel1 = relatives[0] || {};
    const name =
      rel1.full_name ||
      (lang === "ru" ? "Неизвестно" : lang === "uz" ? "Номаълум" : "Noma'lum");
    const colony_application_number = latestBooking.colony_application_number;  
    // const locale = lang === "ru" ? "ru-RU" : "uz-UZ";

    if (latestBooking.status === "approved") {
      let visitDate = latestBooking.start_datetime
        ? new Date(
            new Date(latestBooking.start_datetime).setDate(
              new Date(latestBooking.start_datetime).getDate() + 1
            )
          ).toLocaleString("uz-UZ", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            timeZone: "Asia/Tashkent",
          })
        : lang === "ru"
        ? "Неизвестно"
        : lang === "uz"
        ? "Номаълум"
        : "Noma'lum";
      let createdDate = new Date(latestBooking.created_at).toLocaleString(
        "uz-UZ",
        {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          timeZone: "Asia/Tashkent",
        }
      );

      createdDate = createdDate.replace(".", "/");
      createdDate = createdDate.replace(".2", "/2");
      visitDate = visitDate.replace(".", "/");
      visitDate = visitDate.replace(".2", "/2");

      await ctx.reply(
        texts[lang].approved_details
          .replace("{id}", colony_application_number)
          .replace("{name}", name)
          .replace("{colony}", colony)
          .replace("{created}", createdDate)
          .replace("{visit}", visitDate),
        buildMainMenu(lang, latestNumber)  // Изменено: latestNumber вместо latestId
      );
      return;
    } else if (latestBooking.status === "pending") {
      const pos = await getQueuePosition(latestId);
      await ctx.reply(
        pos
          ? texts[lang].pending_status.replace("{pos}", pos)
          : texts[lang].queue_not_found,
        buildMainMenu(lang, latestNumber)  // Изменено: latestNumber вместо latestId
      );
    } else {
      await ctx.reply(
        texts[lang].status_unknown,
        buildMainMenu(lang, latestNumber)  // Изменено: latestNumber вместо latestId
      );
    }
  } catch (err) {
    console.error("Error in queue status:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

bot.hears(texts.uzl.group_join, async (ctx) => handleGroupJoin(ctx));
bot.hears(texts.uz.group_join, async (ctx) => handleGroupJoin(ctx));
bot.hears(texts.ru.group_join, async (ctx) => handleGroupJoin(ctx));

async function handleGroupJoin(ctx) {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const latestBooking = await getLatestBooking(ctx.from.id);
    if (!latestBooking) {
      await ctx.reply(texts[lang].no_booking_found);
      return;
    }

    const colony = latestBooking.colony;
    let groupUrl = "https://t.me/+qWg7Qh3t_OIxMDBi";

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
        groupUrl = "https://t.me/SmartJIEK10";
        break;
      case "11":
        groupUrl = "https://t.me/SmartJIEK11";
        break;
      case "12":
        groupUrl = "https://t.me/SmartJIEK12";
        break;
      case "13":
        groupUrl = "https://t.me/SmartJIEK13";
        break;
      case "14":
        groupUrl = "https://t.me/SmartJIEK14";
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
      texts[lang].group_join_prompt,
      Markup.inlineKeyboard([
        [Markup.button.url(texts[lang].group_join_button, groupUrl)],
      ])
    );
  } catch (err) {
    console.error("Error in group join:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

bot.hears(texts.uzl.colony_location_button, async (ctx) =>
  handleColonyLocation(ctx)
);
bot.hears(texts.uz.colony_location_button, async (ctx) =>
  handleColonyLocation(ctx)
);
bot.hears(texts.ru.colony_location_button, async (ctx) =>
  handleColonyLocation(ctx)
);

async function handleColonyLocation(ctx) {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const latestBooking = await getLatestBooking(ctx.from.id);
    if (!latestBooking || latestBooking.status === "canceled") {
      return ctx.reply(
        texts[lang].no_active_application,
        buildMainMenu(lang, null)
      );
    }

    const colony = latestBooking.colony;
    const latestNumber = latestBooking.colony_application_number;  // Изменено: для меню
    const [coordRows] = await pool.query(
      "SELECT longitude, latitude FROM coordinates WHERE id = ?",
      [colony]
    );

    if (!coordRows.length) {
      return ctx.reply(texts[lang].coordinates_not_found);
    }

    const { longitude, latitude } = coordRows[0];
    await ctx.replyWithLocation(longitude, latitude);
    await ctx.reply(
      texts[lang].colony_location.replace("{colony}", colony),
      buildMainMenu(lang, latestNumber)  // Изменено: latestNumber вместо id
    );
  } catch (err) {
    console.error("Error in colony location:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

bot.hears(texts.uzl.no, async (ctx) => handleNoCancel(ctx));
bot.hears(texts.uz.no, async (ctx) => handleNoCancel(ctx));
bot.hears(texts.ru.no, async (ctx) => handleNoCancel(ctx));

async function handleNoCancel(ctx) {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    ctx.session.confirmCancel = false;
    ctx.session.confirmCancelId = null;

    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);

    await ctx.reply(texts[lang].cancel_no, buildMainMenu(lang, latestId));
  } catch (err) {
    console.error("Error in no cancel:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

bot.hears(/^❌ Arizani bekor qilish(?:\s*#(\d+))?$/i, async (ctx) =>
  handleCancelApplication(ctx)
); // uzl
bot.hears(/^❌ Аризани бекор қилиш(?:\s*#(\d+))?$/i, async (ctx) =>
  handleCancelApplication(ctx)
); // uz
bot.hears(/^❌ Отменить заявку(?:\s*#(\d+))?$/i, async (ctx) =>
  handleCancelApplication(ctx)
); // ru

async function handleCancelApplication(ctx) {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const explicitNumber = ctx.match && ctx.match[1] ? Number(ctx.match[1]) : null;
    const latestNumber =
      explicitNumber || (await getLatestPendingOrApprovedId(ctx.from.id));

    if (!latestNumber) {
      await ctx.reply(
        texts[lang].new_booking_prompt,
        buildMainMenu(lang, null)
      );
      return;
    }

    // Изменено: поиск по colony_application_number, а не по id
    const [bookingRows] = await pool.query(
      "SELECT id FROM bookings WHERE colony_application_number = ? AND user_id = ?",
      [latestNumber, ctx.from.id]
    );

    if (!bookingRows.length) {
      await ctx.reply(
        texts[lang].booking_not_found_or_canceled,
        buildMainMenu(lang, null)
      );
      return;
    }

    const bookingId = bookingRows[0].id;

    ctx.session.confirmCancel = true;
    ctx.session.confirmCancelId = bookingId;

    await ctx.reply(
      texts[lang].cancel_confirm,
      Markup.keyboard([[texts[lang].yes, texts[lang].no]]).resize()
    );
  } catch (err) {
    console.error("Error in cancel application:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

bot.hears(texts.uzl.yes, async (ctx) => handleYesCancel(ctx));
bot.hears(texts.uz.yes, async (ctx) => handleYesCancel(ctx));
bot.hears(texts.ru.yes, async (ctx) => handleYesCancel(ctx));

async function handleYesCancel(ctx) {
  try {
    const lang = ctx.session.language;
    const bookingId = ctx.session.confirmCancelId;
    if (!ctx.session.confirmCancel || !bookingId) {
      await resetSessionAndScene(ctx);
      return ctx.reply(texts[lang].no_cancel_booking);
    }

    ctx.session.confirmCancel = false;
    ctx.session.confirmCancelId = null;

    const [bookingsRows] = await pool.query(
      "SELECT colony, relatives, colony_application_number FROM bookings WHERE id = ? AND user_id = ?",
      [bookingId, ctx.from.id]
    );

    if (!bookingsRows.length) {
      await resetSessionAndScene(ctx);
      return ctx.reply(texts[lang].booking_not_found_or_canceled);
    }

    const colony = bookingsRows[0].colony;
    const colonyApplicationNumber = bookingsRows[0].colony_application_number;
    let bookingName =
      lang === "ru" ? "Неизвестно" : lang === "uz" ? "Номаълум" : "Noma'lum";

    if (bookingsRows[0].relatives) {
      try {
        const relatives = JSON.parse(bookingsRows[0].relatives);
        if (Array.isArray(relatives) && relatives.length > 0) {
          bookingName = relatives[0].full_name || bookingName;
        }
      } catch (e) {
        console.error("JSON parse error for booking cancellation:", e);
      }
    }

    const [result] = await pool.query(
      "DELETE FROM bookings WHERE id = ? AND user_id = ?",
      [bookingId, ctx.from.id]
    );

    if (result.affectedRows === 0) {
      console.log(
        `Deletion failed: No rows affected for bookingId=${bookingId}, user_id=${ctx.from.id}`
      );
      await resetSessionAndScene(ctx);
      return ctx.reply(texts[lang].booking_not_found_or_canceled);
    }

    const latestNumberAfterDelete = await getLatestPendingOrApprovedId(ctx.from.id);
    await ctx.reply(
      texts[lang].application_canceled,
      buildMainMenu(lang, latestNumberAfterDelete)
    );

    await resetSessionAndScene(ctx);
  } catch (err) {
    console.error("Error in yes cancel:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

bot.on(message("text"), async (ctx, next) => {
  try {
    const lang = ctx.session.language;
    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);
    buildMainMenu(lang, latestId);

    if (ctx.scene && ctx.scene.current) {
      console.log(
        texts[lang].unexpected_text_ignore
          .replace("{id}", ctx.from.id)
          .replace("{scene}", ctx.scene.current.id)
          .replace("{text}", ctx.message.text)
      );
      return;
    }

    await next();
  } catch (err) {
    console.error("Error in text handler:", err);
    await ctx.reply(texts[ctx.session.language].global_error_reply);
  }
});

bot.catch((err, ctx) => {
  console.error("Global error:", err);
  const lang = ctx.session?.language || "uzl"; 
  if (err.response && err.response.error_code === 403) {
    console.warn(`⚠️ User ${ctx.from?.id} blocked the bot, skip message`);
  } else {
    ctx.reply(texts[lang].global_error_reply);
  }
});

bot.hears("Yangi ariza yuborish", async (ctx) => {
  // Legacy, assume uzl
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const userId = ctx.from.id;
    const existingBookingId = await getLatestPendingOrApprovedId(userId);

    if (existingBookingId) {
      const booking = await getLatestBooking(userId);
      let relatives = [];
      try {
        relatives = JSON.parse(booking.relatives || "[]");
      } catch (err) {
        console.error(
          `JSON parse error for booking ${existingBookingId}:`,
          err
        );
        relatives = [];
      }
      const rel1 = relatives[0] || {};
      const name =
        rel1.full_name ||
        (lang === "ru"
          ? "Неизвестно"
          : lang === "uz"
          ? "Номаълум"
          : "Noma'lum");
      const statusText =
        booking.status === "approved"
          ? texts[lang].status_approved
          : texts[lang].status_pending;

      return ctx.reply(
        texts[lang].existing_application
          .replace("{id}", existingBookingId)
          .replace("{status}", statusText)
          .replace("{name}", name),
        buildMainMenu(lang, existingBookingId)
      );
    }

    await ctx.scene.enter("booking-wizard");
  } catch (err) {
    console.error("Error in new application:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
});

bot.hears(texts.uzl.application_copy, async (ctx) =>
  handleApplicationCopy(ctx)
);
bot.hears(texts.uz.application_copy, async (ctx) => handleApplicationCopy(ctx));
bot.hears(texts.ru.application_copy, async (ctx) => handleApplicationCopy(ctx));

async function handleApplicationCopy(ctx) {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const latestBooking = await getLatestBooking(ctx.from.id);
    if (!latestBooking) {
      return ctx.reply(texts[lang].no_application, buildMainMenu(lang, null));
    }
    const booking = latestBooking;

    const [libRows] = await pool.query("SELECT * FROM library LIMIT 1");
    const library = libRows[0] || { placeNumber: "", commander: "" };

    let relatives = [];
    try {
      relatives = booking.relatives ? JSON.parse(booking.relatives) : [];
    } catch (e) {
      console.error(
        `JSON parse error for booking ${booking.id} in document generation:`,
        e
      );
    }

    const rel1 = relatives[0] || {};
    const rel2 = relatives[1] || {};
    const rel3 = relatives[2] || {};

    let templatePath = path.join(__dirname, `ariza_${lang}.docx`);
    if (!fs.existsSync(templatePath)) {
      templatePath = path.join(__dirname, "ariza.docx"); // Fallback
    }
    const content = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(content);

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });

    // const locale = lang === "ru" ? "ru-RU" : "uz-UZ";

    doc.render({
      placeNumber: library.placeNumber,
      commander: library.commander,
      fullname: rel1.full_name || "",
      fullname2:
        rel2.full_name ||
        "____________________________________________________",
      fullname3:
        rel3.full_name ||
        "____________________________________________________",
      prisoner: booking.prisoner_name || "",
      arizaNumber: booking.colony_application_number || "",
      today: new Date().toLocaleDateString("uz-UZ"),
    });

    const buf = doc.getZip().generate({ type: "nodebuffer" });

    await ctx.replyWithDocument({
      source: buf,
      filename: `ariza_${booking.colony_application_number}.docx`,
    });
  } catch (err) {
    console.error("Error in application copy:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

bot.hears(texts.uzl.visitor_reminder, async (ctx) =>
  handleVisitorReminder(ctx)
);
bot.hears(texts.uz.visitor_reminder, async (ctx) => handleVisitorReminder(ctx));
bot.hears(texts.ru.visitor_reminder, async (ctx) => handleVisitorReminder(ctx));

async function handleVisitorReminder(ctx) {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    const pdfFile = `tashrif_${lang}.pdf`;
    const pdfPath = path.join(__dirname, pdfFile);
    if (fs.existsSync(pdfPath)) {
      await ctx.replyWithDocument({ source: pdfPath });
    } else {
      await ctx.reply(texts[lang].file_not_found);
    }
  } catch (err) {
    console.error("Error in visitor reminder:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

bot.hears(texts.uzl.additional_info_button, async (ctx) =>
  handleAdditionalInfo(ctx)
);
bot.hears(texts.uz.additional_info_button, async (ctx) =>
  handleAdditionalInfo(ctx)
);
bot.hears(texts.ru.additional_info_button, async (ctx) =>
  handleAdditionalInfo(ctx)
);

async function handleAdditionalInfo(ctx) {
  try {
    const lang = ctx.session.language;
    await resetSessionAndScene(ctx);
    await ctx.reply(texts[lang].additional_info);
  } catch (err) {
    console.error("Error in additional info:", err);
    await ctx.reply(texts[ctx.session.language].error_occurred);
  }
}

bot.hears(texts.uzl.change_language, async (ctx) => handleChangeLanguage(ctx));
bot.hears(texts.uz.change_language, async (ctx) => handleChangeLanguage(ctx));
bot.hears(texts.ru.change_language, async (ctx) => handleChangeLanguage(ctx));

async function handleChangeLanguage(ctx) {
  try {
    await resetSessionAndScene(ctx);
    await ctx.reply(
      texts[ctx.session.language || "uzl"].language_prompt,
      Markup.inlineKeyboard([
        [Markup.button.callback("🇺🇿 O‘zbekcha (lotin)", "ch_lang_uzl")],
        [Markup.button.callback("🇺🇿 Ўзбекча (кирилл)", "ch_lang_uz")],
        [Markup.button.callback("🇷🇺 Русский", "ch_lang_ru")],
      ])
    );
  } catch (err) {
    console.error("Error in change language:", err);
    await ctx.reply(texts[ctx.session.language || "uzl"].error_occurred);
  }
}

bot.action(["ch_lang_uzl", "ch_lang_uz", "ch_lang_ru"], async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });

    ctx.session.language = ctx.match[0].replace("ch_lang_", "");
    const lang = ctx.session.language;
    const latestId = await getLatestPendingOrApprovedId(ctx.from.id);
    await ctx.reply(texts[lang].main_menu, buildMainMenu(lang, latestId));
  } catch (err) {
    console.error(`Error in change language selection for user ${ctx.from.id}:`, err);
    await ctx.reply(texts[ctx.session.language || "uzl"].error_occurred);
  }
});

bot.launch().then(() => console.log("🚀 Bot ishga tushdi"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));