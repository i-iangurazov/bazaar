(() => {
  const copy = {
    en: {
      lang: "en-US",
      title: "You are offline",
      description: "Connect to the internet to continue using Bazaar.",
    },
    ru: {
      lang: "ru",
      title: "Нет подключения",
      description: "Подключитесь к интернету, чтобы продолжить работу в Bazaar.",
    },
    kg: {
      lang: "ky-KG",
      title: "Интернет жок",
      description: "Bazaar менен иштөөнү улантуу үчүн интернетке туташыңыз.",
    },
  };
  const cookieLocale = document.cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === "NEXT_LOCALE")?.[1];
  const requestedLocale = (cookieLocale || navigator.language || "en").toLowerCase();
  const locale =
    requestedLocale === "ru" || requestedLocale.startsWith("ru-")
      ? "ru"
      : requestedLocale === "kg" || requestedLocale === "ky" || requestedLocale.startsWith("ky-")
        ? "kg"
        : "en";
  const messages = copy[locale];

  document.documentElement.lang = messages.lang;
  document.getElementById("offline-title").textContent = messages.title;
  document.getElementById("offline-description").textContent = messages.description;
})();
