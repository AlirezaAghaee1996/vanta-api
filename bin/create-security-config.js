// bin/create-security-config.js
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';

// Define the target path for the security-config file.
// This example creates it in the current working directory.
const configPath = join(process.env.INIT_CWD || process.cwd(), 'security-config.js');

// If the file does not exist, create it with default content.
if (!existsSync(configPath)) {
  const defaultConfig = `// Default Security Configuration
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
  },
  // Aggregation safeguards
  maxPipelineStages: 20
};
`;

  writeFileSync(configPath, defaultConfig);
  console.log('Default security-config.js created in your project root. You can customize it as needed.');
} else {
  console.log('security-config.js already exists. Using custom configuration.');
}
