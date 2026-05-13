import mongoose from "mongoose";
import winston from "winston";
import pluralize from "pluralize";
import HandleERROR from "./handleError.js";
import { securityConfig } from "./config.js";
import { ObjectId } from "bson";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

const RESERVED_QUERY_KEYS = [
  "page",
  "limit",
  "sort",
  "fields",
  "populate",
  "q",
];

const LOGICAL_OPERATORS = new Set(["$and", "$or", "$nor"]);

export class ApiFeatures {
  constructor(model, query = {}, userRole = "") {
    this.model = model;
    this.query = { ...query };
    this.pipeline = [];
    this.manualFilters = {};
    this.searchFields = [];
    this.useCursor = false;

    this.userRole =
      userRole && securityConfig.accessLevels?.[userRole] ? userRole : "guest";

    this._sanitization();
  }

  filter() {
    const queryFilters = this._parseQueryFilters();
    const merged = this._deepMergeFilters(queryFilters, this.manualFilters);
    const sanitized = this._sanitizeFilters(merged);
    const safe = this._applySecurityFilters(sanitized);

    if (Object.keys(safe).length) {
      this.pipeline.push({ $match: safe });
    }

    return this;
  }

  addManualFilters(filters = {}) {
    if (filters && typeof filters === "object" && !Array.isArray(filters)) {
      this.manualFilters = this._deepMergeFilters(this.manualFilters, filters);
    }

    return this;
  }

  search(fields = []) {
    const q = this.query.q;

    if (!q) return this;

    const cleanFields = Array.isArray(fields)
      ? fields.filter((f) => typeof f === "string" && f.trim())
      : [];

    if (!cleanFields.length) return this;

    const safeQ = this._escapeRegex(String(q).trim());

    if (!safeQ) return this;

    this.pipeline.push({
      $match: {
        $or: cleanFields.map((field) => ({
          [field]: { $regex: safeQ, $options: "i" },
        })),
      },
    });

    return this;
  }

  sort() {
    if (!this.query.sort) return this;

    const sortObj = {};
    const validFields = this._getValidSortableFields();

    String(this.query.sort)
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .forEach((part) => {
        const dir = part.startsWith("-") ? -1 : 1;
        const key = part.replace(/^[-+]/, "");

        if (validFields.has(key)) {
          sortObj[key] = dir;
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
      .map((f) => f.trim())
      .filter(Boolean);

    const hasInclude = fields.some((f) => !f.startsWith("-"));
    const hasExclude = fields.some((f) => f.startsWith("-"));

    if (hasInclude && hasExclude) {
      throw new HandleERROR("Cannot mix include and exclude fields", 400);
    }

    const project = {};

    for (const field of fields) {
      const clean = field.replace(/^-/, "");

      if (this._isForbiddenField(clean)) continue;

      project[clean] = field.startsWith("-") ? 0 : 1;
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
    const allowedPopulate = securityConfig.accessLevels?.[this.userRole]?.allowedPopulate || [];

    for (const populateItem of populateList) {
      this._addPopulateStages({
        model: this.model,
        populateItem,
        parentAlias: "",
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

      if (this.pipeline.length > (securityConfig.maxPipelineStages || 50)) {
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
        const cursor = aggregation.cursor({ batchSize: options.batchSize || 100 });
        data = await cursor.exec().toArray();
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

  _sanitization() {
    for (const key of Object.keys(this.query)) {
      if (key.startsWith("$") || ["$where", "$accumulator", "$function"].includes(key)) {
        delete this.query[key];
      }
    }

    ["page", "limit"].forEach((field) => {
      if (this.query[field] && !/^[0-9]+$/.test(String(this.query[field]))) {
        throw new HandleERROR(`Invalid ${field}`, 400);
      }
    });
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

  _sanitizeFilters(filters = {}) {
    const sanitizeNode = (node, key = "") => {
      if (node === null || node === "null") return null;
      if (node === "true") return true;
      if (node === "false") return false;

      if (Array.isArray(node)) {
        return node.map((item) => sanitizeNode(item, key));
      }

      if (node && typeof node === "object") {
        const result = {};

        for (const [childKey, childVal] of Object.entries(node)) {
          if (LOGICAL_OPERATORS.has(childKey)) {
            result[childKey] = Array.isArray(childVal)
              ? childVal.map((item) => sanitizeNode(item))
              : childVal;
            continue;
          }

          result[childKey] = sanitizeNode(childVal, childKey);
        }

        return result;
      }

      if (typeof node === "string") {
        if (this._shouldConvertToObjectId(key, node)) {
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

  _shouldConvertToObjectId(key, value) {
    if (!this.#isStrictObjectId(value)) return false;

    const normalized = String(key || "").replace(/^\$/, "").toLowerCase();

    return (
      normalized === "_id" ||
      normalized === "id" ||
      normalized.endsWith("id") ||
      normalized === "$eq" ||
      normalized === "$ne" ||
      normalized === "$in" ||
      normalized === "$nin"
    );
  }

  _applySecurityFilters(filters = {}) {
    const clean = { ...filters };

    for (const field of securityConfig.forbiddenFields || []) {
      delete clean[field];
    }

    return clean;
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
          const parts = trimmed.split(".").filter(Boolean);
          let root = { path: parts[0] };
          let current = root;

          for (const part of parts.slice(1)) {
            current.populate = { path: part };
            current = current.populate;
          }

          normalized.push(root);
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
        normalized.push(item);
      }
    };

    raw.forEach(normalizeOne);

    return this._dedupePopulate(normalized);
  }

  _dedupePopulate(items) {
    const map = new Map();

    for (const item of items) {
      map.set(item.path, item);
    }

    return [...map.values()];
  }

  _addPopulateStages({ model, populateItem, parentAlias, allowedPopulate }) {
    const path = populateItem.path;

    if (!this._isPopulateAllowed(parentAlias ? `${parentAlias}.${path}` : path, allowedPopulate)) {
      return;
    }

    const info = this._getPopulateInfo(model, path, parentAlias);

    const lookup = {
      from: info.collection,
      localField: info.localField,
      foreignField: "_id",
      as: info.as,
    };

    this.pipeline.push({ $lookup: lookup });

    if (!info.isArray) {
      this.pipeline.push({
        $unwind: {
          path: `$${info.as}`,
          preserveNullAndEmptyArrays: true,
        },
      });
    }

    if (populateItem.select) {
      const project = this._buildPopulateProjection(populateItem.select, info.as);

      if (Object.keys(project).length) {
        this.pipeline.push({ $project: project });
      }
    }

    if (populateItem.populate) {
      const nestedList = this._normalizeNestedPopulate(populateItem.populate);

      for (const nested of nestedList) {
        this._addPopulateStages({
          model: info.refModel,
          populateItem: nested,
          parentAlias: info.as,
          allowedPopulate,
        });
      }
    }
  }

  _normalizeNestedPopulate(input) {
    if (!input) return [];

    if (Array.isArray(input)) {
      return input.flatMap((item) => this._normalizeNestedPopulate(item));
    }

    if (typeof input === "string") {
      return this._normalizePopulateInput(input);
    }

    if (typeof input === "object" && input.path) {
      return [input];
    }

    return [];
  }

  _getPopulateInfo(model, path, parentAlias = "") {
    const schemaPath = model.schema.path(path);

    if (!schemaPath) {
      throw new HandleERROR(`Invalid populate path: ${path}`, 400);
    }

    const isArray = schemaPath.instance === "Array";
    const refModelName =
      schemaPath.options?.ref ||
      schemaPath.caster?.options?.ref ||
      (Array.isArray(schemaPath.options?.type)
        ? schemaPath.options.type[0]?.ref
        : undefined);

    if (!refModelName) {
      throw new HandleERROR(`Populate path has no ref: ${path}`, 400);
    }

    const refModel = this._resolveModel(refModelName, model);

    const as = parentAlias ? `${parentAlias}.${path}` : path;
    const localField = as;

    return {
      refModel,
      collection: this._resolveCollectionName(refModelName, refModel),
      localField,
      foreignField: "_id",
      as,
      isArray,
    };
  }

  _resolveModel(refModelName, currentModel) {
    const connection = currentModel?.db || this.model?.db || mongoose.connection;

    return (
      connection.models?.[refModelName] ||
      mongoose.models?.[refModelName] ||
      null
    );
  }

  _resolveCollectionName(refModelName, refModel) {
    if (refModel?.collection?.name) {
      return refModel.collection.name;
    }

    return pluralize(String(refModelName).toLowerCase());
  }

  _buildPopulateProjection(select, alias) {
    const fields = String(select)
      .split(" ")
      .map((f) => f.trim())
      .filter(Boolean);

    const hasInclude = fields.some((f) => !f.startsWith("-"));
    const hasExclude = fields.some((f) => f.startsWith("-"));

    if (hasInclude && hasExclude) {
      throw new HandleERROR("Cannot mix include and exclude in populate select", 400);
    }

    const project = {};

    for (const field of fields) {
      const clean = field.replace(/^-/, "");

      if (this._isForbiddenField(clean)) continue;

      project[`${alias}.${clean}`] = field.startsWith("-") ? 0 : 1;
    }

    return project;
  }

  _isPopulateAllowed(path, allowedPopulate = []) {
    return (
      allowedPopulate.includes("*") ||
      allowedPopulate.includes(path) ||
      allowedPopulate.includes(path.split(".")[0])
    );
  }

  _getValidSortableFields() {
    return new Set(Object.keys(this.model.schema.paths));
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
        "$project" in stage
      );
    });
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
        !LOGICAL_OPERATORS.has(key)
      ) {
        out[key] = this._deepMergeFilters(out[key], value);
      } else {
        out[key] = value;
      }
    }

    return out;
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