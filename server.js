
require("dotenv").config();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { readID } = require("./ai/ocr");
const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());
const upload = multer({
  dest: "uploads/"
});
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
   FIREBASE ADMIN
========================================== */

initializeApp({
  credential: cert(serviceAccount)
});/* ==========================================
   SEND PUSH NOTIFICATION
========================================== */

async function sendPushNotification(
  token,
  title,
  body,
  conversationId = "",
  senderId = ""
) {

    console.log("==================================");
    console.log("TIME:", new Date().toISOString());
    console.log("SENDING PUSH");
    console.log("Token:", token);
    console.log("Title:", title);
    console.log("Body:", body);

    const message = {
        token,
        notification: {
            title,
            body
        },
        data: {
            type: "chat",
            conversationId,
            senderId
        },
        android: {
            priority: "high",
            notification: {
                channelId: "default",
                priority: "high",
                defaultSound: true
            }
        }
    };

    console.log("Firebase Payload:");
    console.log(JSON.stringify(message, null, 2));

    const start = Date.now();

    try {

        const response = await getMessaging().send(message);

        console.log("✅ SUCCESS");
        console.log("Firebase Message ID:", response);
        console.log("Send took:", Date.now() - start, "ms");
        console.log("TIME:", new Date().toISOString());

    } catch (err) {

        console.log("❌ FAILED");
        console.log("Code:", err.code);
        console.log("Message:", err.message);

        if (err.errorInfo) {
            console.log(err.errorInfo);
        }

        console.log(err);
    }

    console.log("==================================");
}
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
console.log("🔥 CALLBACK HIT");
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
    await supabase
  .from("payments")
  .update({ status: "PROCESSING" })
  .eq("checkout_request_id", checkoutRequestID);

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
/* --------------------------
   LOAD USER (ONLY ONCE)
--------------------------- */

const { data: user, error: userError } = await supabase
  .from("users")
  .select("token_balance, fcm_token")
  .eq("id", payment.user_id)
  .single();

if (!user || userError) {
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
console.log("TOKENS CREDITED:", tokens);
console.log("NEW BALANCE:", newBalance);


    /* --------------------------
       UPDATE USER WALLET
    --------------------------- */
console.log("STEP 1 - Updating user wallet");
    const { error: walletError } = await supabase
  .from("users")
  .update({
    token_balance: newBalance,
    subscription_active: true,
    subscription_status: "ACTIVE",
    last_payment_amount: amount,
    last_payment_date: new Date().toISOString()
  })
  .eq("id", payment.user_id);

if (walletError) {
  console.error("USER WALLET UPDATE ERROR:", walletError);

  return res.json({
    ResultCode: 0,
    ResultDesc: "Accepted"
  });
}
console.log("STEP 2 - User wallet updated successfully");
    /* --------------------------
       SEND PUSH NOTIFICATION
    --------------------------- */
console.log("STEP 3 - About to send push notification");
  if (user.fcm_token) {
  await sendPushNotification(
    user.fcm_token,
    "💰 Payment Successful",
    `You have received ${tokens.toLocaleString()} AGRIHUB tokens.`
  );

  console.log("STEP 4 - sendPushNotification() finished");
  console.log("📲 Push notification sent");
} else {
  console.log("⚠️ No FCM token found");
}

    /* --------------------------
       UPDATE PAYMENT RECORD
    --------------------------- */
console.log("STEP 5 - Updating payment record");
    const { data: updatedPayment, error: paymentUpdateError } =
      await supabase
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

    if (paymentUpdateError) {
      console.error("PAYMENT UPDATE ERROR:", paymentUpdateError);
    } else {
      console.log("UPDATED PAYMENT:", updatedPayment);
    }

    return res.json({
      ResultCode: 0,
      ResultDesc: "Accepted"
    });

  } catch (err) {
    console.error(err);

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
console.log("🔥 /send-chat-notification endpoint reached");
app.post("/send-chat-notification", async (req, res) => {
  try {
   const {
    receiverId,
    senderId,
    conversationId,
    senderName,
    message
} = req.body;
console.log("CHAT NOTIFICATION REQUEST:", req.body);
    if (!receiverId) {
      return res.status(400).json({
        success: false,
        message: "receiverId required"
      });
    }

    const { data: receiver, error } = await supabase
      .from("users")
      .select("fcm_token")
      .eq("id", receiverId)
      .single();

    if (error || !receiver?.fcm_token) {
      return res.json({
        success: true,
        message: "No FCM token"
      });
    }
await sendPushNotification(
    receiver.fcm_token,
    senderName || "New Message",
    message,
    conversationId,
    senderId
);

    return res.json({ success: true });

  } catch (err) {
    console.error("CHAT NOTIFICATION ERROR:", err);
    return res.status(500).json({ success: false });
  }
});
/* ==========================================
   START SERVER
========================================== */
console.log("SERVER VERSION: CHAT NOTIFICATION ROUTE INSTALLED");app.post("/verify-id", upload.single("idImage"), async (req, res) => {

    try {

        const userId = req.body.userId;

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No image uploaded"
            });
        }

        const result = await readID(req.file.path);

        console.log(result.text);
        console.log("Confidence:", result.confidence);
const text = result.text.toUpperCase();

// Find the user
const { data: user, error } = await supabase
    .from("users")
    .select("full_name,id_number")
    .eq("id", userId)
    .single();

if (error || !user) {
    fs.unlinkSync(req.file.path);

    return res.status(404).json({
        success: false,
        message: "User not found"
    });
}

// Clean database values
const dbName = user.full_name.toUpperCase().trim();
const dbId = String(user.id_number).replace(/\D/g, "");

// Does OCR text contain the database values?
const nameMatch = text.includes(dbName);
const idMatch = text.includes(dbId);
if (nameMatch && idMatch) {

    await supabase
        .from("users")
        .update({
            verification_status: "verified"
        })
        .eq("id", userId);

}
fs.unlinkSync(req.file.path);

res.json({
    success: true,
    verified: nameMatch && idMatch,
    nameMatch,
    idMatch,
    confidence: result.confidence
});
   


    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            error: err.message
        });

    }

});
app.listen(PORT, () => {

  console.log(

    `🚀 AGRIHUB running on port ${PORT}`

  );

});