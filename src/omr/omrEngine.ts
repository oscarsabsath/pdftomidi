import {
  DetectedOmrNote,
  DetectedStaff,
  NoteEvent,
  OmrAnalysisResult,
  OmrPageResult,
  OmrSettings,
  ScoreData,
  TimeSignature,
  VoiceId,
} from '../types/music';
import { getBeatsPerMeasure, staffStepToMidi } from '../utils/musicTheory';
import { RenderedSheetPage } from './pdfLoader';

// ============================================================================
// CLIENT-SIDE AUTONOMOUS OMR ENGINE (100% LOCAL, ZERO EXTERNAL APIs)
// ============================================================================

interface BinaryImage {
  width: number;
  height: number;
  /** 1 = dark ink, 0 = white background */
  data: Uint8Array;
}

/**
 * Compute Otsu threshold and apply mild local contrast compensation for scanned photos.
 */
function binarizeCanvas(canvas: HTMLCanvasElement, thresholdBias: number): BinaryImage {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const imgData = ctx.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  const hist = new Uint32Array(256);

  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    // Perceived luminance
    const lum = (imgData[p] * 77 + imgData[p + 1] * 150 + imgData[p + 2] * 29) >> 8;
    gray[i] = lum;
    hist[lum]++;
  }

  // Otsu global threshold
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let otsuThresh = 175;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const betweenVar = wB * wF * (mB - mF) * (mB - mF);
    if (betweenVar > maxVar) {
      maxVar = betweenVar;
      otsuThresh = t;
    }
  }

  // Clamp threshold safely so clean digital PDFs don't over-threshold faint anti-aliased staff lines
  const baseThresh = Math.max(115, Math.min(225, otsuThresh + thresholdBias));

  // Coarse block local mean (32x32 grid) to survive uneven shadows on phone photos
  const blockSize = 48;
  const gridW = Math.ceil(width / blockSize);
  const gridH = Math.ceil(height / blockSize);
  const blockMeans = new Float32Array(gridW * gridH);

  for (let by = 0; by < gridH; by++) {
    for (let bx = 0; bx < gridW; bx++) {
      let bSum = 0;
      let count = 0;
      const y0 = by * blockSize;
      const y1 = Math.min(height, y0 + blockSize);
      const x0 = bx * blockSize;
      const x1 = Math.min(width, x0 + blockSize);
      for (let y = y0; y < y1; y += 2) {
        const rowOff = y * width;
        for (let x = x0; x < x1; x += 2) {
          bSum += gray[rowOff + x];
          count++;
        }
      }
      blockMeans[by * gridW + bx] = count > 0 ? bSum / count : 240;
    }
  }

  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const by = Math.min(gridH - 1, (y / blockSize) | 0);
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const bx = Math.min(gridW - 1, (x / blockSize) | 0);
      const localMean = blockMeans[by * gridW + bx];
      // Blend Otsu with local background brightness so shaded paper stays clean
      const adaptiveThresh = Math.min(baseThresh, localMean - 26 + thresholdBias * 0.5);
      out[rowOff + x] = gray[rowOff + x] < Math.max(baseThresh * 0.85, adaptiveThresh) ? 1 : 0;
    }
  }

  return { width, height, data: out };
}

/**
 * Estimate small page skew (-2.5 to +2.5 degrees) via horizontal projection variance.
 */
function estimateDeskewAngle(bin: BinaryImage): number {
  const { width, height, data } = bin;
  const stepY = Math.max(1, Math.floor(height / 450));
  const stepX = Math.max(2, Math.floor(width / 350));
  const cx = width * 0.5;
  const cy = height * 0.5;

  let bestAngle = 0;
  let bestScore = -1;

  for (let deg = -2.5; deg <= 2.51; deg += 0.5) {
    const rad = (deg * Math.PI) / 180;
    const sinA = Math.sin(rad);
    const cosA = Math.cos(rad);
    const proj = new Int32Array(height);

    for (let y = 0; y < height; y += stepY) {
      const rowOff = y * width;
      const dy = y - cy;
      for (let x = 0; x < width; x += stepX) {
        if (data[rowOff + x]) {
          const ry = Math.round((x - cx) * sinA + dy * cosA + cy);
          if (ry >= 0 && ry < height) proj[ry]++;
        }
      }
    }

    let score = 0;
    for (let y = 1; y < height; y++) {
      const diff = proj[y] - proj[y - 1];
      score += diff * diff;
    }
    if (score > bestScore) {
      bestScore = score;
      bestAngle = deg;
    }
  }

  return Math.abs(bestAngle) >= 0.5 ? bestAngle : 0;
}

function rotateCanvas(src: HTMLCanvasElement, angleDeg: number): HTMLCanvasElement {
  const dst = document.createElement('canvas');
  dst.width = src.width;
  dst.height = src.height;
  const ctx = dst.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dst.width, dst.height);
  ctx.translate(dst.width / 2, dst.height / 2);
  ctx.rotate((-angleDeg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return dst;
}

/**
 * Detect 5-line musical staves using horizontal projection peaks + geometric regularity verification.
 */
function detectStaves(bin: BinaryImage, pageIndex: number): DetectedStaff[] {
  const { width, height, data } = bin;
  const rowCounts = new Int32Array(height);

  for (let y = 0; y < height; y++) {
    const off = y * width;
    let c = 0;
    for (let x = 0; x < width; x++) c += data[off + x];
    rowCounts[y] = c;
  }

  // Smooth slightly (3-tap) to stabilize anti-aliased staff lines
  let maxRow = 1;
  for (let y = 0; y < height; y++) {
    if (rowCounts[y] > maxRow) maxRow = rowCounts[y];
  }

  // Candidate staff-line rows have strong horizontal coverage (> 32% of page width or > 48% of maxRow)
  const lineThresh = Math.max(width * 0.28, maxRow * 0.45);

  interface PeakRun {
    centerY: number;
    thickness: number;
    strength: number;
  }

  const peaks: PeakRun[] = [];
  let y = 0;
  while (y < height) {
    if (rowCounts[y] >= lineThresh) {
      const start = y;
      let weightedSum = 0;
      let weightTotal = 0;
      let maxStrength = 0;
      while (y < height && rowCounts[y] >= lineThresh * 0.72) {
        weightedSum += y * rowCounts[y];
        weightTotal += rowCounts[y];
        if (rowCounts[y] > maxStrength) maxStrength = rowCounts[y];
        y++;
      }
      const thickness = y - start;
      // Ignore thick solid horizontal bars/banners
      if (thickness <= Math.max(9, height * 0.012)) {
        peaks.push({
          centerY: weightedSum / Math.max(1, weightTotal),
          thickness,
          strength: maxStrength,
        });
      }
    } else {
      y++;
    }
  }

  // Group peaks into valid 5-line staves with consistent spacing
  const staves: DetectedStaff[] = [];
  let i = 0;
  while (i <= peaks.length - 5) {
    // Try starting a 5-line staff at peaks[i]
    const group = [peaks[i]];
    let j = i + 1;
    let expectedSpace = -1;

    while (j < peaks.length && group.length < 5) {
      const gap = peaks[j].centerY - group[group.length - 1].centerY;
      if (expectedSpace < 0) {
        if (gap >= 6 && gap <= 46) {
          expectedSpace = gap;
          group.push(peaks[j]);
        } else if (gap > 46) {
          break;
        }
      } else {
        if (Math.abs(gap - expectedSpace) <= Math.max(2.6, expectedSpace * 0.22)) {
          expectedSpace = (expectedSpace * (group.length - 1) + gap) / group.length;
          group.push(peaks[j]);
        } else if (gap > expectedSpace * 1.35) {
          break;
        }
      }
      j++;
    }

    if (group.length === 5) {
      const lineYs = group.map((g) => g.centerY);
      const staffSpace = (lineYs[4] - lineYs[0]) / 4;
      const lineThickness = Math.max(
        1.5,
        group.reduce((s, g) => s + g.thickness, 0) / 5
      );

      // Estimate leftX & rightX of this staff
      const { leftX, rightX } = findStaffHorizontalBounds(bin, lineYs);

      if (rightX - leftX > width * 0.35) {
        staves.push({
          pageIndex,
          systemIndex: 0,
          staffIndexInSystem: 0,
          clef: 'treble',
          lineYs,
          staffSpace,
          lineThickness,
          leftX,
          rightX,
          barlineXs: [],
        });
        i = j;
        continue;
      }
    }
    i++;
  }

  return staves;
}

function findStaffHorizontalBounds(bin: BinaryImage, lineYs: number[]): { leftX: number; rightX: number } {
  const { width, height, data } = bin;
  const colHits = new Uint8Array(width);

  for (let x = 0; x < width; x++) {
    let linesPresent = 0;
    for (const ly of lineYs) {
      const cy = Math.round(ly);
      let hit = false;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = cy + dy;
        if (yy >= 0 && yy < height && data[yy * width + x]) {
          hit = true;
          break;
        }
      }
      if (hit) linesPresent++;
    }
    colHits[x] = linesPresent >= 3 ? 1 : 0;
  }

  let leftX = 0;
  let rightX = width - 1;
  // Require a run of at least 8 contiguous columns to avoid stray dust speckles
  for (let x = 0; x < width - 10; x++) {
    let sum = 0;
    for (let k = 0; k < 10; k++) sum += colHits[x + k];
    if (sum >= 7) {
      leftX = x;
      break;
    }
  }
  for (let x = width - 1; x >= 10; x--) {
    let sum = 0;
    for (let k = 0; k < 10; k++) sum += colHits[x - k];
    if (sum >= 7) {
      rightX = x;
      break;
    }
  }

  return { leftX, rightX };
}

/**
 * Group detected 5-line staves into systems (Grand Staff pairs or 4-stave open SATB systems).
 */
function groupStavesIntoSystems(
  staves: DetectedStaff[],
  layoutMode: OmrSettings['layoutMode']
): 'grand-staff' | 'four-staves' | 'single-staff' {
  if (staves.length === 0) return 'grand-staff';
  if (staves.length === 1) {
    staves[0].systemIndex = 0;
    staves[0].staffIndexInSystem = 0;
    staves[0].clef = 'treble';
    return 'single-staff';
  }

  // Decide between 2 staves per system (Grand Staff) or 4 staves per system
  let stavesPerSystem = 2;
  if (layoutMode === 'four-staves' && staves.length >= 4) {
    stavesPerSystem = 4;
  } else if (layoutMode === 'auto' && staves.length >= 4 && staves.length % 4 === 0) {
    // Check gap pattern: if gaps[0], gaps[1], gaps[2] are similar and smaller than gaps[3], it's 4-stave SATB
    const gaps: number[] = [];
    for (let i = 0; i < staves.length - 1; i++) {
      gaps.push(staves[i + 1].lineYs[0] - staves[i].lineYs[4]);
    }
    if (gaps.length >= 4) {
      const innerAvg = (gaps[0] + gaps[1] + gaps[2]) / 3;
      const sysBreak = gaps[3];
      const pairBreak = gaps[1];
      if (sysBreak > innerAvg * 1.35 && pairBreak < innerAvg * 1.2) {
        stavesPerSystem = 4;
      }
    }
  }

  for (let i = 0; i < staves.length; i++) {
    const sysIdx = Math.floor(i / stavesPerSystem);
    const inSys = i % stavesPerSystem;
    staves[i].systemIndex = sysIdx;
    staves[i].staffIndexInSystem = inSys;
    if (stavesPerSystem === 4) {
      // Soprano, Contralto, Tenor (treble-8vb or treble), Bajo (bass)
      staves[i].clef = inSys === 3 ? 'bass' : 'treble';
    } else {
      staves[i].clef = inSys === 0 ? 'treble' : 'bass';
    }
  }

  return stavesPerSystem === 4 ? 'four-staves' : 'grand-staff';
}

/**
 * Remove horizontal staff line pixels while preserving vertical stems, noteheads, barlines, and accidentals.
 */
function removeStaffLines(bin: BinaryImage, staves: DetectedStaff[]): BinaryImage {
  const { width, height, data } = bin;
  const cleaned = new Uint8Array(data);

  for (const staff of staves) {
    const maxRun = Math.max(3, Math.ceil(staff.lineThickness * 1.75));
    const xStart = Math.max(0, staff.leftX - 4);
    const xEnd = Math.min(width - 1, staff.rightX + 4);

    for (const ly of staff.lineYs) {
      const centerY = Math.round(ly);
      for (let x = xStart; x <= xEnd; x++) {
        // Measure vertical black run passing through centerY
        let top = centerY;
        while (top > 0 && data[(top - 1) * width + x]) top--;
        let bot = centerY;
        while (bot < height - 1 && data[(bot + 1) * width + x]) bot++;

        if (!data[centerY * width + x]) {
          // Check 1px above/below
          if (centerY > 0 && data[(centerY - 1) * width + x]) {
            top = centerY - 1;
            while (top > 0 && data[(top - 1) * width + x]) top--;
            bot = centerY - 1;
          } else if (centerY < height - 1 && data[(centerY + 1) * width + x]) {
            top = centerY + 1;
            bot = centerY + 1;
            while (bot < height - 1 && data[(bot + 1) * width + x]) bot++;
          } else {
            continue;
          }
        }

        const runHeight = bot - top + 1;
        if (runHeight <= maxRun) {
          for (let yy = top; yy <= bot; yy++) {
            cleaned[yy * width + x] = 0;
          }
        }
      }
    }
  }

  return { width, height, data: cleaned };
}

/**
 * Detect barlines along a staff by finding tall vertical black spans covering the full staff height.
 */
function detectBarlinesForStaff(noStaff: BinaryImage, staff: DetectedStaff): number[] {
  const { width, data } = noStaff;
  const topY = Math.max(0, Math.round(staff.lineYs[0]) - 2);
  const botY = Math.min(noStaff.height - 1, Math.round(staff.lineYs[4]) + 2);
  const staffHeight = Math.max(10, botY - topY);
  const s = staff.staffSpace;

  const headerSkipX = Math.round(staff.leftX + s * 7.5);
  const rawCols: number[] = [];

  for (let x = headerSkipX; x <= staff.rightX + 3; x++) {
    let dark = 0;
    for (let y = topY; y <= botY; y++) {
      if (data[y * width + x]) dark++;
    }
    if (dark >= staffHeight * 0.86) {
      // True barlines have clean white space on BOTH immediate left & right flanks (unlike note stems!)
      const checkW = Math.max(5, Math.round(s * 0.65));
      let leftMass = 0;
      let rightMass = 0;
      const bandTop = topY + Math.round(staffHeight * 0.08);
      const bandBot = botY - Math.round(staffHeight * 0.08);
      const rows = Math.max(1, bandBot - bandTop + 1);
      for (let y = bandTop; y <= bandBot; y++) {
        for (let d = 3; d <= checkW; d++) {
          if (x - d >= 0 && data[y * width + (x - d)]) leftMass++;
          if (x + d < width && data[y * width + (x + d)]) rightMass++;
        }
      }
      const flankArea = Math.max(1, rows * Math.max(1, checkW - 2));
      if (leftMass / flankArea < 0.12 && rightMass / flankArea < 0.12) {
        rawCols.push(x);
      }
    }
  }

  // Merge adjacent columns (within 3.5 * staffSpace) into single barline centers
  const merged: number[] = [];
  for (const col of rawCols) {
    if (merged.length === 0 || col - merged[merged.length - 1] > s * 3.5) {
      merged.push(col);
    } else {
      merged[merged.length - 1] = Math.round((merged[merged.length - 1] + col) / 2);
    }
  }

  // Always include right end of staff as final barline if missing
  if (merged.length === 0 || staff.rightX - merged[merged.length - 1] > s * 4.5) {
    merged.push(staff.rightX);
  }

  return merged;
}

/**
 * Detect actual clef + key signature (+ optional time signature on system 0) boundary for any staff
 * so clefs and key accidentals on System 2, 3, ... are never misread as notes.
 */
function analyzeHeader(
  noStaff: BinaryImage,
  firstStaff: DetectedStaff,
  isFirstSystem = true
): { keyFifths: number; timeSig: TimeSignature; musicStartX: number } {
  const { width, height, data } = noStaff;
  const s = firstStaff.staffSpace;
  const topY = Math.max(0, Math.round(firstStaff.lineYs[0] - s * 1.3));
  const botY = Math.min(height - 1, Math.round(firstStaff.lineYs[4] + s * 1.3));

  const scanStartX = Math.max(0, firstStaff.leftX + Math.round(s * 0.4));
  const scanEndX = Math.min(firstStaff.rightX, Math.round(firstStaff.leftX + s * 14.0));

  const colDark = new Int32Array(Math.max(1, scanEndX - scanStartX + 1));
  for (let x = scanStartX; x <= scanEndX; x++) {
    let c = 0;
    for (let y = topY; y <= botY; y++) {
      if (data[y * width + x]) c++;
    }
    colDark[x - scanStartX] = c;
  }

  interface GlyphSpan {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    cx: number;
    cy: number;
    w: number;
    h: number;
    pixels: number;
  }

  const allGlyphs: GlyphSpan[] = [];
  let gx = 0;
  while (gx < colDark.length) {
    if (colDark[gx] >= 2) {
      const start = gx;
      while (gx < colDark.length && colDark[gx] >= 1) gx++;
      const x0 = scanStartX + start;
      const x1 = scanStartX + gx - 1;
      const w = x1 - x0 + 1;
      if (w >= Math.max(3, s * 0.22) && w <= s * 3.8) {
        let y0 = botY;
        let y1 = topY;
        let pixels = 0;
        for (let y = topY; y <= botY; y++) {
          for (let x = x0; x <= x1; x++) {
            if (data[y * width + x]) {
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
              pixels++;
            }
          }
        }
        const h = y1 - y0 + 1;
        if (h >= s * 0.7 && pixels >= s * 1.2) {
          allGlyphs.push({
            x0,
            x1,
            y0,
            y1,
            cx: (x0 + x1) / 2,
            cy: (y0 + y1) / 2,
            w,
            h,
            pixels,
          });
        }
      }
    } else {
      gx++;
    }
  }

  // 1. Identify the Clef glyph (first substantial glyph near leftX)
  let clefEndX = Math.round(firstStaff.leftX + s * 3.6);
  const postClefGlyphs: GlyphSpan[] = [];
  let foundClef = false;

  for (const g of allGlyphs) {
    if (!foundClef && g.x0 < firstStaff.leftX + s * 4.2 && g.h >= s * 2.2) {
      clefEndX = Math.max(clefEndX, g.x1 + Math.round(s * 0.2));
      foundClef = true;
      continue;
    }
    if (g.x0 >= clefEndX - s * 0.2) {
      postClefGlyphs.push(g);
    }
  }

  // 2. Separate key signature accidentals vs time signature glyph
  let timeSigGlyph: GlyphSpan | null = null;
  const accidentalGlyphs: GlyphSpan[] = [];
  const trebleBottom = firstStaff.lineYs[4];
  const SHARP_STEPS = [8, 5, 9, 6, 3, 7];
  const FLAT_STEPS = [4, 7, 3, 6, 2, 5];

  for (const g of postClefGlyphs) {
    const prevRight =
      accidentalGlyphs.length > 0 ? accidentalGlyphs[accidentalGlyphs.length - 1].x1 : clefEndX;
    const gap = g.x0 - prevRight;

    // Stop if we hit a wide gap into the musical notes
    if (gap > s * 2.6 && (timeSigGlyph || !isFirstSystem || accidentalGlyphs.length > 0)) break;

    if (
      isFirstSystem &&
      !timeSigGlyph &&
      g.h >= s * 2.9 &&
      g.h <= s * 4.8 &&
      g.w >= s * 0.6 &&
      g.w <= s * 2.2
    ) {
      const midY = firstStaff.lineYs[2];
      let topMass = 0;
      let botMass = 0;
      for (let y = g.y0; y <= g.y1; y++) {
        for (let x = g.x0; x <= g.x1; x++) {
          if (data[y * width + x]) {
            if (y < midY) topMass++;
            else botMass++;
          }
        }
      }
      if (topMass > g.pixels * 0.28 && botMass > g.pixels * 0.28) {
        timeSigGlyph = g;
        break;
      }
    }

    // Key signature accidentals must be narrow & positioned near canonical sharp or flat staff steps
    if (
      accidentalGlyphs.length < 6 &&
      g.h >= s * 1.15 &&
      g.h <= s * 2.85 &&
      g.w >= s * 0.28 &&
      g.w <= s * 1.25 &&
      gap <= s * 2.2
    ) {
      const step = Math.round((trebleBottom - g.cy) / (s / 2));
      const idx = accidentalGlyphs.length;
      const matchesSharpPos = Math.abs(step - SHARP_STEPS[idx]) <= 1;
      const matchesFlatPos = Math.abs(step - FLAT_STEPS[idx]) <= 1;
      if (matchesSharpPos || matchesFlatPos) {
        accidentalGlyphs.push(g);
      } else {
        // Not at a canonical key signature step -> probably first note!
        break;
      }
    }
  }

  let keyFifths = 0;
  if (accidentalGlyphs.length > 0) {
    let sharpScore = 0;
    let flatScore = 0;
    accidentalGlyphs.forEach((ag, idx) => {
      const step = Math.round((trebleBottom - ag.cy) / (s / 2));
      if (Math.abs(step - SHARP_STEPS[idx]) <= 1) sharpScore += 2;
      if (Math.abs(step - FLAT_STEPS[idx]) <= 1) flatScore += 2;

      let upper = 0;
      let lower = 0;
      for (let y = ag.y0; y <= ag.y1; y++) {
        for (let x = ag.x0; x <= ag.x1; x++) {
          if (data[y * width + x]) {
            if (y < ag.cy) upper++;
            else lower++;
          }
        }
      }
      if (lower > upper * 1.28) flatScore += 1;
      else sharpScore += 1;
    });
    const count = Math.min(6, accidentalGlyphs.length);
    keyFifths = sharpScore >= flatScore ? count : -count;
  }

  let timeSig: TimeSignature = { numerator: 4, denominator: 4 };
  if (timeSigGlyph) {
    const midY = firstStaff.lineYs[2];
    let leftUpper = 0;
    let rightUpper = 0;
    let midHorizBand = 0;
    const cx = timeSigGlyph.cx;
    const upperMidY = (timeSigGlyph.y0 + midY) / 2;

    for (let y = timeSigGlyph.y0; y < midY; y++) {
      for (let x = timeSigGlyph.x0; x <= timeSigGlyph.x1; x++) {
        if (data[y * width + x]) {
          if (x < cx) leftUpper++;
          else rightUpper++;
          if (Math.abs(y - upperMidY) < s * 0.25) midHorizBand++;
        }
      }
    }
    const upperTotal = Math.max(1, leftUpper + rightUpper);
    if (rightUpper / upperTotal > 0.63 && midHorizBand / upperTotal < 0.24) {
      timeSig = { numerator: 3, denominator: 4 };
    } else if (leftUpper / upperTotal > 0.56) {
      timeSig = { numerator: 6, denominator: 8 };
    } else {
      timeSig = { numerator: 4, denominator: 4 };
    }
  }

  const musicStartX = timeSigGlyph
    ? Math.round(timeSigGlyph.x1 + s * 0.85)
    : accidentalGlyphs.length > 0
      ? Math.round(accidentalGlyphs[accidentalGlyphs.length - 1].x1 + s * 1.0)
      : Math.round(clefEndX + s * 1.1);

  return { keyFifths, timeSig, musicStartX };
}

/**
 * Identify horizontal rows outside a staff that contain printed lyrics/text
 * (characterized by high horizontal ink-transition density) so text letters like 'o'/'a'/'e'
 * are never misdetected as noteheads.
 */
function buildLyricRowMask(noStaff: BinaryImage, staff: DetectedStaff, yMin: number, yMax: number): Uint8Array {
  const { width, data } = noStaff;
  const s = staff.staffSpace;
  const mask = new Uint8Array(noStaff.height);
  const staffTopSafe = staff.lineYs[0] - s * 0.7;
  const staffBotSafe = staff.lineYs[4] + s * 0.7;
  const x0 = Math.max(0, staff.leftX);
  const x1 = Math.min(width - 1, staff.rightX);
  const spanW = Math.max(1, x1 - x0);

  for (let y = yMin; y <= yMax; y++) {
    // Never mask rows inside the 5 staff lines
    if (y >= staffTopSafe && y <= staffBotSafe) continue;

    let transitions = 0;
    let prev = 0;
    const rowOff = y * width;
    for (let x = x0; x <= x1; x++) {
      const cur = data[rowOff + x];
      if (cur !== prev) {
        transitions++;
        prev = cur;
      }
    }
    // Printed lyrics across a staff produce > 26 transitions per 1000px (dense letters);
    // ledger-line notes produce very sparse transitions.
    if (transitions > Math.max(22, (spanW / 1000) * 28)) {
      for (let dy = -Math.round(s * 0.55); dy <= Math.round(s * 0.55); dy++) {
        const yy = y + dy;
        if (yy >= 0 && yy < noStaff.height && (yy < staffTopSafe || yy > staffBotSafe)) {
          mask[yy] = 1;
        }
      }
    }
  }
  return mask;
}

/**
 * Detect filled and hollow elliptical noteheads along a single staff, along with stem direction,
 * beams/flags, augmentation dots, and local accidentals.
 */
function detectNoteheadsOnStaff(
  noStaff: BinaryImage,
  origBin: BinaryImage,
  staff: DetectedStaff,
  allPageStaves: DetectedStaff[],
  musicStartX: number,
  sensitivity: number,
  keyFifths: number
): DetectedOmrNote[] {
  const { width, height, data } = noStaff;
  const s = staff.staffSpace;

  const rx = Math.max(3, Math.round(s * 0.58));
  const ry = Math.max(2, Math.round(s * 0.43));
  const innerRx = Math.max(1, Math.round(s * 0.30));
  const innerRy = Math.max(1, Math.round(s * 0.20));

  // Clamp vertical search safely so we never spill into adjacent staves' lyrics or notes
  const staffIdx = allPageStaves.indexOf(staff);
  const prevStaff = staffIdx > 0 ? allPageStaves[staffIdx - 1] : null;
  const nextStaff = staffIdx >= 0 && staffIdx < allPageStaves.length - 1 ? allPageStaves[staffIdx + 1] : null;

  const upperLimitFromPrev = prevStaff
    ? Math.round((prevStaff.lineYs[4] + staff.lineYs[0]) / 2 + s * 0.5)
    : 0;
  const lowerLimitFromNext = nextStaff
    ? Math.round((staff.lineYs[4] + nextStaff.lineYs[0]) / 2 - s * 0.5)
    : height - 1;

  const yMin = Math.max(ry + 2, upperLimitFromPrev, Math.round(staff.lineYs[0] - s * 2.1));
  const yMax = Math.min(height - ry - 3, lowerLimitFromNext, Math.round(staff.lineYs[4] + s * 2.1));
  const xMin = Math.max(rx + 2, musicStartX);
  const xMax = Math.min(width - rx - 3, staff.rightX - Math.round(s * 0.5));

  const lyricMask = buildLyricRowMask(noStaff, staff, yMin, yMax);

  // Precompute elliptical kernel offsets for fast filled + hollow scoring
  const innerOffsets: Array<[number, number]> = [];
  const filledRingOffsets: Array<[number, number]> = [];
  const hollowRimTop: Array<[number, number]> = [];
  const hollowRimBot: Array<[number, number]> = [];
  const hollowRimLeft: Array<[number, number]> = [];
  const hollowRimRight: Array<[number, number]> = [];
  const outerHaloOffsets: Array<[number, number]> = [];

  for (let dy = -ry - 3; dy <= ry + 3; dy++) {
    for (let dx = -rx - 3; dx <= rx + 3; dx++) {
      const nOuter = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      const nInner = (dx * dx) / (innerRx * innerRx) + (dy * dy) / (innerRy * innerRy);

      if (nInner <= 1.0) {
        innerOffsets.push([dx, dy]);
      } else if (nOuter <= 1.0) {
        filledRingOffsets.push([dx, dy]);
      } else if (nOuter > 1.35 && nOuter <= 2.05) {
        outerHaloOffsets.push([dx, dy]);
      }

      if (nOuter >= 0.52 && nOuter <= 1.28) {
        if (Math.abs(dy / ry) >= Math.abs(dx / rx)) {
          if (dy < 0) hollowRimTop.push([dx, dy]);
          else hollowRimBot.push([dx, dy]);
        } else {
          if (dx < 0) hollowRimLeft.push([dx, dy]);
          else hollowRimRight.push([dx, dy]);
        }
      }
    }
  }

  const totalBodyPts = Math.max(1, innerOffsets.length + filledRingOffsets.length);
  const innerLen = Math.max(1, innerOffsets.length);
  const haloLen = Math.max(1, outerHaloOffsets.length);
  const rimTopLen = Math.max(1, hollowRimTop.length);
  const rimBotLen = Math.max(1, hollowRimBot.length);
  const rimLeftLen = Math.max(1, hollowRimLeft.length);
  const rimRightLen = Math.max(1, hollowRimRight.length);

  const isNearBarline = (x: number) =>
    staff.barlineXs.some((bx) => Math.abs(x - bx) < s * 0.55);

  interface Candidate {
    x: number;
    y: number;
    score: number;
    isHollow: boolean;
  }

  const candidates: Candidate[] = [];
  const stepPx = Math.max(2, Math.round(s * 0.14));
  const filledMinFill = 0.78 - (sensitivity - 0.5) * 0.24;
  const hollowMinRim = 0.38 - (sensitivity - 0.5) * 0.12;

  for (let y = yMin; y <= yMax; y += stepPx) {
    if (lyricMask[y]) continue;
    for (let x = xMin; x <= xMax; x += stepPx) {
      if (isNearBarline(x)) continue;

      let innerDark = 0;
      for (let k = 0; k < innerOffsets.length; k++) {
        const [dx, dy] = innerOffsets[k];
        if (data[(y + dy) * width + (x + dx)]) innerDark++;
      }

      let ringDark = 0;
      for (let k = 0; k < filledRingOffsets.length; k++) {
        const [dx, dy] = filledRingOffsets[k];
        if (data[(y + dy) * width + (x + dx)]) ringDark++;
      }

      const innerRatio = innerDark / innerLen;
      const bodyRatio = (innerDark + ringDark) / totalBodyPts;

      const isFilled = bodyRatio >= filledMinFill && innerRatio >= 0.72;
      let isHollow = false;
      let hollowRimScore = 0;

      if (!isFilled && innerRatio <= 0.34) {
        let qTop = 0;
        let qBot = 0;
        let qLeft = 0;
        let qRight = 0;
        for (let k = 0; k < hollowRimTop.length; k++) {
          const [dx, dy] = hollowRimTop[k];
          if (origBin.data[(y + dy) * width + (x + dx)]) qTop++;
        }
        for (let k = 0; k < hollowRimBot.length; k++) {
          const [dx, dy] = hollowRimBot[k];
          if (origBin.data[(y + dy) * width + (x + dx)]) qBot++;
        }
        for (let k = 0; k < hollowRimLeft.length; k++) {
          const [dx, dy] = hollowRimLeft[k];
          if (origBin.data[(y + dy) * width + (x + dx)]) qLeft++;
        }
        for (let k = 0; k < hollowRimRight.length; k++) {
          const [dx, dy] = hollowRimRight[k];
          if (origBin.data[(y + dy) * width + (x + dx)]) qRight++;
        }

        const rTop = qTop / rimTopLen;
        const rBot = qBot / rimBotLen;
        const rLeft = qLeft / rimLeftLen;
        const rRight = qRight / rimRightLen;

        if (
          rTop >= hollowMinRim * 0.85 &&
          rBot >= hollowMinRim * 0.85 &&
          rLeft >= hollowMinRim * 0.7 &&
          rRight >= hollowMinRim * 0.7
        ) {
          isHollow = true;
          hollowRimScore = (rTop + rBot + rLeft + rRight) / 4;
        }
      }

      if (!isFilled && !isHollow) continue;

      let haloDark = 0;
      for (let k = 0; k < outerHaloOffsets.length; k++) {
        const [dx, dy] = outerHaloOffsets[k];
        if (data[(y + dy) * width + (x + dx)]) haloDark++;
      }
      const haloRatio = haloDark / haloLen;
      if (haloRatio > 0.44) continue;

      if (isFilled) {
        let vertSpan = 0;
        for (let dy = -ry; dy <= ry; dy++) {
          if (data[(y + dy) * width + x] || origBin.data[(y + dy) * width + x]) vertSpan++;
        }
        let horizSpan = 0;
        for (let dx = -rx; dx <= rx; dx++) {
          if (data[y * width + (x + dx)] || origBin.data[y * width + (x + dx)]) horizSpan++;
        }
        if (vertSpan < ry * 1.4 || horizSpan < rx * 1.45) continue;
      }

      const score = isFilled
        ? bodyRatio * 1.15 - haloRatio * 0.65
        : Math.min(0.96, hollowRimScore * 1.25 + (1 - innerRatio) * 0.35 - haloRatio * 0.55);

      candidates.push({ x, y, score, isHollow });
    }
  }

  // Non-Maximum Suppression (NMS)
  candidates.sort((a, b) => b.score - a.score);
  const kept: Candidate[] = [];
  const minDx = s * 0.85;
  const minDy = s * 0.72;

  for (const cand of candidates) {
    let overlaps = false;
    for (const k of kept) {
      if (Math.abs(cand.x - k.x) < minDx && Math.abs(cand.y - k.y) < minDy) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) kept.push(cand);
  }

  const results: DetectedOmrNote[] = [];
  const bottomLineY = staff.lineYs[4];

  for (const c of kept) {
    const diatonicStep = Math.round((bottomLineY - c.y) / (s / 2));
    if (diatonicStep < -4 || diatonicStep > 12) continue;

    const stemInfo = detectStemAndBeam(origBin, c.x, c.y, s, rx);

    // STRICT MUSICAL VALIDATION (eliminates lyric letters, dynamics, punctuation, and scan noise):
    // 1. Every filled notehead (quarter/eighth/sixteenth) MUST have a vertical stem!
    if (!c.isHollow && stemInfo.stemDir === 'none') continue;
    // 2. A stemless hollow notehead (whole note) MUST sit cleanly on or immediately touching the 5-line staff
    //    (never floating in the lyric band above/below the staff!).
    if (c.isHollow && stemInfo.stemDir === 'none' && (diatonicStep < -1 || diatonicStep > 9)) continue;

    const isDotted = detectAugmentationDot(noStaff, c.x, c.y, s, rx);
    const accidental = detectLocalAccidental(noStaff, c.x, c.y, s, rx);

    let durationBeats = 1;
    if (c.isHollow) {
      durationBeats = stemInfo.stemDir === 'none' ? 4 : 2;
    } else {
      durationBeats = stemInfo.hasBeamOrFlag ? 0.5 : 1;
    }
    if (isDotted) durationBeats *= 1.5;

    const pitch = staffStepToMidi(
      staff.clef,
      diatonicStep,
      keyFifths,
      accidental !== 0 ? accidental : null
    );

    let voice: VoiceId;
    if (staff.clef === 'treble') {
      voice = stemInfo.stemDir === 'down' ? 'contralto' : 'soprano';
    } else {
      voice = stemInfo.stemDir === 'up' ? 'tenor' : 'bajo';
    }

    results.push({
      pageIndex: staff.pageIndex,
      systemIndex: staff.systemIndex,
      staffClef: staff.clef,
      x: c.x,
      y: c.y,
      w: rx * 2,
      h: ry * 2,
      isHollow: c.isHollow,
      stemDir: stemInfo.stemDir,
      hasFlagOrBeam: stemInfo.hasBeamOrFlag,
      isDotted,
      accidental,
      diatonicStep,
      pitch,
      voice,
      durationBeats,
      startBeat: 0,
      confidence: Math.max(0.4, Math.min(0.99, c.score)),
    });
  }

  return results.sort((a, b) => a.x - b.x || a.y - b.y);
}

function detectStemAndBeam(
  origBin: BinaryImage,
  cx: number,
  cy: number,
  s: number,
  rx: number
): { stemDir: 'up' | 'down' | 'none'; hasBeamOrFlag: boolean } {
  const { width, height, data } = origBin;
  const stemLen = Math.round(s * 2.35);

  const measureVertical = (
    xStart: number,
    xEnd: number,
    yStart: number,
    yEnd: number
  ): { ratio: number; bestX: number } => {
    const y0 = Math.max(0, Math.min(yStart, yEnd));
    const y1 = Math.min(height - 1, Math.max(yStart, yEnd));
    const total = Math.max(1, y1 - y0 + 1);
    let bestRatio = 0;
    let bestX = Math.round((xStart + xEnd) / 2);

    for (let x = Math.max(0, xStart); x <= Math.min(width - 1, xEnd); x++) {
      let dark = 0;
      for (let y = y0; y <= y1; y++) {
        if (
          data[y * width + x] ||
          (x > 0 && data[y * width + x - 1]) ||
          (x < width - 1 && data[y * width + x + 1])
        ) {
          dark++;
        }
      }
      const r = dark / total;
      if (r > bestRatio) {
        bestRatio = r;
        bestX = x;
      }
    }
    return { ratio: bestRatio, bestX };
  };

  // Standard stems + shared chord stems (when S+A or T+B share a single stem)
  const upRight = measureVertical(
    Math.round(cx + rx * 0.42),
    Math.round(cx + rx * 1.25),
    cy - stemLen,
    cy - Math.round(s * 0.3)
  );
  const downLeft = measureVertical(
    Math.round(cx - rx * 1.25),
    Math.round(cx - rx * 0.42),
    cy + Math.round(s * 0.3),
    cy + stemLen
  );
  const downRight = measureVertical(
    Math.round(cx + rx * 0.42),
    Math.round(cx + rx * 1.25),
    cy + Math.round(s * 0.3),
    cy + stemLen
  );
  const upLeft = measureVertical(
    Math.round(cx - rx * 1.25),
    Math.round(cx - rx * 0.42),
    cy - stemLen,
    cy - Math.round(s * 0.3)
  );

  let stemDir: 'up' | 'down' | 'none' = 'none';
  let tipX = cx;
  let tipY = cy;

  const bestUp = Math.max(upRight.ratio, upLeft.ratio * 0.96);
  const bestDown = Math.max(downLeft.ratio, downRight.ratio * 0.96);

  if (bestUp >= 0.70 && bestUp >= bestDown) {
    stemDir = 'up';
    tipX = upRight.ratio >= upLeft.ratio ? upRight.bestX : upLeft.bestX;
    tipY = Math.max(0, cy - Math.round(s * 2.9));
  } else if (bestDown >= 0.70) {
    stemDir = 'down';
    tipX = downLeft.ratio >= downRight.ratio ? downLeft.bestX : downRight.bestX;
    tipY = Math.min(height - 1, cy + Math.round(s * 2.9));
  }

  let hasBeamOrFlag = false;
  if (stemDir !== 'none') {
    const checkY0 = Math.max(0, tipY - Math.round(s * 0.7));
    const checkY1 = Math.min(height - 1, tipY + Math.round(s * 0.7));
    const checkX0 = Math.max(0, tipX - Math.round(s * 0.9));
    const checkX1 = Math.min(width - 1, tipX + Math.round(s * 1.1));
    let beamCols = 0;
    const totalCols = Math.max(1, checkX1 - checkX0 + 1);
    for (let x = checkX0; x <= checkX1; x++) {
      let colThick = 0;
      for (let y = checkY0; y <= checkY1; y++) {
        if (data[y * width + x]) colThick++;
      }
      if (colThick >= Math.max(3, Math.round(s * 0.28))) beamCols++;
    }
    if (beamCols / totalCols >= 0.58) hasBeamOrFlag = true;
  }

  return { stemDir, hasBeamOrFlag };
}

function detectAugmentationDot(
  noStaff: BinaryImage,
  cx: number,
  cy: number,
  s: number,
  rx: number
): boolean {
  const { width, height, data } = noStaff;
  const x0 = Math.min(width - 1, Math.round(cx + rx * 1.3));
  const x1 = Math.min(width - 1, Math.round(cx + rx * 2.15));
  const y0 = Math.max(0, Math.round(cy - s * 0.42));
  const y1 = Math.min(height - 1, Math.round(cy + s * 0.42));

  let dark = 0;
  let area = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      area++;
      if (data[y * width + x]) dark++;
    }
  }
  const fill = dark / Math.max(1, area);
  return dark >= 5 && fill >= 0.14 && fill <= 0.42;
}

/**
 * Strict isolated local accidental detector: verifies clear white separation from both the notehead
 * and any preceding stem/barline so stems never trigger random out-of-key semitone shifts!
 */
function detectLocalAccidental(
  noStaff: BinaryImage,
  cx: number,
  cy: number,
  s: number,
  rx: number
): -1 | 0 | 1 {
  const { width, height, data } = noStaff;
  // Require a clean white gutter between notehead left edge and accidental box
  const gutterX = Math.max(0, Math.round(cx - rx * 1.35));
  let gutterDark = 0;
  const gy0 = Math.max(0, Math.round(cy - s * 0.4));
  const gy1 = Math.min(height - 1, Math.round(cy + s * 0.4));
  for (let y = gy0; y <= gy1; y++) {
    if (data[y * width + gutterX]) gutterDark++;
  }
  if (gutterDark > 2) return 0; // stem or adjacent note is touching left side -> NOT an accidental

  const x0 = Math.max(0, Math.round(cx - rx * 2.85));
  const x1 = Math.max(0, Math.round(cx - rx * 1.5));
  const y0 = Math.max(0, Math.round(cy - s * 1.15));
  const y1 = Math.min(height - 1, Math.round(cy + s * 1.15));
  if (x1 <= x0 + 3 || y1 <= y0 + 6) return 0;

  // Reject tall continuous vertical strokes (stems / barlines extending above & below the accidental box)
  let overflowTop = 0;
  let overflowBot = 0;
  for (let x = x0; x <= x1; x++) {
    if (y0 - 3 >= 0 && data[(y0 - 3) * width + x]) overflowTop++;
    if (y1 + 3 < height && data[(y1 + 3) * width + x]) overflowBot++;
  }
  if (overflowTop >= 2 || overflowBot >= 2) return 0;

  let upperDark = 0;
  let lowerDark = 0;
  let verticalColsWithInk = 0;

  for (let x = x0; x <= x1; x++) {
    let colDark = 0;
    for (let y = y0; y <= y1; y++) {
      if (data[y * width + x]) {
        colDark++;
        if (y < cy) upperDark++;
        else lowerDark++;
      }
    }
    if (colDark >= s * 1.05) verticalColsWithInk++;
  }

  const totalDark = upperDark + lowerDark;
  const boxArea = (x1 - x0 + 1) * (y1 - y0 + 1);
  const density = totalDark / Math.max(1, boxArea);

  if (density < 0.22 || density > 0.52 || verticalColsWithInk < 1) return 0;
  if (verticalColsWithInk >= 2 && Math.abs(upperDark - lowerDark) < totalDark * 0.20) return 1;
  if (verticalColsWithInk === 1 && lowerDark > upperDark * 1.45) return -1;
  return 0;
}

/**
 * Align detected notes across all staves of a system into synchronized musical beats & clean SATB voices.
 * Supports anacrusis (pickup measures) and preserves per-voice note durations.
 */
function alignSystemNotesToBeats(
  systemStaves: DetectedStaff[],
  systemNotes: DetectedOmrNote[],
  layout: 'grand-staff' | 'four-staves' | 'single-staff',
  timeSig: TimeSignature,
  systemStartBeat: number,
  musicStartX: number,
  isVeryFirstSystem: boolean
): { events: NoteEvent[]; nextBeat: number } {
  const beatsPerMeasure = getBeatsPerMeasure(timeSig);
  const s = systemStaves[0]?.staffSpace ?? 16;

  const allBarXs = systemStaves.flatMap((st) => st.barlineXs).sort((a, b) => a - b);
  const unifiedBars: number[] = [];
  for (const bx of allBarXs) {
    if (unifiedBars.length === 0 || bx - unifiedBars[unifiedBars.length - 1] > s * 2.6) {
      unifiedBars.push(bx);
    } else {
      unifiedBars[unifiedBars.length - 1] = Math.round((unifiedBars[unifiedBars.length - 1] + bx) / 2);
    }
  }

  const validBars = unifiedBars.filter((bx) => bx > musicStartX + s * 2.5);
  const measureBounds: Array<{ x0: number; x1: number }> = [];
  let prevX = musicStartX;
  for (const bx of validBars) {
    measureBounds.push({ x0: prevX, x1: bx });
    prevX = bx;
  }
  if (measureBounds.length === 0) {
    measureBounds.push({
      x0: musicStartX,
      x1: systemStaves[0]?.rightX ?? musicStartX + 800,
    });
  }

  const widths = measureBounds.map((m) => m.x1 - m.x0).sort((a, b) => a - b);
  const medianMeasureW = widths[Math.floor(widths.length / 2)] || 300;

  const events: NoteEvent[] = [];
  let noteCounter = 1;
  let runningBeat = systemStartBeat;

  measureBounds.forEach((mb, mIdx) => {
    const mNotes = systemNotes.filter((n) => n.x >= mb.x0 - s * 0.4 && n.x < mb.x1 + s * 0.4);
    if (mNotes.length === 0) {
      runningBeat += beatsPerMeasure;
      return;
    }

    mNotes.sort((a, b) => a.x - b.x || a.y - b.y);
    const columns: DetectedOmrNote[][] = [];
    for (const n of mNotes) {
      const lastCol = columns[columns.length - 1];
      if (lastCol && Math.abs(n.x - lastCol[0].x) <= s * 1.35) {
        lastCol.push(n);
      } else {
        columns.push([n]);
      }
    }

    const colDurs = columns.map((col) => {
      const durs = col.map((n) => n.durationBeats).sort((a, b) => a - b);
      return durs[0]; // shortest moving voice governs column advance step
    });
    const sumDur = colDurs.reduce((a, b) => a + b, 0);

    // Detect anacrusis (pickup measure) at start of piece: narrow first bar with <= 2 beats
    const isPickup =
      isVeryFirstSystem &&
      mIdx === 0 &&
      measureBounds.length > 1 &&
      (mb.x1 - mb.x0 < medianMeasureW * 0.58 || (columns.length <= 2 && sumDur <= beatsPerMeasure * 0.55));

    const measureBeats = isPickup ? Math.max(0.5, Math.min(beatsPerMeasure - 0.5, sumDur)) : beatsPerMeasure;
    const exactMatch = Math.abs(sumDur - measureBeats) <= 0.51;

    let cursorBeat = 0;
    const mWidth = Math.max(1, mb.x1 - mb.x0);
    const measureEvents: NoteEvent[] = [];

    columns.forEach((col, colIdx) => {
      let beatInMeasure: number;
      if (exactMatch) {
        beatInMeasure = cursorBeat;
        cursorBeat += colDurs[colIdx];
      } else {
        const avgX = col.reduce((sum, n) => sum + n.x, 0) / col.length;
        const rel = Math.max(0, Math.min(0.95, (avgX - mb.x0 - s * 0.5) / Math.max(1, mWidth - s * 1.0)));
        beatInMeasure = Math.round(rel * measureBeats * 2) / 2;
      }

      const nextBeatInMeasure =
        colIdx < columns.length - 1
          ? exactMatch
            ? beatInMeasure + colDurs[colIdx]
            : Math.max(
                beatInMeasure + 0.5,
                Math.round(
                  Math.max(
                    0,
                    Math.min(
                      1,
                      (columns[colIdx + 1].reduce((sum, n) => sum + n.x, 0) / columns[colIdx + 1].length -
                        mb.x0 -
                        s * 0.5) /
                        Math.max(1, mWidth - s * 1.0)
                    )
                  ) *
                    measureBeats *
                    2
                ) / 2
              )
          : measureBeats;

      const defaultColDur = Math.max(
        0.5,
        Math.min(measureBeats - beatInMeasure, exactMatch ? colDurs[colIdx] : nextBeatInMeasure - beatInMeasure)
      );

      if (layout === 'four-staves') {
        const voiceMap: VoiceId[] = ['soprano', 'contralto', 'tenor', 'bajo'];
        for (const n of col) {
          const st = systemStaves.find((stItem) => Math.abs(n.y - stItem.lineYs[2]) < stItem.staffSpace * 4);
          if (st) n.voice = voiceMap[Math.min(3, st.staffIndexInSystem)];
        }
      } else {
        const trebleCol = col.filter((n) => n.staffClef === 'treble').sort((a, b) => b.pitch - a.pitch);
        const bassCol = col.filter((n) => n.staffClef === 'bass').sort((a, b) => b.pitch - a.pitch);

        if (trebleCol.length >= 2) {
          trebleCol[0].voice = 'soprano';
          for (let k = 1; k < trebleCol.length; k++) trebleCol[k].voice = 'contralto';
        } else if (trebleCol.length === 1) {
          trebleCol[0].voice = trebleCol[0].stemDir === 'down' ? 'contralto' : 'soprano';
        }

        if (bassCol.length >= 2) {
          bassCol[0].voice = 'tenor';
          for (let k = 1; k < bassCol.length; k++) bassCol[k].voice = 'bajo';
        } else if (bassCol.length === 1) {
          bassCol[0].voice = bassCol[0].stemDir === 'up' ? 'tenor' : 'bajo';
        }
      }

      const absStartBeat = runningBeat + beatInMeasure;
      const emittedVoices = new Set<VoiceId>();
      for (const n of col) {
        if (emittedVoices.has(n.voice)) continue;
        emittedVoices.add(n.voice);

        // Preserve individual voice duration (e.g. held half note against moving quarters) within measure
        const ownDur = Math.max(
          defaultColDur,
          Math.min(measureBeats - beatInMeasure, n.durationBeats)
        );
        n.startBeat = absStartBeat;
        n.durationBeats = ownDur;

        measureEvents.push({
          id: `omr_p${n.pageIndex}_s${n.systemIndex}_${noteCounter++}`,
          voice: n.voice,
          pitch: n.pitch,
          startBeat: Math.round(absStartBeat * 16) / 16,
          durationBeats: Math.max(0.25, Math.round(ownDur * 16) / 16),
          velocity: n.voice === 'soprano' ? 98 : 90,
          pageIndex: n.pageIndex,
          bbox: { x: n.x - n.w / 2, y: n.y - n.h / 2, w: n.w, h: n.h },
        });
      }
    });

    // Trim any per-voice duration that overlaps the next note in that same voice inside this measure
    const voicesList: VoiceId[] = ['soprano', 'contralto', 'tenor', 'bajo'];
    for (const v of voicesList) {
      const vn = measureEvents.filter((e) => e.voice === v).sort((a, b) => a.startBeat - b.startBeat);
      for (let i = 0; i < vn.length - 1; i++) {
        const gap = vn[i + 1].startBeat - vn[i].startBeat;
        if (gap > 0 && vn[i].durationBeats > gap) {
          vn[i].durationBeats = gap;
        }
      }
    }

    events.push(...measureEvents);
    runningBeat += measureBeats;
  });

  return {
    events,
    nextBeat: runningBeat,
  };
}

/**
 * Run the full autonomous OMR pipeline across one or more rendered sheet music pages.
 */
export async function runAutonomousOmr(
  pages: RenderedSheetPage[],
  title: string,
  sourceType: 'omr-pdf' | 'omr-image',
  settings: OmrSettings,
  onProgress?: (stage: string, pct: number) => void
): Promise<ScoreData> {
  const omrPages: OmrPageResult[] = [];
  const warnings: string[] = [];

  let detectedKeyFifths = 0;
  let detectedTimeSignature: TimeSignature = { numerator: 4, denominator: 4 };
  let detectedLayout: 'grand-staff' | 'four-staves' | 'single-staff' = 'grand-staff';
  let globalBeatCursor = 0;
  let totalStaves = 0;
  let totalSystems = 0;
  const allEvents: NoteEvent[] = [];
  const allDetectedNotes: DetectedOmrNote[] = [];

  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const page = pages[pIdx];
    const basePct = (pIdx / pages.length) * 100;
    onProgress?.(`Preprocesando página ${pIdx + 1} de ${pages.length}...`, basePct + 8);
    await yieldToUi();

    // 1. Initial binarization & deskew check
    let workingCanvas = page.canvas;
    let bin = binarizeCanvas(workingCanvas, settings.thresholdBias);
    const deskewAngleDeg = estimateDeskewAngle(bin);
    if (deskewAngleDeg !== 0) {
      workingCanvas = rotateCanvas(workingCanvas, deskewAngleDeg);
      bin = binarizeCanvas(workingCanvas, settings.thresholdBias);
    }

    onProgress?.(`Detectando pentagramas y claves (pág. ${pIdx + 1})...`, basePct + 25);
    await yieldToUi();

    // 2. Detect staves & group systems
    const staves = detectStaves(bin, pIdx);
    const pageLayout = groupStavesIntoSystems(staves, settings.layoutMode);
    if (pIdx === 0) detectedLayout = pageLayout;

    if (staves.length === 0) {
      warnings.push(`Página ${pIdx + 1}: no se detectaron pentagramas claros. Prueba ajustar el umbral de contraste OMR.`);
      omrPages.push({
        pageIndex: pIdx,
        width: workingCanvas.width,
        height: workingCanvas.height,
        imageUrl: workingCanvas.toDataURL('image/png'),
        deskewAngleDeg,
        staves: [],
        detectedNotes: [],
      });
      continue;
    }

    totalStaves += staves.length;
    const noStaff = removeStaffLines(bin, staves);

    // 3. Header analysis on first page
    let firstSystemMusicStartX = Math.round(staves[0].leftX + staves[0].staffSpace * 6.0);
    if (pIdx === 0) {
      const header = analyzeHeader(noStaff, staves[0]);
      detectedKeyFifths = settings.keyOverride === 'auto' ? header.keyFifths : settings.keyOverride;
      if (settings.timeSigOverride === 'auto') {
        detectedTimeSignature = header.timeSig;
      } else {
        const [num, den] = settings.timeSigOverride.split('/').map(Number);
        detectedTimeSignature = { numerator: num || 4, denominator: den || 4 };
      }
      firstSystemMusicStartX = header.musicStartX;
    }

    onProgress?.(`Reconociendo notas y separando voces SATB (pág. ${pIdx + 1})...`, basePct + 55);
    await yieldToUi();

    // 4. Barlines & Noteheads per staff
    const pageDetectedNotes: DetectedOmrNote[] = [];
    const maxSysIdx = Math.max(...staves.map((st) => st.systemIndex));
    totalSystems += maxSysIdx + 1;

    for (const st of staves) {
      st.barlineXs = detectBarlinesForStaff(noStaff, st);
    }

    for (let sysIdx = 0; sysIdx <= maxSysIdx; sysIdx++) {
      const sysStaves = staves.filter((st) => st.systemIndex === sysIdx);
      const isVeryFirst = pIdx === 0 && sysIdx === 0;
      const sysHeader = isVeryFirst ? null : analyzeHeader(noStaff, sysStaves[0], false);
      const sysMusicStartX = isVeryFirst
        ? firstSystemMusicStartX
        : Math.max(
            sysHeader?.musicStartX ?? 0,
            Math.round(
              sysStaves[0].leftX +
                sysStaves[0].staffSpace * (4.0 + Math.abs(detectedKeyFifths) * 0.72)
            )
          );

      const sysNotes: DetectedOmrNote[] = [];
      for (const st of sysStaves) {
        const found = detectNoteheadsOnStaff(
          noStaff,
          bin,
          st,
          staves,
          sysMusicStartX,
          settings.sensitivity,
          detectedKeyFifths
        );
        sysNotes.push(...found);
      }

      const aligned = alignSystemNotesToBeats(
        sysStaves,
        sysNotes,
        pageLayout,
        detectedTimeSignature,
        globalBeatCursor,
        sysMusicStartX,
        isVeryFirst
      );
      allEvents.push(...aligned.events);
      pageDetectedNotes.push(...sysNotes);
      allDetectedNotes.push(...sysNotes);
      globalBeatCursor = aligned.nextBeat;
    }

    omrPages.push({
      pageIndex: pIdx,
      width: workingCanvas.width,
      height: workingCanvas.height,
      imageUrl: workingCanvas.toDataURL('image/png'),
      deskewAngleDeg,
      staves,
      detectedNotes: pageDetectedNotes,
    });
  }

  onProgress?.('Finalizando separación coral SATB...', 98);
  await yieldToUi();

  const avgConf =
    allDetectedNotes.length > 0
      ? allDetectedNotes.reduce((s, n) => s + n.confidence, 0) / allDetectedNotes.length
      : 0;

  if (allEvents.length === 0) {
    warnings.push(
      'No se pudieron extraer notas automáticamente. Puedes ajustar Sensibilidad/Contraste OMR o añadir notas manualmente en el Piano Roll.'
    );
  }

  const omrAnalysis: OmrAnalysisResult = {
    pages: omrPages,
    detectedKeyFifths,
    detectedTimeSignature,
    detectedLayout,
    totalStaves,
    totalSystems,
    totalNotes: allEvents.length,
    averageConfidence: avgConf,
    warnings,
    settingsUsed: { ...settings },
  };

  return {
    id: `score_omr_${Date.now()}`,
    title,
    sourceType,
    tempoBpm: 88,
    timeSignature: detectedTimeSignature,
    keySignatureFifths: detectedKeyFifths,
    notes: allEvents.sort((a, b) => a.startBeat - b.startBeat || b.pitch - a.pitch),
    omrAnalysis,
  };
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 12));
}
