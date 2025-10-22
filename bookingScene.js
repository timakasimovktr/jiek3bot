// bookingScene.js (refactored, readable, structured with ctx handling)

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
      if (!ctx.wizard) {
        await ctx.reply(texts[lang].internal_error);
        return ctx.scene.leave();
      }
      ctx.wizard.state = {}; // Reset state

      // Check existing pending
      const [rows] = await pool.query(
        `SELECT id, status, created_at FROM bookings WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
        [ctx.from.id]
      );
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

      // Check last phone
      const [userRows] = await pool.query(
        `SELECT phone_number FROM bookings WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
        [ctx.from.id]
      );

      if (userRows.length > 0 && userRows[0].phone_number) {
        ctx.wizard.state.phone = userRows[0].phone_number;
        ctx.wizard.state.offerRequested = true;
        await ctx.reply(texts[lang].phone_saved, Markup.removeKeyboard());
        await sendOfferPrompt(ctx);
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
      return ctx.wizard.next();
    } catch (err) {
      console.error("Step 0 error:", err);
      await ctx.reply(texts[lang].error);
      return ctx.scene.leave();
    }
  },

  // Step 1: Accept contact
  async (ctx) => {
    const lang = ctx.session.language || "uzl";
    try {
      if (!ctx.message?.contact?.phone_number) {
        ctx.wizard.state.retryCount = (ctx.wizard.state.retryCount || 0) + 1;
        if (ctx.wizard.state.retryCount > 2) {
          await ctx.reply(
            texts[lang].too_many_retries,
            Markup.removeKeyboard()
          );
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
        return;
      }

      ctx.wizard.state.phone = ctx.message.contact.phone_number;
      ctx.wizard.state.offerRequested = true;
      await ctx.reply(texts[lang].phone_accepted, Markup.removeKeyboard());
      await sendOfferPrompt(ctx);
      return ctx.wizard.next();
    } catch (err) {
      console.error("Step 1 error:", err);
      await ctx.reply(texts[lang].error);
      return ctx.scene.leave();
    }
  },

  // Step 2: Accept offer
  async (ctx) => {
    const lang = ctx.session.language || "uzl";
    try {
      if (ctx.callbackQuery?.data !== "accept_offer") {
        await sendOfferPrompt(ctx);
        return;
      }
      await ctx.answerCbQuery();
      ctx.wizard.state.offer_accepted = true;
      await ctx.reply(texts[lang].select_colony, generateColonyKeyboard(lang));
      return ctx.wizard.next();
    } catch (err) {
      console.error("Step 2 error:", err);
      await ctx.reply(texts[lang].error);
      return ctx.scene.leave();
    }
  },

  // Step 3: Colony selection and payment
  async (ctx) => {
    const lang = ctx.session.language || "uzl";
    try {
      // Handle post-payment continue
      if (ctx.callbackQuery?.data === "continue_after_payment") {
        await ctx.answerCbQuery();
        const [paymentRows] = await pool.query(
          `SELECT status FROM payments WHERE user_id = ? AND payload = ? AND status = 'successful'`,
          [ctx.from.id, ctx.wizard.state.paymentPayload]
        );
        if (!paymentRows.length || paymentRows[0].status !== "successful") {
          await ctx.reply(texts[lang].payment_not_verified);
          return ctx.scene.leave();
        }
        await proceedToVisitType(ctx);
        return ctx.wizard.next();
      }

      // Handle payment cancel
      if (ctx.callbackQuery?.data === "cancel_payment") {
        await ctx.answerCbQuery();
        await pool.query("DELETE FROM payments WHERE payload = ?", [
          ctx.wizard.state.paymentPayload,
        ]);
        await ctx.reply(
          texts[lang].payment_canceled,
          Markup.inlineKeyboard([
            [Markup.button.callback(texts[lang].book_meeting, "start_booking")],
          ])
        );
        ctx.session = { language: ctx.session.language };
        ctx.wizard.state = {};
        return ctx.scene.leave();
      }

      // Resend invoice if pending
      if (
        ctx.wizard.state.paymentPayload &&
        (ctx.message || !ctx.callbackQuery)
      ) {
        const [paymentRows] = await pool.query(
          `SELECT status, amount FROM payments WHERE user_id = ? AND payload = ?`,
          [ctx.from.id, ctx.wizard.state.paymentPayload]
        );
        if (paymentRows.length && paymentRows[0].status === "pending") {
          await sendPaymentInvoice(ctx, paymentRows[0].amount);
        } else {
          await ctx.reply(texts[lang].payment_already_processed);
          return ctx.scene.leave();
        }
        return;
      }

      // Colony selection
      const data = ctx.callbackQuery?.data;
      if (!data || !data.startsWith("colony_")) {
        await ctx.reply(
          texts[lang].select_colony,
          generateColonyKeyboard(lang)
        );
        return;
      }
      await ctx.answerCbQuery();
      ctx.wizard.state.colony = data.replace("colony_", "");


      if (!ctx.wizard.state.phone) {
        const [userRows] = await pool.query(
          `SELECT phone_number FROM bookings WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
          [ctx.from.id]
        );
        if (userRows.length > 0 && userRows[0].phone_number) {
          ctx.wizard.state.phone = userRows[0].phone_number;
        }
      }

      const attemptsLeft = await pool.query(`SELECT attempts FROM payments WHERE user_id = ?`, [ctx.from.id]);
      const requiresPayment = paidColonies.includes(ctx.wizard.state.colony);

      if (requiresPayment && (!attemptsLeft[0].length || attemptsLeft[0][0].attempts < 1)) {
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
        return;
      } else if (requiresPayment) {
        await ctx.reply(texts[lang].attemptsLeft(attemptsLeft[0][0].attempts));
      }

      await proceedToVisitType(ctx);
      return ctx.wizard.next();
    } catch (err) {
      console.error("Step 3 error:", err);
      await ctx.reply(texts[lang].error);
      return ctx.scene.leave();
    }
  },

  // Step 4: Visit type
  async (ctx) => {
    const lang = ctx.session.language || "uzl";
    try {
      if (
        !ctx.callbackQuery?.data ||
        !["long", "short"].includes(ctx.callbackQuery.data)
      ) {
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
    } catch (err) {
      console.error("Step 4 error:", err);
      await ctx.reply(texts[lang].error);
      return ctx.scene.leave();
    }
  },

  // Step 5: Full name (first relative)
  async (ctx) => {
    const lang = ctx.session.language || "uzl";
    try {
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
        return;
      }
      ctx.wizard.state.relatives = ctx.wizard.state.relatives || [];
      ctx.wizard.state.currentRelative = {
        full_name: ctx.message.text.toUpperCase(),
        passport: "AC1234567",
      };
      ctx.wizard.state.relatives.push(ctx.wizard.state.currentRelative);

      if (!ctx.wizard.state.prisoner_name) {
        await ctx.reply(texts[lang].enter_prisoner_name);
        return ctx.wizard.selectStep(7);
      } else {
        return askAddMore(ctx);
      }
    } catch (err) {
      console.error("Step 5 error:", err);
      await ctx.reply(texts[lang].error);
      return ctx.scene.leave();
    }
  },

  // Step 6: Placeholder
  async (ctx) => ctx.wizard.next(),

  // Step 7: Prisoner name
  async (ctx) => {
    const lang = ctx.session.language || "uzl";
    try {
      if (!ctx.message?.text) {
        await ctx.reply(texts[lang].invalid_prisoner);
        return;
      }
      ctx.wizard.state.prisoner_name = ctx.message.text.toUpperCase();
      return askAddMore(ctx);
    } catch (err) {
      console.error("Step 7 error:", err);
      await ctx.reply(texts[lang].error);
      return ctx.scene.leave();
    }
  },

  // Step 8: Add more relatives
  async (ctx) => {
    const lang = ctx.session.language || "uzl";
    try {
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
      }
    } catch (err) {
      console.error("Step 8 error:", err);
      await ctx.reply(texts[lang].error);
      return ctx.scene.leave();
    }
  },

  // Step 9: Confirm summary
  async (ctx) => {
    const lang = ctx.session.language || "uzl";
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery();

      if (ctx.callbackQuery?.data === "confirm") {
        const bookingId = await saveBooking(ctx);
        if (bookingId && ctx.wizard.state.paymentPayload) {
          await pool.query(
            `UPDATE payments SET booking_id = ? WHERE user_id = ? AND payload = ?`,
            [bookingId, ctx.from.id, ctx.wizard.state.paymentPayload]
          );
        }
        return ctx.scene.leave();
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
      }
    } catch (err) {
      console.error("Step 9 error:", err);
      await ctx.reply(texts[lang].error);
      return ctx.scene.leave();
    }
  }
);

// Helpers
async function sendOfferPrompt(ctx) {
  const lang = ctx.session.language || "uzl";
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
}

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

async function sendPaymentInvoice(ctx, amount) {
  const lang = ctx.session.language || "uzl";
  await ctx.replyWithInvoice({
    title: texts[lang].payment_title || "Оплата заявки",
    description:
      texts[lang].payment_desc ||
      "Оплата 12500 сум за подачу заявки в платную колонию",
    payload: ctx.wizard.state.paymentPayload,
    provider_token: process.env.PROVIDER_TOKEN,
    currency: "UZS",
    prices: [{ label: "Заявка", amount: amount * 100 }],
    photo_url: "https://ik.imagekit.io/k0nzunnda/photo_2025-09-04_03-56-37%20_%20%D0%BA%D0%BE%D0%BF%D0%B8%D1%8F%20(2).jpg?updatedAt=1761132588528",
    photo_width: 256,
    photo_height: 256,
    photo_size: 256,
  });
  await ctx.reply(
    texts[lang].pay_or_cancel || "Оплатите или отмените.",
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          texts[lang].cancel_button || "Отмена",
          "cancel_payment"
        ),
      ],
    ])
  );
}

module.exports = bookingWizard;
