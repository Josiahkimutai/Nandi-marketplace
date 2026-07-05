console.log("push.js loaded");

// Wait for app to fully load (Capacitor-safe)
document.addEventListener("deviceready", async () => {
  const { PushNotifications } = Capacitor.Plugins;

  // Supabase client (ONLY ONCE)
  const sb = window.supabase.createClient(
    "https://wfbepkegbtxszhhozqtz.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmYmVwa2VnYnR4c3poaG96cXR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMjE4NjEsImV4cCI6MjA5NzY5Nzg2MX0.RkyZ4Jszz9KbNP9fk4MldMX2S1416eYFR8GHhPzRGJc"
  );

  // ==============================
  // 1. REQUEST PERMISSION
  // ==============================
  let permStatus = await PushNotifications.requestPermissions();

  if (permStatus.receive !== "granted") {
    console.log("Notification permission denied");
    return;
  }

  // ==============================
  // 2. LISTEN FOR TOKEN
  // ==============================
  PushNotifications.addListener("registration", async (token) => {
    console.log("FCM TOKEN:", token.value);

    // Always store locally first
    localStorage.setItem("fcm_token", token.value);

    const user = JSON.parse(localStorage.getItem("agrihub_user"));

    // If user not ready → save pending token
    if (!user || !user.id) {
      console.log("User not ready. Saving token for later sync.");

      localStorage.setItem("pending_fcm_token", token.value);
      return;
    }

    try {
      const { error } = await sb
        .from("users")
        .update({ fcm_token: token.value })
        .eq("id", user.id);

      if (error) {
        console.error("❌ Failed to save FCM token:", error);
      } else {
        console.log("✅ FCM token saved successfully.");
      }

    } catch (err) {
      console.error("Unexpected error saving token:", err);
    }
  });

  // ==============================
  // 3. REGISTRATION ERROR
  // ==============================
  PushNotifications.addListener("registrationError", (err) => {
    console.error("❌ Registration error:", err);
  });

  // ==============================
  // 4. NOTIFICATION RECEIVED
  // ==============================
  PushNotifications.addListener(
    "pushNotificationReceived",
    (notification) => {
      console.log("📩 Notification received:", notification);

      if (navigator.notification) {
        navigator.notification.beep(1);
      }
    }
  );

  // ==============================
  // 5. NOTIFICATION CLICKED
  // ==============================
  PushNotifications.addListener(
    "pushNotificationActionPerformed",
    (action) => {
      console.log("👉 Notification action:", action);
      window.location.href = "inbox.html";
    }
  );

  // ==============================
  // 6. REGISTER DEVICE
  // ==============================
  try {
    await PushNotifications.register();
    console.log("📲 Push registration triggered");
  } catch (err) {
    console.error("❌ Push register failed:", err);
  }
});