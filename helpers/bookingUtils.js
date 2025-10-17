const { Markup } = require("telegraf");
const pool = require("../db.js");
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
  const { prisoner_name, relatives, visit_type, colony } = ctx.wizard.state;
  const chatId = ctx.chat.id;

  try {
    const [maxNumberRows] = await pool.query(
      `SELECT MAX(colony_application_number) as max_number FROM bookings WHERE colony = ?`,
      [colony]
    );
    const maxNumber = maxNumberRows[0].max_number || 0;
    const newColonyApplicationNumber = maxNumber + 1;

    const [result] = await pool.query(
      `INSERT INTO bookings (user_id, phone_number, visit_type, prisoner_name, relatives, colony, status, telegram_chat_id, colony_application_number, language)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        ctx.from.id,
        ctx.wizard.state.phone,
        visit_type,
        prisoner_name,
        JSON.stringify(relatives),
        colony,
        chatId,
        newColonyApplicationNumber,
        lang,
      ]
    );

    const bookingId = result.insertId;

    await ctx.scene.leave();
    await sendApplicationToClient(ctx, {
      relatives,
      prisoner: prisoner_name,
      id: newColonyApplicationNumber,
      visit_type,
      colony,
      lang,
      telegram_id: ctx.from.id,
    });

    const [rows] = await pool.query(
      `SELECT * FROM bookings WHERE status = 'pending' AND colony = ? ORDER BY colony_application_number ASC`,
      [colony]
    );
    const myIndex = rows.findIndex((b) => b.id === bookingId);
    const position = myIndex + 1;

    await ctx.reply(
      texts[lang].booking_saved(position),
      Markup.keyboard([
        [texts[lang].queue_status],
        [texts[lang].cancel_application(newColonyApplicationNumber)],
      ])
        .resize()
        .oneTime(false)
    );

    const groupUrl = `https://t.me/SmartJIEK${colony}`;
    await ctx.reply(
      texts[lang].join_group,
      Markup.inlineKeyboard([
        [Markup.button.url(texts[lang].group_button(colony), groupUrl)],
        [Markup.button.url(texts[lang].moneyGroup, "https://t.me/smartdunyopaygroup")]
      ])
    );
  } catch (err) {
    await ctx.reply(texts[lang].error);
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
  }
}

module.exports = { askAddMore, showSummary, saveBooking, sendApplicationToClient };
