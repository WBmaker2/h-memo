#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const REQUIRED_ENV_KEYS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_APP_ID",
];

export const OPTIONAL_ENV_KEYS = [
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_MEASUREMENT_ID",
];

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    help: false,
    mode: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--mode") {
      if (i + 1 >= argv.length) {
        throw new Error("--mode requires a value.");
      }
      options.mode = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith("--mode=")) {
      options.mode = arg.slice("--mode=".length);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

export function getDotEnvFileOrder(mode = "") {
  const normalizedMode = trim(mode);
  const files = [".env", ".env.local"];
  if (normalizedMode !== "") {
    files.push(`.env.${normalizedMode}`, `.env.${normalizedMode}.local`);
  }
  return files;
}

export function parseDotEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const source = readFileSync(filePath, "utf8");
  const env = {};

  for (const line of source.split("\n")) {
    const cleaned = line.trim();
    if (cleaned === "" || cleaned.startsWith("#")) {
      continue;
    }

    const equalsIndex = cleaned.indexOf("=");
    if (equalsIndex < 0) {
      continue;
    }

    const rawKey = cleaned.slice(0, equalsIndex).trim();
    const rawValue = cleaned.slice(equalsIndex + 1);
    if (rawKey === "") {
      continue;
    }

    const unquoted = rawValue.trim().replace(/^["']|["']$/g, "");
    env[rawKey] = unquoted;
  }

  return env;
}

export function readDotEnvFiles({ cwd = process.cwd(), mode = "" } = {}) {
  return getDotEnvFileOrder(mode).reduce((combined, fileName) => {
    return {
      ...combined,
      ...parseDotEnvFile(path.join(cwd, fileName)),
    };
  }, {});
}

export function loadFirebaseEnv({
  cwd = process.cwd(),
  mode = "",
  processEnv = process.env,
} = {}) {
  return {
    ...readDotEnvFiles({ cwd, mode }),
    ...processEnv,
  };
}

export function collectStatusFromKeys(keys, sourceEnv) {
  const present = [];
  const missing = [];
  for (const key of keys) {
    if (trim(sourceEnv[key]) !== "") {
      present.push(key);
    } else {
      missing.push(key);
    }
  }
  return { present, missing };
}

export function checkFirebaseEnv(sourceEnv) {
  return {
    required: collectStatusFromKeys(REQUIRED_ENV_KEYS, sourceEnv),
    optional: collectStatusFromKeys(OPTIONAL_ENV_KEYS, sourceEnv),
  };
}

function printUsage() {
  console.log("Usage: node scripts/check-firebase-env.mjs [--mode <mode>]");
  console.log("  --mode  Also load .env.<mode> and .env.<mode>.local after generic env files");
}

function main() {
  try {
    const { help, mode } = parseArgs();
    if (help) {
      printUsage();
      process.exit(0);
    }

    const result = checkFirebaseEnv(loadFirebaseEnv({ mode }));
    const { required, optional } = result;

    console.log("[firebase-env] required keys");
    if (required.missing.length === 0) {
      console.log("  present: all required keys");
    } else {
      console.log(`  missing: ${required.missing.join(", ")}`);
    }

    console.log(`[firebase-env] optional keys`);
    if (optional.present.length > 0) {
      console.log(`  present: ${optional.present.join(", ")}`);
    }
    if (optional.missing.length > 0) {
      console.log(`  missing: ${optional.missing.join(", ")}`);
    }

    if (required.missing.length > 0) {
      console.error(
        `[firebase-env] missing required keys: ${required.missing.join(", ")}`
      );
      process.exitCode = 1;
      return;
    }

    console.log("[firebase-env] all required Firebase client keys are present.");
  } catch (err) {
    console.error(`[firebase-env] ${String(err.message || err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
