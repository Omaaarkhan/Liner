// Renders build/icon-src/groove.svg into the platform icon files using Electron,
// so no extra image tooling is needed. Run from apps/desktop:
//   npx electron scripts/make-icons.cjs
// Writes build/icon.icns (macOS only, needs iconutil), build/icon.ico and build/icon.png.
const { app, BrowserWindow } = require("electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const buildDir = path.join(__dirname, "..", "build");
const svg = fs.readFileSync(path.join(buildDir, "icon-src", "groove.svg"), "utf8");
const svgUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

// macOS icons sit on an 824 px rounded square inside the 1024 canvas, with a soft shadow.
const macPage = `<!doctype html><html style="background:transparent;overflow:hidden"><body style="margin:0;background:transparent;overflow:hidden">
<svg style="display:block" xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <clipPath id="shape"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-opacity="0.3"/></filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="#000" filter="url(#shadow)"/>
  <image href="${svgUrl}" x="100" y="100" width="824" height="824" clip-path="url(#shape)"/>
</svg></body></html>`;

// Windows and Linux get the artwork on a gently rounded square that fills the canvas.
const flatPage = `<!doctype html><html style="background:transparent;overflow:hidden"><body style="margin:0;background:transparent;overflow:hidden">
<svg style="display:block" xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><clipPath id="shape"><rect x="24" y="24" width="976" height="976" rx="200"/></clipPath></defs>
  <image href="${svgUrl}" x="24" y="24" width="976" height="976" clip-path="url(#shape)"/>
</svg></body></html>`;

let renderWindow;

async function render(html) {
  renderWindow ??= new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    webPreferences: { offscreen: true }
  });
  await renderWindow.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  return renderWindow.webContents.capturePage();
}

function sized(image, size) {
  return image.resize({ width: size, height: size, quality: "best" }).toPNG();
}

// ICO files may hold PNG images directly; this writes a minimal multi-size ICO.
function writeIco(image, file) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map((size) => sized(image, size));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(pngs[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += pngs[i].length;
  });
  fs.writeFileSync(file, Buffer.concat([header, ...pngs]));
}

function writeIcns(image, file) {
  const iconset = fs.mkdtempSync(path.join(os.tmpdir(), "icon-")) + "/icon.iconset";
  fs.mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(iconset, `icon_${size}x${size}.png`), sized(image, size));
    fs.writeFileSync(path.join(iconset, `icon_${size}x${size}@2x.png`), sized(image, size * 2));
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", file]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    if (process.platform === "darwin") {
      const mac = await render(macPage);
      fs.writeFileSync(path.join(buildDir, "icon-mac.png"), sized(mac, 1024));
      writeIcns(mac, path.join(buildDir, "icon.icns"));
    }
    const flat = await render(flatPage);
    fs.writeFileSync(path.join(buildDir, "icon.png"), sized(flat, 1024));
    writeIco(flat, path.join(buildDir, "icon.ico"));
    console.log("Icons written to", buildDir);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
  app.quit();
});
