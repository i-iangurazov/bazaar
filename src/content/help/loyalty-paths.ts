import { helpText as t } from "./ui";

export const loyaltyPaths = [
  {
    guideId: "loyalty/get-started",
    icon: "settings",
    audience: t("Владелец", "Дүкөн ээси", "Owner"),
    title: t("Запустить программу", "Программаны баштоо", "Launch the program"),
    description: t(
      "Условия → магазины → QR регистрации → обучение кассира",
      "Шарттар → дүкөндөр → катталуу QR коду → кассирди окутуу",
      "Rules → stores → registration QR → cashier training",
    ),
  },
  {
    guideId: "loyalty/pos-points",
    icon: "register",
    audience: t("Кассир", "Кассир", "Cashier"),
    title: t(
      "Провести покупку с бонусами",
      "Бонус менен сатып алууну өткөрүү",
      "Sell with customer rewards",
    ),
    description: t(
      "Найти карту → выбрать баллы → подтверждение → оплата",
      "Картаны табуу → упай тандоо → ырастоо → төлөм",
      "Find card → choose points → approval → payment",
    ),
  },
  {
    guideId: "loyalty/customer-card",
    icon: "users",
    audience: t("Покупатель", "Кардар", "Customer"),
    title: t("Получить и использовать карту", "Картаны алуу жана колдонуу", "Get and use a card"),
    description: t(
      "QR магазина → email → карта → баланс и история",
      "Дүкөндүн QR коду → email → карта → баланс жана тарых",
      "Store QR → email → card → balance and history",
    ),
  },
];
