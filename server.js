const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

/* ==========================================
   ENVIRONMENT VARIABLES
========================================== */

const {
  CONSUMER_KEY,
  CONSUMER_SECRET,
  SHORTCODE,
  PASSKEY,
  CALLBACK_URL,
  SUPABASE_URL,
  SUPABASE_KEY
} = process.env;

/* ==========================================
   SUPABASE
========================================== */

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

/* ==========================================
   HOME
========================================== */

app.get("/", (req, res) => {
  res.send("🌾 AGRIHUB Backend Running");
});

/* ==========================================
   GET MPESA ACCESS TOKEN
========================================== */

async function getAccessToken() {

  const auth = Buffer.from(
    `${CONSUMER_KEY}:${CONSUMER_SECRET}`
  ).toString("base64");

  const { data } = await axios.get(
    "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${auth}`
      }
    }
  );

  return data.access_token;
}

/* ==========================================
   STK PUSH
========================================== */

app.post("/stkpush", async (req, res) => {

  try {

    const {
      phone,
      amount,
      userId
    } = req.body;

    if (!phone || !amount || !userId) {
      return res.status(400).json({
        success: false,
        message: "phone, amount and userId are required."
      });
    }

    console.log("NEW PAYMENT REQUEST");
    console.log(req.body);

    const accessToken = await getAccessToken();

    const timestamp = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, "")
      .slice(0, 14);

    const password = Buffer.from(
      `${SHORTCODE}${PASSKEY}${timestamp}`
    ).toString("base64");

    const { data: stk } = await axios.post(

      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",

      {
        BusinessShortCode: SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: Number(amount),
        PartyA: phone,
        PartyB: SHORTCODE,
        PhoneNumber: phone,
        CallBackURL: CALLBACK_URL,
        AccountReference: "AGRIHUB",
        TransactionDesc: "Token Purchase"
      },

      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }

    );

    console.log("STK RESPONSE");
    console.log(stk);

    const payment = {

      user_id: userId,

      phone,

      amount: Number(amount),

      checkout_request_id: stk.CheckoutRequestID,

      merchant_request_id: stk.MerchantRequestID,

      status: "PENDING",

      message: "Waiting for callback"

    };

    const { error } = await supabase
      .from("payments")
      .insert(payment);

    if (error) {

      console.log("PAYMENT INSERT ERROR");
      console.log(error);

      return res.status(500).json({
        success: false,
        message: error.message
      });

    }

    console.log("PENDING PAYMENT SAVED");

    return res.json({
      success: true,
      checkoutRequestID: stk.CheckoutRequestID,
      merchantRequestID: stk.MerchantRequestID,
      customerMessage: stk.CustomerMessage
    });

  }

  catch (err) {

    console.log("STK ERROR");
    console.log(err.response?.data || err.message);

    return res.status(500).json({
      success: false,
      message: err.response?.data || err.message
    });

  }

});/* ==========================================
   CALLBACK
========================================== */

app.post("/callback", async (req, res) => {

  try {

    console.log(
      "CALLBACK:",
      JSON.stringify(req.body, null, 2)
    );

    const stk = req.body?.Body?.stkCallback;

    if (!stk) {
      return res.json({
        ResultCode: 0,
        ResultDesc: "Accepted"
      });
    }

    const checkoutRequestID = stk.CheckoutRequestID;
    const resultCode = stk.ResultCode;
    const resultDesc = stk.ResultDesc;

    const items = stk.CallbackMetadata?.Item || [];

    const amount =
      items.find(i => i.Name === "Amount")?.Value || 0;

    const receipt =
      items.find(i => i.Name === "MpesaReceiptNumber")?.Value || "";

    const phone =
      items.find(i => i.Name === "PhoneNumber")?.Value || "";

    const transactionDate =
      items.find(i => i.Name === "TransactionDate")?.Value || "";

    /* --------------------------
       FIND PAYMENT
    --------------------------- */

    const { data: payment, error: paymentError } =
      await supabase
        .from("payments")
        .select("*")
        .eq("checkout_request_id", checkoutRequestID)
        .single();

    if (paymentError || !payment) {

      console.log("PAYMENT NOT FOUND");

      return res.json({
        ResultCode: 0,
        ResultDesc: "Accepted"
      });

    }

    console.log("FOUND PAYMENT:", payment);

    /* --------------------------
       UPDATE PAYMENT
    --------------------------- */


    /* --------------------------
       PAYMENT FAILED
    --------------------------- */

    if (resultCode !== 0) {

      console.log("PAYMENT FAILED");

      return res.json({
        ResultCode: 0,
        ResultDesc: "Accepted"
      });

    }

    /* --------------------------
       LOAD USER
    --------------------------- */

    const { data: user } = await supabase

      .from("users")

      .select("*")

      .eq("id", payment.user_id)

      .single();

    if (!user) {

      console.log("USER NOT FOUND");

      return res.json({
        ResultCode: 0,
        ResultDesc: "Accepted"
      });

    }

    const currentTokens =
      Number(user.token_balance || 0);

    const tokens =
      Number(amount) * 1000;

    const newBalance =
      currentTokens + tokens;
      console.log("Amount:", amount);
console.log("Tokens Purchased:", tokens);
console.log("Current Balance:", currentTokens);
console.log("New Balance:", newBalance);

    /* --------------------------
       UPDATE USER WALLET
    --------------------------- */

    await supabase

      .from("users")

      .update({

        token_balance: newBalance,

        subscription_active: true,

        subscription_status: "ACTIVE",

        last_payment_amount: amount,

        last_payment_date:
          new Date().toISOString()

      })

      .eq("id", payment.user_id);
     const { data: updatedPayment, error: paymentUpdateError } = await supabase
  .from("payments")
  .update({
    phone,
    amount,
    mpesa_receipt: receipt,
    transaction_date: String(transactionDate),
    result_code: resultCode,
    result_desc: resultDesc,
    message: resultDesc,
    status: "SUCCESS",
    tokens_purchased: tokens,
    token_balance_after: newBalance,
    payment_completed_at: new Date().toISOString()
  })
  .eq("checkout_request_id", checkoutRequestID)
  .select();

console.log("UPDATED PAYMENT:", updatedPayment);
console.log("PAYMENT UPDATE ERROR:", paymentUpdateError);
if (paymentUpdateError) {
  console.error("PAYMENT UPDATE ERROR:", paymentUpdateError);
} else {
  console.log("UPDATED PAYMENT:", updatedPayment);
}

    return res.json({

      ResultCode: 0,

      ResultDesc: "Accepted"

    });

  }

  catch (err) {

    console.log(err);

    return res.json({

      ResultCode: 0,

      ResultDesc: "Accepted"

    });

  }

});


/* ==========================================
   PAYMENT STATUS
========================================== */

app.get("/payment-status/:id", async (req, res) => {

  const { id } = req.params;

  const { data } = await supabase

    .from("payments")

    .select("*")

    .eq("checkout_request_id", id)

    .maybeSingle();

  if (!data) {

    return res.json({

      found: false,

      status: "PENDING"

    });

  }

  res.json({

    found: true,

    status: data.status,

    payment: data

  });

});


/* ==========================================
   LOGIN
========================================== */

app.post("/login", async (req, res) => {

  const { phone } = req.body;

  const { data } = await supabase

    .from("users")

    .select("*")

    .eq("phone", phone)

    .maybeSingle();

  if (!data) {

    return res.json({

      success: false

    });

  }

  res.json({

    success: true,

    user: data

  });

});


/* ==========================================
   START SERVER
========================================== */

app.listen(PORT, () => {

  console.log(

    `🚀 AGRIHUB running on port ${PORT}`

  );

});