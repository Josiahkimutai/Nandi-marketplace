function getUser() {
  try {
    return JSON.parse(localStorage.getItem("agrihub_user"));
  } catch {
    return null;
  }
}

function protectPage() {
  const user = getUser();

  if (!user) {
    window.location.replace("index.html");
    return null;
  }

  return user;
}

window.currentUser = protectPage();