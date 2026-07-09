# BAZAAR API v1

Документация для интеграции внешних систем, сайтов и маркетплейсов с BAZAAR.

## Назначение API

BAZAAR API позволяет внешней системе:

- получать товары магазина;
- получать актуальные цены и остатки вместе с товарами;
- передавать заказы в BAZAAR;
- создавать или обновлять клиентов.

На текущий момент API работает в модели store-scoped access: каждый API-ключ привязан к одному магазину. Внешняя система видит и создаёт данные только в рамках этого магазина.

## Базовый URL

```text
https://bazaar.kg/api/bazaar/v1
```

Пример:

```text
https://bazaar.kg/api/bazaar/v1
```

## Авторизация

Для всех запросов требуется API-ключ.

```http
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

API-ключ создаётся в BAZAAR в разделе интеграций. Новый ключ показывается один раз, поэтому его нужно сохранить сразу после создания.

Если ключ отозван или передан неверно, API возвращает:

```json
{
  "message": "apiUnauthorized"
}
```

HTTP статус: `401`.

## Доступные методы

| Метод | Endpoint | Назначение |
| --- | --- | --- |
| `GET` | `/products` | Получение товаров, цен, остатков, изображений и вариантов |
| `POST` | `/orders` | Создание заказа во внутренней системе BAZAAR |
| `GET` | `/orders` | Получение списка API-заказов и их статусов |
| `GET` | `/orders/{id}` | Получение одного API-заказа по ID, номеру или externalId |
| `POST` | `/customers` | Создание или обновление клиента |

## GET /products

Возвращает список активных товаров магазина, доступных для интеграции.

```http
GET /api/bazaar/v1/products?page=1&pageSize=50&search=coffee
```

### Query параметры

| Параметр | Тип | Обязательный | Описание |
| --- | --- | --- | --- |
| `page` | number | Нет | Номер страницы. По умолчанию `1` |
| `pageSize` | number | Нет | Количество товаров на странице. По умолчанию `50`, максимум `100` |
| `search` | string | Нет | Поиск по названию или SKU. Максимум `200` символов |

### Пример запроса

```bash
curl -X GET "https://bazaar.kg/api/bazaar/v1/products?page=1&pageSize=50" \
  -H "Authorization: Bearer <API_KEY>"
```

### Пример ответа

```json
{
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
}
```

### Важные поля

| Поле | Описание |
| --- | --- |
| `id` | ID товара. Используется при создании заказа |
| `sku` | Артикул товара |
| `price` | Цена в валюте магазина |
| `priceKgs` | Цена в KGS |
| `currencyCode` | Валюта магазина |
| `stockQty` | Остаток базового товара |
| `pcs` | Совместимый alias для `stockQty` |
| `variants[].id` | ID варианта. Используется как `variantId` при создании заказа |
| `variants[].stockQty` | Остаток конкретного варианта |
| `stockByVariant` | Остатки по базовому товару и вариантам |

Закрытые внутренние поля, включая себестоимость и бухгалтерские данные, через API не передаются.

## POST /orders

Создаёт заказ в BAZAAR для магазина, к которому привязан API-ключ.

```http
POST /api/bazaar/v1/orders
```

### Тело запроса

| Поле | Тип | Обязательное | Ограничение |
| --- | --- | --- | --- |
| `externalId` | string | Нет | До `160` символов |
| `customerName` | string | Нет | До `160` символов |
| `customerEmail` | string | Нет | Валидный email, до `254` символов |
| `customerPhone` | string | Нет | До `64` символов |
| `customerAddress` | string | Нет | До `512` символов |
| `comment` | string | Нет | До `2000` символов |
| `lines` | array | Да | От `1` до `500` строк |
| `lines[].productId` | string | Да | ID товара из `GET /products` |
| `lines[].variantId` | string | Нет | ID варианта из `GET /products`; не передавать для базового товара |
| `lines[].qty` | number | Да | Целое число, минимум `1` |

### Пример запроса

```bash
curl -X POST "https://bazaar.kg/api/bazaar/v1/orders" \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
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
  }'
```

### Пример ответа

```json
{
  "order": {
    "id": "order_123",
    "number": "SO-000001",
    "status": "CONFIRMED",
    "totalKgs": 3000
  }
}
```

HTTP статус при успешном создании: `201`.

### Правила создания заказов

- Заказ создаётся только в магазине, к которому привязан API-ключ.
- Товары в заказе должны быть активны и доступны в этом же магазине.
- Для варианта товара нужно передавать `variantId` из ответа `GET /products`.
- Если переданы данные клиента, BAZAAR создаст или обновит клиента в базе этого магазина.
- Если email и телефон клиента не переданы, отдельная карточка клиента не создаётся.
- Валютный snapshot магазина сохраняется в заказе на момент создания.

## GET /orders

Возвращает список API-заказов магазина, к которому привязан API-ключ.

```http
GET /api/bazaar/v1/orders?status=CONFIRMED&dateFrom=2026-06-01&dateTo=2026-06-30&limit=50
```

### Query параметры

| Параметр | Тип | Обязательный | Описание |
| --- | --- | --- | --- |
| `status` | string | Нет | Публичный статус: `NEW`, `CONFIRMED`, `READY_FOR_PICKUP`, `COMPLETED`, `CANCELLED` |
| `orderNumber` | string | Нет | Номер заказа, например `SO-000054` |
| `externalOrderId` | string | Нет | `externalId`, переданный в `POST /orders` |
| `dateFrom` | string | Нет | Начало периода по `createdAt` |
| `dateTo` | string | Нет | Конец периода по `createdAt` |
| `storeId` | string | Нет | Должен совпадать с магазином API-ключа |
| `limit` | number | Нет | Размер страницы. По умолчанию `50`, максимум `100` |
| `cursor` | string | Нет | Курсор следующей страницы из `pagination.nextCursor` |

### Пример запроса

```bash
curl -X GET "https://bazaar.kg/api/bazaar/v1/orders?status=CONFIRMED&limit=50" \
  -H "Authorization: Bearer <API_KEY>"
```

### Пример ответа

```json
{
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
}
```

## GET /orders/{id}

Возвращает один API-заказ по ID BAZAAR, номеру заказа или `externalId`.

```http
GET /api/bazaar/v1/orders/SO-000001
```

### Примеры запроса

```bash
curl -X GET "https://bazaar.kg/api/bazaar/v1/orders/SO-000001" \
  -H "Authorization: Bearer <API_KEY>"

curl -X GET "https://bazaar.kg/api/bazaar/v1/orders/MARKET-10001" \
  -H "Authorization: Bearer <API_KEY>"
```

### Пример ответа

```json
{
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
}
```

Если заказ не найден или недоступен для API-ключа:

```json
{
  "error": "ORDER_NOT_FOUND"
}
```

HTTP статус: `404`.

### Статусы заказов

Поле `status` стабильно для внешних интеграций. Поле `internalStatus` передаётся для диагностики.

| Внутренний статус | Public API status | Описание |
| --- | --- | --- |
| `DRAFT` | `NEW` | Новый заказ |
| `CONFIRMED` | `CONFIRMED` | Подтвержден |
| `READY` | `READY_FOR_PICKUP` | Готов к выдаче |
| `COMPLETED` | `COMPLETED` | Завершен |
| `CANCELED` | `CANCELLED` | Отменен |

## POST /customers

Создаёт нового клиента или обновляет существующего клиента в магазине.

```http
POST /api/bazaar/v1/customers
```

### Тело запроса

| Поле | Тип | Обязательное | Ограничение |
| --- | --- | --- | --- |
| `name` | string | Да | От `1` до `160` символов |
| `email` | string | Да | Валидный email, до `254` символов |
| `phone` | string | Да | От `1` до `64` символов |
| `address` | string | Нет | До `512` символов |

### Пример запроса

```bash
curl -X POST "https://bazaar.kg/api/bazaar/v1/customers" \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Ivan Ivanov",
    "email": "ivan@example.com",
    "phone": "+996555111222",
    "address": "Bishkek, Manas 10"
  }'
```

### Пример ответа при создании

```json
{
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
}
```

HTTP статус при создании: `201`.

### Пример ответа при обновлении

```json
{
  "action": "updated",
  "customer": {
    "id": "customer_123",
    "name": "Ivan Ivanov",
    "email": "ivan@example.com",
    "phone": "+996555111222",
    "address": "Bishkek, Manas 10",
    "source": "INTEGRATION",
    "createdAt": "2026-06-04T10:00:00.000Z",
    "updatedAt": "2026-06-04T10:05:00.000Z"
  }
}
```

HTTP статус при обновлении: `200`.

## Ошибки

Ошибки возвращаются в едином формате:

```json
{
  "message": "invalidInput"
}
```

| HTTP статус | `message` | Описание |
| --- | --- | --- |
| `400` | `invalidInput` | Неверный JSON, неверный формат полей или превышены лимиты |
| `400` | `invalidQuantity` | Некорректное количество товара в заказе |
| `400` | `salesOrderEmpty` | Заказ без строк |
| `401` | `apiUnauthorized` | Не передан, неверный или отозван API-ключ |
| `404` | `storeNotFound` | Магазин для API-ключа не найден |
| `404` | `ORDER_NOT_FOUND` | Заказ не найден или недоступен для API-ключа |
| `404` | `productNotFound` | Товар не найден или недоступен в магазине API-ключа |
| `404` | `variantNotFound` | Вариант товара не найден или не относится к указанному товару |
| `500` | `genericMessage` | Внутренняя ошибка сервера |

## Ограничения и требования

- Все запросы должны выполняться по HTTPS.
- API-ключ нельзя передавать в query string; используйте только заголовок `Authorization`.
- Один API-ключ даёт доступ только к одному магазину.
- `GET /products` возвращает максимум `100` товаров на страницу.
- `GET /orders` возвращает максимум `100` заказов на страницу.
- `POST /orders` принимает максимум `500` строк заказа.
- API отдаёт только активные товары, доступные в магазине.
- API не отдаёт себестоимость, бухгалтерские и другие закрытые внутренние поля.
- Для синхронизации товаров, цен и остатков маркетплейс должен регулярно читать `GET /products`.
- Для передачи заказов маркетплейс должен вызывать `POST /orders`.
- Запись товаров, цен и остатков из внешней системы в BAZAAR через публичный API сейчас не включена в базовый набор методов и обсуждается отдельно при необходимости.

## Рекомендуемый сценарий интеграции с маркетплейсом

1. В BAZAAR создаётся API-ключ для нужного магазина.
2. Маркетплейс периодически вызывает `GET /products`.
3. Маркетплейс сохраняет у себя `productId` и, при наличии вариантов, `variantId`.
4. При новом заказе маркетплейс вызывает `POST /orders`.
5. BAZAAR создаёт подтверждённый заказ и сохраняет данные клиента.
6. Маркетплейс вызывает `GET /orders/{id}` или `GET /orders?externalOrderId=...`, чтобы получить актуальный статус заказа.
7. Маркетплейс повторно читает `GET /products` для обновления остатков и цен.
