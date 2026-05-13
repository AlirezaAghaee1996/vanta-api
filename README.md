# 🚀 Vanta API

**Vanta API** is a lightweight, reusable API utility toolkit for **Express.js** and **Mongoose** applications.

It helps you build clean, secure, and production-friendly API endpoints with advanced filtering, search, sorting, pagination, populate, centralized error handling, and async route handling.

---

## ✨ Features

- Advanced query filtering
- Manual server-side filters
- Recursive `$and`, `$or`, `$nor` filter support
- Automatic `ObjectId` conversion
- Search using `q`
- Case-insensitive regex search
- Sorting
- Field limiting / projection
- Pagination
- Aggregation-based populate
- Nested populate support
- Role-based security limits
- Forbidden field protection
- Async route wrapper
- Centralized Express error handler
- Custom operational error class

---

## 📦 Installation

```bash
npm install vanta-api
```

Required dependencies in your app:

```bash
npm install express mongoose
```

---

## 📁 Project Files

```txt
src/
  api-features.js
  catchAsync.js
  config.js
  errorHandler.js
  handleError.js
  security-default-config.js
```

| File | Purpose |
|---|---|
| `api-features.js` | Main API query builder for filtering, search, sorting, pagination, populate, and execution |
| `catchAsync.js` | Wraps async Express route handlers and forwards errors to `next()` |
| `errorHandler.js` | Global Express error middleware |
| `handleError.js` | Custom operational error class |
| `config.js` | Loads and merges security configuration |
| `security-default-config.js` | Default security rules and role-based limits |

---

# 🇬🇧 English Documentation

## Quick Start

```js
import ApiFeatures,{catchAsync,catchError,HandleERROR} from "vanta-api";

```

Example controller:

```js
export const getProducts = catchAsync(async (req, res, next) => {
  const result = await new ApiFeatures(Product, req.query, req.user?.role)
    .filter()
    .search(["name", "description"])
    .sort()
    .limitFields()
    .paginate()
    .execute();

  res.status(200).json(result);
});
```

---

# ApiFeatures

`ApiFeatures` is the main class of this package. It converts request query parameters and manual backend filters into a MongoDB aggregation pipeline.

## Constructor

```js
new ApiFeatures(model, query, userRole)
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `model` | Mongoose Model | Yes | The Mongoose model used to run aggregation |
| `query` | Object | No | Usually `req.query` |
| `userRole` | String | No | Role name used for security rules |

Example:

```js
const features = new ApiFeatures(Product, req.query, req.user?.role);
```

If `userRole` is missing or invalid, the default role is `guest`.

---

## Recommended Chain Order

```js
const result = await new ApiFeatures(Model, req.query, req.user?.role)
  .addManualFilters(serverSideFilters)
  .filter()
  .populate(populateOptions)
  .search(["name", "description"])
  .sort()
  .limitFields()
  .paginate()
  .execute();
```

Why this order?

1. `addManualFilters()` adds backend-controlled filters.
2. `filter()` creates the base `$match`.
3. `populate()` joins referenced documents.
4. `search()` searches normal or populated fields.
5. `sort()` sorts final results.
6. `limitFields()` controls output fields.
7. `paginate()` applies paging.
8. `execute()` runs the aggregation.

---

## `filter()`

Builds a MongoDB `$match` stage from `req.query`.

```js
new ApiFeatures(Product, req.query)
  .filter()
  .execute();
```

### Simple Filter

```txt
GET /api/products?category=phone
```

Generated filter:

```js
{
  category: "phone"
}
```

### Comparison Operators

```txt
GET /api/products?price[gte]=100&price[lte]=500
```

Generated filter:

```js
{
  price: {
    $gte: 100,
    $lte: 500
  }
}
```

### Boolean / Null / Number Conversion

```txt
GET /api/products?isActive=true&deletedAt=null&price=100
```

Generated values:

```js
{
  isActive: true,
  deletedAt: null,
  price: 100
}
```

Strings with leading zero are preserved:

```txt
GET /api/users?code=0012
```

```js
{
  code: "0012"
}
```

### ObjectId Conversion

Fields like `_id`, `id`, and fields ending with `id` are converted to `ObjectId` when the value is a strict MongoDB ObjectId.

```txt
GET /api/products?_id=665f0f6f4e7d9a2e2c123456
```

```js
{
  _id: ObjectId("665f0f6f4e7d9a2e2c123456")
}
```

Reserved query keys are excluded from normal filtering:

```js
["page", "limit", "sort", "fields", "populate", "q"]
```

---

## `addManualFilters(filters)`

Adds backend-controlled filters manually. This is useful when you want to enforce conditions that users should not control from the URL.

```js
new ApiFeatures(Order, req.query)
  .addManualFilters({ user: req.user._id })
  .filter()
  .execute();
```

### `$and` Example

```js
const result = await new ApiFeatures(Product, req.query)
  .addManualFilters({
    $and: [
      { _id: "665f0f6f4e7d9a2e2c123456" },
      { isActive: true }
    ]
  })
  .filter()
  .execute();
```

The `_id` inside `$and` is recursively converted to `ObjectId`.

### `$or` Example

```js
const result = await new ApiFeatures(Product, req.query)
  .addManualFilters({
    $or: [
      { ownerId: "665f0f6f4e7d9a2e2c123456" },
      { createdById: "665f0f6f4e7d9a2e2c654321" }
    ]
  })
  .filter()
  .execute();
```

### `$nor` Example

```js
const result = await new ApiFeatures(Product, req.query)
  .addManualFilters({
    $nor: [
      { status: "blocked" },
      { isDeleted: true }
    ]
  })
  .filter()
  .execute();
```

### `$in` Example

```js
const result = await new ApiFeatures(Product, req.query)
  .addManualFilters({
    _id: {
      $in: [
        "665f0f6f4e7d9a2e2c123456",
        "665f0f6f4e7d9a2e2c654321"
      ]
    }
  })
  .filter()
  .execute();
```

---

## `search(fields)`

Searches using the `q` key from `req.query`. It always uses case-insensitive regex search.

```js
.search(["name", "description"])
```

```txt
GET /api/products?q=iphone
```

```js
const result = await new ApiFeatures(Product, req.query)
  .filter()
  .search(["name", "description", "brand"])
  .paginate()
  .execute();
```

Generated condition:

```js
{
  $or: [
    { name: { $regex: "iphone", $options: "i" } },
    { description: { $regex: "iphone", $options: "i" } },
    { brand: { $regex: "iphone", $options: "i" } }
  ]
}
```

`q` is reserved and is not treated as a normal filter.

---

## `sort()`

Sorts results using the `sort` query key.

```txt
GET /api/products?sort=-createdAt,price
```

```js
{
  createdAt: -1,
  price: 1
}
```

Only fields existing in the model schema are accepted.

---

## `limitFields(input)`

Controls returned fields using projection.

```txt
GET /api/products?fields=name,price,category
```

or:

```js
.limitFields("name,price")
```

Include mode:

```js
{ name: 1, price: 1 }
```

Exclude mode:

```txt
GET /api/products?fields=-description
```

```js
{ description: 0 }
```

Mixed include/exclude is not allowed:

```txt
GET /api/products?fields=name,-password
```

Throws:

```txt
Cannot mix include and exclude fields
```

---

## `paginate()`

Adds `$skip` and `$limit`.

```txt
GET /api/products?page=2&limit=10
```

Pipeline:

```js
[
  { $skip: 10 },
  { $limit: 10 }
]
```

Limits are capped by role.

---

## `populate(input)`

Performs aggregation-based populate using `$lookup`.

```js
.populate("user")
```

From query:

```txt
GET /api/posts?populate=user
```

Multiple populate paths:

```js
.populate(["user", "category"])
```

Nested populate:

```js
.populate({
  path: "user",
  populate: {
    path: "company",
    populate: {
      path: "country"
    }
  }
})
```

Dot notation:

```js
.populate("user.company.country")
```

Populate with select:

```js
.populate({
  path: "user",
  select: "name email"
})
```

Exclude fields:

```js
.populate({
  path: "user",
  select: "-password"
})
```

Mixed include/exclude is not allowed.

---

## `execute(options)`

Runs the aggregation pipeline.

```js
const result = await features.execute();
```

Returns:

```js
{
  success: true,
  count: 25,
  data: [...]
}
```

Options:

```js
.execute({
  debug: true,
  useCursor: false,
  batchSize: 100,
  maxTimeMS: 10000,
  allowDiskUse: true,
  readConcern: "majority"
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `debug` | Boolean | `false` | Logs the pipeline |
| `useCursor` | Boolean | `false` | Uses aggregation cursor |
| `batchSize` | Number | `100` | Cursor batch size |
| `maxTimeMS` | Number | `10000` | Max execution time |
| `allowDiskUse` | Boolean | `false` | Allows disk usage |
| `readConcern` | String | `majority` | MongoDB read concern |

---

# Full Controller Example

```js
import ApiFeatures,{catchAsync} from "vanta-api";
import Product from "../models/productModel.js";

export const getProducts = catchAsync(async (req, res, next) => {
  const result = await new ApiFeatures(Product, req.query, req.user?.role)
    .addManualFilters({ isDeleted: false })
    .filter()
    .populate([
      {
        path: "category",
        select: "name slug"
      },
      {
        path: "createdBy",
        select: "name email"
      }
    ])
    .search(["name", "description", "category.name"])
    .sort()
    .limitFields()
    .paginate()
    .execute();

  res.status(200).json(result);
});
```

---

# Error Handling

## `HandleERROR`

Custom operational error class.

```js
import {HandleERROR} from "vanta-api";

throw new HandleERROR("Product not found", 404);
```

Example properties:

```js
{
  message: "Product not found",
  statusCode: 404,
  status: "fail",
  isOperational: true
}
```

For `4xx` errors, `status` is `fail`. For `5xx` errors, `status` is `error`.

## `catchAsync`

Wraps async Express handlers and removes repetitive `try/catch`.

```js
import {catchAsync} from "vanta-api";

app.get(
  "/products",
  catchAsync(async (req, res, next) => {
    const products = await Product.find();
    res.json(products);
  })
);
```

Any rejected promise is forwarded to Express `next()`.

## `errorHandler`

Global Express error middleware.

```js
import {catchError} from "vanta-api";

app.use(catchError);
```

Example response:

```json
{
  "status": "fail",
  "success": false,
  "message": "Product not found"
}
```

Use it after all routes:

```js
app.use("/api/products", productRouter);
app.use(catchError);
```

---

# Security Configuration

Default security settings are stored in:

```txt
src/security-default-config.js
```

You can override them by creating a `security-config.js` file in your project root.

```js
export const securityConfig = {
  allowedOperators: [
    "eq",
    "ne",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "nin",
    "regex",
    "exists"
  ],

  forbiddenFields: ["password", "refreshToken", "resetPasswordToken"],

  maxPipelineStages: 50,

  accessLevels: {
    guest: {
      maxLimit: 20,
      allowedPopulate: ["category"]
    },
    user: {
      maxLimit: 100,
      allowedPopulate: ["category", "createdBy"]
    },
    admin: {
      maxLimit: 1000,
      allowedPopulate: ["*"]
    }
  }
};
```

---

# Express Setup Example

```js
import express from "express";
import {catchError} from "vanta-api";
import productRouter from "./routes/productRoutes.js";

const app = express();

app.use(express.json());
app.use("/api/products", productRouter);
app.use(catchError);

export default app;
```

---

# 🇮🇷 مستندات فارسی

## شروع سریع

```js
import ApiFeatures,{catchAsync,catchError,HandleERROR} from "vanta-api";

```

مثال controller:

```js
export const getProducts = catchAsync(async (req, res, next) => {
  const result = await new ApiFeatures(Product, req.query, req.user?.role)
    .filter()
    .search(["name", "description"])
    .sort()
    .limitFields()
    .paginate()
    .execute();

  res.status(200).json(result);
});
```

---

# ApiFeatures چیست؟

`ApiFeatures` کلاس اصلی پکیج است. این کلاس از روی `req.query` و فیلترهای دستی سمت سرور، یک MongoDB aggregation pipeline می‌سازد.

## Constructor

```js
new ApiFeatures(model, query, userRole)
```

| ورودی | نوع | اجباری | توضیح |
|---|---|---|---|
| `model` | Mongoose Model | بله | مدلی که aggregation روی آن اجرا می‌شود |
| `query` | Object | خیر | معمولاً همان `req.query` |
| `userRole` | String | خیر | نقش کاربر برای قوانین امنیتی |

اگر `userRole` داده نشود یا معتبر نباشد، role پیش‌فرض `guest` استفاده می‌شود.

---

## ترتیب پیشنهادی استفاده

```js
const result = await new ApiFeatures(Model, req.query, req.user?.role)
  .addManualFilters(serverSideFilters)
  .filter()
  .populate(populateOptions)
  .search(["name", "description"])
  .sort()
  .limitFields()
  .paginate()
  .execute();
```

---

## `filter()`

از روی `req.query` مرحله‌ی `$match` می‌سازد.

```txt
GET /api/products?category=phone
```

```js
{
  category: "phone"
}
```

operatorهای مقایسه‌ای:

```txt
GET /api/products?price[gte]=100&price[lte]=500
```

```js
{
  price: {
    $gte: 100,
    $lte: 500
  }
}
```

تبدیل‌های خودکار:

```txt
GET /api/products?isActive=true&deletedAt=null&price=100
```

```js
{
  isActive: true,
  deletedAt: null,
  price: 100
}
```

کلیدهایی مثل `_id`, `id` و کلیدهایی که به `id` ختم می‌شوند، اگر مقدارشان ObjectId معتبر باشد، به `ObjectId` تبدیل می‌شوند.

---

## `addManualFilters(filters)`

برای اضافه کردن فیلترهای دستی سمت سرور استفاده می‌شود.

```js
new ApiFeatures(Order, req.query)
  .addManualFilters({ user: req.user._id })
  .filter()
  .execute();
```

استفاده از `$and`:

```js
const result = await new ApiFeatures(Product, req.query)
  .addManualFilters({
    $and: [
      { _id: "665f0f6f4e7d9a2e2c123456" },
      { isActive: true }
    ]
  })
  .filter()
  .execute();
```

در این حالت `_id` داخل `$and` هم به صورت recursive به `ObjectId` تبدیل می‌شود.

استفاده از `$or`:

```js
const result = await new ApiFeatures(Product, req.query)
  .addManualFilters({
    $or: [
      { ownerId: "665f0f6f4e7d9a2e2c123456" },
      { createdById: "665f0f6f4e7d9a2e2c654321" }
    ]
  })
  .filter()
  .execute();
```

استفاده از `$in`:

```js
const result = await new ApiFeatures(Product, req.query)
  .addManualFilters({
    _id: {
      $in: [
        "665f0f6f4e7d9a2e2c123456",
        "665f0f6f4e7d9a2e2c654321"
      ]
    }
  })
  .filter()
  .execute();
```

---

## `search(fields)`

از کلید `q` داخل `req.query` مقدار را می‌گیرد و با regex جستجو می‌کند. جستجو همیشه case-insensitive است.

```txt
GET /api/products?q=iphone
```

```js
const result = await new ApiFeatures(Product, req.query)
  .filter()
  .search(["name", "description", "brand"])
  .paginate()
  .execute();
```

نکته: `q` جزو کلیدهای رزرو شده است و وارد filter معمولی نمی‌شود.

---

## `sort()`

از `sort` داخل query برای مرتب‌سازی استفاده می‌کند.

```txt
GET /api/products?sort=-createdAt,price
```

```js
{
  createdAt: -1,
  price: 1
}
```

---

## `limitFields(input)`

برای کنترل فیلدهای خروجی استفاده می‌شود.

```txt
GET /api/products?fields=name,price,category
```

یا مستقیم:

```js
.limitFields("name,price")
```

حالت include:

```js
{ name: 1, price: 1 }
```

حالت exclude:

```js
{ description: 0 }
```

حالت mixed مجاز نیست:

```txt
GET /api/products?fields=name,-password
```

---

## `paginate()`

برای صفحه‌بندی استفاده می‌شود.

```txt
GET /api/products?page=2&limit=10
```

```js
[
  { $skip: 10 },
  { $limit: 10 }
]
```

---

## `populate(input)`

با استفاده از aggregation و `$lookup` داده‌های مرتبط را join می‌کند.

```js
.populate("user")
```

از query:

```txt
GET /api/posts?populate=user
```

چند populate:

```js
.populate(["user", "category"])
```

nested populate:

```js
.populate({
  path: "user",
  populate: {
    path: "company",
    populate: {
      path: "country"
    }
  }
})
```

یا با dot notation:

```js
.populate("user.company.country")
```

select در populate:

```js
.populate({
  path: "user",
  select: "name email"
})
```

exclude:

```js
.populate({
  path: "user",
  select: "-password"
})
```

---

## `execute(options)`

pipeline را اجرا می‌کند.

```js
const result = await features.execute();
```

خروجی:

```js
{
  success: true,
  count: 25,
  data: [...]
}
```

---

# مدیریت خطاها

## `HandleERROR`

کلاس خطای اختصاصی.

```js
throw new HandleERROR("Product not found", 404);
```

```js
{
  message: "Product not found",
  statusCode: 404,
  status: "fail",
  isOperational: true
}
```

## `catchAsync`

برای حذف `try/catch` تکراری در route handlerهای async.

```js
app.get(
  "/products",
  catchAsync(async (req, res, next) => {
    const products = await Product.find();
    res.json(products);
  })
);
```

## `errorHandler`

middleware مرکزی خطاها:

```js
app.use(catchError);
```

نمونه خروجی:

```json
{
  "status": "fail",
  "success": false,
  "message": "Product not found"
}
```

---

# تنظیمات امنیتی

برای override کردن تنظیمات پیش‌فرض، در root پروژه فایل زیر را بسازید:

```txt
security-config.js
```

```js
export const securityConfig = {
  allowedOperators: ["eq", "ne", "gt", "gte", "lt", "lte", "in", "nin", "regex", "exists"],
  forbiddenFields: ["password", "refreshToken", "resetPasswordToken"],
  maxPipelineStages: 50,
  accessLevels: {
    guest: {
      maxLimit: 20,
      allowedPopulate: ["category"]
    },
    user: {
      maxLimit: 100,
      allowedPopulate: ["category", "createdBy"]
    },
    admin: {
      maxLimit: 1000,
      allowedPopulate: ["*"]
    }
  }
};
```

---

# License

MIT
