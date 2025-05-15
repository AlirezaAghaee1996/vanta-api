# VantaApi: Advanced MongoDB API Utilities

![npm](https://img.shields.io/npm/v/vanta-api) ![license](https://img.shields.io/github/license/yourusername/vanta-api) ![downloads](https://img.shields.io/npm/dm/vanta-api)

**VantaApi** is a comprehensive toolkit for building secure, performant, and flexible APIs on top of MongoDB with Mongoose. It streamlines common query operations—filtering, sorting, field selection, pagination, and population—while enforcing robust security policies and sanitization.

---

## 🧩 Features Overview

* **Advanced Query Parsing**: Convert HTTP query parameters into MongoDB aggregation stages.
* **Filtering**: Support for comparison operators (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`), inclusion (`in`, `nin`), regex, existence, logical (`or`, `and`), and nested filters.
* **Sorting**: Dynamic, multi-field sorting with ascending/descending options and schema-based validation.
* **Field Selection**: Whitelisted projection of fields, automatic exclusion of sensitive data.
* **Pagination**: `$skip`/`$limit` with default values, role-based maximum limits, and helpful HTTP headers.
* **Population**: Flexible population via `$lookup` and `$unwind`, supporting string, object, array inputs, deep (nested) references, and role-based permissions.
* **Security & Sanitization**: Whitelist operators, strip dangerous operators (`$where`, `$function`, etc.), sanitize ObjectId and date values, and enforce forbidden fields.
* **Role-Based Access Control**: Define per-role limits on pagination, allowed populate paths, and other behaviors in a central config.
* **Performance Safeguards**: Limit maximum pipeline stages, enforce `maxTimeMS` for aggregation, and optional aggregation cursor support for large datasets.
* **Logging & Debugging**: Integrate with Winston for structured logs, debug flag to print built pipelines.
* **Error Handling**: Custom error class (`HandleERROR`), `catchAsync` helper, and `catchError` middleware for uniform error responses.
* **TypeScript-Ready**: Designed with generics and typings in mind for seamless TS integration.

---

## 🚀 Installation

### Requirements

* **Node.js** 16 or higher
* **MongoDB** 5 or higher
* **Mongoose** 7 or higher

### Installation

```bash
npm install vanta-api
```

or

```bash
yarn add vanta-api
```

Also install peer dependencies in your project:

```bash
npm install mongoose winston pluralize
```

---

## 🔧 Configuration

Centralize security and behavior settings in `config.js`:

```js
export const securityConfig = {
  // Allowed filter operators
  allowedOperators: [
    'eq','ne','gt','gte','lt','lte','in','nin','regex','exists','size','or','and'
  ],

  // Fields never exposed or matched
  forbiddenFields: ['password','__v'],

  // Role-based settings
  accessLevels: {
    guest:      { maxLimit: 50,   allowedPopulate: ['*'] },
    user:       { maxLimit: 100,  allowedPopulate: ['profile','orders'] },
    admin:      { maxLimit: 1000, allowedPopulate: ['*'] },
    superAdmin: { maxLimit: 5000, allowedPopulate: ['*'] }
  },

  // Aggregation safeguards
  maxPipelineStages: 20
};
```

* **allowedOperators**: Only these operators pass through parsing.
* **forbiddenFields**: Always removed from `$match` and `$project`.
* **accessLevels**: Configure per-role `maxLimit` and `allowedPopulate` paths.
* **maxPipelineStages**: Prevent overly complex pipelines.

---

## 🛠️ Usage Guide

### 1. Importing

```js
import ApiFeatures, { HandleERROR, catchAsync, catchError } from 'vanta-api';
```

### 2. Express Integration

```js
import express from 'express';
import Product from './models/product.js';

const router = express.Router();

router.get(
  '/',
  catchAsync(async (req, res) => {
    const features = new ApiFeatures(Product, req.query, req.user.role);
    const result = await features
      .filter()
      .sort()
      .limitFields()
      .paginate()
      .populate()
      .execute({ debug: req.query.debug === 'true' });

    res
      .set('X-Total-Count', result.count)
      .status(200)
      .json(result);
  })
);

// Global error handler
app.use(catchError);
```

### 3. Chaining Methods

All methods (except `addManualFilters`) are chainable and return `this`.

```js
const api = new ApiFeatures(Model, req.query, 'user');
api
  .addManualFilters({ status: 'active' }) // optional
  .filter()
  .sort()
  .limitFields()
  .paginate()
  .populate(['category','brand'])
  .execute();
```

---

## 📚 ApiFeatures Class Methods

### `.filter()`

* **Purpose**: Parse `req.query` and merge with optional manual filters, apply security filters (`forbiddenFields`, `isActive:true` for non-admin).
* **Behavior**:

  1. Remove pagination/sort/project/populate keys.
  2. Parse comparison operators and logical (`$or/$and`).
  3. Sanitize values (ObjectId, boolean, number).
  4. Apply `$match` with forbidden fields stripped.
* **Returns**: `this`.

### `.sort()`

* **Purpose**: Generate `$sort` stage.
* **Behavior**:

  1. Split comma-separated list.
  2. Determine direction (`-` prefix = descending).
  3. Validate against schema paths.
  4. Push `{ $sort: {...} }` if valid.
* **Returns**: `this`.

### `.limitFields()`

* **Purpose**: Generate `$project` stage for field selection.
* **Behavior**:

  1. Split comma-separated fields.
  2. Exclude `forbiddenFields`.
  3. Validate against schema paths.
  4. Push `{ $project: {...} }`.
* **Returns**: `this`.

### `.paginate()`

* **Purpose**: Add `$skip` and `$limit` for pagination.
* **Behavior**:

  1. Parse `page` and `limit`, default to 1 and 10.
  2. Enforce `maxLimit` per role.
  3. Push `{ $skip }` and `{ $limit }`.
* **Returns**: `this`.

### `.populate(input?)`

* **Purpose**: Add `$lookup`/`$unwind` stages for population.
* **Input Types**: `string`, `{ path, select, populate? }`, `array`
* **Behavior**:

  1. Collect inputs and `req.query.populate`.
  2. Deduplicate and enforce `allowedPopulate` per role.
  3. For each field:

     * Determine `collection` via `pluralize`.
     * Build `$lookup` with optional `pipeline` for projections.
     * Add `$unwind` preserving nulls.
* **Returns**: `this`.

### `.addManualFilters(filters)`

* **Purpose**: Inject custom filters before calling `.filter()`.
* **Behavior**: Merge into internal `manualFilters`.
* **Returns**: `this`.

### `.execute(options?)`

* **Purpose**: Execute the aggregation pipeline and return results.
* **Options**:

  * `useCursor` (boolean): Return a cursor for streaming large sets.
  * `allowDiskUse` (boolean): Enable disk use.
  * `maxTimeMS` (number): Timeout for aggregation.
  * `debug` (boolean): Log the pipeline.
  * `projection` (object): Final projection on returned documents.
* **Behavior**:

  1. Validate `maxPipelineStages`.
  2. Optionally log pipeline.
  3. Run `countPipeline` + `$count` to get total.
  4. Run `pipeline` with or without cursor.
  5. Apply `projection` to results if provided.
* **Returns**: `{ success: true, count: number, data: array }`.

---

## 🔄 Error Handling Utilities

### `HandleERROR`

Custom error class:

```js
throw new HandleERROR('Not Found', 404);
```

### `catchAsync(fn)`

Wrap async handlers:

```js
app.get('/', catchAsync(async (req,res) => { /* ... */ }));
```

### `catchError`

Express error middleware:

```js
app.use(catchError);
```

---

## 🌟 Examples

See the `examples/` directory for a full Express app demonstrating basic and advanced use cases.

---

## 🔬 Testing

Unit tests powered by Jest:

```bash
npm test
```

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/YourFeature`
3. Commit: `git commit -m 'Add awesome feature'`
4. Push: `git push origin feature/YourFeature`
5. Open a Pull Request

Please follow existing code style, include tests, and update documentation if needed.

---

## 📜 License

Licensed under the MIT License. See [LICENSE](./LICENSE) for details.
