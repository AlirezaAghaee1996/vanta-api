import mongoose from "mongoose";
import winston from "winston";
import pluralize from "pluralize";
import HandleERROR from "./handleError.js";
import { securityConfig } from "./config.js";
import { ObjectId } from "bson";
// Logger setup
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

export class ApiFeatures {
  constructor(model, query = {}, userRole = "") {
    this.model = model;
    this.query = { ...query };
    if (
      !userRole ||
      !Object.keys(securityConfig.accessLevels).includes(userRole)
    ) {
      this.userRole = "guest";
    } else {
      this.userRole = userRole;
    }

    this.pipeline = [];
    this.countPipeline = [];
    this.manualFilters = {};
    this.useCursor = false;

    this._sanitization();
  }

  // ---------- Core Methods ----------

  filter() {
    // Parse and sanitize both query and manual filters
    const queryFilters = this._parseQueryFilters();
    const merged = this._sanitizeFilters({
      ...queryFilters,
      ...this.manualFilters,
    });
    const safe = this._applySecurityFilters(merged);

    if (Object.keys(safe).length) {
      this.pipeline.push({ $match: safe });
      this.countPipeline.push({ $match: safe });
    }
    return this;
  }

  sort() {
    if (!this.query.sort) return this;
    const parts = this.query.sort.split(",");
    const validFields = Object.keys(this.model.schema.paths);
    const sortObj = {};

    for (const part of parts) {
      const dir = part.startsWith("-") ? -1 : 1;
      const key = part.replace(/^[-+]/, "");
      if (validFields.includes(key)) sortObj[key] = dir;
    }

    if (Object.keys(sortObj).length) this.pipeline.push({ $sort: sortObj });
    return this;
  }

  limitFields(input = "") {
    const rawFields = [input, this.query.fields].filter(Boolean).join(",");
    if (!rawFields) return this;

    const validFields = Object.keys(this.model.schema.paths).filter(
      (f) => !securityConfig.forbiddenFields.includes(f)
    );

    const fieldsArray = rawFields
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);

    const includeFields = new Set();
    const excludeFields = new Set();

    fieldsArray.forEach((f) => {
      if (f.startsWith("-")) excludeFields.add(f.slice(1));
      else includeFields.add(f);
    });
    const project = {};
    if (includeFields.size > 0) {
      includeFields.forEach((f) => {
        if (validFields.includes(f)) project[f] = 1;
      });
    } else if (excludeFields.size > 0) {
      validFields.forEach((f) => {
        if (!excludeFields.has(f)) project[f] = 1;
      });
    }

    if (Object.keys(project).length) {
      this.pipeline.push({ $project: project });
    }

    return this;
  }
  paginate() {
    const { maxLimit } = securityConfig.accessLevels[this.userRole] || {
      maxLimit: 100,
    };
    const page = Math.max(parseInt(this.query.page, 10) || 1, 1);
    const lim = Math.min(
      Math.max(parseInt(this.query.limit, 10) || 10, 1),
      maxLimit
    );

    this.pipeline.push({ $skip: (page - 1) * lim }, { $limit: lim });
    return this;
  }

  populate(input = "") {
    let list = [];
    const raw = Array.isArray(input) ? input : [input];
    if (this.query.populate) raw.push(...this.query.populate.split(","));

    raw.forEach((item) => {
      if (typeof item === "string" && item.trim()) list.push(item.trim());
      else if (item?.path) list.push(item);
    });

    const map = new Map();
    list.forEach((opt) => {
      const key = typeof opt === "string" ? opt : opt.path;
      map.set(key, opt);
    });

    const allowed =
      securityConfig.accessLevels[this.userRole]?.allowedPopulate || [];
    const final = [];
    map.forEach((opt, key) => {
      if (allowed.includes("*") || allowed.includes(key)) final.push(opt);
    });

    for (const opt of final) {
      const field = typeof opt === "string" ? opt : opt.path;
      const proj =
        typeof opt === "object" && opt.select
          ? opt.select.split(" ").reduce(
              (a, f) => {
                a[f] = 1;
                return a;
              },
              { _id: 1 }
            )
          : {};

      const { collection, isArray } = this._getCollectionInfo(field);

      const matchStage = isArray
        ? { $match: { $expr: { $in: ["$_id", "$$id"] } } }
        : { $match: { $expr: { $eq: ["$_id", "$$id"] } } };

      const lookup =
        proj && Object.keys(proj).length
          ? {
              from: collection,
              let: { id: `$${field}` },
              pipeline: [matchStage, { $project: proj }],
              as: field,
            }
          : {
              from: collection,
              localField: field,
              foreignField: "_id",
              as: field,
            };

      this.pipeline.push({ $lookup: lookup });

      if (!isArray) {
        this.pipeline.push({
          $unwind: { path: `$${field}`, preserveNullAndEmptyArrays: true },
        });
      }
    }

    return this;
  }

  addManualFilters(filters) {
    if (filters) this.manualFilters = { ...this.manualFilters, ...filters };
    return this;
  }

  async execute(options = {}) {
    try {
      if (options.useCursor) this.useCursor = true;
      if (options.debug) logger.info("Pipeline:", this.pipeline);
      if (this.pipeline.length > (securityConfig.maxPipelineStages || 20)) {
        throw new HandleERROR("Too many pipeline stages", 400);
      }

      let agg = this.model
        .aggregate(this.pipeline)
        .option({ maxTimeMS: 10000 });
      const [cnt] = await this.model.aggregate([
        ...this.countPipeline,
        { $count: "total" },
      ]);
      const cursorOrData = this.useCursor
        ? agg.cursor({ batchSize: 100 }).exec()
        : agg
            .allowDiskUse(options.allowDiskUse || false)
            .readConcern("majority");

      const data = this.useCursor
        ? await cursorOrData.toArray()
        : await cursorOrData;

      const result = { success: true, count: cnt?.total || 0, data };
      if (options.projection) {
        result.data = result.data.map((doc) => {
          const projDoc = {};
          Object.keys(options.projection).forEach((f) => {
            if (options.projection[f]) projDoc[f] = doc[f];
          });
          return projDoc;
        });
      }
      return result;
    } catch (err) {
      this._handleError(err);
    }
  }

  // ---------- Private Helpers ----------

  _sanitization() {
    // Remove unsafe ops
    ["$", "$where", "$accumulator", "$function"].forEach((op) => {
      delete this.query[op];
    });
    // Validate numeric
    ["page", "limit"].forEach((f) => {
      if (this.query[f] && !/^[0-9]+$/.test(this.query[f])) {
        throw new HandleERROR(`Invalid ${f}`, 400);
      }
    });
  }

  _parseQueryFilters() {
    const obj = { ...this.query };
    ["page", "limit", "sort", "fields", "populate"].forEach(
      (k) => delete obj[k]
    );

    const out = {};

    for (const [rawKey, rawVal] of Object.entries(obj)) {
      if (typeof rawVal === "object" && !Array.isArray(rawVal)) {
        out[rawKey] = {};
        for (let [op, val] of Object.entries(rawVal)) {
          const cleanOp = op.replace(/^\$/, "");
          if (securityConfig.allowedOperators.includes(cleanOp)) {
            const v = /^[0-9]+$/.test(val) ? parseInt(val, 10) : val;
            out[rawKey][`$${cleanOp}`] = v;
          }
        }
      } else if (/^\w+\[\$?\w+\]$/.test(rawKey)) {
        const [, field, op] = rawKey.match(/^(\w+)\[\$?(\w+)\]$/);
        if (securityConfig.allowedOperators.includes(op)) {
          const v = /^[0-9]+$/.test(rawVal) ? parseInt(rawVal, 10) : rawVal;
          out[field] = { [`$${op}`]: v };
        }
      } else {
        if (typeof rawVal === "string" && rawVal.includes(",")) {
          out[rawKey] = rawVal.split(",");
        } else {
          out[rawKey] = rawVal;
        }
      }
    }

    return out;
  }

  _sanitizeFilters(filters) {
    const resultObj = {};
    const resualt = Object.entries(filters).map((el) => {
      const [keyObj, val] = el;
      if (val === "null") {
        resultObj[keyObj] = null;
        return;
      }
      if (
        typeof val === "object" &&
        (this.#isStrictObjectId(val["$eq"]) ||
          this.#isStrictObjectId(val["eq"]))
      ) {
        const newVal = { ...val };
        if (this.#isStrictObjectId(val["$eq"])) {
          newVal["$eq"] = new ObjectId(val["$eq"]);
        }
        if (this.#isStrictObjectId(val["eq"])) {
          newVal["eq"] = new ObjectId(val["eq"]);
        }
        resultObj[keyObj] = newVal;
        return;
      }
      if (val === "true") {
        resultObj[keyObj] = true;
        return;
      }
      if (val === "false") {
        resultObj[keyObj] = false;
        return;
      }

      if (typeof val === "string" && /^[0-9]+$/.test(val)) {
        if (val.length > 1 && val.startsWith("0")) {
          resultObj[keyObj] = val; // keep leading zero
        } else {
          resultObj[keyObj] = parseInt(val, 10);
        }
        return;
      }

      if (typeof val === "string" && this.#isStrictObjectId(val)) {
        resultObj[keyObj] = new ObjectId(val);
        return;
      }
      resultObj[keyObj] = val;
    });
    return resultObj;
  }

  #isStrictObjectId(id) {
    return (
      typeof id === "string" &&
      mongoose.Types.ObjectId.isValid(id) &&
      new mongoose.Types.ObjectId(id).toString() === id
    );
  }

  _applySecurityFilters(filters) {
    let res = { ...filters };
    securityConfig.forbiddenFields.forEach((f) => delete res[f]);
    return res;
  }

  _getCollectionInfo(field) {
    const path = this.model.schema.path(field);
    if (!path?.options?.ref && !path?.options?.type[0]?.ref)
      throw new HandleERROR(`Invalid populate: ${field}`, 400);

    const refModelName =
      path?.options?.ref?.toLowerCase() ||
      path?.options?.type[0]?.ref.toLowerCase();

    const collectionName = pluralize(refModelName);

    return {
      collection: collectionName,
      isArray: path.instance === "Array",
    };
  }

  _handleError(err) {
    logger.error(`[ApiFeatures] ${err.message}`, { stack: err.stack });
    throw err;
  }
}

export default ApiFeatures;
