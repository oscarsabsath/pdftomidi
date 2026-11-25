export type VoiceId = 'soprano' | 'contralto' | 'tenor' | 'bajo';

export const VOICE_IDS: VoiceId[] = ['soprano', 'contralto', 'tenor', 'bajo'];

export interface VoiceMeta {
  id: VoiceId;
  label: string;
  shortLabel: string;
  clef: 'treble' | 'bass';
  color: string;
  colorLight: string;
  colorDark: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  midiChannel: number;
  minPitch: number;
  maxPitch: number;
  defaultPan: number;
}

export const VOICE_META: Record<VoiceId, VoiceMeta> = {
  soprano: {
    id: 'soprano',
    label: 'Soprano',
    shortLabel: 'S',
    clef: 'treble',
    color: '#38bdf8',
    colorLight: '#7dd3fc',
    colorDark: '#0284c7',
    bgClass: 'bg-sky-500',
    textClass: 'text-sky-400',
    borderClass: 'border-sky-500/50',
    midiChannel: 0,
    minPitch: 60, // C4
    maxPitch: 81, // A5
    defaultPan: -0.35,
  },
  contralto: {
    id: 'contralto',
    label: 'Contralto',
    shortLabel: 'A',
    clef: 'treble',
    color: '#34d399',
    colorLight: '#6ee7b7',
    colorDark: '#059669',
    bgClass: 'bg-emerald-500',
    textClass: 'text-emerald-400',
    borderClass: 'border-emerald-500/50',
    midiChannel: 1,
    minPitch: 53, // F3
    maxPitch: 74, // D5
    defaultPan: -0.12,
  },
  tenor: {
    id: 'tenor',
    label: 'Tenor',
    shortLabel: 'T',
    clef: 'bass',
    color: '#fbbf24',
    colorLight: '#fcd34d',
    colorDark: '#d97706',
    bgClass: 'bg-amber-500',
    textClass: 'text-amber-400',
    borderClass: 'border-amber-500/50',
    midiChannel: 2,
    minPitch: 48, // C3
    maxPitch: 69, // A4
    defaultPan: 0.12,
  },
  bajo: {
    id: 'bajo',
    label: 'Bajo',
    shortLabel: 'B',
    clef: 'bass',
    color: '#f472b6',
    colorLight: '#f9a8d4',
    colorDark: '#db2777',
    bgClass: 'bg-pink-500',
    textClass: 'text-pink-400',
    borderClass: 'border-pink-500/50',
    midiChannel: 3,
    minPitch: 38, // D2
    maxPitch: 62, // D4
    defaultPan: 0.35,
  },
};

export interface NoteEvent {
  id: string;
  voice: VoiceId;
  pitch: number; // MIDI 0..127
  startBeat: number; // in quarter-note beats
  durationBeats: number; // in quarter-note beats
  velocity: number; // 1..127
  pageIndex?: number;
  bbox?: { x: number; y: number; w: number; h: number };
}

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

export interface DetectedStaff {
  pageIndex: number;
  systemIndex: number;
  staffIndexInSystem: number;
  clef: 'treble' | 'bass';
  lineYs: number[]; // 5 Y positions top to bottom
  staffSpace: number;
  lineThickness: number;
  leftX: number;
  rightX: number;
  barlineXs: number[];
}

export interface DetectedOmrNote {
  pageIndex: number;
  systemIndex: number;
  staffClef: 'treble' | 'bass';
  x: number;
  y: number;
  w: number;
  h: number;
  isHollow: boolean;
  stemDir: 'up' | 'down' | 'none';
  hasFlagOrBeam: boolean;
  isDotted: boolean;
  accidental: -1 | 0 | 1;
  diatonicStep: number;
  pitch: number;
  voice: VoiceId;
  durationBeats: number;
  startBeat: number;
  confidence: number;
}

export interface OmrPageResult {
  pageIndex: number;
  width: number;
  height: number;
  imageUrl: string;
  deskewAngleDeg: number;
  staves: DetectedStaff[];
  detectedNotes: DetectedOmrNote[];
}

export interface OmrSettings {
  thresholdBias: number; // -35..+35
  sensitivity: number; // 0.3..1.0
  keyOverride: number | 'auto'; // -7..+7 or 'auto'
  timeSigOverride: string | 'auto'; // '4/4', '3/4', '2/4', '6/8', '3/2', or 'auto'
  layoutMode: 'auto' | 'grand-staff' | 'four-staves';
}

export interface OmrAnalysisResult {
  pages: OmrPageResult[];
  detectedKeyFifths: number;
  detectedTimeSignature: TimeSignature;
  detectedLayout: 'grand-staff' | 'four-staves' | 'single-staff';
  totalStaves: number;
  totalSystems: number;
  totalNotes: number;
  averageConfidence: number;
  warnings: string[];
  settingsUsed: OmrSettings;
}

export type SourceType = 'omr-pdf' | 'omr-image' | 'musicxml' | 'midi' | 'demo';

export interface ScoreData {
  id: string;
  title: string;
  sourceType: SourceType;
  tempoBpm: number;
  timeSignature: TimeSignature;
  keySignatureFifths: number; // -7..+7
  notes: NoteEvent[];
  omrAnalysis?: OmrAnalysisResult;
}

export interface VoiceMixState {
  muted: boolean;
  solo: boolean;
  highlighted: boolean;
  volume: number; // 0..1.5
  pan: number; // -1..1
}

export type MixerState = Record<VoiceId, VoiceMixState>;

export type SynthInstrument = 'choir' | 'piano' | 'organ' | 'strings';

export interface PlaybackSettings {
  tempoBpm: number;
  transposeSemitones: number; // -12..+12
  verseCount: number; // 1..10
  versePauseBeats: number; // 0, 1, 2, 4
  instrument: SynthInstrument;
  metronome: boolean;
  stereoSpread: boolean;
  loop: boolean;
}

export const DEFAULT_OMR_SETTINGS: OmrSettings = {
  thresholdBias: 0,
  sensitivity: 0.65,
  keyOverride: 'auto',
  timeSigOverride: 'auto',
  layoutMode: 'auto',
};

export function createDefaultMixer(): MixerState {
  return {
    soprano: { muted: false, solo: false, highlighted: false, volume: 1.0, pan: VOICE_META.soprano.defaultPan },
    contralto: { muted: false, solo: false, highlighted: false, volume: 1.0, pan: VOICE_META.contralto.defaultPan },
    tenor: { muted: false, solo: false, highlighted: false, volume: 1.0, pan: VOICE_META.tenor.defaultPan },
    bajo: { muted: false, solo: false, highlighted: false, volume: 1.0, pan: VOICE_META.bajo.defaultPan },
  };
}
