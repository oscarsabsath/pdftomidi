import React from 'react';
import {
  Gauge,
  Headphones,
  Music2,
  Repeat,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  MixerState,
  NoteEvent,
  PlaybackSettings,
  SynthInstrument,
  TimeSignature,
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

interface ChoralMixerPanelProps {
  notes: NoteEvent[];
  timeSignature: TimeSignature;
  keySignatureFifths: number;
  baseTempoBpm: number;
  mixer: MixerState;
  settings: PlaybackSettings;
  onChangeMixer: (next: MixerState) => void;
  onChangeSettings: (next: PlaybackSettings) => void;
}

const INSTRUMENTS: Array<{ id: SynthInstrument; label: string; desc: string }> = [
  { id: 'choir', label: 'Coro Vocal', desc: 'Formantes SATB' },
  { id: 'piano', label: 'Piano Ensayo', desc: 'Ataque nítido' },
  { id: 'organ', label: 'Órgano Iglesia', desc: 'Tubos armónicos' },
  { id: 'strings', label: 'Cuerdas', desc: 'Ensamble suave' },
];

export const ChoralMixerPanel: React.FC<ChoralMixerPanelProps> = ({
  notes,
  timeSignature,
  keySignatureFifths,
  baseTempoBpm,
  mixer,
  settings,
  onChangeMixer,
  onChangeSettings,
}) => {
  const singleVerseBeats = getSingleVerseDurationBeats(notes, timeSignature);
  const totalBeats =
    settings.verseCount * singleVerseBeats + Math.max(0, settings.verseCount - 1) * settings.versePauseBeats;
  const singleSec = beatsToSeconds(singleVerseBeats, settings.tempoBpm);
  const totalSec = beatsToSeconds(totalBeats, settings.tempoBpm);

  const toggleHighlight = (voice: VoiceId) => {
    const next = { ...mixer };
    const willHighlight = !mixer[voice].highlighted;
    // Highlighting focuses one voice cleanly (exclusive by default for choral practice)
    for (const v of VOICE_IDS) {
      next[v] = {
        ...mixer[v],
        highlighted: v === voice ? willHighlight : false,
        muted: v === voice && willHighlight ? false : mixer[v].muted,
      };
    }
    onChangeMixer(next);
  };

  const toggleSolo = (voice: VoiceId) => {
    onChangeMixer({
      ...mixer,
      [voice]: {
        ...mixer[voice],
        solo: !mixer[voice].solo,
        muted: !mixer[voice].solo ? false : mixer[voice].muted,
      },
    });
  };

  const toggleMute = (voice: VoiceId) => {
    onChangeMixer({
      ...mixer,
      [voice]: {
        ...mixer[voice],
        muted: !mixer[voice].muted,
        solo: !mixer[voice].muted ? false : mixer[voice].solo,
      },
    });
  };

  const setVolume = (voice: VoiceId, volume: number) => {
    onChangeMixer({
      ...mixer,
      [voice]: { ...mixer[voice], volume },
    });
  };

  const resetMixer = () => {
    const next = { ...mixer };
    for (const v of VOICE_IDS) {
      next[v] = { ...mixer[v], muted: false, solo: false, highlighted: false, volume: 1.0 };
    }
    onChangeMixer(next);
  };

  const anyActiveFilter = VOICE_IDS.some(
    (v) => mixer[v].muted || mixer[v].solo || mixer[v].highlighted
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      {/* Left 7 cols: 4-Voice Choral Mixer (Destacar / Solo / Silenciar / Volumen) */}
      <div className="xl:col-span-7 rounded-xl border border-slate-800/90 bg-slate-900/65 p-3.5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Headphones className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-white">Mezclador Coral SATB</h2>
          </div>
          {anyActiveFilter && (
            <button
              onClick={resetMixer}
              className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-0.5 text-[11px] text-slate-300 hover:text-white"
            >
              <RotateCcw className="h-3 w-3" />
              Escuchar todo igual
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {VOICE_IDS.map((v) => {
            const meta = VOICE_META[v];
            const st = mixer[v];
            const stats = getVoicePitchStats(notes, v);
            const anySolo = VOICE_IDS.some((id) => mixer[id].solo);
            const isEffectivelySilent = st.muted || (anySolo && !st.solo);

            return (
              <div
                key={v}
                className={`relative flex flex-col gap-2 rounded-lg border p-2.5 transition ${
                  st.highlighted
                    ? 'border-amber-400/70 bg-slate-900 shadow-lg shadow-amber-500/10'
                    : st.solo
                      ? 'border-sky-400/70 bg-slate-900'
                      : isEffectivelySilent
                        ? 'border-slate-800/60 bg-slate-950/60 opacity-65'
                        : 'border-slate-800 bg-slate-950/80'
                }`}
              >
                {/* Top color indicator & stats */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full ring-2 ring-white/15"
                      style={{ backgroundColor: meta.color }}
                    />
                    <div>
                      <div className="text-xs font-bold text-white leading-tight flex items-center gap-1.5">
                        {meta.label}
                        <span className="text-[10px] font-normal text-slate-400">
                          ({meta.clef === 'treble' ? 'Sol' : 'Fa'})
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-slate-400">
                        {stats.count} notas · {stats.rangeLabel}
                      </div>
                    </div>
                  </div>

                  <span className="font-mono text-[11px] text-slate-300">
                    {Math.round(st.volume * 100)}%
                  </span>
                </div>

                {/* Action buttons: Destacar / Solo / Silenciar */}
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    onClick={() => toggleHighlight(v)}
                    title="Destacar esta voz (+6 dB y guía clara) manteniendo el coro suave de fondo"
                    className={`flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold border transition ${
                      st.highlighted
                        ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-sm'
                        : 'bg-slate-900 text-slate-300 border-slate-700/80 hover:border-amber-400/60 hover:text-amber-300'
                    }`}
                  >
                    <Sparkles className="h-3 w-3" />
                    Destacar
                  </button>
                  <button
                    onClick={() => toggleSolo(v)}
                    title="Escuchar únicamente esta voz"
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold border transition ${
                      st.solo
                        ? 'bg-sky-400 text-slate-950 border-sky-300 shadow-sm'
                        : 'bg-slate-900 text-slate-300 border-slate-700/80 hover:border-sky-400/60 hover:text-sky-300'
                    }`}
                  >
                    Solo
                  </button>
                  <button
                    onClick={() => toggleMute(v)}
                    title="Silenciar esta voz"
                    className={`flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold border transition ${
                      st.muted
                        ? 'bg-rose-500 text-white border-rose-400'
                        : 'bg-slate-900 text-slate-300 border-slate-700/80 hover:border-rose-400/60 hover:text-rose-300'
                    }`}
                  >
                    {st.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                    {st.muted ? 'Mudo' : 'Silenc.'}
                  </button>
                </div>

                {/* Volume slider */}
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={st.volume}
                  onChange={(e) => setVolume(v, parseFloat(e.target.value))}
                  className="w-full h-1.5 cursor-pointer"
                  style={{ accentColor: meta.color }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Right 5 cols: Estrofas/Repeticiones + Tempo + Tono + Instrumento */}
      <div className="xl:col-span-5 flex flex-col justify-between gap-3 rounded-xl border border-slate-800/90 bg-slate-900/65 p-3.5">
        {/* Estrofas / Repeticiones */}
        <div className="rounded-lg border border-sky-500/25 bg-sky-950/20 p-2.5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Repeat className="h-4 w-4 text-sky-400" />
              <span className="text-xs font-semibold text-white">Estrofas / Repeticiones del Himno</span>
            </div>
            <span className="rounded-full bg-sky-500/20 px-2 py-0.5 font-mono text-[11px] font-semibold text-sky-300">
              Total: {formatDuration(totalSec)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  onClick={() => onChangeSettings({ ...settings, verseCount: n })}
                  className={`h-7 w-7 rounded-md font-mono text-xs font-bold border transition ${
                    settings.verseCount === n
                      ? 'bg-sky-400 text-slate-950 border-sky-300'
                      : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-sky-500/60'
                  }`}
                >
                  {n}
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={12}
                value={settings.verseCount}
                onChange={(e) =>
                  onChangeSettings({
                    ...settings,
                    verseCount: Math.max(1, Math.min(12, parseInt(e.target.value || '1', 10))),
                  })
                }
                title="Número personalizado de estrofas (1 a 12)"
                className="w-12 h-7 rounded-md border border-slate-700 bg-slate-950 px-1.5 text-center font-mono text-xs text-white"
              />
            </div>

            <select
              value={settings.versePauseBeats}
              onChange={(e) =>
                onChangeSettings({ ...settings, versePauseBeats: parseFloat(e.target.value) })
              }
              className="ml-auto rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200"
              title="Respiración entre estrofas"
            >
              <option value={0}>Sin pausa</option>
              <option value={1}>Respiro: 1 tiempo</option>
              <option value={2}>Respiro: 2 tiempos</option>
              <option value={4}>Respiro: 4 tiempos</option>
            </select>
          </div>

          <div className="mt-1.5 text-[10.5px] text-slate-400">
            1 estrofa dura <span className="font-mono text-slate-200">{formatDuration(singleSec)}</span> · Se aplica a la reproducción y a las descargas <span className="text-sky-300 font-medium">.MID y .WAV</span>.
          </div>
        </div>

        {/* Tempo & Tono (Transposition) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* Tempo */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/75 p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1 text-xs font-medium text-slate-300">
                <Gauge className="h-3.5 w-3.5 text-emerald-400" />
                Tempo
              </span>
              <div className="flex items-center gap-1">
                <span className="font-mono text-xs font-bold text-white">{settings.tempoBpm} BPM</span>
                {settings.tempoBpm !== baseTempoBpm && (
                  <button
                    onClick={() => onChangeSettings({ ...settings, tempoBpm: baseTempoBpm })}
                    title="Restaurar tempo original"
                    className="text-[10px] text-sky-400 hover:underline ml-1"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
            <input
              type="range"
              min={44}
              max={180}
              step={1}
              value={settings.tempoBpm}
              onChange={(e) => onChangeSettings({ ...settings, tempoBpm: parseInt(e.target.value, 10) })}
              className="w-full h-1.5 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-0.5">
              <span>Lento</span>
              <span>{Math.round((settings.tempoBpm / Math.max(1, baseTempoBpm)) * 100)}%</span>
              <span>Rápido</span>
            </div>
          </div>

          {/* Tono / Transposición */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/75 p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1 text-xs font-medium text-slate-300">
                <Music2 className="h-3.5 w-3.5 text-pink-400" />
                Tono
              </span>
              <span className="font-mono text-[11px] font-bold text-pink-300">
                {getTransposedKeyLabel(keySignatureFifths, settings.transposeSemitones)}{' '}
                ({settings.transposeSemitones > 0 ? `+${settings.transposeSemitones}` : settings.transposeSemitones} st)
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() =>
                  onChangeSettings({
                    ...settings,
                    transposeSemitones: Math.max(-12, settings.transposeSemitones - 1),
                  })
                }
                className="h-6 w-7 rounded border border-slate-700 bg-slate-900 text-xs font-bold text-slate-200 hover:bg-slate-800"
              >
                -1
              </button>
              <input
                type="range"
                min={-12}
                max={12}
                step={1}
                value={settings.transposeSemitones}
                onChange={(e) =>
                  onChangeSettings({ ...settings, transposeSemitones: parseInt(e.target.value, 10) })
                }
                className="flex-1 h-1.5 cursor-pointer"
              />
              <button
                onClick={() =>
                  onChangeSettings({
                    ...settings,
                    transposeSemitones: Math.min(12, settings.transposeSemitones + 1),
                  })
                }
                className="h-6 w-7 rounded border border-slate-700 bg-slate-900 text-xs font-bold text-slate-200 hover:bg-slate-800"
              >
                +1
              </button>
            </div>
            {settings.transposeSemitones !== 0 && (
              <button
                onClick={() => onChangeSettings({ ...settings, transposeSemitones: 0 })}
                className="mt-1 text-[10px] text-sky-400 hover:underline"
              >
                Volver al tono original
              </button>
            )}
          </div>
        </div>

        {/* Instrument Selector + Metronome / Stereo */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {INSTRUMENTS.map((inst) => (
              <button
                key={inst.id}
                onClick={() => onChangeSettings({ ...settings, instrument: inst.id })}
                title={inst.desc}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold border transition ${
                  settings.instrument === inst.id
                    ? 'bg-sky-500/20 text-sky-200 border-sky-400/50'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                {inst.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 text-[11px] text-slate-300">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.metronome}
                onChange={(e) => onChangeSettings({ ...settings, metronome: e.target.checked })}
              />
              Metrónomo
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.stereoSpread}
                onChange={(e) => onChangeSettings({ ...settings, stereoSpread: e.target.checked })}
              />
              Estéreo
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
