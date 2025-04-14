

# VantaApi: Advanced API Features & Security Config for MongoDB

This repository provides a robust, feature-rich, and secure solution for building, customizing, and optimizing your Node.js APIs powered by MongoDB. **VantaApi** processes incoming query parameters and builds an aggregation pipeline step by step, offering powerful features such as advanced filtering, sorting, field selection, pagination, and document population with comprehensive security controls.

---

## Table of Contents

1. [Installation & Setup](#installation--setup)
2. [Overview](#overview)
3. [ApiFeatures Class Methods](#ApiFeatures-class-methods)
   - [filter()](#filter)
   - [sort()](#sort)
   - [limitFields()](#limitfields)
   - [paginate()](#paginate)
   - [populate()](#populate)
   - [addManualFilters()](#addmanualfilters)
   - [execute()](#execute)
4. [Input Types & Supported Operators](#input-types--supported-operators)
5. [Additional Conditions](#additional-conditions)
6. [Security Configuration](#security-configuration)
7. [Security & Performance Enhancements](#security--performance-enhancements)
8. [Error Handling Middleware](#error-handling-middleware)
9. [Full Examples](#full-examples)
10. [Summary](#summary)

---

## Installation & Setup

### Prerequisites

- Node.js 16+
- MongoDB 5+
- Mongoose 7+

### Install Dependencies

Install core dependencies:

```bash
npm install mongoose lodash dotenv winston
```

For testing purposes, install Jest:

```bash
npm install --save-dev jest
```

---

## Overview

The **ApiFeatures** class processes incoming query parameters and progressively builds an aggregation pipeline. The package supports:

- **Advanced filtering, sorting, and field selection.**
- **Pagination with defaults** (defaults to page 1 and limit 10 if not provided), with the maximum limit based on the user's role.
- **Document population:** Supports joining related documents, including nested population.
- **Automatic Conditions:** If the model includes an `isActive` field and the user is not an admin, `isActive: true` is added automatically.
- **Input Sanitization & Validation:** Sanitizes inputs, validates numeric fields, and enforces security through a dedicated configuration.
- **Enhanced Logging & Error Handling:** Uses winston for logging and employs a custom error class for centralized error management.
- **Performance Improvements:** Features aggregation cursor support and optimized pipeline ordering.
- **Error Middleware:** Provides a centralized error handling middleware for consistent API error responses.

---

## ApiFeatures Class Methods

### filter()
- **Description:**  
  Parses query parameters, merges them with manually added filters (if provided), and applies security filters. If the model includes an `isActive` field and the user is not "admin," it automatically adds `isActive: true`.
- **Usage Example:**

  ```javascript
  // URL: /api/products?status=active&price[gte]=100
  const features = new ApiFeatures(Product, req.query);
  features.filter();
  // Pipeline adds: { $match: { status: "active", price: { $gte: 100 }, isActive: true } }
  ```

### sort()
- **Description:**  
  Converts a comma-separated list of sorting fields into a `$sort` object. A "-" prefix indicates descending order.
- **Usage Example:**

  ```javascript
  // URL: /api/products?sort=-price,createdAt
  const features = new ApiFeatures(Product, req.query);
  features.sort();
  // Pipeline adds: { $sort: { price: -1, createdAt: 1 } }
  ```

### limitFields()
- **Description:**  
  Uses `$project` to return only the specified fields while excluding forbidden fields (such as "password").
- **Usage Example:**

  ```javascript
  // URL: /api/products?fields=name,price,category,password
  const features = new ApiFeatures(Product, req.query);
  features.limitFields();
  // Pipeline adds: { $project: { name: 1, price: 1, category: 1 } }
  ```

### paginate()
- **Description:**  
  Determines the page and limit values, applying pagination with defaults (page 1 and limit 10 if not provided). The maximum limit is based on the user's role as defined in the security configuration.
- **Usage Example:**

  ```javascript
  // URL: /api/products?page=2&limit=20
  const features = new ApiFeatures(Product, req.query, "user");
  features.paginate();
  // Pipeline adds: { $skip: 20 } and { $limit: 20 }
  ```

### populate()
- **Description:**  
  Joins related documents using `$lookup` and `$unwind`. It supports:
  - **String Input:** A comma-separated list of field names.
  - **Object Input:** An object with properties `path` (required) and `select` (optional).
  - **Array Input:** An array of strings or objects for multiple or nested population.
- **Usage Examples:**
  - **String Input:**

    ```javascript
    // URL: /api/products?populate=category,brand
    const features = new ApiFeatures(Product, req.query);
    features.populate();
    ```

  - **Object Input:**

    ```javascript
    const populateOptions = { path: "category", select: "name description" };
    const features = new ApiFeatures(Product, req.query);
    features.populate(populateOptions);
    ```

  - **Array Input:**

    ```javascript
    const populateArray = [
      "brand",
      { path: "category", select: "name description" },
      { path: "category", select: "name", populate: { path: "subCategory", select: "title" } }
    ];
    const features = new ApiFeatures(Product, req.query, "admin");
    features.populate(populateArray);
    ```

### addManualFilters()
- **Description:**  
  Merges additional manual filters with the parsed query filters. **Note:** Call `addManualFilters()` before `filter()` to incorporate the manual filters properly.
- **Usage Example:**

  ```javascript
  const manualFilter = { category: "electronics" };
  const features = new ApiFeatures(Product, { status: "active" });
  features.addManualFilters(manualFilter).filter();
  ```

### execute()
- **Description:**  
  Executes the built aggregation pipeline using Mongoose and returns an object containing a success flag, total document count, and result data. Supports aggregation cursor for handling large datasets.
- **Usage Example:**

  ```javascript
  const features = new ApiFeatures(Product, req.query);
  const result = await features
    .filter()
    .sort()
    .limitFields()
    .paginate()
    .populate()
    .execute();
  console.log(result);
  ```

---

## Input Types & Supported Operators

### Filtering Operators

The class translates query parameters into MongoDB operators:

| Operator | Query Example             | Description                |
|----------|---------------------------|----------------------------|
| eq       | `?age=25`                 | Equal to                   |
| ne       | `?status[ne]=inactive`    | Not equal to               |
| gt       | `?price[gt]=100`          | Greater than               |
| gte      | `?stock[gte]=50`          | Greater than or equal to   |
| lt       | `?weight[lt]=500`         | Less than                  |
| lte      | `?rating[lte]=3`          | Less than or equal to      |
| in       | `?colors[in]=red,blue`    | In the list                |
| nin      | `?size[nin]=xl`           | Not in the list            |
| regex    | `?name[regex]=^A`         | Regex search               |
| exists   | `?discount[exists]=true`  | Field existence            |

Additional aspects like sorting, projection, and pagination are handled via `$sort`, `$project`, `$skip`, and `$limit`.

---

## Additional Conditions

- **isActive Condition:**  
  If the model includes an `isActive` field and the user is not an admin, `filter()` automatically adds `isActive: true`.
- **Default Pagination:**  
  Defaults are applied (page 1 and limit 10) when no pagination parameters are provided.
- **Numeric Validation:**  
  Validates that fields such as `page` and `limit` contain only numeric values.
- **Removal of Dangerous Operators:**  
  Operators such as `$where`, `$accumulator`, and `$function` are removed from the query.
- **Ordering of Manual Filters:**  
  Ensure that `addManualFilters()` is called before `filter()` so that manual filters are merged correctly.

---

## Security Configuration

Security settings enforce allowed operators, exclude forbidden fields (e.g., "password"), and apply role-based access limits:

```javascript
export const securityConfig = {
  allowedOperators: [
    "eq", "ne", "gt", "gte", "lt", "lte", "in", "nin", "regex", "exists", "size", "or", "and"
  ],
  forbiddenFields: ["password"],
  accessLevels: {
    guest: { maxLimit: 50, allowedPopulate: ["*"] },
    user: { maxLimit: 100, allowedPopulate: ["*"] },
    admin: { maxLimit: 1000, allowedPopulate: ["*"] },
    superAdmin: { maxLimit: 1000, allowedPopulate: ["*"] }
  }
};
```

These configurations are applied automatically in methods such as `filter()`, `paginate()`, and `limitFields()`.

---

## Security & Performance Enhancements

- **Enhanced Logging:**  
  Uses winston to log events and errors with detailed timestamps and stack traces.
- **Improved Error Handling:**  
  A custom error class (HandleERROR) coupled with dedicated error middleware centralizes error management.
- **Dynamic Configuration:**  
  Security settings are maintained in a separate config file (`config.js`) for easy modifications without changing core code.
- **Performance Optimization:**  
  Features aggregation cursor support in `execute()` and optimized pipeline ordering for resource-efficient execution.

---

## Error Handling Middleware

A dedicated error-handling middleware is available to centralize error responses:

```javascript
import catchError from "./errorHandler.js";

// In your Express app:
// app.use(catchError);
```

This middleware sets the appropriate HTTP status code and JSON error message when an error occurs.

---

## Full Examples

### Example 1: Basic Query

```javascript
import ApiFeatures from "./api-features.js";
import Product from "./models/product.js";

// URL: /api/products?status=active&price[gte]=100&sort=-price,createdAt&fields=name,price,category&page=1&limit=10&populate=category,brand
const features = new ApiFeatures(Product, req.query, "user");
const result = await features
  .filter()
  .sort()
  .limitFields()
  .paginate()
  .populate()
  .execute();
console.log(result);
```

### Example 2: Query with Manual Filters

*(Call `addManualFilters()` before `filter()`)*

```javascript
const query = { status: "active" };
const manualFilter = { category: "electronics" };
const features = new ApiFeatures(Product, query, "user");
features.addManualFilters(manualFilter).filter();
const result = await features.execute();
console.log(result);
```

### Example 3: Advanced Nested Populate with Array Input

```javascript
const populateArray = [
  "brand", // Simple string input
  { path: "category", select: "name description" },
  { path: "category", select: "name", populate: { path: "subCategory", select: "title" } }
];
const features = new ApiFeatures(Product, req.query, "admin");
const result = await features.populate(populateArray).execute();
console.log(result);
```

### Example 4: Full Advanced Query Example

```http
GET /api/products?
  page=1&
  limit=10&
  sort=-createdAt,price&
  fields=name,price,category&
  populate=category,brand&
  price[gte]=1000&
  category[in]=electronics,phones&
  name[regex]=^Samsung
```

### Example 5: Using Default Pagination (when page and limit are not provided)

```javascript
// URL: /api/products?status=active
const features = new ApiFeatures(Product, req.query);
const result = await features
  .filter() // Defaults to page 1 and limit 10
  .execute();
console.log(result);
```

---

## Summary

- **Filtering:**  
  Combines query parameters with manual filters and applies a safe `$match` with an automatic `isActive: true` condition for non-admin users.
- **Sorting:**  
  Converts a comma-separated string into a proper `$sort` object.
- **Field Selection:**  
  Uses `$project` to include only permitted fields while excluding forbidden fields.
- **Pagination:**  
  Applies `$skip` and `$limit` with default values (page 1, limit 10) and role-based limits.
- **Populate:**  
  Joins related documents using `$lookup` and `$unwind`, supporting nested and varied input types.
- **Security:**  
  Enforces allowed operators, sanitizes inputs, validates numeric fields, and removes dangerous operators via the security configuration.
- **Logging & Error Handling:**  
  Integrated advanced logging using winston and centralized error handling with a custom error class and middleware.
- **Performance Optimizations:**  
  Supports aggregation cursor for large datasets and optimizes aggregation pipelines for efficient resource usage.

---

VantaApi provides a complete solution for integrating powerful, secure, and customizable query capabilities into any Node.js/MongoDB project.

---