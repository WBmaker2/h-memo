#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const REQUIRED_ENV_KEYS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_APP_ID",
];

const OPTIONAL_ENV_KEYS = [
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_MEASUREMENT_ID",
];

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseDotEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  const source = readFileSync(path, "utf8");
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

function collectStatusFromKeys(keys, sourceEnv) {
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

function main() {
  const fileEnv = parseDotEnvFile(".env");
  const combined = {
    ...fileEnv,
    ...process.env,
  };

  const required = collectStatusFromKeys(REQUIRED_ENV_KEYS, combined);
  const optional = collectStatusFromKeys(OPTIONAL_ENV_KEYS, combined);

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
}

main();
