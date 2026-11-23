// Meme Sprint 3: AI Agent Goes Rogue
// Writes one 1024x1024 PNG meme to <out>/entry.png (default /output).
// Pure Node stdlib: a tiny raster canvas, a 5x7 bitmap font, and a
// from-scratch PNG encoder. No network, no randomness, no dates:
// two runs produce byte-identical output.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- canvas
type RGB = [number, number, number];

const buf = new Uint8Array(W * H * 4);

function setPx(x: number, y: number, c: RGB, a = 1): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  if (a >= 1) {
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
  } else {
    buf[i] = Math.round(buf[i] * (1 - a) + c[0] * a);
    buf[i + 1] = Math.round(buf[i + 1] * (1 - a) + c[1] * a);
    buf[i + 2] = Math.round(buf[i + 2] * (1 - a) + c[2] * a);
    buf[i + 3] = 255;
  }
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) setPx(xx, yy, c);
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(W, Math.ceil(cx + r));
  const y1 = Math.min(H, Math.ceil(cy + r));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const dx = xx + 0.5 - cx;
      const dy = yy + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) setPx(xx, yy, c, a);
    }
  }
}

function roundRect(x: number, y: number, w: number, h: number, r: number, c: RGB): void {
  fillRect(x + r, y, w - 2 * r, h, c);
  fillRect(x, y + r, w, h - 2 * r, c);
  fillCircle(x + r, y + r, r, c);
  fillCircle(x + w - r, y + r, r, c);
  fillCircle(x + r, y + h - r, r, c);
  fillCircle(x + w - r, y + h - r, r, c);
}

// Thick line: stamp circles along the segment.
function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB): void {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    fillCircle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, c);
  }
}

function fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    const edges: [number, number, number, number][] = [[x0, y0, x1, y1], [x1, y1, x2, y2], [x2, y2, x0, y0]];
    for (const [ax, ay, bx, by] of edges) {
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
    }
    if (xs.length >= 2) {
      const lo = Math.max(0, Math.floor(Math.min(...xs)));
      const hi = Math.min(W - 1, Math.ceil(Math.max(...xs)));
      for (let x = lo; x <= hi; x++) setPx(x, y, c);
    }
  }
}

// ------------------------------------------------------------------- font
// 5x7 bitmap glyphs: each row is a 5-bit number, bit 4 = leftmost pixel.
const GLYPHS: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  ".": [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
  " ": [0, 0, 0, 0, 0, 0, 0],
};

function textWidth(text: string, scale: number): number {
  return text.length * (5 * scale + scale) - scale;
}

function drawText(text: string, x: number, y: number, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (!g) { cx += 6 * scale; continue; }
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (g[row] & (1 << (4 - col))) {
          fillRect(cx + col * scale, y + row * scale, scale, scale, c);
        }
      }
    }
    cx += 6 * scale;
  }
}

function drawTextCentered(text: string, y: number, scale: number, c: RGB): void {
  drawText(text, Math.round((W - textWidth(text, scale)) / 2), y, scale, c);
}

// ------------------------------------------------------------- PNG encode
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const b of data) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4;
      const di = y * (1 + W * 3) + 1 + x * 3;
      raw[di] = buf[si];
      raw[di + 1] = buf[si + 1];
      raw[di + 2] = buf[si + 2];
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Empty a directory's contents only — never remove the directory itself:
// the grader's /output is a mounted empty directory and removing it fails.
function emptyDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return;
  }
  for (const entry of readdirSync(dir)) {
    rmSync(join(dir, entry), { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ scene
// Palette
const BLACK: RGB = [17, 17, 17];
const WHITE: RGB = [255, 255, 255];
const WALL: RGB = [174, 191, 201];
const WALL_DARK: RGB = [143, 163, 176];
const FLOOR: RGB = [156, 122, 84];
const FLOOR_LINE: RGB = [138, 106, 72];
const DESK_TOP: RGB = [125, 90, 56];
const DESK: RGB = [109, 76, 47];
const DESK_DARK: RGB = [93, 65, 40];
const STEEL: RGB = [176, 190, 197];
const STEEL_DARK: RGB = [96, 125, 139];
const PANEL: RGB = [69, 90, 100];
const RED: RGB = [255, 34, 34];
const RED_DARK: RGB = [198, 40, 40];
const TIE: RGB = [198, 40, 40];
const SKIN: RGB = [232, 185, 138];
const SHIRT: RGB = [63, 111, 181];
const PANTS: RGB = [47, 59, 76];
const BOX: RGB = [176, 137, 84];
const BOX_DARK: RGB = [150, 114, 66];
const SCREEN: RGB = [13, 40, 24];
const SCREEN_LINE: RGB = [74, 222, 128];
const GOLD: RGB = [212, 175, 55];
const MUG: RGB = [236, 239, 241];
const COFFEE: RGB = [109, 76, 47];
const LEAF: RGB = [46, 125, 50];
const POT: RGB = [183, 91, 52];

function drawOffice(): void {
  // Wall and floor
  fillRect(0, 140, W, 500, WALL);
  fillRect(0, 640, W, 220, FLOOR);
  for (let x = 0; x < W; x += 128) fillRect(x, 640, 3, 220, FLOOR_LINE);
  fillRect(0, 636, W, 6, WALL_DARK);

  // Framed poster on the wall (a tiny sunset over hills)
  fillRect(880, 190, 110, 130, [60, 60, 60]);
  fillRect(888, 198, 94, 114, [255, 183, 77]);
  fillCircle(935, 250, 22, [255, 112, 67]);
  fillRect(888, 272, 94, 40, [46, 125, 50]);
  fillRect(888, 292, 94, 20, [27, 94, 32]);

  // Wall clock (clear wall space, left of the robot)
  fillCircle(330, 250, 34, WHITE);
  fillCircle(330, 250, 34, STEEL_DARK); // rim ring via overdraw trick below
  fillCircle(330, 250, 30, WHITE);
  thickLine(330, 250, 330, 226, 4, BLACK);
  thickLine(330, 250, 348, 258, 4, BLACK);
  fillCircle(330, 250, 4, BLACK);

  // Door frame behind the human (left)
  fillRect(36, 200, 210, 440, [120, 100, 70]);
  fillRect(48, 212, 186, 428, [196, 168, 128]);

  drawHuman();
  drawRobot(); // robot first: the desk then occludes its lower body
  drawDesk();
}

function drawHuman(): void {
  // The fired human: holding a cardboard box, standing in the doorway.
  const skin = SKIN;
  // Legs
  fillRect(118, 560, 22, 80, PANTS);
  fillRect(152, 560, 22, 80, PANTS);
  // Shoes
  fillRect(112, 634, 32, 10, BLACK);
  fillRect(148, 634, 32, 10, BLACK);
  // Shirt
  roundRect(112, 452, 74, 112, 10, SHIRT);
  // Arms reaching forward to the box
  thickLine(122, 480, 96, 530, 14, SHIRT);
  thickLine(176, 480, 200, 530, 14, SHIRT);
  // Head: hair cap first, skin circle over it so only a hairline shows
  fillCircle(149, 404, 30, [40, 30, 22]);
  fillCircle(149, 422, 28, skin);
  // Sad eyes and a small frown
  fillCircle(138, 420, 3, BLACK);
  fillCircle(160, 420, 3, BLACK);
  thickLine(142, 442, 149, 438, 3, BLACK);
  thickLine(149, 438, 156, 442, 3, BLACK);
  // Cardboard box
  fillRect(76, 528, 140, 84, BOX);
  fillRect(76, 528, 140, 10, BOX_DARK);
  fillRect(76, 528, 10, 84, BOX_DARK);
  thickLine(76, 570, 216, 570, 3, BOX_DARK);
  // Paper sticking out of the box
  fillRect(120, 500, 44, 34, WHITE);
  thickLine(128, 512, 156, 512, 2, [120, 120, 120]);
  thickLine(128, 522, 156, 522, 2, [120, 120, 120]);
}

function drawDesk(): void {
  // Desk top and body
  fillRect(300, 600, 700, 22, DESK_TOP);
  fillRect(320, 622, 660, 238, DESK);
  // Drawer fronts
  fillRect(340, 640, 180, 90, DESK_DARK);
  fillRect(340, 750, 180, 90, DESK_DARK);
  fillCircle(500, 685, 7, GOLD);
  fillCircle(500, 795, 7, GOLD);
  // Potted plant on the desk (left)
  fillRect(352, 560, 52, 40, POT);
  fillCircle(368, 548, 20, LEAF);
  fillCircle(392, 540, 22, LEAF);
  fillCircle(380, 522, 18, [56, 142, 60]);
  // Laptop: base and glowing screen with code lines
  fillRect(430, 566, 170, 34, [38, 50, 56]);
  fillRect(440, 470, 150, 100, [20, 20, 20]);
  fillRect(448, 478, 134, 84, SCREEN);
  fillRect(448, 478, 134, 12, [229, 57, 53]); // red banner on screen
  for (let i = 0; i < 5; i++) {
    fillRect(456, 500 + i * 12, 60 + ((i * 37) % 50), 5, SCREEN_LINE);
  }
  // Coffee mug with steam, near the robot's hand
  roundRect(850, 556, 52, 44, 8, MUG);
  fillRect(850, 556, 52, 12, COFFEE);
  fillCircle(902, 576, 10, MUG);
  fillCircle(902, 576, 6, COFFEE);
  for (let i = 0; i < 3; i++) {
    const bx = 862 + i * 14;
    for (let s = 0; s < 26; s++) {
      const yy = 548 - s;
      const xx = bx + Math.round(4 * Math.sin(s / 4));
      setPx(xx, yy, [200, 200, 200], 0.7);
      setPx(xx + 1, yy, [200, 200, 200], 0.7);
    }
  }
  // Gold nameplate on the desk
  fillRect(640, 584, 130, 16, GOLD);
}

function drawRobot(): void {
  // Chair back behind the robot
  roundRect(560, 430, 300, 220, 24, [52, 63, 71]);
  // Robot body
  roundRect(590, 470, 240, 170, 26, STEEL);
  roundRect(590, 470, 240, 170, 26, STEEL_DARK); // outline pass
  roundRect(596, 476, 228, 158, 22, STEEL);
  // Chest panel with lights
  roundRect(650, 520, 120, 70, 10, PANEL);
  fillCircle(680, 555, 10, [76, 175, 80]);
  fillCircle(710, 555, 10, [255, 235, 59]);
  fillCircle(740, 555, 10, RED);
  // The tie: the robot took the boss's job, so it wears the boss's tie
  fillTriangle(706, 486, 720, 486, 713, 500, TIE);
  fillTriangle(700, 500, 726, 500, 713, 560, TIE);
  // Neck
  fillRect(696, 452, 34, 22, STEEL_DARK);
  // Head
  roundRect(620, 300, 180, 150, 30, STEEL);
  roundRect(620, 300, 180, 150, 30, STEEL_DARK);
  roundRect(626, 306, 168, 138, 26, STEEL);
  // Antenna with blinking red light
  thickLine(710, 300, 710, 258, 6, STEEL_DARK);
  fillCircle(710, 250, 12, RED);
  fillCircle(710, 250, 12, RED, 0.35);
  fillCircle(710, 250, 20, RED, 0.18);
  // Rogue red eyes (glowing)
  fillCircle(668, 372, 26, RED, 0.25);
  fillCircle(752, 372, 26, RED, 0.25);
  fillCircle(668, 372, 15, RED);
  fillCircle(752, 372, 15, RED);
  fillCircle(668, 372, 6, [255, 120, 120]);
  fillCircle(752, 372, 6, [255, 120, 120]);
  // Smug little smirk
  thickLine(690, 420, 730, 412, 4, STEEL_DARK);
  // Ears / side bolts
  fillCircle(620, 375, 10, STEEL_DARK);
  fillCircle(800, 375, 10, STEEL_DARK);
  // Arms: one on the laptop keys, one holding the coffee
  thickLine(600, 520, 520, 566, 26, STEEL_DARK);
  thickLine(600, 520, 520, 566, 18, STEEL);
  thickLine(820, 520, 872, 566, 26, STEEL_DARK);
  thickLine(820, 520, 872, 566, 18, STEEL);
  // Hands
  fillCircle(518, 568, 14, STEEL_DARK);
  fillCircle(874, 568, 14, STEEL_DARK);
}

function drawMeme(): void {
  // Caption bands
  fillRect(0, 0, W, 140, BLACK);
  fillRect(0, 860, W, 164, BLACK);
  drawTextCentered("MY AI AGENT WENT ROGUE", 48, 6, WHITE);
  drawTextCentered("IT TOOK MY JOB.", 884, 7, WHITE);
  drawTextCentered("AND MY CHAIR.", 950, 7, WHITE);
  drawOffice();
}

// -------------------------------------------------------------------- main
function main(): void {
  const outDir = process.argv[2] ?? "/output";
  emptyDir(outDir);
  drawMeme();
  writeFileSync(join(outDir, "entry.png"), encodePng());
}

main();
