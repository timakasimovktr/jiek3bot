// bookingScene.js (refactored)
const { Scenes, Markup } = require("telegraf");
const pool = require("./db.js");
const texts = require("./texts.js");
const { generateColonyKeyboard } = require("./helpers/keyboards.js");
const {
  askAddMore,
  showSummary,
  saveBooking,
} = require("./helpers/bookingUtils.js");
const { MAX_RELATIVES } = require("./constants/config.js");

const paidColonies = ["24"];
const PAYMENT_AMOUNT = 12500;

const bookingWizard = new Scenes.WizardScene(
  "booking-wizard",

  // Step 0: Phone check and request
  async (ctx) => {
    const lang = ctx.session.language || "uzl";
    try {
      console.log(`Step 0: Starting for user ${ctx.from.id}`);

      if (!ctx.wizard) {
        console.error(`ctx.wizard is undefined for user ${ctx.from.id}`);
        await ctx.reply(texts[lang].internal_error);
        return ctx.scene.leave();
      }

      ctx.wizard.state = {};

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
          texts[lang].existing_pending,
          Markup.keyboard([
            [texts[lang].queue_status],
            [texts[lang].cancel_text],
          ]).resize()
        );
        return ctx.scene.leave();
      }

      const [userRows] = await pool.query(
        `SELECT phone_number
         FROM bookings
         WHERE user_id = ?
         ORDER BY created_at DESC LIMIT 1`,
        [ctx.from.id]
      );
      console.log(`Step 0: Phone query result for user ${ctx.from.id}:`, userRows);

      if (userRows.length > 0 && userRows[0].phone_number) {
        ctx.wizard.state.phone = userRows[0].phone_number;
        ctx.wizard.state.offerRequested = true;
        await ctx.reply(texts[lang].phone_saved, Markup.removeKeyboard());
        await ctx.reply(
          texts[lang].offer_prompt,
          Markup.inlineKeyboard([
            [
              Markup.button.url(
                texts[lang].read_offer,
                "https://telegra.ph/PUBLICHNAYA-OFERTA-09-14-7"
              ),
            ],
            [Markup.button.callback(texts[lang].accept_offer, "accept_offer")],
          ])
        );
        console.log(`Step 0: Moving to Step 2 for user ${ctx.from.id} with phone ${ctx.wizard.state.phone}`);
        return ctx.wizard.selectStep(2);
      }

      ctx.wizard.state.offerRequested = false;
      await ctx.reply(
        texts[lang].request_phone,
        Markup.keyboard([
          [Markup.button.contactRequest(texts[lang].contact_button)],
        ])
          .resize()
          .oneTime()
      );
      console.log(`Step 0: Requesting phone number for user ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      console.error(`Error in Step 0 for user ${ctx.from.id}:`, err);
      await ctx.reply(texts[lang].error);
      return ctx.scene.leave();
    }
  },

  // Step 1: Accept only contact
  async (ctx) => {
    const lang = ctx.session.language || "uzl";
    try {
      console.log(`Step 1: Starting for user ${ctx.from.id}, message:`, ctx.message, `wizard state:`, ctx.wizard.state);

      if (!ctx.message?.contact?.phone_number) {
        ctx.wizard.state.retryCount = (ctx.wizard.state.retryCount || 0) + 1;

        if (ctx.wizard.state.retryCount > 2) {
          await ctx.reply(texts[lang].too_many_retries, Markup.removeKeyboard());
          console.log(`Step 1: Too many retries for user ${ctx.from.id}`);
          return ctx.scene.leave();
        }

        await ctx.reply(
          texts[lang].retry_phone,
          Markup.keyboard([
            [Markup.button.contactRequest(texts[lang].retry_contact_button)],
          ])
            .resize()
            .oneTime()
        );
        console.log(`Step 1: Requesting phone retry for user ${ctx.from.id}`);
        return;
      }

      ctx.wizard.state.phone = ctx.message.contact.phone_number;
      ctx.wizard.state.offerRequested = true;
      await ctx.reply(texts[lang].phone_accepted, Markup.removeKeyboard());
      console.log(`Step 1: Phone received for user ${ctx.from.id}: ${ctx.wizard.state.phone}`);

      await ctx.reply(
        texts[lang].offer_prompt,
        Markup.inlineKeyboard([
          [
            Markup.button.url(
              texts[lang].read_offer,
              "https://telegra.ph/PUBLICHNAYA-OFERTA-09-14-7"
            ),
          ],
          [Markup.button.callback(texts[lang].accept_offer, "accept_offer")],
        ])
      );
      console.log(`Step 1: Offer requested for user ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      console.error(`Error in Step 1 for user ${ctx.from.id}:`, err);
      await ctx.reply(texts[lang].error);
      return ctx.scene.leave();
    }
  },

  // Step 2: Accept public offer
  async (ctx) => {
    const lang = ctx.session.language || "uzl";
    console.log(`Step 2: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}, message: ${ctx.message?.text}`);

    if (!ctx.callbackQuery?.data || ctx.callbackQuery.data !== "accept_offer") {
      await ctx.reply(
        texts[lang].offer_prompt,
        Markup.inlineKeyboard([
          [
            Markup.button.url(
              texts[lang].read_offer,
              "https://telegra.ph/PUBLICHNAYA-OFERTA-09-14-7"
            ),
          ],
          [Markup.button.callback(texts[lang].accept_offer, "accept_offer")],
        ])
      );
      return;
    }

    await ctx.answerCbQuery();
    ctx.wizard.state.offer_accepted = true;

    await ctx.reply(texts[lang].select_colony, generateColonyKeyboard(lang));
    console.log(`Step 2: Moving to colony selection for user ${ctx.from.id}`);
    return ctx.wizard.next();
  },

  // Step 3: Select colony (with payment handling)
  async (ctx) => {
    const lang = ctx.session.language || "uzl";
    console.log(`Step 3: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}, message: ${ctx.message?.text}`);

    // Handle continue after payment
    if (ctx.callbackQuery?.data === "continue_after_payment") {
      await ctx.answerCbQuery();
      const [paymentRows] = await pool.query(
        `SELECT status FROM payments WHERE user_id = ? AND payload = ? AND status = 'successful'`,
        [ctx.from.id, ctx.wizard.state.paymentPayload]
      );
      if (paymentRows.length === 0 || paymentRows[0].status !== "successful") {
        await ctx.reply(texts[lang].payment_not_verified || "Оплата не подтверждена.");
        return ctx.scene.leave();
      }

      await proceedToVisitType(ctx);
      return ctx.wizard.next();
    }

    // Handle cancel payment
    if (ctx.callbackQuery?.data === "cancel_payment") {
      await ctx.answerCbQuery();
      await pool.query("DELETE FROM payments WHERE payload = ?", [ctx.wizard.state.paymentPayload]);
      await ctx.reply(
        texts[lang].payment_canceled || "Оплата отменена. Запишитесь на встречу заново.",
        Markup.inlineKeyboard([
          [Markup.button.callback(texts[lang].book_meeting, "start_booking")],
        ])
      );
      ctx.session = { language: ctx.session.language };
      ctx.wizard.state = {};
      return;
    }

    // If payment pending, resend invoice if needed
    if (ctx.wizard.state.paymentPayload) {
      if (ctx.message || !ctx.callbackQuery) {
        const [paymentRows] = await pool.query(
          `SELECT status, amount FROM payments WHERE user_id = ? AND payload = ?`,
          [ctx.from.id, ctx.wizard.state.paymentPayload]
        );
        if (paymentRows.length > 0 && paymentRows[0].status === "pending") {
          const amount = paymentRows[0].amount;
          await sendPaymentInvoice(ctx, amount);
        } else {
          await ctx.reply(texts[lang].payment_already_processed || "Оплата уже обработана.");
          return ctx.scene.leave();
        }
        return;
      }
      return;
    }

    // Colony selection
    const data = ctx.callbackQuery?.data;
    if (!data || !data.startsWith("colony_")) {
      await ctx.reply(texts[lang].select_colony, generateColonyKeyboard(lang));
      return;
    }

    await ctx.answerCbQuery();
    ctx.wizard.state.colony = data.replace("colony_", "");
    const requiresPayment = paidColonies.includes(ctx.wizard.state.colony);
    const [attemptsLeftRows] = await pool.query(
      `SELECT attempts FROM payments WHERE phone_number = ?`,
      [ctx.wizard.state.phone]
    );
    const attemptsLeft = attemptsLeftRows[0]?.attempts || 0;
    console.log("phone:", ctx.wizard.state.phone, "attemptsLeft:", attemptsLeft);
    if (requiresPayment) {
      if (!ctx.wizard.state.paymentPayload) {
        const payload = `application_payment_${ctx.from.id}_${Date.now()}`;
        await pool.query(
          `INSERT INTO payments (user_id, amount, currency, status, payload, created_at, phone_number)
           VALUES (?, ?, 'UZS', 'pending', ?, CURRENT_TIMESTAMP, ?)`,
          [ctx.from.id, PAYMENT_AMOUNT, payload, ctx.wizard.state.phone]
        );
        ctx.wizard.state.paymentPayload = payload;
      }

      await sendPaymentInvoice(ctx, PAYMENT_AMOUNT);
      console.log(`Step 3: Invoice sent for paid colony ${ctx.wizard.state.colony}, user ${ctx.from.id}`);
      return;
    }

    await proceedToVisitType(ctx);
    return ctx.wizard.next();
  },

  // Step 4: Select visit type
  async (ctx) => {
    const lang = ctx.session.language || "uzl";
    console.log(`Step 4: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}`);

    if (!ctx.callbackQuery?.data || (ctx.callbackQuery.data !== "long" && ctx.callbackQuery.data !== "short")) {
      await ctx.reply(
        texts[lang].select_visit_type,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(texts[lang].short_visit, "short"),
            Markup.button.callback(texts[lang].long_visit, "long"),
          ],
        ])
      );
      return;
    }

    await ctx.answerCbQuery();
    ctx.wizard.state.visit_type = ctx.callbackQuery.data;

    await ctx.reply(texts[lang].enter_full_name);
    return ctx.wizard.next();
  },

  // Step 5: Full name
  async (ctx) => {
    const lang = ctx.session.language || "uzl";
    console.log(`Step 5: User ${ctx.from.id} sent text: ${ctx.message?.text}`);

    if (ctx.message?.text === texts[lang].cancel_text) {
      await ctx.reply(
        texts[lang].booking_canceled,
        Markup.inlineKeyboard([
          [Markup.button.callback(texts[lang].book_meeting, "start_booking")],
        ])
      );
      return ctx.scene.leave();
    }

    if (!ctx.message?.text) {
      await ctx.reply(texts[lang].invalid_name);
      return ctx.wizard.selectStep(5);
    }

    ctx.wizard.state.currentRelative = {
      full_name: ctx.message.text.toUpperCase(),
      passport: "AC1234567", // Default or placeholder
    };
    ctx.wizard.state.relatives.push(ctx.wizard.state.currentRelative);

    if (!ctx.wizard.state.prisoner_name) {
      await ctx.reply(texts[lang].enter_prisoner_name);
      return ctx.wizard.selectStep(7);
    } else {
      return askAddMore(ctx);
    }
  },

  // Step 6: Placeholder (skipped)
  async (ctx) => {
    return ctx.wizard.next();
  },

  // Step 7: Prisoner name
  async (ctx) => {
    const lang = ctx.session.language || "uzl";
    console.log(`Step 7: User ${ctx.from.id} sent text: ${ctx.message?.text}`);

    if (!ctx.message?.text) {
      await ctx.reply(texts[lang].invalid_prisoner);
      return ctx.wizard.selectStep(7);
    }

    ctx.wizard.state.prisoner_name = ctx.message.text.toUpperCase();
    return askAddMore(ctx);
  },

  // Step 8: Add more or done
  async (ctx) => {
    const lang = ctx.session.language || "uzl";
    console.log(`Step 8: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}`);

    if (ctx.callbackQuery) await ctx.answerCbQuery();

    if (ctx.callbackQuery?.data === "add_more") {
      if (ctx.wizard.state.relatives.length < MAX_RELATIVES) {
        ctx.wizard.state.currentRelative = {};
        await ctx.reply(texts[lang].new_relative);
        return ctx.wizard.selectStep(5);
      } else {
        await ctx.reply(texts[lang].max_reached);
        return showSummary(ctx);
      }
    } else if (ctx.callbackQuery?.data === "done") {
      return showSummary(ctx);
    } else {
      await ctx.reply(
        texts[lang].add_more_prompt,
        Markup.inlineKeyboard([
          [Markup.button.callback(texts[lang].yes_add, "add_more")],
          [Markup.button.callback(texts[lang].no_done, "done")],
        ])
      );
      return;
    }
  },

  // Step 9: Final confirm or cancel
  async (ctx) => {
    const lang = ctx.session.language || "uzl";
    console.log(`Step 9: User ${ctx.from.id} action: ${ctx.callbackQuery?.data}, message: ${ctx.message?.text}`);

    if (ctx.callbackQuery) await ctx.answerCbQuery();

    if (ctx.callbackQuery?.data === "confirm") {
      const bookingId = await saveBooking(ctx);
      if (bookingId && ctx.wizard.state.paymentPayload) {
        await pool.query(
          `UPDATE payments SET booking_id = ? WHERE user_id = ? AND payload = ?`,
          [bookingId, ctx.from.id, ctx.wizard.state.paymentPayload]
        );
      }
      return;
    } else if (ctx.callbackQuery?.data === "cancel") {
      await ctx.reply(
        texts[lang].booking_canceled,
        Markup.inlineKeyboard([
          [Markup.button.callback(texts[lang].book_meeting, "start_booking")],
        ])
      );
      return ctx.scene.leave();
    } else {
      await ctx.reply(
        texts[lang].confirm_prompt,
        Markup.inlineKeyboard([
          [Markup.button.callback(texts[lang].confirm_button, "confirm")],
          [Markup.button.callback(texts[lang].cancel_button, "cancel")],
        ])
      );
      return;
    }
  }
);

// Helper: Proceed to visit type selection
async function proceedToVisitType(ctx) {
  const lang = ctx.session.language || "uzl";
  ctx.wizard.state.relatives = [];
  ctx.wizard.state.currentRelative = {};
  ctx.wizard.state.prisoner_name = null;
  ctx.wizard.state.visit_type = null;

  await ctx.reply(
    texts[lang].select_visit_type,
    Markup.inlineKeyboard([
      [
        Markup.button.callback(texts[lang].short_visit, "short"),
        Markup.button.callback(texts[lang].long_visit, "long"),
      ],
    ])
  );
}

// Helper: Send payment invoice
async function sendPaymentInvoice(ctx, amount) {
  const lang = ctx.session.language || "uzl";
  await ctx.replyWithInvoice({
    title: texts[lang].payment_title || "Оплата заявки",
    description: texts[lang].payment_desc || "Оплата 12500 сум за подачу заявки в платную колонию",
    payload: ctx.wizard.state.paymentPayload,
    provider_token: process.env.PROVIDER_TOKEN,
    currency: "UZS",
    prices: [{ label: "Заявка", amount: amount * 100 }], // in tiyin
  });

  await ctx.reply(
    texts[lang].pay_or_cancel || "Оплатите или отмените.",
    Markup.inlineKeyboard([
      [Markup.button.callback(texts[lang].cancel_button || "Отмена", "cancel_payment")],
    ])
  );
}

module.exports = bookingWizard;