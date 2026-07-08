
const notificationUser = JSON.parse(localStorage.getItem("agrihub_user") || "null");

if (notificationUser) {

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
    sb.channel("global-messages-" + notificationUser.id)
      .on(
        "postgres_changes",
        {
            event: "INSERT",
            schema: "public",
            table: "messages"
        },
        payload => {

            // Ignore your own messages
            // Ignore your own messages
if (payload.new.sender_id === notificationUser.id) {
    return;
}

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