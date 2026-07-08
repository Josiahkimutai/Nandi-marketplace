// ==============================
// AGRIHUB TOKEN ENGINE
// Deducts tokens every 10 seconds
// Shared by all pages
// ==============================

// Create a separate Supabase client
const tokenSb = supabase.createClient(
    "https://wfbepkegbtxszhhozqtz.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmYmVwa2VnYnR4c3poaG96cXR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMjE4NjEsImV4cCI6MjA5NzY5Nzg2MX0.RkyZ4Jszz9KbNP9fk4MldMX2S1416eYFR8GHhPzRGJc"
);

// Pages where the token engine should run
const allowedPages = [
    "farmerdashboard.html",
    "myaccount.html",
    "sell.html"
];

const currentPage = window.location.pathname.split("/").pop();

if (!allowedPages.includes(currentPage)) {
    console.log("Token engine disabled on this page:", currentPage);
} else {

    // Logged in user (SAFE PARSE)
    const tokenUserRaw = localStorage.getItem("agrihub_user");

    let tokenUser = null;

    try {
        tokenUser = tokenUserRaw ? JSON.parse(tokenUserRaw) : null;
    } catch (e) {
        tokenUser = null;
    }

    // ...

    // Stop if nobody is logged in
    if (!tokenUser || !tokenUser.id) {

        console.log("TokenEngine: No logged in user.");

    } else {

    // ============================
    // CONFIG
    // ============================

    const STARTING_TOKENS = 10000;
    const DAYS_TO_EXPIRE = 30;
    const CHECK_INTERVAL = 10000; // 10 seconds

    const TOTAL_BLOCKS =
        DAYS_TO_EXPIRE *
        24 *
        60 *
        6;

    const TOKENS_PER_BLOCK =
        STARTING_TOKENS / TOTAL_BLOCKS;

    let tokenTimer;

    // ============================
    //// ============================
// TOKEN CHECK
// ============================

async function checkTokenUsage() {

    try {

        const { data, error } = await tokenSb
            .from("users")
            .select("token_balance,last_token_update")
            .eq("id", tokenUser.id)
            .single();

        if (error || !data) {
            console.error(error);
            return;
        }

        // =====================================
        // FIRST CHECK IF TOKENS ARE ALREADY ZERO
        // =====================================
        const currentBalance = Number(
            data.token_balance ?? STARTING_TOKENS
        );

        console.log("Current Balance:", currentBalance);

        if (currentBalance <= 0) {

            clearInterval(tokenTimer);

         if (!window.location.pathname.includes("index.html") &&
    !window.location.pathname.includes("register.html")) {
    showNoTokensPopup();
}

            return;
        }

        const now = new Date();

        const last = data.last_token_update
            ? new Date(data.last_token_update)
            : now;

        const elapsed = now - last;

        const periodsPassed = Math.floor(
            elapsed / CHECK_INTERVAL
        );

        if (periodsPassed <= 0) return;

        const deduct =
            periodsPassed * TOKENS_PER_BLOCK;

        const newBalance = Math.max(
            0,
            currentBalance - deduct
        );

        const { error: updateError } = await tokenSb
            .from("users")
            .update({
                token_balance: Number(newBalance.toFixed(6)),
                last_token_update: now.toISOString()
            })
            .eq("id", tokenUser.id);

        if (updateError) {
            console.error(updateError);
            return;
        }

        console.log(
            "Tokens:",
            currentBalance.toFixed(6),
            "→",
            newBalance.toFixed(6)
        );

        // =====================================
        // CHECK AGAIN AFTER DEDUCTION
        // =====================================
        if (newBalance <= 0) {

            clearInterval(tokenTimer);

            showNoTokensPopup();

            return;
        }

    } catch (err) {

        console.error("Token Engine Error:", err);

    }

}

    // ============================
    // START ENGINE
    // ============================

    checkTokenUsage();

    tokenTimer = setInterval(
        checkTokenUsage,
        CHECK_INTERVAL
    );

}

// ============================
// NO TOKENS POPUP
// ============================

function showNoTokensPopup() {

    if (document.getElementById("noTokensPopup")) return;

    document.body.insertAdjacentHTML(
        "beforeend",
        `
        <div id="noTokensPopup" style="
            position:fixed;
            inset:0;
            background:rgba(0,0,0,.65);
            display:flex;
            justify-content:center;
            align-items:center;
            z-index:999999;
        ">

            <div style="
                background:white;
                width:90%;
                max-width:340px;
                border-radius:18px;
                padding:25px;
                text-align:center;
            ">

                <div style="font-size:55px;">🪙</div>

                <h2>Please Add Tokens</h2>

                <p style="margin:15px 0;color:#555;">
                    Your AgriHub tokens have finished.
                    Please purchase more tokens to continue.
                </p>

                <button
onclick="location.href='pay.html'"
style="
background:#1f8f4e;
color:#fff;
border:none;
padding:12px;
width:100%;
border-radius:10px;
font-weight:bold;
cursor:pointer;
">
Buy Tokens
</button>

<button
onclick="history.back()"
style="
margin-top:10px;
width:100%;
padding:12px;
background:#f3f4f6;
color:#374151;
border:1px solid #d1d5db;
border-radius:10px;
font-weight:bold;
cursor:pointer;
">
← Back
</button>

            </div>

        </div>
        `
    );

}
}