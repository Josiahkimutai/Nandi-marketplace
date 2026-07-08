import { App } from '@capacitor/app';

App.addListener('backButton', ({ canGoBack }) => {

  console.log("BACK BUTTON FIRED");

  const popup =
    document.getElementById("verifyPopup") ||
    document.getElementById("tokenPopup") ||
    document.getElementById("imageViewer");

  if (popup && getComputedStyle(popup).display !== "none") {
    popup.style.display = "none";
    return;
  }

  const path = location.pathname;

  if (path.includes("chat.html")) {
    history.back();
    return;
  }

  if (path.includes("farmerdashboard.html")) {
    App.exitApp();
    return;
  }

  if (canGoBack && history.length > 1) {
    history.back();
  } else {
    App.exitApp();
  }
});