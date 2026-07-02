const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

/* =====================================================
   ENVIRONMENT VARIABLES
===================================================== */

const {
    CONSUMER_KEY,
    CONSUMER_SECRET,
    SHORTCODE,
    PASSKEY,
    CALLBACK_URL,

    JOSKEV_SUPABASE_URL,
    JOSKEV_SUPABASE_KEY,

    AGRIHUB_SUPABASE_URL,
    AGRIHUB_SUPABASE_KEY

} = process.env;

/* =====================================================
   SUPABASE CONNECTIONS
===================================================== */

const joskevDB = createClient(
    JOSKEV_SUPABASE_URL,
    JOSKEV_SUPABASE_KEY
);

const agrihubDB = createClient(
    AGRIHUB_SUPABASE_URL,
    AGRIHUB_SUPABASE_KEY
);

/* =====================================================
   DATABASE HELPER
===================================================== */

function getDatabase(project){

    if(project === "AGRIHUB"){
        return agrihubDB;
    }

    return joskevDB;

}

/* =====================================================
   HOME
===================================================== */

app.get("/", (req,res)=>{

    res.send("Unified M-Pesa Backend Running 🚀");

});

/* =====================================================
   ACCESS TOKEN
===================================================== */

async function getAccessToken(){

    const auth = Buffer.from(
        `${CONSUMER_KEY}:${CONSUMER_SECRET}`
    ).toString("base64");

    const response = await axios.get(

        "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",

        {
            headers:{
                Authorization:`Basic ${auth}`
            }
        }

    );

    return response.data.access_token;

}


/* ================= ACCESS TOKEN ================= */
async function getAccessToken() {
  const auth = Buffer.from(
    `${CONSUMER_KEY}:${CONSUMER_SECRET}`
  ).toString("base64");

  const response = await axios.get(
    "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${auth}`
      }
    }
  );

  return response.data.access_token;
}

/* ================= STK PUSH ================= */
/* =====================================================
   STK PUSH
===================================================== */

app.post("/stkpush", async (req, res) => {

    try {

        const {
            phone,
            amount,
            userId,
            project
        } = req.body;
console.log("=== STK REQUEST BODY ===");
console.log(req.body);
console.log("=========================");
        if (!phone || !amount || !userId) {
            return res.status(400).json({
                error: "Phone, amount and userId are required."
            });
        }

        // Choose the correct database
    const db = getDatabase(project);

console.log("================================");
console.log("PROJECT RECEIVED:", project);
console.log(
  "DATABASE SELECTED:",
  db === agrihubDB ? "AGRIHUB" : "JOSKEV"
);
console.log("================================");

        const token = await getAccessToken();

        const timestamp = new Date()
            .toISOString()
            .replace(/[-:T.Z]/g, "")
            .slice(0, 14);

        const password = Buffer.from(
            `${SHORTCODE}${PASSKEY}${timestamp}`
        ).toString("base64");

        const stkBody = {

            BusinessShortCode: SHORTCODE,

            Password: password,

            Timestamp: timestamp,

            TransactionType: "CustomerPayBillOnline",

            Amount: Number(amount),

            PartyA: phone,

            PartyB: SHORTCODE,

            PhoneNumber: phone,

            CallBackURL: CALLBACK_URL,

            AccountReference: project || "JOSKEV",

            TransactionDesc: "Payment"

        };

        const response = await axios.post(

            "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",

            stkBody,

            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }

        );

        const stkData = response.data;

        console.log("====================================");
        console.log("NEW STK PUSH");
        console.log("PROJECT:", project);
        console.log("PHONE:", phone);
        console.log("AMOUNT:", amount);
        console.log("====================================");

        if (stkData.CheckoutRequestID) {
console.log("================================");
console.log("PROJECT:", project);
console.log("DATABASE:", db === agrihubDB ? "AGRIHUB" : "JOSKEV");
console.log("================================");
            const { data, error } = await db
    .from("payments")
    .insert([
        {
            phone,
            amount: Number(amount),
            checkout_request_id: stkData.CheckoutRequestID,
            merchant_request_id: stkData.MerchantRequestID,
            status: "PENDING",
            message: "Waiting for callback"
        }
    ])
    .select();

console.log("INSERT DATA:", data);
console.log("INSERT ERROR:", error);

        }

        res.json(stkData);

    }

    catch (err) {

        console.log("STK ERROR");

        console.log(err.response?.data || err.message);

        res.status(500).json({

            error: err.message

        });

    }

});
/* =====================================================
   M-PESA CALLBACK
===================================================== */

app.post("/callback", async (req, res) => {

    try {

        const callback = req.body;

        console.log("====================================");
        console.log("M-PESA CALLBACK RECEIVED");
        console.log(JSON.stringify(callback, null, 2));
        console.log("====================================");

        const stkCallback = callback?.Body?.stkCallback;

        if (!stkCallback) {
            return res.json({ ResultCode: 0, ResultDesc: "OK" });
        }

        const checkoutRequestID = stkCallback.CheckoutRequestID;
        const resultCode = stkCallback.ResultCode;

        // Determine which DB this transaction belongs to
        // (we stored CheckoutRequestID in BOTH DBs, so we search both)
        const dbs = [agrihubDB, joskevDB];

        let paymentRecord = null;
        let activeDB = null;

        for (const db of dbs) {

            const { data } = await db
                .from("payments")
                .select("*")
                .eq("checkout_request_id", checkoutRequestID)
                .single();

            if (data) {
                paymentRecord = data;
                activeDB = db;
                break;
            }
        }

        if (!paymentRecord) {
            console.log("Payment record not found");
            return res.json({ ResultCode: 0, ResultDesc: "OK" });
        }

        // PAYMENT FAILED
        if (resultCode !== 0) {

            await activeDB
                .from("payments")
                .update({
                    status: "FAILED",
                    message: "Payment failed"
                })
                .eq("checkout_request_id", checkoutRequestID);

            return res.json({ ResultCode: 0, ResultDesc: "OK" });
        }

        // Extract amount safely
        const callbackMetadata = stkCallback.CallbackMetadata?.Item || [];
        const amountItem = callbackMetadata.find(i => i.Name === "Amount");
        const mpesaReceiptItem = callbackMetadata.find(i => i.Name === "MpesaReceiptNumber");

        const amount = amountItem?.Value || paymentRecord.amount;
        const mpesaReceipt = mpesaReceiptItem?.Value || "UNKNOWN";

        console.log("Payment SUCCESS:", {
            amount,
            mpesaReceipt
        });

        /* =========================================
           UPDATE PAYMENT RECORD
        ========================================= */

        await activeDB
            .from("payments")
            .update({
                status: "SUCCESS",
                message: "Payment completed",
                mpesa_receipt: mpesaReceipt
            })
            .eq("checkout_request_id", checkoutRequestID);

        /* =========================================
           CREDIT USER (EDIT THIS PART LATER IF NEEDED)
        ========================================= */

        // Example: token system (adjust if you use different schema)
        const { data: user } = await activeDB
            .from("users")
            .select("*")
            .eq("id", paymentRecord.user_id)
            .single();

        if (user) {

            const newBalance = (user.token_balance || 0) + amount;

            await activeDB
                .from("users")
                .update({
                    token_balance: newBalance
                })
                .eq("id", user.id);

        }

        return res.json({ ResultCode: 0, ResultDesc: "OK" });

    }

    catch (err) {

        console.log("CALLBACK ERROR:", err.message);

        return res.json({ ResultCode: 0, ResultDesc: "OK" });

    }

});

/* ================= PAYMENT STATUS ================= */
app.get("/payment-status/:id", async (req, res) => {

  try {

    const { id } = req.params;

    const dbs = [agrihubDB, joskevDB];

    for (const db of dbs) {

      const { data } = await db
        .from("payments")
        .select("*")
        .eq("checkout_request_id", id)
        .maybeSingle();

      if (data) {

        return res.json({
          success: true,
          found: true,
          status: data.status,
          payment: data
        });

      }

    }

    return res.json({
      success: true,
      found: false,
      status: "PENDING",
      message: "Waiting for payment"
    });

  }

  catch (err) {

    return res.status(500).json({
      success: false,
      error: err.message
    });

  }

});



/* ================= START ================= */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});