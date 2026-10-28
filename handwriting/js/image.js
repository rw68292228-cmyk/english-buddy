// 圖片處理：讀相、縮細、轉方向、裁剪、字樣標準化、砌「字樣參考表」。

// 讀相（瀏覽器會自動跟 EXIF 轉正），縮到最長邊 maxSide
export async function loadImage(file, maxSide = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = makeCanvas(Math.round(img.naturalWidth * scale), Math.round(img.naturalHeight * scale));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// 順時針轉 90 度
export function rotate(src) {
  const c = makeCanvas(src.height, src.width);
  const ctx = c.getContext("2d");
  ctx.translate(c.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(src, 0, 0);
  return c;
}

export function scaleDown(src, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
  if (scale === 1) return src;
  const c = makeCanvas(Math.round(src.width * scale), Math.round(src.height * scale));
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export const toJpeg = (canvas, quality = 0.85) => canvas.toDataURL("image/jpeg", quality);

// rect 用原圖座標 { x, y, w, h }
export function crop(src, { x, y, w, h }) {
  const c = makeCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  c.getContext("2d").drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

const GLYPH = 96;

// 字樣：白底正方形，字置中、保持比例
export function normalizeGlyph(src) {
  const c = makeCanvas(GLYPH, GLYPH);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, GLYPH, GLYPH);
  const pad = 6;
  const scale = Math.min((GLYPH - pad * 2) / src.width, (GLYPH - pad * 2) / src.height);
  const w = src.width * scale;
  const h = src.height * scale;
  ctx.drawImage(src, (GLYPH - w) / 2, (GLYPH - h) / 2, w, h);
  return toJpeg(c, 0.8);
}

export function dataUrlToImage(url) {
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img);
}

// 字樣參考表：每格上面係手寫字樣，下面用印刷字寫正確答案
export async function buildSheet(glyphs, cols = 8) {
  const cellW = 110;
  const imgH = GLYPH;
  const labelH = 30;
  const cellH = imgH + labelH + 8;
  const rows = Math.ceil(glyphs.length / cols);
  const c = makeCanvas(cols * cellW, rows * cellH);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '600 22px system-ui, "PingFang HK", "Microsoft JhengHei", sans-serif';
  const imgs = await Promise.all(glyphs.map((g) => dataUrlToImage(g.image)));
  glyphs.forEach((g, i) => {
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * cellH;
    ctx.drawImage(imgs[i], x + (cellW - GLYPH) / 2, y + 4, GLYPH, imgH);
    ctx.strokeStyle = "#bbb";
    ctx.strokeRect(x + 2, y + 2, cellW - 4, cellH - 4);
    ctx.fillStyle = "#1d4ed8";
    ctx.fillText(g.label, x + cellW / 2, y + imgH + 4 + labelH / 2);
  });
  return toJpeg(c, 0.85);
}
