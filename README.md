# VantaApi :: Advanced MongoDB API Utilities

**VantaApi** is a comprehensive toolkit for building secure, performant, and flexible APIs on top of MongoDB with Mongoose. It streamlines common query operations—filtering, sorting, field selection, pagination, and population—while enforcing robust security policies and sanitization.

---

## 📦 Installation

Install via npm or Yarn:

```bash
npm install vanta-api
# or
yarn add vanta-api
```

A `postinstall` hook will scaffold a `security-config.js` file in your project root.

---

## ⚙️ Setup & Initialization

### 1. Importing the Package

#### ECMAScript Module (ESM)

```js
import express from 'express';
import mongoose from 'mongoose';
import ApiFeatures, { catchAsync, catchError, HandleERROR } from 'vanta-api';
```

#### CommonJS (CJS)

```js
const express = require('express');
const mongoose = require('mongoose');
const { default: ApiFeatures, catchAsync, catchError, HandleERROR } = require('vanta-api');
```

### 2. Basic Server Setup

```js
const app = express();
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});
```

### 3. Route Definition & Error Handling

```js
// Example route with async handler
app.get(
  '/api/v1/items',
  catchAsync(async (req, res, next) => {
    const result = await new ApiFeatures(ItemModel, req.query, req.user.role)
      .filter()
      .sort()
      .limitFields()
      .paginate()
      .populate()
      .execute();
    res.status(200).json(result);
  })
);

// Global error handler (after all routes)
app.use(catchError);

// Start server
app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

---

## 🔍 API Reference

### 1. catchAsync(fn)

Wraps an async function to catch errors and pass them to Express error middleware.

* **Signature:** `catchAsync(fn: Function): Function`

* **Example:**

  ```js
  app.post(
    '/api/v1/users',
    catchAsync(async (req, res) => {
      // async logic
    })
  );
  ```

### 2. catchError(err, req, res, next)

Express error-handling middleware that returns standardized JSON errors.

* **Response:**

  ```json
  {
    "status": "error" | "fail",
    "message": "Error description",
    "errors": [ /* optional array of details */ ]
  }
  ```

* **Usage:** Place after all routes

### 3. HandleERROR

Custom `Error` subclass for operational errors.

* **Constructor:** `new HandleERROR(message: string, statusCode: number)`
* **Example:**

  ```js
  if (!user) {
    throw new HandleERROR('User not found', 404);
  }
  ```

---

## 🚀 ApiFeatures Class

Chainable class that translates HTTP query parameters into a secure MongoDB aggregation pipeline.

```js
const features = new ApiFeatures(
  Model,         // Mongoose model
  req.query,     // HTTP query object
  req.user.role  // User role for security (guest|user|admin|superAdmin)
)
  .filter()           // Filtering
  .sort()             // Sorting
  .limitFields()      // Field limiting
  .paginate()         // Pagination
  .populate()         // Population
  .addManualFilters({ isActive: true }) // Manual filters
;
const result = await features.execute({ allowDiskUse: true });
```

### Constructor

```ts
new ApiFeatures(
  model: mongoose.Model,
  queryParams: Record<string, any> = {},
  userRole: string = 'guest'
)
```

* **model**: Mongoose model.
* **queryParams**: Typically `req.query`.
* **userRole**: Role key for security rules.

### Chainable Methods

| Method                   | Description                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `.filter()`              | Applies MongoDB operators. Supported operators:                                                      |
|                          | `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `regex` (e.g. `?price[gt]=100&name[regex]=Book`). |
| `.sort()`                | Sorting (e.g. `?sort=price,-name`).                                                                  |
| `.limitFields()`         | Field selection (e.g. `?fields=name,price`).                                                         |
| `.paginate()`            | Pagination (e.g. `?page=2&limit=10`).                                                                |
| `.populate(paths?)`      | Populate referenced documents. Accepts various input types (see below).                              |
| `.addManualFilters(obj)` | Add programmatic filters (e.g. `.addManualFilters({ isActive: true })`).                             |

> All methods return `this` for chaining.

#### Populate Input Formats

The `.populate()` method supports multiple ways to specify which paths to populate:

1. **String (comma-separated)**

   ```js
   .populate('author,comments')
   ```
2. **Array of strings**

   ```js
   .populate(['author', 'comments'])
   ```
3. **Dot notation for nested paths**

   ```js
   // Populating nested field 'comments.author'
   .populate('comments.author')
   ```
4. **Object with options**

   ```js
   .populate({
     path: 'author',           // field to populate
     select: 'name email',     // include only name and email
     match: { isActive: true}, // only active authors
     options: { limit: 5 }     // limit populated docs
   })
   ```
5. **Array of objects**

   ```js
   .populate([
     { path: 'author', select: 'name' },
     { path: 'comments', match: { flagged: false } }
   ])
   ```

---

### execute(options)

Executes aggregation pipeline.
(options)

Executes aggregation pipeline.

* **Signature:**

  ````ts
  async execute(options?: {
    useCursor?: boolean;      // return cursor if true
    allowDiskUse?: boolean;   // enable disk use
    projection?: Record<string, any>; // manual projection map
  }): Promise<{
    success: boolean;
    count: number;
    data: any[];
  }>```

  ````
* **Example Response:**

  ```json
  {
    "success": true,
    "count": 50,
    "data": [ /* documents */ ]
  }
  ```

---

## 🔐 Security Configuration

Customize rules in `security-config.js` at your project root (auto-generated):

```js
// security-config.js
export const securityConfig = {
  allowedOperators: [
    'eq','ne','gt','gte','lt','lte','in','nin','regex'
  ],
  forbiddenFields: ['password','__v'],
  accessLevels: {
    guest: {
      maxLimit: 20,
      allowedPopulate: []
    },
    user: {
      maxLimit: 100,
      allowedPopulate: ['orders','profile']
    },
    admin: {
      maxLimit: 1000,
      allowedPopulate: ['*']
    }
  }
};
```

* **allowedOperators**: Operators users can use in queries.
* **forbiddenFields**: Fields excluded from results.
* **accessLevels**: Per-role limits and populate permissions.

> If you omit `security-config.js`, defaults are applied from the package.

---

## 🔍 Examples

### Filter with Multiple Operators

```http
GET /api/v1/products?price[gte]=50&price[lte]=200&category[in]=["books","electronics"]
```

### Manual Filter & Projection

```js
const features = new ApiFeatures(Product, req.query, 'user')
  .addManualFilters({ isActive: true })
  .filter()
  .limitFields()
  .execute({ projection: { name: 1, price: 1 } });
```

### Populate Relations

```http
GET /api/v1/posts?populate=author,comments
```

### Complete Controller Example

```js
app.get(
  '/api/v1/orders',
  catchAsync(async (req, res) => {
    const result = await new ApiFeatures(Order, req.query, req.user.role)
      .filter()
      .sort()
      .limitFields()
      .paginate()
      .populate()
      .execute();

    res.json(result);
  })
);
```

---

## 🧪 Testing

```bash
npm test
```

Tests use Jest. Add tests for your controllers and ApiFeatures behaviors.

---

## 📜 License

MIT © [Alireza Aghaee](https://github.com/alirezaaghaee)

---

## 📜 License

MIT © 2024 Alireza Aghaee

---

## ✒️ Author

**Alireza Aghaee**

* GitHub: [AlirezaAghaee1996](https://github.com/AlirezaAghaee1996)
* LinkedIn: [alireza-aghaee-mern-dev](https://www.linkedin.com/in/alireza-aghaee-mern-dev)
