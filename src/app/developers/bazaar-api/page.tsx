import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import {
  BookOpenIcon,
  ExternalLinkIcon,
  KeyIcon,
  ProductsIcon,
  SalesOrdersIcon,
  ShieldCheckIcon,
  StatusSuccessIcon,
  UsersIcon,
} from "@/components/icons-ssr";

export const metadata: Metadata = {
  title: "BAZAAR API v1 — документация для интеграций",
  description:
    "Публичная документация BAZAAR API v1 для интеграции товаров, цен, остатков, заказов и клиентов с внешними системами и маркетплейсами.",
  robots: {
    index: true,
    follow: true,
  },
};

const baseUrl = "https://bazaar.kg/api/bazaar/v1";

const productResponse = `{
  "store": {
    "id": "store_123",
    "name": "Main Store"
  },
  "currencyCode": "KGS",
  "currencyRateKgsPerUnit": 1,
  "page": 1,
  "pageSize": 50,
  "total": 1,
  "items": [
    {
      "id": "product_123",
      "sku": "COFFEE-250",
      "name": "Coffee 250g",
      "category": "Coffee",
      "categories": ["Coffee", "Beans"],
      "description": "Single-origin whole bean coffee",
      "unit": "pcs",
      "baseUnit": {
        "id": "unit_123",
        "code": "pcs",
        "labelRu": "шт",
        "labelKg": "даана"
      },
      "supplier": {
        "id": "supplier_123",
        "name": "Supplier LLC"
      },
      "isBundle": false,
      "barcodes": ["1234567890123"],
      "packs": [
        {
          "id": "pack_123",
          "packName": "Box",
          "packBarcode": "BOX-123",
          "multiplierToBase": 6,
          "allowInPurchasing": true,
          "allowInReceiving": true
        }
      ],
      "createdAt": "2026-06-01T10:00:00.000Z",
      "updatedAt": "2026-06-04T10:00:00.000Z",
      "price": 900,
      "priceKgs": 900,
      "stockQty": 7,
      "pcs": 7,
      "stockByVariant": [
        {
          "variantKey": "BASE",
          "stockQty": 7,
          "pcs": 7
        }
      ],
      "images": [
        "https://cdn.example.com/products/coffee-main.jpg"
      ],
      "imageObjects": [
        {
          "id": null,
          "url": "https://cdn.example.com/products/coffee-main.jpg",
          "position": 0,
          "isPrimary": true,
          "isAiGenerated": false
        }
      ],
      "variants": [
        {
          "id": "variant_123",
          "sku": "COFFEE-1KG",
          "name": "1 kg",
          "attributes": {
            "size": "1 kg"
          },
          "attributeValues": [
            {
              "key": "size",
              "value": "1 kg"
            }
          ],
          "createdAt": "2026-06-01T10:00:00.000Z",
          "updatedAt": "2026-06-04T10:00:00.000Z",
          "price": 1200,
          "priceKgs": 1200,
          "stockQty": 3,
          "pcs": 3
        }
      ]
    }
  ]
}`;

const orderRequest = `{
  "externalId": "MARKET-10001",
  "customerName": "Ivan Ivanov",
  "customerEmail": "ivan@example.com",
  "customerPhone": "+996555111222",
  "customerAddress": "Bishkek, Manas 10",
  "comment": "Delivery after 18:00",
  "lines": [
    {
      "productId": "product_123",
      "qty": 2
    },
    {
      "productId": "product_456",
      "variantId": "variant_456_blue",
      "qty": 1
    }
  ]
}`;

const orderResponse = `{
  "order": {
    "id": "order_123",
    "number": "SO-000001",
    "status": "CONFIRMED",
    "totalKgs": 3000
  }
}`;

const orderDetailResponse = `{
  "order": {
    "id": "order_123",
    "orderNumber": "SO-000001",
    "externalOrderId": "MARKET-10001",
    "status": "CONFIRMED",
    "statusLabel": "Подтвержден",
    "internalStatus": "CONFIRMED",
    "createdAt": "2026-06-04T10:00:00.000Z",
    "updatedAt": "2026-06-04T10:00:00.000Z",
    "cancelledAt": null,
    "completedAt": null,
    "customer": {
      "name": "Ivan Ivanov",
      "phone": "+996555111222",
      "email": "ivan@example.com",
      "address": "Bishkek, Manas 10"
    },
    "store": {
      "id": "store_123",
      "name": "Main Store"
    },
    "items": [
      {
        "productId": "product_123",
        "variantId": null,
        "name": "Coffee 250g",
        "sku": "COFFEE-250",
        "quantity": 2,
        "price": 1500,
        "priceKgs": 1500,
        "total": 3000,
        "totalKgs": 3000
      }
    ],
    "totals": {
      "subtotal": 3000,
      "discount": 0,
      "shipping": 0,
      "total": 3000,
      "currencyCode": "KGS"
    },
    "payment": {
      "status": "UNPAID",
      "method": null,
      "methods": []
    },
    "fulfillment": {
      "status": "PENDING",
      "trackingNumber": null,
      "trackingUrl": null,
      "carrier": null
    }
  }
}`;

const orderListResponse = `{
  "data": [
    {
      "id": "order_123",
      "orderNumber": "SO-000001",
      "externalOrderId": "MARKET-10001",
      "status": "CONFIRMED",
      "statusLabel": "Подтвержден",
      "internalStatus": "CONFIRMED",
      "createdAt": "2026-06-04T10:00:00.000Z",
      "updatedAt": "2026-06-04T10:00:00.000Z",
      "total": 3000,
      "totalKgs": 3000,
      "currencyCode": "KGS"
    }
  ],
  "pagination": {
    "nextCursor": null
  }
}`;

const customerRequest = `{
  "name": "Ivan Ivanov",
  "email": "ivan@example.com",
  "phone": "+996555111222",
  "address": "Bishkek, Manas 10"
}`;

const customerResponse = `{
  "action": "created",
  "customer": {
    "id": "customer_123",
    "name": "Ivan Ivanov",
    "email": "ivan@example.com",
    "phone": "+996555111222",
    "address": "Bishkek, Manas 10",
    "source": "INTEGRATION",
    "createdAt": "2026-06-04T10:00:00.000Z",
    "updatedAt": "2026-06-04T10:00:00.000Z"
  }
}`;

const errorResponse = `{
  "message": "invalidInput"
}`;

const navItems = [
  { href: "#overview", label: "Обзор" },
  { href: "#auth", label: "Авторизация" },
  { href: "#products", label: "Товары" },
  { href: "#orders", label: "Заказы" },
  { href: "#customers", label: "Клиенты" },
  { href: "#errors", label: "Ошибки" },
  { href: "#limits", label: "Ограничения" },
];

const endpoints = [
  {
    method: "GET",
    path: "/products",
    title: "Получение товаров",
    description: "Товары, цены, остатки, изображения, штрихкоды, упаковки и варианты.",
    icon: ProductsIcon,
  },
  {
    method: "POST",
    path: "/orders",
    title: "Создание заказа",
    description: "Передача заказа из маркетплейса или внешней витрины в BAZAAR.",
    icon: SalesOrdersIcon,
  },
  {
    method: "GET",
    path: "/orders",
    title: "Статусы заказов",
    description: "Список API-заказов с фильтрами по статусу, датам и внешнему ID.",
    icon: SalesOrdersIcon,
  },
  {
    method: "GET",
    path: "/orders/{id}",
    title: "Заказ по ID",
    description: "Получение статуса и деталей по ID, номеру заказа или externalId.",
    icon: SalesOrdersIcon,
  },
  {
    method: "POST",
    path: "/customers",
    title: "Синхронизация клиентов",
    description: "Создание нового клиента или обновление существующей карточки.",
    icon: UsersIcon,
  },
];

const queryParams = [
  ["page", "number", "Нет", "Номер страницы. По умолчанию 1."],
  ["pageSize", "number", "Нет", "Количество товаров на странице. По умолчанию 50, максимум 100."],
  ["search", "string", "Нет", "Поиск по названию или SKU. Максимум 200 символов."],
];

const importantProductFields = [
  ["id", "ID товара. Используется при создании заказа."],
  ["sku", "Артикул товара."],
  ["price", "Цена в валюте магазина."],
  ["priceKgs", "Цена в KGS."],
  ["currencyCode", "Валюта магазина."],
  ["stockQty", "Остаток базового товара."],
  ["pcs", "Совместимый alias для stockQty."],
  ["variants[].id", "ID варианта. Используется как variantId при создании заказа."],
  ["variants[].stockQty", "Остаток конкретного варианта."],
  ["stockByVariant", "Остатки по базовому товару и вариантам."],
];

const orderFields = [
  ["externalId", "string", "Нет", "До 160 символов."],
  ["customerName", "string", "Нет", "До 160 символов."],
  ["customerEmail", "string", "Нет", "Валидный email, до 254 символов."],
  ["customerPhone", "string", "Нет", "До 64 символов."],
  ["customerAddress", "string", "Нет", "До 512 символов."],
  ["comment", "string", "Нет", "До 2000 символов."],
  ["lines", "array", "Да", "От 1 до 500 строк."],
  ["lines[].productId", "string", "Да", "ID товара из GET /products."],
  ["lines[].variantId", "string", "Нет", "ID варианта из GET /products; не передавать для базового товара."],
  ["lines[].qty", "number", "Да", "Целое число, минимум 1."],
];

const orderListQueryParams = [
  ["status", "string", "Нет", "Публичный статус: NEW, CONFIRMED, READY_FOR_PICKUP, COMPLETED, CANCELLED."],
  ["orderNumber", "string", "Нет", "Номер заказа, например SO-000001."],
  ["externalOrderId", "string", "Нет", "externalId, переданный при POST /orders."],
  ["dateFrom", "string", "Нет", "Дата/время начала периода по createdAt."],
  ["dateTo", "string", "Нет", "Дата/время конца периода по createdAt."],
  ["storeId", "string", "Нет", "Должен совпадать с магазином API-ключа; другие магазины не возвращаются."],
  ["limit", "number", "Нет", "Размер страницы. По умолчанию 50, максимум 100."],
  ["cursor", "string", "Нет", "Курсор следующей страницы из pagination.nextCursor."],
];

const orderStatusRows = [
  ["DRAFT", "NEW", "Новый заказ"],
  ["CONFIRMED", "CONFIRMED", "Подтвержден"],
  ["READY", "READY_FOR_PICKUP", "Готов к выдаче"],
  ["COMPLETED", "COMPLETED", "Завершен"],
  ["CANCELED", "CANCELLED", "Отменен"],
];

const customerFields = [
  ["name", "string", "Да", "От 1 до 160 символов."],
  ["email", "string", "Да", "Валидный email, до 254 символов."],
  ["phone", "string", "Да", "От 1 до 64 символов."],
  ["address", "string", "Нет", "До 512 символов."],
];

const errors = [
  ["400", "invalidInput", "Неверный JSON, неверный формат полей или превышены лимиты."],
  ["400", "invalidQuantity", "Некорректное количество товара в заказе."],
  ["400", "salesOrderEmpty", "Заказ без строк."],
  ["401", "apiUnauthorized", "Не передан, неверный или отозван API-ключ."],
  ["404", "storeNotFound", "Магазин для API-ключа не найден."],
  ["404", "ORDER_NOT_FOUND", "Заказ не найден или недоступен для API-ключа."],
  ["404", "productNotFound", "Товар не найден или недоступен в магазине API-ключа."],
  ["404", "variantNotFound", "Вариант товара не найден или не относится к указанному товару."],
  ["500", "genericMessage", "Внутренняя ошибка сервера."],
];

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950 p-4 text-sm leading-6 text-slate-100 shadow-sm">
    <code>{children}</code>
  </pre>
);

const MethodBadge = ({ method }: { method: string }) => {
  const isPost = method === "POST";
  return (
    <span
      className={
        isPost
          ? "rounded-md bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700"
          : "rounded-md bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-700"
      }
    >
      {method}
    </span>
  );
};

const DataTable = ({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) => (
  <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
    <table className="min-w-[720px] text-sm">
      <thead className="bg-slate-50">
        <tr>
          {headers.map((header) => (
            <th key={header} className="px-4 py-3 text-left font-semibold text-slate-600">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200">
        {rows.map((row) => (
          <tr key={row.join(":")}>
            {row.map((cell, index) => (
              <td key={`${cell}-${index}`} className="px-4 py-3 align-top text-slate-700">
                {index === 0 || (headers[index] ?? "").includes("message") ? (
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-900">{cell}</code>
                ) : (
                  cell
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Section = ({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) => (
  <section id={id} className="scroll-mt-24 border-t border-slate-200 py-12">
    <p className="text-sm font-semibold uppercase tracking-[0.14em] text-blue-700">{eyebrow}</p>
    <h2 className="mt-2 text-2xl font-semibold tracking-normal text-slate-950 md:text-3xl">{title}</h2>
    <div className="mt-6 space-y-6">{children}</div>
  </section>
);

const BazaarApiDocsPage = () => (
  <main className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-8 md:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <Link href="/" className="inline-flex items-center gap-3 text-slate-950">
            <Image src="/brand/logo.png" alt="Bazaar" width={144} height={36} className="h-9 w-auto" priority />
            <span className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
              API v1
            </span>
          </Link>
          <h1 className="mt-8 max-w-4xl text-4xl font-semibold tracking-normal text-slate-950 md:text-6xl">
            Документация BAZAAR API для внешних интеграций
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">
            Подключайте сайты, маркетплейсы и внешние системы к BAZAAR: получайте товары, цены и
            остатки, передавайте заказы и синхронизируйте клиентов.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href="#products"
              className="inline-flex h-11 items-center gap-2 rounded-md bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800"
            >
              Смотреть методы
              <ExternalLinkIcon className="h-4 w-4" aria-hidden />
            </a>
            <a
              href="#flow"
              className="inline-flex h-11 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Сценарий интеграции
            </a>
          </div>
        </div>

        <div className="w-full max-w-md rounded-md border border-slate-200 bg-slate-950 p-5 text-slate-100 shadow-xl lg:shrink-0">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-300">Base URL</p>
            <span className="rounded bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-300">
              Store-scoped
            </span>
          </div>
          <code className="block break-all rounded-md bg-white/5 p-3 text-sm text-slate-100">
            {baseUrl}
          </code>
          <div className="mt-5 grid gap-3 text-sm text-slate-300">
            <div className="flex items-center gap-2">
              <KeyIcon className="h-4 w-4 text-emerald-300" aria-hidden />
              Authorization: Bearer API key
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheckIcon className="h-4 w-4 text-emerald-300" aria-hidden />
              Один ключ даёт доступ к одному магазину
            </div>
            <div className="flex items-center gap-2">
              <StatusSuccessIcon className="h-4 w-4 text-emerald-300" aria-hidden />
              Максимум 100 товаров на страницу
            </div>
          </div>
        </div>
      </div>
    </header>

    <div className="mx-auto grid max-w-7xl gap-8 px-5 py-8 md:px-8 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <nav className="sticky top-6 rounded-md border border-slate-200 bg-white p-3">
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Разделы
          </p>
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-950"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 rounded-md border border-slate-200 bg-white px-5 py-2 shadow-sm md:px-8">
        <Section id="overview" eyebrow="Overview" title="Назначение API">
          <div className="grid gap-4 md:grid-cols-3">
            {endpoints.map((endpoint) => {
              const Icon = endpoint.icon;
              return (
                <div key={endpoint.path} className="rounded-md border border-slate-200 bg-white p-5">
                  <Icon className="h-6 w-6 text-blue-700" aria-hidden />
                  <div className="mt-4 flex items-center gap-2">
                    <MethodBadge method={endpoint.method} />
                    <code className="rounded bg-slate-100 px-2 py-1 text-sm text-slate-900">
                      {endpoint.path}
                    </code>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-slate-950">{endpoint.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{endpoint.description}</p>
                </div>
              );
            })}
          </div>
          <p className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">
            API работает в модели <code className="rounded bg-white px-1.5 py-0.5">store-scoped access</code>:
            каждый API-ключ привязан к одному магазину. Внешняя система видит и создаёт данные
            только в рамках этого магазина.
          </p>
        </Section>

        <Section id="auth" eyebrow="Authentication" title="Авторизация">
          <p className="text-slate-700">Для всех запросов требуется API-ключ в заголовке.</p>
          <CodeBlock>{`Authorization: Bearer <API_KEY>
Content-Type: application/json`}</CodeBlock>
          <p className="text-slate-700">
            API-ключ создаётся в BAZAAR в разделе интеграций. Новый ключ показывается один раз,
            поэтому его нужно сохранить сразу после создания.
          </p>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            Если ключ отозван или передан неверно, API возвращает HTTP <code>401</code> и
            сообщение <code>apiUnauthorized</code>.
          </div>
        </Section>

        <Section id="products" eyebrow="Endpoint" title="GET /products">
          <p className="text-slate-700">
            Возвращает список активных товаров магазина, доступных для интеграции.
          </p>
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
            <MethodBadge method="GET" />
            <code className="break-all text-sm text-slate-900">
              /api/bazaar/v1/products?page=1&amp;pageSize=50&amp;search=coffee
            </code>
          </div>

          <div>
            <h3 className="mb-3 text-lg font-semibold text-slate-950">Query параметры</h3>
            <DataTable headers={["Параметр", "Тип", "Обязательный", "Описание"]} rows={queryParams} />
          </div>

          <div>
            <h3 className="mb-3 text-lg font-semibold text-slate-950">Пример запроса</h3>
            <CodeBlock>{`curl -X GET "${baseUrl}/products?page=1&pageSize=50" \\
  -H "Authorization: Bearer <API_KEY>"`}</CodeBlock>
          </div>

          <div>
            <h3 className="mb-3 text-lg font-semibold text-slate-950">Пример ответа</h3>
            <CodeBlock>{productResponse}</CodeBlock>
          </div>

          <div>
            <h3 className="mb-3 text-lg font-semibold text-slate-950">Важные поля</h3>
            <DataTable headers={["Поле", "Описание"]} rows={importantProductFields} />
          </div>

          <p className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
            Закрытые внутренние поля, включая себестоимость и бухгалтерские данные, через API не
            передаются.
          </p>
        </Section>

        <Section id="orders" eyebrow="Endpoint" title="Заказы">
          <p className="text-slate-700">
            Создаёт заказ в BAZAAR для магазина, к которому привязан API-ключ.
          </p>
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
            <MethodBadge method="POST" />
            <code className="break-all text-sm text-slate-900">/api/bazaar/v1/orders</code>
          </div>

          <div>
            <h3 className="mb-3 text-lg font-semibold text-slate-950">Тело запроса</h3>
            <DataTable headers={["Поле", "Тип", "Обязательное", "Ограничение"]} rows={orderFields} />
          </div>

          <div>
            <h3 className="mb-3 text-lg font-semibold text-slate-950">Пример запроса</h3>
            <CodeBlock>{`curl -X POST "${baseUrl}/orders" \\
  -H "Authorization: Bearer <API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '${orderRequest}'`}</CodeBlock>
          </div>

          <div>
            <h3 className="mb-3 text-lg font-semibold text-slate-950">Пример ответа</h3>
            <CodeBlock>{orderResponse}</CodeBlock>
          </div>

          <ul className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
            <li>Заказ создаётся только в магазине, к которому привязан API-ключ.</li>
            <li>Товары в заказе должны быть активны и доступны в этом же магазине.</li>
            <li>
              Для варианта товара нужно передавать <code>variantId</code> из ответа{" "}
              <code>GET /products</code>.
            </li>
            <li>Если переданы данные клиента, BAZAAR создаст или обновит клиента в базе этого магазина.</li>
            <li>Если email и телефон клиента не переданы, отдельная карточка клиента не создаётся.</li>
            <li>Валютный snapshot магазина сохраняется в заказе на момент создания.</li>
          </ul>

          <div className="space-y-4 border-t border-slate-200 pt-6">
            <h3 className="text-xl font-semibold text-slate-950">GET /orders</h3>
            <p className="text-slate-700">
              Возвращает список API-заказов магазина с фильтрами и cursor-пагинацией.
            </p>
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
              <MethodBadge method="GET" />
              <code className="break-all text-sm text-slate-900">
                /api/bazaar/v1/orders?status=CONFIRMED&amp;limit=50
              </code>
            </div>
            <DataTable headers={["Параметр", "Тип", "Обязательный", "Описание"]} rows={orderListQueryParams} />
            <CodeBlock>{`curl -X GET "${baseUrl}/orders?status=CONFIRMED&dateFrom=2026-06-01&dateTo=2026-06-30" \\
  -H "Authorization: Bearer <API_KEY>"`}</CodeBlock>
            <CodeBlock>{orderListResponse}</CodeBlock>
          </div>

          <div className="space-y-4 border-t border-slate-200 pt-6">
            <h3 className="text-xl font-semibold text-slate-950">GET /orders/{"{id}"}</h3>
            <p className="text-slate-700">
              Возвращает один API-заказ по ID BAZAAR, номеру заказа или <code>externalId</code>,
              переданному при создании.
            </p>
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
              <MethodBadge method="GET" />
              <code className="break-all text-sm text-slate-900">/api/bazaar/v1/orders/SO-000001</code>
            </div>
            <CodeBlock>{`curl -X GET "${baseUrl}/orders/SO-000001" \\
  -H "Authorization: Bearer <API_KEY>"

curl -X GET "${baseUrl}/orders/MARKET-10001" \\
  -H "Authorization: Bearer <API_KEY>"`}</CodeBlock>
            <CodeBlock>{orderDetailResponse}</CodeBlock>
          </div>

          <div className="space-y-4 border-t border-slate-200 pt-6">
            <h3 className="text-xl font-semibold text-slate-950">Публичные статусы</h3>
            <p className="text-slate-700">
              Поле <code>status</code> стабильно для внешних интеграций. Поле{" "}
              <code>internalStatus</code> передаётся только для диагностики.
            </p>
            <DataTable headers={["Internal", "Public API", "Описание"]} rows={orderStatusRows} />
          </div>
        </Section>

        <Section id="customers" eyebrow="Endpoint" title="POST /customers">
          <p className="text-slate-700">
            Создаёт нового клиента или обновляет существующего клиента в магазине.
          </p>
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
            <MethodBadge method="POST" />
            <code className="break-all text-sm text-slate-900">/api/bazaar/v1/customers</code>
          </div>

          <div>
            <h3 className="mb-3 text-lg font-semibold text-slate-950">Тело запроса</h3>
            <DataTable headers={["Поле", "Тип", "Обязательное", "Ограничение"]} rows={customerFields} />
          </div>

          <div>
            <h3 className="mb-3 text-lg font-semibold text-slate-950">Пример запроса</h3>
            <CodeBlock>{`curl -X POST "${baseUrl}/customers" \\
  -H "Authorization: Bearer <API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '${customerRequest}'`}</CodeBlock>
          </div>

          <div>
            <h3 className="mb-3 text-lg font-semibold text-slate-950">Пример ответа</h3>
            <CodeBlock>{customerResponse}</CodeBlock>
          </div>
        </Section>

        <Section id="errors" eyebrow="Errors" title="Ошибки">
          <p className="text-slate-700">Ошибки возвращаются в едином формате.</p>
          <CodeBlock>{errorResponse}</CodeBlock>
          <DataTable headers={["HTTP статус", "message", "Описание"]} rows={errors} />
        </Section>

        <Section id="limits" eyebrow="Limits" title="Ограничения и требования">
          <ul className="space-y-3 text-slate-700">
            <li>Все запросы должны выполняться по HTTPS.</li>
            <li>
              API-ключ нельзя передавать в query string; используйте только заголовок{" "}
              <code>Authorization</code>.
            </li>
            <li>Один API-ключ даёт доступ только к одному магазину.</li>
            <li>
              <code>GET /products</code> возвращает максимум <code>100</code> товаров на страницу.
            </li>
            <li>
              <code>POST /orders</code> принимает максимум <code>500</code> строк заказа.
            </li>
            <li>API отдаёт только активные товары, доступные в магазине.</li>
            <li>API не отдаёт себестоимость, бухгалтерские и другие закрытые внутренние поля.</li>
            <li>
              Для синхронизации товаров, цен и остатков маркетплейс должен регулярно читать{" "}
              <code>GET /products</code>.
            </li>
            <li>
              Для передачи заказов маркетплейс должен вызывать <code>POST /orders</code>.
            </li>
            <li>
              Запись товаров, цен и остатков из внешней системы в BAZAAR через публичный API сейчас
              не включена в базовый набор методов и обсуждается отдельно при необходимости.
            </li>
          </ul>
        </Section>

        <Section id="flow" eyebrow="Integration flow" title="Рекомендуемый сценарий интеграции">
          <ol className="space-y-3 text-slate-700">
            <li>В BAZAAR создаётся API-ключ для нужного магазина.</li>
            <li>
              Маркетплейс периодически вызывает <code>GET /products</code>.
            </li>
            <li>
              Маркетплейс сохраняет у себя <code>productId</code> и, при наличии вариантов,{" "}
              <code>variantId</code>.
            </li>
            <li>
              При новом заказе маркетплейс вызывает <code>POST /orders</code>.
            </li>
            <li>BAZAAR создаёт подтверждённый заказ и сохраняет данные клиента.</li>
            <li>
              Маркетплейс повторно читает <code>GET /products</code> для обновления остатков и цен.
            </li>
          </ol>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-5">
            <div className="flex items-start gap-3">
              <BookOpenIcon className="mt-1 h-5 w-5 text-blue-700" aria-hidden />
              <div>
                <h3 className="font-semibold text-slate-950">Публичная ссылка</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  После деплоя документация будет доступна по адресу{" "}
                  <code>/developers/bazaar-api</code> на вашем домене.
                </p>
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  </main>
);

export default BazaarApiDocsPage;
