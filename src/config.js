import path from "path";
import { fileURLToPath } from "url";
import { securityConfig as defaultConfig } from "./security-default-config.js";

let userConfig = {};

try {
  const userPath = path.resolve(process.cwd(), "security-config.js");
  userConfig = (await import(userPath))?.securityConfig || {};
} catch (err) {
  // کاربر security-config نداشت، مشکلی نیست
}

export const securityConfig = {
  ...defaultConfig,
  ...userConfig,
  accessLevels: {
    ...defaultConfig.accessLevels,
    ...(userConfig.accessLevels || {}),
  },
};
