import mongoose from "mongoose";
import winston from "winston";
import pluralize from "pluralize";
import HandleERROR from "./handleError.js";
import { securityConfig } from "./config.js";
import { ObjectId } from "bson";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

const RESERVED_QUERY_KEYS = ["page", "limit", "sort", "fields", "populate", "q"];
const LOGICAL_OPERATORS = ["$and", "$or", "$nor"];

export class ApiFeatures {
  constructor(model, query = {}, userRole = "") {
    this.model = model;
    this.query = { ...query };
    this.pipeline = [];
    this.manualFilters = {};
    this.useCursor = false;
    this.userRole =
      userRole && securityConfig.accessLevels?.[userRole] ? userRole : "guest";

    this._sanitization();
  }

  filter() {
    const queryFilters = this._parseQueryFilters();
    const normalizedManualFilters = this._normalizeLogicalOperators(
      this.manualFilters
    );

    const mergedFilters = this._deepMergeFilters(
      queryFilters,
      normalizedManualFilters
    );

    const sanitizedFilters = this._sanitizeFilters(mergedFilters);
    const safeFilters = this._applySecurityFilters(sanitizedFilters);

    if (Object.keys(safeFilters).length) {
      this.pipeline.push({ $match: safeFilters });
    }

    return this;
  }

  addManualFilters(filters = {}) {
    if (filters && typeof filters === "object" && !Array.isArray(filters)) {
      const normalizedFilters = this._normalizeLogicalOperators(filters);
      this.manualFilters = this._deepMergeFilters(
        this.manualFilters,
        normalizedFilters
      );
    }

    return this;
  }

  search(fields = []) {
    const q = this.query.q;
    if (!q || !Array.isArray(fields) || !fields.length) return this;

    const safeQ = this._escapeRegex(String(q).trim());
    if (!safeQ) return this;

    const conditions = fields
      .filter((field) => typeof field === "string" && field.trim())
      .map((field) => ({
        [field]: { $regex: safeQ, $options: "i" },
      }));

    if (conditions.length) {
      this.pipeline.push({
        $match: {
          $or: conditions,
        },
      });
    }

    return this;
  }

  sort() {
    if (!this.query.sort) return this;

    const sortObj = {};
    const validFields = new Set(Object.keys(this.model.schema.paths));

    String(this.query.sort)
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        const direction = part.startsWith("-") ? -1 : 1;
        const field = part.replace(/^[-+]/, "");

        if (validFields.has(field)) {
          sortObj[field] = direction;
        }
      });

    if (Object.keys(sortObj).length) {
      this.pipeline.push({ $sort: sortObj });
    }

    return this;
  }

  limitFields(input = "") {
    const rawFields = [input, this.query.fields].filter(Boolean).join(",");
    if (!rawFields) return this;

    const fields = rawFields
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);

    const hasInclude = fields.some((field) => !field.startsWith("-"));
    const hasExclude = fields.some((field) => field.startsWith("-"));

    if (hasInclude && hasExclude) {
      throw new HandleERROR("Cannot mix include and exclude fields", 400);
    }

    const project = {};

    for (const field of fields) {
      const cleanField = field.replace(/^-/, "");
      if (this._isForbiddenField(cleanField)) continue;
      project[cleanField] = field.startsWith("-") ? 0 : 1;
    }

    if (Object.keys(project).length) {
      this.pipeline.push({ $project: project });
    }

    return this;
  }

  paginate() {
    const access = securityConfig.accessLevels?.[this.userRole] || {};
    const maxLimit = access.maxLimit || 100;

    const page = Math.max(parseInt(this.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(this.query.limit, 10) || 10, 1),
      maxLimit
    );

    this.pipeline.push({ $skip: (page - 1) * limit }, { $limit: limit });

    return this;
  }

  populate(input = "") {
    const populateList = this._normalizePopulateInput(input);
    const allowedPopulate =
      securityConfig.accessLevels?.[this.userRole]?.allowedPopulate || [];

    for (const populateItem of populateList) {
      this._addPopulateStages({
        populateItem,
        parentPath: "",
        parentIsArray: false,
        schema: this.model.schema,
        allowedPopulate,
      });
    }

    return this;
  }

  async execute(options = {}) {
    try {
      if (options.useCursor) this.useCursor = true;

      if (options.debug) {
        logger.info("Pipeline:", this.pipeline);
      }

      if (this.pipeline.length > (securityConfig.maxPipelineStages || 80)) {
        throw new HandleERROR("Too many pipeline stages", 400);
      }

      const countPipeline = this._buildCountPipeline();

      const [countResult] = await this.model.aggregate([
        ...countPipeline,
        { $count: "total" },
      ]);

      const aggregation = this.model
        .aggregate(this.pipeline)
        .option({ maxTimeMS: options.maxTimeMS || 10000 });

      let data;

      if (this.useCursor) {
        const cursor = aggregation.cursor({
          batchSize: options.batchSize || 100,
        });

        data = [];
        for await (const doc of cursor) {
          data.push(doc);
        }
      } else {
        data = await aggregation
          .allowDiskUse(Boolean(options.allowDiskUse))
          .readConcern(options.readConcern || "majority");
      }

      return {
        success: true,
        count: countResult?.total || 0,
        data,
      };
    } catch (err) {
      this._handleError(err);
    }
  }

  _normalizeLogicalOperators(filters = {}) {
    if (Array.isArray(filters)) {
      return filters.map((item) => this._normalizeLogicalOperators(item));
    }

    if (!filters || typeof filters !== "object") return filters;

    if (
      filters instanceof mongoose.Types.ObjectId ||
      filters instanceof ObjectId ||
      filters instanceof Date
    ) {
      return filters;
    }

    const out = {};

    for (const [key, value] of Object.entries(filters)) {
      const normalizedKey =
        key === "and" ? "$and" : key === "or" ? "$or" : key === "nor" ? "$nor" : key;

      out[normalizedKey] = this._normalizeLogicalOperators(value);
    }

    return out;
  }

  _sanitizeFilters(filters = {}) {
    const sanitizeNode = (node, key = "", parentKey = "") => {
      if (
        node instanceof mongoose.Types.ObjectId ||
        node instanceof ObjectId ||
        node instanceof Date
      ) {
        return node;
      }

      if (node === null || node === "null") return null;
      if (node === "true") return true;
      if (node === "false") return false;

      if (Array.isArray(node)) {
        return node.map((item) => sanitizeNode(item, key, parentKey));
      }

      if (node && typeof node === "object") {
        const result = {};

        for (const [childKey, childVal] of Object.entries(node)) {
          result[childKey] = sanitizeNode(childVal, childKey, key);
        }

        return result;
      }

      if (typeof node === "string") {
        if (
          this.#isStrictObjectId(node) &&
          this._shouldConvertToObjectId(key, parentKey)
        ) {
          return new ObjectId(node);
        }

        if (/^[0-9]+$/.test(node)) {
          return node.length > 1 && node.startsWith("0")
            ? node
            : parseInt(node, 10);
        }
      }

      return node;
    };

    return sanitizeNode(filters);
  }

  _shouldConvertToObjectId(key = "", parentKey = "") {
    const cleanKey = String(key).replace(/^\$/, "").toLowerCase();
    const cleanParentKey = String(parentKey).replace(/^\$/, "").toLowerCase();

    if (
      cleanKey === "_id" ||
      cleanKey === "id" ||
      cleanKey.endsWith("id") ||
      cleanParentKey === "_id" ||
      cleanParentKey === "id" ||
      cleanParentKey.endsWith("id")
    ) {
      return true;
    }

    return (
      ["eq", "ne", "in", "nin"].includes(cleanKey) &&
      (cleanParentKey === "_id" ||
        cleanParentKey === "id" ||
        cleanParentKey.endsWith("id"))
    );
  }

  _deepMergeFilters(a = {}, b = {}) {
    const out = { ...a };

    for (const [key, value] of Object.entries(b)) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        out[key] &&
        typeof out[key] === "object" &&
        !Array.isArray(out[key]) &&
        !LOGICAL_OPERATORS.includes(key)
      ) {
        out[key] = this._deepMergeFilters(out[key], value);
      } else {
        out[key] = value;
      }
    }

    return out;
  }

  _applySecurityFilters(filters = {}) {
    const cleanNode = (node) => {
      if (
        node instanceof mongoose.Types.ObjectId ||
        node instanceof ObjectId ||
        node instanceof Date
      ) {
        return node;
      }

      if (Array.isArray(node)) {
        return node.map(cleanNode);
      }

      if (!node || typeof node !== "object") {
        return node;
      }

      const result = {};

      for (const [key, value] of Object.entries(node)) {
        if (this._isForbiddenField(key)) continue;
        result[key] = cleanNode(value);
      }

      return result;
    };

    return cleanNode(filters);
  }

  _addPopulateStages(args) {
    return ApiFeatures.prototype.__proto__?._addPopulateStages?.call(this, args);
  }

  _parseQueryFilters() {
    const obj = { ...this.query };
    RESERVED_QUERY_KEYS.forEach((key) => delete obj[key]);

    const out = {};

    for (const [rawKey, rawVal] of Object.entries(obj)) {
      const bracketMatch = rawKey.match(/^(.+)\[\$?(\w+)\]$/);

      if (bracketMatch) {
        const [, field, op] = bracketMatch;
        const cleanOp = op.replace(/^\$/, "");

        if (securityConfig.allowedOperators?.includes(cleanOp)) {
          out[field] = {
            ...(out[field] || {}),
            [`$${cleanOp}`]: rawVal,
          };
        }

        continue;
      }

      if (rawVal && typeof rawVal === "object" && !Array.isArray(rawVal)) {
        out[rawKey] = out[rawKey] || {};

        for (const [op, val] of Object.entries(rawVal)) {
          const cleanOp = op.replace(/^\$/, "");

          if (securityConfig.allowedOperators?.includes(cleanOp)) {
            out[rawKey][`$${cleanOp}`] = val;
          }
        }

        continue;
      }

      if (typeof rawVal === "string" && rawVal.includes(",")) {
        out[rawKey] = rawVal.split(",").map((v) => v.trim());
      } else {
        out[rawKey] = rawVal;
      }
    }

    return out;
  }

  _sanitization() {
    for (const key of Object.keys(this.query)) {
      if (
        key.startsWith("$") ||
        ["$where", "$accumulator", "$function"].includes(key)
      ) {
        delete this.query[key];
      }
    }

    ["page", "limit"].forEach((field) => {
      if (this.query[field] && !/^[0-9]+$/.test(String(this.query[field]))) {
        throw new HandleERROR(`Invalid ${field}`, 400);
      }
    });
  }

  _normalizePopulateInput(input = "") {
    const raw = [];

    if (input) {
      if (Array.isArray(input)) raw.push(...input);
      else raw.push(input);
    }

    if (this.query.populate) {
      raw.push(...String(this.query.populate).split(","));
    }

    const normalized = [];

    const normalizeOne = (item) => {
      if (!item) return;

      if (typeof item === "string") {
        const trimmed = item.trim();
        if (!trimmed) return;

        if (trimmed.includes(".")) {
          normalized.push(this._dotPathToPopulate(trimmed));
        } else {
          normalized.push({ path: trimmed });
        }

        return;
      }

      if (Array.isArray(item)) {
        item.forEach(normalizeOne);
        return;
      }

      if (item && typeof item === "object" && item.path) {
        normalized.push(this._normalizePopulateObject(item));
      }
    };

    raw.forEach(normalizeOne);

    return this._dedupePopulate(normalized);
  }

  _normalizePopulateObject(item) {
    const normalized = { ...item };

    if (typeof normalized.path === "string") {
      normalized.path = normalized.path.trim();
    }

    if (typeof normalized.select === "string") {
      normalized.select = normalized.select.trim();
    }

    if (normalized.populate) {
      normalized.populate = this._normalizeNestedPopulate(normalized.populate);
    }

    return normalized;
  }

  _normalizeNestedPopulate(input) {
    if (!input) return [];

    if (typeof input === "string") {
      return this._normalizePopulateInput(input);
    }

    if (Array.isArray(input)) {
      return input
        .flatMap((item) => {
          if (typeof item === "string") return this._normalizePopulateInput(item);

          if (item && typeof item === "object" && item.path) {
            return [this._normalizePopulateObject(item)];
          }

          return [];
        })
        .filter(Boolean);
    }

    if (typeof input === "object" && input.path) {
      return [this._normalizePopulateObject(input)];
    }

    return [];
  }

  _dotPathToPopulate(path) {
    const parts = path
      .split(".")
      .map((part) => part.trim())
      .filter(Boolean);

    const root = { path: parts[0] };
    let current = root;

    for (const part of parts.slice(1)) {
      current.populate = { path: part };
      current = current.populate;
    }

    return root;
  }

  _dedupePopulate(items) {
    const map = new Map();

    for (const item of items) {
      if (!item?.path) continue;

      if (!map.has(item.path)) {
        map.set(item.path, item);
        continue;
      }

      const existing = map.get(item.path);
      map.set(item.path, this._mergePopulateOptions(existing, item));
    }

    return [...map.values()];
  }

  _mergePopulateOptions(a, b) {
    const merged = { ...a, ...b };

    if (a.populate || b.populate) {
      const aList = Array.isArray(a.populate)
        ? a.populate
        : a.populate
          ? [a.populate]
          : [];

      const bList = Array.isArray(b.populate)
        ? b.populate
        : b.populate
          ? [b.populate]
          : [];

      merged.populate = this._dedupePopulate([...aList, ...bList]);
    }

    return merged;
  }

  _isPopulateAllowed(path, allowedPopulate = []) {
    return (
      allowedPopulate.includes("*") ||
      allowedPopulate.includes(path) ||
      allowedPopulate.includes(path.split(".")[0])
    );
  }

  _resolveCollectionName(refModelName = "") {
    return pluralize(String(refModelName).toLowerCase());
  }

  _resolveRegisteredSchema(refModelName = "") {
    const connection = this.model?.db || mongoose.connection;
    const registeredModel =
      connection.models?.[refModelName] || mongoose.models?.[refModelName];

    return registeredModel?.schema || null;
  }

  _inferModelNameFromPath(path = "") {
    let clean = String(path).split(".").pop();

    clean = clean.replace(/Ids$/i, "");
    clean = clean.replace(/Id$/i, "");
    clean = pluralize.singular(clean);

    return clean
      .split(/[_-\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
  }

  _makeTempLookupName(path = "") {
    return `__vanta_lookup_${String(path).replace(/[^a-zA-Z0-9]/g, "_")}`;
  }

  _isForbiddenField(field) {
    return (securityConfig.forbiddenFields || []).includes(field);
  }

  _buildCountPipeline() {
    return this.pipeline.filter((stage) => {
      return !(
        "$skip" in stage ||
        "$limit" in stage ||
        "$sort" in stage ||
        "$project" in stage ||
        "$lookup" in stage ||
        "$unwind" in stage ||
        "$set" in stage ||
        "$unset" in stage
      );
    });
  }

  _escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  #isStrictObjectId(id) {
    return (
      typeof id === "string" &&
      mongoose.Types.ObjectId.isValid(id) &&
      new mongoose.Types.ObjectId(id).toString() === id
    );
  }

  _handleError(err) {
    logger.error(`[ApiFeatures] ${err.message}`, { stack: err.stack });
    throw err;
  }
}

export default ApiFeatures;