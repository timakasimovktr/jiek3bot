const { Markup } = require("telegraf");
const pool = require("../../db.js");
const texts = require("../texts.js");
const { MAX_RELATIVES } = require("../constants/config.js");

async function askAddMore(ctx) {
  const lang = ctx.session.language;
  // if (ctx.wizard.state.relatives.length < MAX_RELATIVES) {
  //   await ctx.reply(
  //     texts[lang].add_more_prompt,
  //     Markup.inlineKeyboard([
  //       [Markup.button.callback(texts[lang].yes_add, "add_more")],
  //       [Markup.button.callback(texts[lang].no_done, "done")],
  //     ])
  //   );
  //   return ctx.wizard.selectStep(8);
  // } else {
  //   await ctx.reply(texts[lang].max_reached);
  //   return showSummary(ctx);
  // }
  return showSummary(ctx);
}

async function showSummary(ctx) {
  const lang = ctx.session.language;
  const { prisoner_name, relatives, colony } = ctx.wizard.state;
  let text = texts[lang].summary_title + "\n";
  text += texts[lang].summary_colony(colony) + "\n";
  text += texts[lang].summary_prisoner(prisoner_name) + "\n\n";
  relatives.forEach((r, i) => {
    text += texts[lang].summary_relative(i, r.full_name) + "\n";
  });
  text += texts[lang].confirm_prompt;

  await ctx.reply(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback(texts[lang].confirm_button, "confirm")],
      [Markup.button.callback(texts[lang].cancel_button, "cancel")],
    ])
  );
  return ctx.wizard.selectStep(9);
}

async function saveBooking(ctx) {
  const lang = ctx.session.language;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  try {
    const phone = ctx.wizard.state.phone;
    const colony = ctx.wizard.state.colony;
    const visit_type = ctx.wizard.state.visit_type;
    const prisoner_name = ctx.wizard.state.prisoner_name.toUpperCase();
    const relatives = JSON.stringify(ctx.wizard.state.relatives.map(rel => ({
      full_name: rel.full_name.toUpperCase(),
      passport: rel.passport || "AC1234567" // Или генерируйте паспорт, если нужно
    })));

    let bookingId = ctx.wizard.state.bookingId; // Если возобновляем после оплаты

    if (bookingId) {
      // Обновляем существующую запись после оплаты
      await pool.query(
        `UPDATE bookings 
         SET visit_type = ?, prisoner_name = ?, relatives = ?, status = 'pending', language = ?
         WHERE id = ? AND user_id = ? AND payment_status = 'paid'`,
        [visit_type, prisoner_name, relatives, lang, bookingId, userId]
      );

      // Проверяем, обновилось ли
      const [updatedRows] = await pool.query(
        "SELECT id FROM bookings WHERE id = ? AND status = 'pending'",
        [bookingId]
      );
      if (!updatedRows.length) {
        await ctx.reply(texts[lang].error_occurred);
        return ctx.scene.leave();
      }
    } else {
      // Создаём новую запись (для неплатных колоний или после оплаты)
      const payment_status = paidColonies.includes(colony) ? 'paid' : 'not_required'; // Если нужно отличать
      const [insertResult] = await pool.query(
        `INSERT INTO bookings 
         (user_id, telegram_chat_id, phone_number, colony, visit_type, prisoner_name, relatives, language, status, payment_status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [userId, chatId, phone, colony, visit_type, prisoner_name, relatives, lang, payment_status]
      );
      bookingId = insertResult.insertId;
    }

    // Генерация номера заявки в колонии (colony_application_number)
    // Предполагаем, что есть логика генерации уникального номера для каждой колонии
    const applicationNumber = await generateApplicationNumber(colony); // Реализуйте эту функцию отдельно
    await pool.query(
      "UPDATE bookings SET colony_application_number = ? WHERE id = ?",
      [applicationNumber, bookingId]
    );

    // Здесь добавьте дополнительную логику: отправка в очередь, уведомления админам и т.д.
    // Например, расчет позиции в очереди или сохранение в другую таблицу

    const latestNumber = applicationNumber; // Или используйте getLatestPendingOrApprovedId если нужно

    // Показываем summary или подтверждение
    let relativesList = ctx.wizard.state.relatives.map((rel, index) => 
      `${index + 1}. ${rel.full_name}`
    ).join('\n');

    await ctx.reply(
      texts[lang].booking_summary
        .replace("{colony}", colony)
        .replace("{visit_type}", visit_type === 'short' ? texts[lang].short_visit : texts[lang].long_visit)
        .replace("{prisoner}", prisoner_name)
        .replace("{relatives}", relativesList)
        .replace("{number}", latestNumber),
      buildMainMenu(lang, latestNumber)
    );

    // Уведомление об успехе
    await ctx.reply(texts[lang].booking_saved);

    // Если это платная колония, можно сбросить attempts или другую логику
    if (paidColonies.includes(colony)) {
      // Уже обработано в callback
    }

    return ctx.scene.leave();
  } catch (err) {
    console.error("Error in saveBooking:", err);
    await ctx.reply(texts[lang].error_occurred);
    return ctx.scene.leave();
  }
}

async function sendApplicationToClient(ctx, application) {
  const firstRelative = application.relatives[0];
  const name = firstRelative
    ? `${firstRelative.full_name}`
    : application.lang === "ru"
    ? "Неизвестно"
    : application.lang === "uz"
    ? "Номаълум"
    : "Noma'lum";

  const locale = application.lang === "ru" ? "ru-RU" : "uz-UZ";
  const date = new Date().toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const isLong = application.visit_type === "long";
  const text = `${texts[application.lang].admin_new(application.id)} 
${texts[application.lang].admin_applicant(name)}
${texts[application.lang].admin_colony(application.colony)}
${texts[application.lang].admin_date(date)}
${texts[application.lang].admin_type(isLong)}
${texts[application.lang].admin_status}`;

  try {
    await ctx.telegram.sendMessage(application.telegram_id, text);
  } catch (err) {
    console.error("Error sending message:", err);
  }
}

module.exports = { askAddMore, showSummary, saveBooking, sendApplicationToClient };
