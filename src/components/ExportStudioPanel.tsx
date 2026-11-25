import React, { useState } from 'react';
import {
  Archive,
  Download,
  FileAudio,
  FileMusic,
  Loader2,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  downloadCompleteChoralZip,
  downloadMidi,
  downloadWav,
} from '../io/bundleExporter';
import {
  PlaybackSettings,
  ScoreData,
  VoiceId,
  VOICE_IDS,
  VOICE_META,
} from '../types/music';
import {
  beatsToSeconds,
  formatDuration,
  getSingleVerseDurationBeats,
  getTransposedKeyLabel,
  getVoicePitchStats,
} from '../utils/musicTheory';

interface ExportStudioPanelProps {
  score: ScoreData;
  settings: PlaybackSettings;
}

export const ExportStudioPanel: React.FC<ExportStudioPanelProps> = ({ score, settings }) => {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [zipProgress, setZipProgress] = useState<{ label: string; pct: number } | null>(null);
  const [includeHighlightedInZip, setIncludeHighlightedInZip] = useState(true);

  const singleBeats = getSingleVerseDurationBeats(score.notes, score.timeSignature);
  const totalBeats =
    settings.verseCount * singleBeats + Math.max(0, settings.verseCount - 1) * settings.versePauseBeats;
  const totalSec = beatsToSeconds(totalBeats, settings.tempoBpm);

  const handleWavDownload = async (
    key: string,
    mode: 'full' | 'single' | 'highlighted',
    voice?: VoiceId
  ) => {
    try {
      setBusyKey(key);
      await downloadWav(score, settings, mode, voice);
    } finally {
      setBusyKey(null);
    }
  };

  const handleZipDownload = async () => {
    try {
      setBusyKey('zip');
      await downloadCompleteChoralZip(score, settings, includeHighlightedInZip, (label, pct) => {
        setZipProgress({ label, pct });
      });
    } finally {
      setBusyKey(null);
      setZipProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-800/90 bg-slate-950/90 p-4 shadow-xl">
      {/* Header Summary Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/80 p-3.5">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Download className="h-4 w-4 text-sky-400" />
            Descarga Directa de Archivos .MID y .WAV (100% Local)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Todas las descargas incluyen exactamente tus ajustes actuales:{' '}
            <strong className="text-sky-300">{settings.verseCount} estrofa{settings.verseCount > 1 ? 's' : ''}</strong> ·{' '}
            <strong className="text-slate-200">{formatDuration(totalSec)}</strong> ·{' '}
            <strong className="text-slate-200">{settings.tempoBpm} BPM</strong> ·{' '}
            <strong className="text-pink-300">
              {getTransposedKeyLabel(score.keySignatureFifths, settings.transposeSemitones)}
            </strong>
            .
          </p>
        </div>

        {/* One-Click ZIP Bundle */}
        <div className="flex flex-col items-end gap-1.5">
          <button
            onClick={handleZipDownload}
            disabled={busyKey !== null || score.notes.length === 0}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-sky-500 to-indigo-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-sky-500/20 hover:from-sky-400 hover:to-indigo-400 disabled:opacity-50 transition"
          >
            {busyKey === 'zip' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
            Descargar Paquete Completo (.ZIP)
          </button>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={includeHighlightedInZip}
              onChange={(e) => setIncludeHighlightedInZip(e.target.checked)}
            />
            Incluir audios de ensayo con voz destacada (.WAV)
          </label>
        </div>
      </div>

      {/* Live ZIP progress bar */}
      {zipProgress && (
        <div className="rounded-lg border border-sky-500/35 bg-sky-950/30 p-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-sky-200 font-medium">{zipProgress.label}</span>
            <span className="font-mono text-sky-300">{zipProgress.pct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-900 overflow-hidden">
            <div
              className="h-full bg-sky-400 transition-all duration-200"
              style={{ width: `${zipProgress.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Full Choir Row */}
      <div className="rounded-xl border border-sky-500/30 bg-gradient-to-r from-slate-900/95 to-sky-950/30 p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/20 border border-sky-400/40 text-sky-300">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Coro Completo (4 Voces SATB)</div>
            <div className="text-xs text-slate-400">
              MIDI multipista con 4 pistas nombradas (S/A/T/B) y audio WAV estéreo 44.1 kHz 16-bit
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => downloadMidi(score, settings, 'full')}
            disabled={score.notes.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-100 hover:border-sky-400 hover:text-sky-300 disabled:opacity-45 transition"
          >
            <FileMusic className="h-4 w-4 text-sky-400" />
            Descargar .MID
          </button>
          <button
            onClick={() => handleWavDownload('full_wav', 'full')}
            disabled={busyKey !== null || score.notes.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 disabled:opacity-45 transition"
          >
            {busyKey === 'full_wav' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileAudio className="h-4 w-4" />
            )}
            Descargar .WAV
          </button>
        </div>
      </div>

      {/* Per-Voice Export Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {VOICE_IDS.map((v) => {
          const meta = VOICE_META[v];
          const stats = getVoicePitchStats(score.notes, v);
          const hasNotes = stats.count > 0;

          return (
            <div
              key={v}
              className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/75 p-3.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span
                    className="h-3.5 w-3.5 rounded-full"
                    style={{ backgroundColor: meta.color }}
                  />
                  <div>
                    <div className="text-sm font-bold text-white">{meta.label}</div>
                    <div className="text-[11px] font-mono text-slate-400">
                      {stats.count} notas · {stats.rangeLabel}
                    </div>
                  </div>
                </div>
                <span className="rounded bg-slate-950 border border-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-400">
                  Canal MIDI {meta.midiChannel + 1}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => downloadMidi(score, settings, 'single', v)}
                  disabled={!hasNotes}
                  className="flex items-center justify-center gap-1 rounded-lg border border-slate-700/80 bg-slate-950 px-2 py-2 text-[11px] font-semibold text-slate-200 hover:border-sky-400/60 hover:text-white disabled:opacity-35 transition"
                >
                  <FileMusic className="h-3.5 w-3.5 text-sky-400" />
                  Solo .MID
                </button>

                <button
                  onClick={() => handleWavDownload(`${v}_solo`, 'single', v)}
                  disabled={busyKey !== null || !hasNotes}
                  className="flex items-center justify-center gap-1 rounded-lg border border-slate-700/80 bg-slate-950 px-2 py-2 text-[11px] font-semibold text-slate-200 hover:border-emerald-400/60 hover:text-white disabled:opacity-35 transition"
                >
                  {busyKey === `${v}_solo` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileAudio className="h-3.5 w-3.5 text-emerald-400" />
                  )}
                  Solo .WAV
                </button>

                <button
                  onClick={() => handleWavDownload(`${v}_hl`, 'highlighted', v)}
                  disabled={busyKey !== null || !hasNotes}
                  title="Esta voz al frente (+6 dB) y el resto del coro suave de fondo para ensayar"
                  className="flex items-center justify-center gap-1 rounded-lg border border-amber-500/35 bg-amber-950/30 px-2 py-2 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-35 transition"
                >
                  {busyKey === `${v}_hl` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                  )}
                  Destac. WAV
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
