import { NoteEvent, ScoreData, VoiceId } from '../types/music';

interface ChordSlice {
  dur: number;
  s: number;
  a: number;
  t: number;
  b: number;
}

function buildScoreFromChords(
  id: string,
  title: string,
  tempoBpm: number,
  timeSignature: { numerator: number; denominator: number },
  keySignatureFifths: number,
  slices: ChordSlice[]
): ScoreData {
  const notes: NoteEvent[] = [];
  let beat = 0;
  let seq = 1;
  const voices: Array<{ key: 's' | 'a' | 't' | 'b'; voice: VoiceId }> = [
    { key: 's', voice: 'soprano' },
    { key: 'a', voice: 'contralto' },
    { key: 't', voice: 'tenor' },
    { key: 'b', voice: 'bajo' },
  ];

  for (const slice of slices) {
    for (const v of voices) {
      notes.push({
        id: `${id}_${seq++}`,
        voice: v.voice,
        pitch: slice[v.key],
        startBeat: beat,
        durationBeats: slice.dur,
        velocity: v.voice === 'soprano' ? 98 : 90,
      });
    }
    beat += slice.dur;
  }

  return {
    id,
    title,
    sourceType: 'demo',
    tempoBpm,
    timeSignature,
    keySignatureFifths,
    notes,
  };
}

/**
 * Classic Public Domain 4-Part SATB Hymn: "Sublime Gracia" (New Britain / Amazing Grace)
 * Key: F Major (1 flat, fifths = -1), Time: 3/4, authentic 16-measure rhythm & SATB harmony
 */
export function createAmazingGraceDemo(): ScoreData {
  // F4=65, G4=67, A4=69, Bb4=70, C5=72, D5=74
  // C4=60, D4=62, E4=64, F3=53, G3=55, A3=57, Bb3=58, C3=48, D3=50, F2=41
  const slices: ChordSlice[] = [
    // Phrase 1 (anacrusis 1 beat + 4 measures = 12 beats)
    { dur: 1, s: 60, a: 57, t: 53, b: 41 }, // C4 (Sub-)
    { dur: 2, s: 65, a: 60, t: 57, b: 41 }, // F4 (-li-)
    { dur: 0.5, s: 69, a: 60, t: 57, b: 41 }, // A4 (-me)
    { dur: 0.5, s: 65, a: 60, t: 57, b: 41 }, // F4
    { dur: 2, s: 69, a: 60, t: 57, b: 45 }, // A4 (gra-)
    { dur: 1, s: 67, a: 60, t: 58, b: 48 }, // G4 (-cia)
    { dur: 2, s: 65, a: 60, t: 57, b: 41 }, // F4 (del)
    { dur: 1, s: 62, a: 58, t: 53, b: 46 }, // D4 (Se-)
    { dur: 2, s: 60, a: 57, t: 53, b: 41 }, // C4 (-ñor)

    // Phrase 2 (12 beats — C5 held for full 5 beats: 3+2)
    { dur: 1, s: 60, a: 57, t: 53, b: 41 }, // C4 (que a un)
    { dur: 2, s: 65, a: 60, t: 57, b: 41 }, // F4 (in-)
    { dur: 0.5, s: 69, a: 60, t: 57, b: 41 }, // A4 (-fe-)
    { dur: 0.5, s: 65, a: 60, t: 57, b: 41 }, // F4 (-liz)
    { dur: 2, s: 69, a: 60, t: 57, b: 45 }, // A4 (sal-)
    { dur: 1, s: 67, a: 60, t: 55, b: 43 }, // G4 (-vó)
    { dur: 3, s: 72, a: 64, t: 55, b: 48 }, // C5 (C major)
    { dur: 2, s: 72, a: 64, t: 55, b: 48 }, // C5 (sustain)

    // Phrase 3 (12 beats)
    { dur: 1, s: 69, a: 65, t: 60, b: 41 }, // A4 (fui)
    { dur: 1.5, s: 72, a: 65, t: 60, b: 41 }, // C5 (cie-)
    { dur: 0.5, s: 69, a: 65, t: 60, b: 41 }, // A4 (-go)
    { dur: 0.5, s: 72, a: 65, t: 60, b: 45 }, // C5 (mas)
    { dur: 0.5, s: 69, a: 65, t: 60, b: 45 }, // A4
    { dur: 2, s: 65, a: 60, t: 57, b: 41 }, // F4 (hoy)
    { dur: 1, s: 60, a: 57, t: 53, b: 41 }, // C4 (mi-)
    { dur: 1.5, s: 62, a: 58, t: 53, b: 46 }, // D4 (-ro)
    { dur: 0.5, s: 65, a: 62, t: 58, b: 46 }, // F4
    { dur: 0.5, s: 65, a: 62, t: 58, b: 46 }, // F4
    { dur: 0.5, s: 62, a: 58, t: 53, b: 46 }, // D4
    { dur: 2, s: 60, a: 57, t: 53, b: 41 }, // C4 (yo)

    // Phrase 4 (12 beats — Ending cadence)
    { dur: 1, s: 60, a: 57, t: 53, b: 41 }, // C4 (per-)
    { dur: 2, s: 65, a: 60, t: 57, b: 41 }, // F4 (-di-)
    { dur: 0.5, s: 69, a: 60, t: 57, b: 41 }, // A4 (-do y)
    { dur: 0.5, s: 65, a: 60, t: 57, b: 41 }, // F4
    { dur: 2, s: 69, a: 60, t: 57, b: 48 }, // A4 (Él me ha-)
    { dur: 1, s: 67, a: 60, t: 58, b: 48 }, // G4 (-lló)
    { dur: 5, s: 65, a: 60, t: 57, b: 41 }, // F4 (resolution)
  ];

  return buildScoreFromChords(
    'demo_sublime_gracia',
    'Sublime Gracia (Coro SATB)',
    84,
    { numerator: 3, denominator: 4 },
    -1,
    slices
  );
}

/**
 * Classic Public Domain 4-Part SATB Hymn: "Santo, Santo, Santo" (Nicaea — John B. Dykes)
 * Key: D Major (2 sharps, fifths = +2), Time: 4/4, authentic full 16-measure SATB hymn
 */
export function createSantoSantoDemo(): ScoreData {
  // D4=62, E4=64, F#4=66, G4=67, G#4=68, A4=69, B4=71, C#5=73, D5=74
  const slices: ChordSlice[] = [
    // Phrase 1 (Measures 1-4): "Santo, Santo, Santo, Señor Omnipotente"
    { dur: 1, s: 62, a: 57, t: 54, b: 50 }, // D4
    { dur: 1, s: 62, a: 57, t: 54, b: 50 }, // D4
    { dur: 1, s: 66, a: 62, t: 57, b: 50 }, // F#4
    { dur: 1, s: 66, a: 62, t: 57, b: 50 }, // F#4
    { dur: 2, s: 69, a: 62, t: 57, b: 45 }, // A4
    { dur: 2, s: 69, a: 62, t: 57, b: 50 }, // A4
    { dur: 2, s: 71, a: 67, t: 62, b: 43 }, // B4
    { dur: 1, s: 71, a: 67, t: 62, b: 43 }, // B4
    { dur: 1, s: 71, a: 67, t: 62, b: 43 }, // B4
    { dur: 2, s: 69, a: 66, t: 62, b: 50 }, // A4
    { dur: 2, s: 66, a: 62, t: 57, b: 50 }, // F#4

    // Phrase 2 (Measures 5-8): "Siempre el labio mío loores te dará"
    { dur: 1, s: 69, a: 64, t: 57, b: 45 }, // A4
    { dur: 1, s: 69, a: 64, t: 57, b: 45 }, // A4
    { dur: 1, s: 69, a: 64, t: 57, b: 45 }, // A4
    { dur: 1, s: 69, a: 64, t: 57, b: 45 }, // A4
    { dur: 2, s: 74, a: 66, t: 62, b: 47 }, // D5
    { dur: 1, s: 73, a: 64, t: 61, b: 45 }, // C#5
    { dur: 1, s: 69, a: 64, t: 57, b: 45 }, // A4
    { dur: 1, s: 64, a: 61, t: 57, b: 45 }, // E4
    { dur: 1, s: 69, a: 64, t: 61, b: 45 }, // A4
    { dur: 1.5, s: 71, a: 64, t: 62, b: 40 }, // B4 (E7)
    { dur: 0.5, s: 69, a: 64, t: 61, b: 45 }, // A4
    { dur: 4, s: 69, a: 64, t: 61, b: 45 }, // A4 (A major cadence)

    // Phrase 3 (Measures 9-12): "Santo, Santo, Santo, te adoro reverente"
    { dur: 1, s: 62, a: 57, t: 54, b: 50 }, // D4
    { dur: 1, s: 62, a: 57, t: 54, b: 50 }, // D4
    { dur: 1, s: 66, a: 62, t: 57, b: 50 }, // F#4
    { dur: 1, s: 66, a: 62, t: 57, b: 50 }, // F#4
    { dur: 2, s: 69, a: 62, t: 57, b: 45 }, // A4
    { dur: 2, s: 69, a: 62, t: 57, b: 50 }, // A4
    { dur: 2, s: 71, a: 67, t: 62, b: 43 }, // B4
    { dur: 1, s: 71, a: 67, t: 62, b: 43 }, // B4
    { dur: 1, s: 71, a: 67, t: 62, b: 43 }, // B4
    { dur: 2, s: 69, a: 64, t: 61, b: 45 }, // A4
    { dur: 2, s: 69, a: 64, t: 55, b: 45 }, // A4 (A7)

    // Phrase 4 (Measures 13-16): "Dios en tres personas, bendita Trinidad"
    { dur: 2, s: 74, a: 66, t: 62, b: 50 }, // D5 (D)
    { dur: 2, s: 69, a: 66, t: 62, b: 42 }, // A4 (D/F#)
    { dur: 2, s: 71, a: 62, t: 59, b: 43 }, // B4 (G)
    { dur: 2, s: 66, a: 62, t: 57, b: 50 }, // F#4 (D)
    { dur: 1, s: 67, a: 64, t: 59, b: 40 }, // G4 (Em)
    { dur: 1, s: 64, a: 61, t: 55, b: 45 }, // E4 (A7)
    { dur: 2, s: 64, a: 61, t: 55, b: 45 }, // E4 (A7)
    { dur: 4, s: 62, a: 57, t: 54, b: 50 }, // D4 (D Major resolution)
  ];

  return buildScoreFromChords(
    'demo_santo_santo',
    'Santo, Santo, Santo (Nicaea SATB)',
    94,
    { numerator: 4, denominator: 4 },
    2,
    slices
  );
}

/**
 * Generates a high-resolution synthetic 4-part SATB Grand Staff sheet music PNG
 * (with Treble & Bass staves, barlines, stem-up Soprano/Tenor, stem-down Contralto/Bajo,
 * quarter/half/whole notes) to test and demonstrate the local OMR vision engine immediately!
 */
export function generateSyntheticSheetMusicCanvas(): HTMLCanvasElement {
  const width = 1500;
  const height = 1050;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // White paper background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Title header
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 34px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('HIMNO DE PRUEBA CORAL (SATB)', width / 2, 72);
  ctx.font = 'italic 18px Georgia, serif';
  ctx.fillText('Partitura en Clave de Sol y Fa — 4/4 — Sol Mayor', width / 2, 102);

  const staffSpace = 18;
  const lineWidth = 2.2;
  const leftMargin = 110;
  const rightMargin = width - 90;

  // Two Grand Staff systems, 4 measures each = 8 measures total in G Major (1 sharp, 4/4)
  // Using diatonic steps from bottom line:
  // Treble bottom line (step 0) = E4 (64). G4=2, A4=3, B4=4, C5=5, D5=6, E5=7
  // Bass bottom line (step 0) = G2 (43). A2=1, B2=2, C3=3, D3=4, E3=5, F#3=6, G3=7, A3=8, B3=9
  interface SheetEvent {
    beatOffset: number; // within 4-beat measure
    dur: 'q' | 'h' | 'w';
    sStep: number;
    aStep: number;
    tStep: number;
    bStep: number;
  }

  const systems: SheetEvent[][][] = [
    // System 1: 4 measures
    [
      // M1: G - G - A - B
      [
        { beatOffset: 0, dur: 'q', sStep: 2, aStep: 0, tStep: 9, bStep: 0 },
        { beatOffset: 1, dur: 'q', sStep: 2, aStep: 0, tStep: 9, bStep: 0 },
        { beatOffset: 2, dur: 'q', sStep: 3, aStep: 1, tStep: 8, bStep: 4 },
        { beatOffset: 3, dur: 'q', sStep: 4, aStep: 2, tStep: 7, bStep: 0 },
      ],
      // M2: C5 (h) - B4 (h)
      [
        { beatOffset: 0, dur: 'h', sStep: 5, aStep: 2, tStep: 7, bStep: 3 },
        { beatOffset: 2, dur: 'h', sStep: 4, aStep: 2, tStep: 7, bStep: 0 },
      ],
      // M3: A4 - B4 - C5 - A4
      [
        { beatOffset: 0, dur: 'q', sStep: 3, aStep: 1, tStep: 6, bStep: 4 },
        { beatOffset: 1, dur: 'q', sStep: 4, aStep: 2, tStep: 7, bStep: 0 },
        { beatOffset: 2, dur: 'q', sStep: 5, aStep: 2, tStep: 7, bStep: 3 },
        { beatOffset: 3, dur: 'q', sStep: 3, aStep: 1, tStep: 6, bStep: 4 },
      ],
      // M4: B4 (h) - G4 (h)
      [
        { beatOffset: 0, dur: 'h', sStep: 4, aStep: 2, tStep: 7, bStep: 0 },
        { beatOffset: 2, dur: 'h', sStep: 2, aStep: 0, tStep: 7, bStep: 0 },
      ],
    ],
    // System 2: 4 measures
    [
      // M5: D5 - D5 - C5 - B4
      [
        { beatOffset: 0, dur: 'q', sStep: 6, aStep: 4, tStep: 9, bStep: 0 },
        { beatOffset: 1, dur: 'q', sStep: 6, aStep: 4, tStep: 9, bStep: 0 },
        { beatOffset: 2, dur: 'q', sStep: 5, aStep: 2, tStep: 7, bStep: 3 },
        { beatOffset: 3, dur: 'q', sStep: 4, aStep: 2, tStep: 7, bStep: 0 },
      ],
      // M6: A4 (h) - B4 (h)
      [
        { beatOffset: 0, dur: 'h', sStep: 3, aStep: 1, tStep: 6, bStep: 4 },
        { beatOffset: 2, dur: 'h', sStep: 4, aStep: 2, tStep: 7, bStep: 0 },
      ],
      // M7: C5 - B4 - A4 (h)
      [
        { beatOffset: 0, dur: 'q', sStep: 5, aStep: 2, tStep: 7, bStep: 3 },
        { beatOffset: 1, dur: 'q', sStep: 4, aStep: 2, tStep: 7, bStep: 0 },
        { beatOffset: 2, dur: 'h', sStep: 3, aStep: 1, tStep: 6, bStep: 4 },
      ],
      // M8: G4 (whole)
      [
        { beatOffset: 0, dur: 'w', sStep: 2, aStep: 0, tStep: 7, bStep: 0 },
      ],
    ],
  ];

  const drawStaff = (topY: number) => {
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = lineWidth;
    for (let i = 0; i < 5; i++) {
      const y = topY + i * staffSpace;
      ctx.beginPath();
      ctx.moveTo(leftMargin, y);
      ctx.lineTo(rightMargin, y);
      ctx.stroke();
    }
  };

  const drawNote = (
    x: number,
    bottomLineY: number,
    step: number,
    dur: 'q' | 'h' | 'w',
    stemDir: 'up' | 'down'
  ) => {
    const y = bottomLineY - step * (staffSpace / 2);
    const rx = staffSpace * 0.62;
    const ry = staffSpace * 0.45;

    // Ledger line if needed
    if (step <= -2) {
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = lineWidth;
      for (let ls = -2; ls >= step; ls -= 2) {
        const ly = bottomLineY - ls * (staffSpace / 2);
        ctx.beginPath();
        ctx.moveTo(x - rx * 1.5, ly);
        ctx.lineTo(x + rx * 1.5, ly);
        ctx.stroke();
      }
    }
    if (step >= 10) {
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = lineWidth;
      for (let ls = 10; ls <= step; ls += 2) {
        const ly = bottomLineY - ls * (staffSpace / 2);
        ctx.beginPath();
        ctx.moveTo(x - rx * 1.5, ly);
        ctx.lineTo(x + rx * 1.5, ly);
        ctx.stroke();
      }
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.22);
    if (dur === 'q') {
      ctx.fillStyle = '#0a0a0a';
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Hollow half or whole note
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0a0a0a';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Draw stem for quarter and half notes
    if (dur !== 'w') {
      const stemLen = staffSpace * 3.2;
      ctx.strokeStyle = '#0a0a0a';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      if (stemDir === 'up') {
        ctx.moveTo(x + rx - 1, y);
        ctx.lineTo(x + rx - 1, y - stemLen);
      } else {
        ctx.moveTo(x - rx + 1, y);
        ctx.lineTo(x - rx + 1, y + stemLen);
      }
      ctx.stroke();
    }
  };

  const drawSharp = (x: number, y: number) => {
    ctx.strokeStyle = '#0a0a0a';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 14);
    ctx.lineTo(x - 4, y + 14);
    ctx.moveTo(x + 4, y - 16);
    ctx.lineTo(x + 4, y + 12);
    ctx.stroke();
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(x - 9, y - 5);
    ctx.lineTo(x + 9, y - 8);
    ctx.moveTo(x - 9, y + 6);
    ctx.lineTo(x + 9, y + 3);
    ctx.stroke();
  };

  systems.forEach((measures, sysIdx) => {
    const trebleTopY = 190 + sysIdx * 420;
    const trebleBottomY = trebleTopY + 4 * staffSpace;
    const bassTopY = trebleTopY + 185;
    const bassBottomY = bassTopY + 4 * staffSpace;

    drawStaff(trebleTopY);
    drawStaff(bassTopY);

    // Grand staff left connecting bar
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(leftMargin, trebleTopY);
    ctx.lineTo(leftMargin, bassBottomY);
    ctx.stroke();

    // Clef symbols (styled graphic glyphs)
    ctx.fillStyle = '#0a0a0a';
    ctx.font = '95px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText('𝄞', leftMargin + 12, trebleBottomY + 6);
    ctx.font = '76px Georgia, serif';
    ctx.fillText('𝄢', leftMargin + 14, bassTopY + staffSpace * 3.1);

    // Key signature: 1 sharp (F# on top line of treble, 4th line of bass)
    drawSharp(leftMargin + 86, trebleTopY);
    drawSharp(leftMargin + 86, bassTopY + staffSpace);

    // Time signature 4/4 on first system
    let notesStartX = leftMargin + 125;
    if (sysIdx === 0) {
      ctx.font = 'bold 40px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('4', leftMargin + 125, trebleTopY + staffSpace * 1.9);
      ctx.fillText('4', leftMargin + 125, trebleTopY + staffSpace * 3.9);
      ctx.fillText('4', leftMargin + 125, bassTopY + staffSpace * 1.9);
      ctx.fillText('4', leftMargin + 125, bassTopY + staffSpace * 3.9);
      notesStartX = leftMargin + 168;
    }

    const usableWidth = rightMargin - notesStartX - 20;
    const measureW = usableWidth / measures.length;

    measures.forEach((events, mIdx) => {
      const mStartX = notesStartX + mIdx * measureW;
      const mEndX = mStartX + measureW;

      // Draw notes inside measure
      for (const ev of events) {
        const nx = mStartX + 38 + (ev.beatOffset / 4) * (measureW - 56);
        drawNote(nx, trebleBottomY, ev.sStep, ev.dur, 'up');
        drawNote(nx, trebleBottomY, ev.aStep, ev.dur, 'down');
        drawNote(nx, bassBottomY, ev.tStep, ev.dur, 'up');
        drawNote(nx, bassBottomY, ev.bStep, ev.dur, 'down');
      }

      // Draw barline at end of measure
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = mIdx === measures.length - 1 && sysIdx === systems.length - 1 ? 5 : 2.6;
      ctx.beginPath();
      ctx.moveTo(mEndX, trebleTopY);
      ctx.lineTo(mEndX, bassBottomY);
      ctx.stroke();
    });
  });

  return canvas;
}
