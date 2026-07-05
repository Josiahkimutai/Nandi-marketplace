const sb = supabase.createClient(
    "https://wfbepkegbtxszhhozqtz.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmYmVwa2VnYnR4c3poaG96cXR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMjE4NjEsImV4cCI6MjA5NzY5Nzg2MX0.RkyZ4Jszz9KbNP9fk4MldMX2S1416eYFR8GHhPzRGJc"
);

const user = JSON.parse(localStorage.getItem("agrihub_user") || "null");

if (user) {

    // Unlock audio after first click
    document.addEventListener("click", function unlock() {

        const sound = document.getElementById("notificationSound");

        if (!sound) return;

        sound.play()
            .then(() => {
                sound.pause();
                sound.currentTime = 0;
            })
            .catch(() => {});

        document.removeEventListener("click", unlock);

    });

    // Listen for ALL new messages
    sb.channel("global-messages-" + user.id)
      .on(
        "postgres_changes",
        {
            event: "INSERT",
            schema: "public",
            table: "messages"
        },
        payload => {

            // Ignore your own messages
            if (payload.new.sender_id === user.id) return;

            // Play sound
            const sound = document.getElementById("notificationSound");

            if (sound) {
                sound.currentTime = 0;
                sound.play().catch(() => {});
            }

            // Update badge if page has one
            if (typeof loadUnreadMessages === "function") {
                loadUnreadMessages();
            }

        }
      )
      .subscribe();

}