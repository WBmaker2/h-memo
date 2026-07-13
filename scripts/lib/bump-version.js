import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const INTERNAL_PACKAGE_PREFIX = "@h-memo/";
const DEFAULTS = {
  rootDir: process.cwd(),
  rootPackagePath: "package.json",
  packageLockPath: "package-lock.json",
  workspaceRoots: ["apps", "packages"],
  tauriConfigPath: path.join("apps", "desktop", "src-tauri", "tauri.conf.json"),
  cargoTomlPath: path.join("apps", "desktop", "src-tauri", "Cargo.toml"),
  cargoLockPath: path.join("apps", "desktop", "src-tauri", "Cargo.lock"),
};

function requiredFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  return readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  const source = requiredFile(filePath);
  try {
    return { source, value: JSON.parse(source) };
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function assertExactSemver(version, source) {
  if (typeof version !== "string" || !SEMVER_PATTERN.test(version)) {
    throw new Error(`Invalid exact semver in ${source}: ${String(version)}`);
  }
}

function formatJson(value, source) {
  const newline = source.endsWith("\r\n") ? "\r\n" : "\n";
  return `${JSON.stringify(value, null, 2)}${newline}`;
}

function discoverWorkspacePackagePaths(rootDir, workspaceRoots) {
  const packagePaths = [];

  for (const workspaceRoot of workspaceRoots) {
    const directory = path.resolve(rootDir, workspaceRoot);
    if (!existsSync(directory)) {
      throw new Error(`Required workspace directory not found: ${directory}`);
    }

    const entries = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const name of entries) {
      const packagePath = path.join(directory, name, "package.json");
      if (!existsSync(packagePath)) {
        throw new Error(`Required workspace package not found: ${packagePath}`);
      }
      packagePaths.push(packagePath);
    }
  }

  return packagePaths;
}

function assertPackageVersion(packageJson, filePath, expectedVersion) {
  if (typeof packageJson !== "object" || packageJson === null) {
    throw new Error(`Invalid package object in ${filePath}`);
  }
  assertExactSemver(packageJson.version, `${filePath} version`);
  if (packageJson.version !== expectedVersion) {
    throw new Error(
      `Version mismatch in ${filePath}: ${packageJson.version} (expected ${expectedVersion})`
    );
  }
}

function updateInternalDependencyVersions(packageJson, filePath, expectedVersion, nextVersion) {
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const dependencies = packageJson[field];
    if (dependencies == null) {
      continue;
    }
    if (typeof dependencies !== "object" || Array.isArray(dependencies)) {
      throw new Error(`Invalid ${field} object in ${filePath}`);
    }

    for (const [name, range] of Object.entries(dependencies)) {
      if (!name.startsWith(INTERNAL_PACKAGE_PREFIX)) {
        continue;
      }
      if (typeof range !== "string") {
        throw new Error(`Invalid ${field} range for ${name} in ${filePath}`);
      }
      if (range.startsWith("file:")) {
        continue;
      }
      assertExactSemver(range, `${field} range for ${name} in ${filePath}`);
      if (range !== expectedVersion) {
        throw new Error(
          `Internal dependency mismatch for ${name} in ${filePath}: ${range} (expected ${expectedVersion})`
        );
      }
      dependencies[name] = nextVersion;
    }
  }
}

function replaceTomlPackageVersion(source, filePath, expectedVersion, nextVersion) {
  const lines = source.split(/(\r?\n)/);
  let inPackage = false;
  let versionIndex = -1;

  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === "[package]") {
      if (inPackage) {
        throw new Error(`Duplicate [package] section in ${filePath}`);
      }
      inPackage = true;
      continue;
    }
    if (inPackage && /^\[.+\]$/.test(trimmed)) {
      break;
    }
    if (!inPackage) {
      continue;
    }

    const match = line.match(/^(\s*version\s*=\s*)"([^"]*)"(\s*(?:#.*)?)$/);
    if (match) {
      if (versionIndex !== -1) {
        throw new Error(`Duplicate version in [package] section of ${filePath}`);
      }
      assertExactSemver(match[2], `${filePath} [package] version`);
      if (match[2] !== expectedVersion) {
        throw new Error(
          `Version mismatch in ${filePath}: ${match[2]} (expected ${expectedVersion})`
        );
      }
      versionIndex = index;
      lines[index] = `${match[1]}"${nextVersion}"${match[3]}`;
    }
  }

  if (!inPackage) {
    throw new Error(`Missing [package] section in ${filePath}`);
  }
  if (versionIndex === -1) {
    throw new Error(`Missing version in [package] section of ${filePath}`);
  }

  return lines.join("");
}

function replaceCargoLockPackageVersion(source, filePath, expectedVersion, nextVersion) {
  const blocks = source.split(/(?=^\[\[package\]\]$)/m);
  let matches = 0;
  let updatedSource = source;

  for (const block of blocks) {
    if (!/^\[\[package\]\]$\r?\nname = "h-memo-desktop"$/m.test(block)) {
      continue;
    }
    matches += 1;
    const versionMatch = block.match(/^(version\s*=\s*)"([^"]*)"$/m);
    if (!versionMatch) {
      throw new Error(`Missing version in h-memo-desktop package block of ${filePath}`);
    }
    assertExactSemver(versionMatch[2], `${filePath} h-memo-desktop version`);
    if (versionMatch[2] !== expectedVersion) {
      throw new Error(
        `Version mismatch in ${filePath}: ${versionMatch[2]} (expected ${expectedVersion})`
      );
    }
    const updatedBlock = block.replace(
      /^(version\s*=\s*)"[^"]*"$/m,
      `$1"${nextVersion}"`
    );
    updatedSource = updatedSource.replace(block, updatedBlock);
  }

  if (matches === 0) {
    throw new Error(`Missing h-memo-desktop package block in ${filePath}`);
  }
  if (matches > 1) {
    throw new Error(`Duplicate h-memo-desktop package blocks in ${filePath}`);
  }

  return updatedSource;
}

function updatePackageLock(lockfile, filePath, workspacePaths, expectedVersion, nextVersion) {
  if (typeof lockfile !== "object" || lockfile === null || typeof lockfile.packages !== "object") {
    throw new Error(`Invalid package-lock structure in ${filePath}`);
  }

  assertExactSemver(lockfile.version, `${filePath} top-level version`);
  if (lockfile.version !== expectedVersion) {
    throw new Error(
      `Version mismatch in ${filePath} top-level version: ${lockfile.version} (expected ${expectedVersion})`
    );
  }
  lockfile.version = nextVersion;

  const expectedPackagePaths = ["", ...workspacePaths];
  for (const workspacePath of expectedPackagePaths) {
    const packageEntry = lockfile.packages[workspacePath];
    if (typeof packageEntry !== "object" || packageEntry === null) {
      throw new Error(`Missing package-lock workspace entry for ${workspacePath || "root"} in ${filePath}`);
    }
    assertExactSemver(packageEntry.version, `${filePath} ${workspacePath || "root"} version`);
    if (packageEntry.version !== expectedVersion) {
      throw new Error(
        `Version mismatch in ${filePath} ${workspacePath || "root"}: ${packageEntry.version} (expected ${expectedVersion})`
      );
    }
    packageEntry.version = nextVersion;
    updateInternalDependencyVersions(
      packageEntry,
      `${filePath} ${workspacePath || "root"}`,
      expectedVersion,
      nextVersion
    );
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = { rootDir: process.cwd(), patch: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--patch") {
      options.patch = true;
      continue;
    }
    if (arg === "--root" || arg === "--root-dir") {
      if (index + 1 >= argv.length) {
        throw new Error(`${arg} requires a value.`);
      }
      options.rootDir = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.patch) {
    throw new Error("Exactly one bump type is required: --patch");
  }
  return options;
}

export function bumpPatch(version) {
  assertExactSemver(version, "root package version");
  const [major, minor, patch] = version.split(".");
  return `${major}.${minor}.${BigInt(patch) + 1n}`;
}

export function bumpVersion({ rootDir = DEFAULTS.rootDir } = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const rootPackagePath = path.join(resolvedRoot, DEFAULTS.rootPackagePath);
  const packageLockPath = path.join(resolvedRoot, DEFAULTS.packageLockPath);
  const tauriConfigPath = path.join(resolvedRoot, DEFAULTS.tauriConfigPath);
  const cargoTomlPath = path.join(resolvedRoot, DEFAULTS.cargoTomlPath);
  const cargoLockPath = path.join(resolvedRoot, DEFAULTS.cargoLockPath);
  const workspacePackagePaths = discoverWorkspacePackagePaths(resolvedRoot, DEFAULTS.workspaceRoots);

  const rootPackage = readJson(rootPackagePath);
  assertPackageVersion(rootPackage.value, rootPackagePath, rootPackage.value.version);
  const currentVersion = rootPackage.value.version;
  const nextVersion = bumpPatch(currentVersion);

  const packageFiles = [{ path: rootPackagePath, ...rootPackage }];
  for (const packagePath of workspacePackagePaths) {
    const packageFile = readJson(packagePath);
    assertPackageVersion(packageFile.value, packagePath, currentVersion);
    packageFiles.push({ path: packagePath, ...packageFile });
  }

  const packageLock = readJson(packageLockPath);
  const workspaceLockPaths = workspacePackagePaths.map((packagePath) =>
    path.relative(resolvedRoot, path.dirname(packagePath)).split(path.sep).join("/")
  );
  const tauriConfig = readJson(tauriConfigPath);
  assertPackageVersion(tauriConfig.value, tauriConfigPath, currentVersion);
  const cargoTomlSource = requiredFile(cargoTomlPath);
  const cargoLockSource = requiredFile(cargoLockPath);

  for (const packageFile of packageFiles) {
    packageFile.value.version = nextVersion;
    updateInternalDependencyVersions(
      packageFile.value,
      packageFile.path,
      currentVersion,
      nextVersion
    );
  }
  updatePackageLock(
    packageLock.value,
    packageLockPath,
    workspaceLockPaths,
    currentVersion,
    nextVersion
  );
  tauriConfig.value.version = nextVersion;

  const writes = [
    ...packageFiles.map((packageFile) => ({
      path: packageFile.path,
      content: formatJson(packageFile.value, packageFile.source),
    })),
    { path: packageLockPath, content: formatJson(packageLock.value, packageLock.source) },
    { path: tauriConfigPath, content: formatJson(tauriConfig.value, tauriConfig.source) },
    {
      path: cargoTomlPath,
      content: replaceTomlPackageVersion(
        cargoTomlSource,
        cargoTomlPath,
        currentVersion,
        nextVersion
      ),
    },
    {
      path: cargoLockPath,
      content: replaceCargoLockPackageVersion(
        cargoLockSource,
        cargoLockPath,
        currentVersion,
        nextVersion
      ),
    },
  ];

  for (const write of writes) {
    writeFileSync(write.path, write.content);
  }

  return nextVersion;
}

export function main() {
  try {
    const options = parseArgs();
    process.stdout.write(`${bumpVersion(options)}\n`);
  } catch (error) {
    process.stderr.write(`[version:bump] ${String(error.message || error)}\n`);
    process.exitCode = 1;
  }
}
