/**
 * electron-builder afterPack hook.
 *
 * Downloads the Bun binary for the target platform/arch and places it at
 * Contents/Resources/bin/bun (macOS/Linux) or resources\bin\bun.exe (Windows)
 * so the packaged app can run the Episteme server without requiring a system Bun.
 *
 * Called by electron-builder once per arch. On a macOS universal build it runs
 * twice: once for arm64, once for x64.
 */

const https = require("https");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execSync } = require("child_process");

// electron-builder Arch enum (numeric values)
const ArchEnum = { ia32: 0, x64: 1, armv7l: 2, arm64: 3, universal: 4 };

/**
 * Map electron-builder platform + arch to the Bun release archive name.
 * Release archives live at:
 *   https://github.com/oven-sh/bun/releases/latest/download/<name>.zip
 */
function bunTarget(platform, arch) {
  const isArm = arch === ArchEnum.arm64 || arch === ArchEnum.armv7l;
  switch (platform) {
    case "darwin":
      return isArm ? "bun-darwin-aarch64" : "bun-darwin-x64";
    case "linux":
      return isArm ? "bun-linux-aarch64" : "bun-linux-x64";
    case "win32":
      return "bun-windows-x64"; // Bun only ships a 64-bit Windows build
    default:
      throw new Error(`afterPack: unsupported platform "${platform}"`);
  }
}

/** Resolve the Resources directory inside the packed output. */
function resourcesDir(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const appName = packager.appInfo.productName;
  if (electronPlatformName === "darwin") {
    return path.join(appOutDir, `${appName}.app`, "Contents", "Resources");
  }
  return path.join(appOutDir, "resources");
}

/** Follow redirects and return the final URL's content as a Buffer. */
function fetchBuffer(url, redirects = 10) {
  return new Promise((resolve, reject) => {
    if (redirects === 0) return reject(new Error("Too many redirects"));
    https.get(url, { headers: { "User-Agent": "episteme-builder/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchBuffer(res.headers.location, redirects - 1).then(resolve).catch(reject);
        res.resume();
        return;
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

/**
 * Extract a single entry from a ZIP buffer using the system unzip/Expand-Archive.
 * Writing a pure-JS ZIP parser is overkill here; both tools ship with every
 * supported OS (macOS, Linux, Windows 10+).
 */
function extractBinary(zipBuffer, targetDir, platform) {
  const tmp = path.join(os.tmpdir(), `episteme-bun-${Date.now()}.zip`);
  fs.writeFileSync(tmp, zipBuffer);

  fs.mkdirSync(targetDir, { recursive: true });

  try {
    if (platform === "win32") {
      // PowerShell is always available on Windows 10+
      execSync(
        `powershell -Command "Expand-Archive -Force -Path '${tmp}' -DestinationPath '${targetDir}'"`,
        { stdio: "inherit" }
      );
    } else {
      execSync(`unzip -o "${tmp}" -d "${targetDir}"`, { stdio: "inherit" });
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * After extraction the zip produces a subdirectory, e.g. bun-darwin-aarch64/bun.
 * Find the binary inside targetDir and move it to targetDir/bun (or bun.exe).
 */
function promoteBinary(targetDir, platform) {
  const ext = platform === "win32" ? ".exe" : "";
  const binaryName = `bun${ext}`;
  const dest = path.join(targetDir, binaryName);

  // Already at root (idempotent re-run)
  if (fs.existsSync(dest)) return dest;

  // Search one level deep for the binary
  for (const entry of fs.readdirSync(targetDir)) {
    const candidate = path.join(targetDir, entry, binaryName);
    if (fs.existsSync(candidate)) {
      fs.renameSync(candidate, dest);
      // Remove the now-empty subdirectory
      try { fs.rmdirSync(path.join(targetDir, entry)); } catch {}
      return dest;
    }
  }

  throw new Error(`afterPack: could not find bun binary in ${targetDir}`);
}

exports.default = async function afterPack(context) {
  const { electronPlatformName, arch } = context;

  const target = bunTarget(electronPlatformName, arch);
  const url = `https://github.com/oven-sh/bun/releases/latest/download/${target}.zip`;

  const resDir = resourcesDir(context);
  const binDir = path.join(resDir, "bin");
  const ext = electronPlatformName === "win32" ? ".exe" : "";
  const dest = path.join(binDir, `bun${ext}`);

  if (fs.existsSync(dest)) {
    console.log(`afterPack: bun already present at ${dest}, skipping download`);
    return;
  }

  console.log(`afterPack: downloading ${target} from GitHub releases…`);
  const zip = await fetchBuffer(url);

  console.log(`afterPack: extracting to ${binDir}…`);
  extractBinary(zip, binDir, electronPlatformName);
  promoteBinary(binDir, electronPlatformName);

  if (electronPlatformName !== "win32") {
    fs.chmodSync(dest, 0o755);
  }

  console.log(`afterPack: bun installed at ${dest}`);
};
