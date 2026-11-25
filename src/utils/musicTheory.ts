import { NoteEvent, TimeSignature, VoiceId, VOICE_IDS, VOICE_META } from '../types/music';

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_ES_SHARP = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const NOTE_NAMES_ES_FLAT = ['Do', 'Reb', 'Re', 'Mib', 'Mi', 'Fa', 'Solb', 'Sol', 'Lab', 'La', 'Sib', 'Si'];

export interface KeySignatureInfo {
  fifths: number;
  majorNameEs: string;
  minorNameEs: string;
  majorNameEn: string;
  sharpsOrFlatsLabel: string;
  tonicPitchClass: number; // 0..11
}

export const KEY_SIGNATURES: KeySignatureInfo[] = [
  { fifths: -7, majorNameEs: 'Dob Mayor', minorNameEs: 'Lab menor', majorNameEn: 'Cb Major', sharpsOrFlatsLabel: '7 bemoles', tonicPitchClass: 11 },
  { fifths: -6, majorNameEs: 'Solb Mayor', minorNameEs: 'Mib menor', majorNameEn: 'Gb Major', sharpsOrFlatsLabel: '6 bemoles', tonicPitchClass: 6 },
  { fifths: -5, majorNameEs: 'Reb Mayor', minorNameEs: 'Sib menor', majorNameEn: 'Db Major', sharpsOrFlatsLabel: '5 bemoles', tonicPitchClass: 1 },
  { fifths: -4, majorNameEs: 'Lab Mayor', minorNameEs: 'Fa menor', majorNameEn: 'Ab Major', sharpsOrFlatsLabel: '4 bemoles', tonicPitchClass: 8 },
  { fifths: -3, majorNameEs: 'Mib Mayor', minorNameEs: 'Do menor', majorNameEn: 'Eb Major', sharpsOrFlatsLabel: '3 bemoles', tonicPitchClass: 3 },
  { fifths: -2, majorNameEs: 'Sib Mayor', minorNameEs: 'Sol menor', majorNameEn: 'Bb Major', sharpsOrFlatsLabel: '2 bemoles', tonicPitchClass: 10 },
  { fifths: -1, majorNameEs: 'Fa Mayor', minorNameEs: 'Re menor', majorNameEn: 'F Major', sharpsOrFlatsLabel: '1 bemol (Sib)', tonicPitchClass: 5 },
  { fifths: 0, majorNameEs: 'Do Mayor', minorNameEs: 'La menor', majorNameEn: 'C Major', sharpsOrFlatsLabel: 'Sin alteraciones', tonicPitchClass: 0 },
  { fifths: 1, majorNameEs: 'Sol Mayor', minorNameEs: 'Mi menor', majorNameEn: 'G Major', sharpsOrFlatsLabel: '1 sostenido (Fa#)', tonicPitchClass: 7 },
  { fifths: 2, majorNameEs: 'Re Mayor', minorNameEs: 'Si menor', majorNameEn: 'D Major', sharpsOrFlatsLabel: '2 sostenidos', tonicPitchClass: 2 },
  { fifths: 3, majorNameEs: 'La Mayor', minorNameEs: 'Fa# menor', majorNameEn: 'A Major', sharpsOrFlatsLabel: '3 sostenidos', tonicPitchClass: 9 },
  { fifths: 4, majorNameEs: 'Mi Mayor', minorNameEs: 'Do# menor', majorNameEn: 'E Major', sharpsOrFlatsLabel: '4 sostenidos', tonicPitchClass: 4 },
  { fifths: 5, majorNameEs: 'Si Mayor', minorNameEs: 'Sol# menor', majorNameEn: 'B Major', sharpsOrFlatsLabel: '5 sostenidos', tonicPitchClass: 11 },
  { fifths: 6, majorNameEs: 'Fa# Mayor', minorNameEs: 'Re# menor', majorNameEn: 'F# Major', sharpsOrFlatsLabel: '6 sostenidos', tonicPitchClass: 6 },
  { fifths: 7, majorNameEs: 'Do# Mayor', minorNameEs: 'La# menor', majorNameEn: 'C# Major', sharpsOrFlatsLabel: '7 sostenidos', tonicPitchClass: 1 },
];

export function getKeyInfo(fifths: number): KeySignatureInfo {
  const clamped = Math.max(-7, Math.min(7, Math.round(fifths)));
  return KEY_SIGNATURES.find((k) => k.fifths === clamped) ?? KEY_SIGNATURES[7];
}

export function getTransposedKeyLabel(fifths: number, transposeSemitones: number): string {
  const base = getKeyInfo(fifths);
  const newPc = ((base.tonicPitchClass + transposeSemitones) % 12 + 12) % 12;
  const preferFlats = fifths < 0 || [1, 3, 5, 8, 10].includes(newPc);
  const name = preferFlats ? NOTE_NAMES_ES_FLAT[newPc] : NOTE_NAMES_ES_SHARP[newPc];
  return `${name} Mayor`;
}

export function midiToNoteName(midi: number, spanish = false): string {
  const clamped = Math.max(0, Math.min(127, Math.round(midi)));
  const pc = clamped % 12;
  const octave = Math.floor(clamped / 12) - 1;
  return `${spanish ? NOTE_NAMES_ES_SHARP[pc] : NOTE_NAMES_SHARP[pc]}${octave}`;
}

export function isBlackKey(midi: number): boolean {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Given a key signature in fifths (-7..+7), return per-letter accidental (-1, 0, +1)
 * indexed by diatonic letter: 0=C, 1=D, 2=E, 3=F, 4=G, 5=A, 6=B
 */
export function getKeyAlterations(fifths: number): number[] {
  const alts = [0, 0, 0, 0, 0, 0, 0];
  const sharpOrder = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
  const flatOrder = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F
  if (fifths > 0) {
    for (let i = 0; i < Math.min(7, fifths); i++) alts[sharpOrder[i]] = 1;
  } else if (fifths < 0) {
    for (let i = 0; i < Math.min(7, -fifths); i++) alts[flatOrder[i]] = -1;
  }
  return alts;
}

/**
 * Convert a diatonic step from the bottom line of a staff into a MIDI pitch.
 * Treble bottom line (step 0) = E4 (diatonic index 4*7 + 2 = 30)
 * Bass bottom line (step 0) = G2 (diatonic index 2*7 + 4 = 18)
 */
const DIATONIC_SEMITONES = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B

export function staffStepToMidi(
  clef: 'treble' | 'bass',
  stepFromBottomLine: number,
  keyFifths: number,
  localAccidental: -1 | 0 | 1 | null = null
): number {
  const baseDiatonic = clef === 'treble' ? 4 * 7 + 2 : 2 * 7 + 4; // E4 or G2
  const diatonicIdx = baseDiatonic + stepFromBottomLine;
  const octave = Math.floor(diatonicIdx / 7);
  const letter = ((diatonicIdx % 7) + 7) % 7;
  const keyAlts = getKeyAlterations(keyFifths);
  const alteration = localAccidental !== null ? localAccidental : keyAlts[letter];
  const midi = (octave + 1) * 12 + DIATONIC_SEMITONES[letter] + alteration;
  return Math.max(28, Math.min(96, midi));
}

export function getBeatsPerMeasure(timeSig: TimeSignature): number {
  return (timeSig.numerator * 4) / timeSig.denominator;
}

export function getSingleVerseDurationBeats(notes: NoteEvent[], timeSig: TimeSignature): number {
  const bpmMeasure = getBeatsPerMeasure(timeSig);
  if (notes.length === 0) return bpmMeasure * 4;
  let maxEnd = 0;
  for (const n of notes) {
    const end = n.startBeat + n.durationBeats;
    if (end > maxEnd) maxEnd = end;
  }
  // Round up cleanly to whole measures
  const measures = Math.max(1, Math.ceil((maxEnd - 0.01) / bpmMeasure));
  return measures * bpmMeasure;
}

/**
 * Expand single-verse notes into full hymn across N verses (estrofas) with optional pause beats between verses.
 */
export function expandScoreWithVerses(
  notes: NoteEvent[],
  timeSig: TimeSignature,
  verseCount: number,
  versePauseBeats: number,
  transposeSemitones = 0
): { expandedNotes: NoteEvent[]; verseLengthBeats: number; totalBeats: number } {
  const safeVerses = Math.max(1, Math.min(12, Math.round(verseCount)));
  const safePause = Math.max(0, versePauseBeats);
  const verseLengthBeats = getSingleVerseDurationBeats(notes, timeSig);
  const stride = verseLengthBeats + safePause;
  const expandedNotes: NoteEvent[] = [];

  for (let v = 0; v < safeVerses; v++) {
    const offset = v * stride;
    for (const n of notes) {
      expandedNotes.push({
        ...n,
        id: v === 0 ? n.id : `${n.id}_v${v + 1}`,
        pitch: Math.max(21, Math.min(108, n.pitch + transposeSemitones)),
        startBeat: n.startBeat + offset,
      });
    }
  }

  const totalBeats = safeVerses * verseLengthBeats + (safeVerses - 1) * safePause;
  return { expandedNotes, verseLengthBeats, totalBeats };
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function beatsToSeconds(beats: number, tempoBpm: number): number {
  return (beats * 60) / Math.max(20, tempoBpm);
}

/**
 * Separate an arbitrary list of polyphonic notes into 4 choral voices (Soprano, Contralto, Tenor, Bajo)
 * by grouping near-simultaneous onsets and assigning sorted pitches to vocal ranges.
 */
export function autoSeparateSATB(
  rawNotes: Array<{ pitch: number; startBeat: number; durationBeats: number; velocity?: number; preferredClef?: 'treble' | 'bass' }>
): NoteEvent[] {
  if (rawNotes.length === 0) return [];
  const sorted = [...rawNotes].sort((a, b) => a.startBeat - b.startBeat || b.pitch - a.pitch);

  // Cluster notes starting within 0.12 beats of each other into vertical chords
  const clusters: typeof sorted[] = [];
  for (const note of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(note.startBeat - last[0].startBeat) <= 0.12) {
      last.push(note);
    } else {
      clusters.push([note]);
    }
  }

  const result: NoteEvent[] = [];
  const lastPitchByVoice: Record<VoiceId, number> = {
    soprano: 70,
    contralto: 63,
    tenor: 56,
    bajo: 48,
  };

  let counter = 1;
  for (const cluster of clusters) {
    // Sort descending by pitch (highest first)
    const chord = [...cluster].sort((a, b) => b.pitch - a.pitch);

    if (chord.length === 4) {
      const voices: VoiceId[] = ['soprano', 'contralto', 'tenor', 'bajo'];
      chord.forEach((n, idx) => {
        const v = voices[idx];
        lastPitchByVoice[v] = n.pitch;
        result.push({
          id: `n_${counter++}`,
          voice: v,
          pitch: n.pitch,
          startBeat: n.startBeat,
          durationBeats: Math.max(0.125, n.durationBeats),
          velocity: n.velocity ?? 92,
        });
      });
    } else if (chord.length > 4) {
      // Pick the outer voices and closest inner voices; assign duplicates to nearest voice
      const assigned = new Set<number>();
      const pick = (voice: VoiceId, idx: number) => {
        assigned.add(idx);
        const n = chord[idx];
        lastPitchByVoice[voice] = n.pitch;
        result.push({
          id: `n_${counter++}`,
          voice,
          pitch: n.pitch,
          startBeat: n.startBeat,
          durationBeats: Math.max(0.125, n.durationBeats),
          velocity: n.velocity ?? 92,
        });
      };
      pick('soprano', 0);
      pick('bajo', chord.length - 1);
      pick('contralto', 1);
      pick('tenor', chord.length - 2);
      // Any extra inner notes go to nearest voice by range
      chord.forEach((n, idx) => {
        if (assigned.has(idx)) return;
        const v = pickBestVoiceForPitch(n.pitch, lastPitchByVoice, n.preferredClef);
        result.push({
          id: `n_${counter++}`,
          voice: v,
          pitch: n.pitch,
          startBeat: n.startBeat,
          durationBeats: Math.max(0.125, n.durationBeats),
          velocity: n.velocity ?? 88,
        });
      });
    } else {
      // 1, 2, or 3 notes in this slice: assign greedily without duplicating voices in same chord
      const usedVoices = new Set<VoiceId>();
      for (const n of chord) {
        const v = pickBestVoiceForPitch(n.pitch, lastPitchByVoice, n.preferredClef, usedVoices);
        usedVoices.add(v);
        lastPitchByVoice[v] = n.pitch;
        result.push({
          id: `n_${counter++}`,
          voice: v,
          pitch: n.pitch,
          startBeat: n.startBeat,
          durationBeats: Math.max(0.125, n.durationBeats),
          velocity: n.velocity ?? 92,
        });
      }
    }
  }

  return result;
}

function pickBestVoiceForPitch(
  pitch: number,
  lastPitchByVoice: Record<VoiceId, number>,
  preferredClef?: 'treble' | 'bass',
  exclude?: Set<VoiceId>
): VoiceId {
  let bestVoice: VoiceId = 'soprano';
  let bestScore = Infinity;

  for (const v of VOICE_IDS) {
    if (exclude?.has(v)) continue;
    const meta = VOICE_META[v];
    const center = (meta.minPitch + meta.maxPitch) / 2;
    let score = Math.abs(pitch - center) * 1.1 + Math.abs(pitch - lastPitchByVoice[v]) * 0.65;
    if (pitch < meta.minPitch) score += (meta.minPitch - pitch) * 3.0;
    if (pitch > meta.maxPitch) score += (pitch - meta.maxPitch) * 3.0;
    if (preferredClef && meta.clef !== preferredClef) score += 14;
    if (score < bestScore) {
      bestScore = score;
      bestVoice = v;
    }
  }
  return bestVoice;
}

/**
 * Clean up overlapping notes within the exact same voice so each vocal line is monophonic and crisp.
 */
export function cleanupVoiceOverlaps(notes: NoteEvent[]): NoteEvent[] {
  const byVoice: Record<VoiceId, NoteEvent[]> = {
    soprano: [],
    contralto: [],
    tenor: [],
    bajo: [],
  };
  for (const n of notes) byVoice[n.voice].push({ ...n });

  const cleaned: NoteEvent[] = [];
  for (const v of VOICE_IDS) {
    const list = byVoice[v].sort((a, b) => a.startBeat - b.startBeat);
    for (let i = 0; i < list.length; i++) {
      const cur = list[i];
      const next = list[i + 1];
      if (next && cur.startBeat + cur.durationBeats > next.startBeat) {
        const trimmed = next.startBeat - cur.startBeat;
        if (trimmed >= 0.125) {
          cur.durationBeats = trimmed;
        }
      }
      cleaned.push(cur);
    }
  }
  return cleaned.sort((a, b) => a.startBeat - b.startBeat || b.pitch - a.pitch);
}

export function getVoicePitchStats(notes: NoteEvent[], voice: VoiceId): { count: number; rangeLabel: string } {
  const vn = notes.filter((n) => n.voice === voice);
  if (vn.length === 0) return { count: 0, rangeLabel: 'Sin notas' };
  let min = 127;
  let max = 0;
  for (const n of vn) {
    if (n.pitch < min) min = n.pitch;
    if (n.pitch > max) max = n.pitch;
  }
  return {
    count: vn.length,
    rangeLabel: `${midiToNoteName(min)} – ${midiToNoteName(max)}`,
  };
}

/**
 * Snap all notes to the nearest diatonic scale degree of the current Key Signature.
 * Very helpful for cleaning up stray off-key notes after OMR on noisy scanned PDFs/photos.
 */
export function snapNotesToKeySignature(notes: NoteEvent[], keyFifths: number): NoteEvent[] {
  const tonic = getKeyInfo(keyFifths).tonicPitchClass;
  const majorIntervals = new Set([0, 2, 4, 5, 7, 9, 11].map((i) => (tonic + i) % 12));

  return notes.map((n) => {
    const pc = ((n.pitch % 12) + 12) % 12;
    if (majorIntervals.has(pc)) return n;
    const upPc = (pc + 1) % 12;
    const downPc = (pc + 11) % 12;
    if (majorIntervals.has(downPc)) return { ...n, pitch: n.pitch - 1 };
    if (majorIntervals.has(upPc)) return { ...n, pitch: n.pitch + 1 };
    return n;
  });
}

let idSeq = 1000;
export function nextNoteId(): string {
  idSeq += 1;
  return `note_${Date.now().toString(36)}_${idSeq}`;
}
