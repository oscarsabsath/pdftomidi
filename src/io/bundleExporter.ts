import { zipSync } from 'fflate';
import { renderScoreToWav } from '../audio/choralSynth';
import { encodeMidiFile } from './midiCodec';
import { PlaybackSettings, ScoreData, VoiceId, VOICE_IDS, VOICE_META } from '../types/music';

function sanitizeFileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'himno_coral';
}

export function triggerBlobDownload(bytes: Uint8Array, fileName: string, mimeType: string): void {
  const safeBytes = new Uint8Array(bytes);
  const blob = new Blob([safeBytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadMidi(
  score: ScoreData,
  settings: PlaybackSettings,
  mode: 'full' | 'single' | 'highlighted',
  targetVoice?: VoiceId
): void {
  const base = sanitizeFileName(score.title);
  const suffix =
    mode === 'full'
      ? 'coro_completo'
      : mode === 'single' && targetVoice
        ? `${targetVoice}_solo`
        : `${targetVoice}_destacada`;

  const bytes = encodeMidiFile({
    score,
    tempoBpm: settings.tempoBpm,
    transposeSemitones: settings.transposeSemitones,
    verseCount: settings.verseCount,
    versePauseBeats: settings.versePauseBeats,
    instrument: settings.instrument,
    mode,
    targetVoice,
  });

  triggerBlobDownload(bytes, `${base}_${suffix}_${settings.verseCount}est.mid`, 'audio/midi');
}

export async function downloadWav(
  score: ScoreData,
  settings: PlaybackSettings,
  mode: 'full' | 'single' | 'highlighted',
  targetVoice?: VoiceId
): Promise<void> {
  const base = sanitizeFileName(score.title);
  const suffix =
    mode === 'full'
      ? 'coro_completo'
      : mode === 'single' && targetVoice
        ? `${targetVoice}_solo`
        : `${targetVoice}_destacada`;

  const bytes = await renderScoreToWav({
    score,
    tempoBpm: settings.tempoBpm,
    transposeSemitones: settings.transposeSemitones,
    verseCount: settings.verseCount,
    versePauseBeats: settings.versePauseBeats,
    instrument: settings.instrument,
    stereoSpread: settings.stereoSpread,
    mode,
    targetVoice,
  });

  triggerBlobDownload(bytes, `${base}_${suffix}_${settings.verseCount}est.wav`, 'audio/wav');
}

export async function downloadCompleteChoralZip(
  score: ScoreData,
  settings: PlaybackSettings,
  includeHighlightedWavs: boolean,
  onProgress?: (label: string, pct: number) => void
): Promise<void> {
  const base = sanitizeFileName(score.title);
  const files: Record<string, Uint8Array> = {};

  onProgress?.('Generando archivos MIDI (.mid)...', 10);

  // Full Choir MIDI + per-voice MIDIs
  files[`midi/${base}_coro_completo.mid`] = encodeMidiFile({
    score,
    tempoBpm: settings.tempoBpm,
    transposeSemitones: settings.transposeSemitones,
    verseCount: settings.verseCount,
    versePauseBeats: settings.versePauseBeats,
    instrument: settings.instrument,
    mode: 'full',
  });

  for (const v of VOICE_IDS) {
    files[`midi/${base}_${v}_solo.mid`] = encodeMidiFile({
      score,
      tempoBpm: settings.tempoBpm,
      transposeSemitones: settings.transposeSemitones,
      verseCount: settings.verseCount,
      versePauseBeats: settings.versePauseBeats,
      instrument: settings.instrument,
      mode: 'single',
      targetVoice: v,
    });
  }

  const wavTasks: Array<{ path: string; label: string; mode: 'full' | 'single' | 'highlighted'; voice?: VoiceId }> = [
    { path: `wav/${base}_coro_completo.wav`, label: 'Renderizando WAV: Coro Completo...', mode: 'full' },
    ...VOICE_IDS.map((v) => ({
      path: `wav/${base}_${v}_solo.wav`,
      label: `Renderizando WAV: ${VOICE_META[v].label} (Solo)...`,
      mode: 'single' as const,
      voice: v,
    })),
  ];

  if (includeHighlightedWavs) {
    for (const v of VOICE_IDS) {
      wavTasks.push({
        path: `wav_ensayo_destacado/${base}_${v}_destacada.wav`,
        label: `Renderizando WAV ensayo: ${VOICE_META[v].label} destacada...`,
        mode: 'highlighted',
        voice: v,
      });
    }
  }

  for (let i = 0; i < wavTasks.length; i++) {
    const task = wavTasks[i];
    const pct = 15 + Math.round(((i + 0.5) / wavTasks.length) * 78);
    onProgress?.(task.label, pct);
    files[task.path] = await renderScoreToWav({
      score,
      tempoBpm: settings.tempoBpm,
      transposeSemitones: settings.transposeSemitones,
      verseCount: settings.verseCount,
      versePauseBeats: settings.versePauseBeats,
      instrument: settings.instrument,
      stereoSpread: settings.stereoSpread,
      mode: task.mode,
      targetVoice: task.voice,
    });
  }

  onProgress?.('Empaquetando archivo .zip...', 96);
  const zipped = zipSync(files, { level: 1 });
  triggerBlobDownload(zipped, `${base}_estudio_coral_${settings.verseCount}est.zip`, 'application/zip');
}
