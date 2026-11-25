import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Download,
  FolderOpen,
  Music4,
  Pause,
  Play,
  Repeat,
  ScanEye,
  Sliders,
  Square,
} from 'lucide-react';
import { ChoralAudioEngine } from './audio/choralSynth';
import { ChoralMixerPanel } from './components/ChoralMixerPanel';
import { ExportStudioPanel } from './components/ExportStudioPanel';
import { OmrSheetViewer } from './components/OmrSheetViewer';
import { PianoRollEditor } from './components/PianoRollEditor';
import { UploadDropzone } from './components/UploadDropzone';
import {
  createAmazingGraceDemo,
  createSantoSantoDemo,
  generateSyntheticSheetMusicCanvas,
} from './data/demoScores';
import { parseMidiFile } from './io/midiCodec';
import { parseMusicXmlFile } from './io/musicXmlParser';
import { runAutonomousOmr } from './omr/omrEngine';
import { loadImageToCanvas, RenderedSheetPage, renderPdfToCanvases } from './omr/pdfLoader';
import {
  createDefaultMixer,
  DEFAULT_OMR_SETTINGS,
  MixerState,
  NoteEvent,
  OmrSettings,
  PlaybackSettings,
  ScoreData,
  VoiceId,
} from './types/music';
import {
  beatsToSeconds,
  cleanupVoiceOverlaps,
  formatDuration,
  getKeyInfo,
  getSingleVerseDurationBeats,
  KEY_SIGNATURES,
} from './utils/musicTheory';

type WorkspaceTab = 'pianoroll' | 'omr' | 'export';

export function App() {
  const [score, setScore] = useState<ScoreData | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('pianoroll');
  const [mixer, setMixer] = useState<MixerState>(createDefaultMixer);
  const [settings, setSettings] = useState<PlaybackSettings>({
    tempoBpm: 88,
    transposeSemitones: 0,
    verseCount: 4,
    versePauseBeats: 2,
    instrument: 'choir',
    metronome: false,
    stereoSpread: true,
    loop: false,
  });

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [currentVerse, setCurrentVerse] = useState(1);

  // Undo / Redo history for note edits
  const [history, setHistory] = useState<NoteEvent[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // OMR cached rendered canvases so the user can re-analyze with new threshold/key/time settings instantly
  const renderedPagesRef = useRef<RenderedSheetPage[]>([]);
  const [omrSettings, setOmrSettings] = useState<OmrSettings>(DEFAULT_OMR_SETTINGS);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputHeaderRef = useRef<HTMLInputElement>(null);
  const engineRef = useRef<ChoralAudioEngine | null>(null);

  // Initialize Web Audio Engine once
  useEffect(() => {
    const engine = new ChoralAudioEngine();
    engine.onBeatUpdate = (beat, verse, playing) => {
      setCurrentBeat(beat);
      setCurrentVerse(verse);
      setIsPlaying(playing);
    };
    engineRef.current = engine;
    return () => engine.dispose();
  }, []);

  // Keep engine synced with score, mixer & settings
  useEffect(() => {
    if (score && engineRef.current) {
      engineRef.current.updateState(score, mixer, settings);
    }
  }, [score, mixer, settings]);

  // Spacebar toggles play/pause globally
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.code === 'Space' && score) {
        e.preventDefault();
        if (engineRef.current?.getIsPlaying()) engineRef.current.pause();
        else engineRef.current?.play();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [score]);

  const loadNewScore = useCallback((newScore: ScoreData, defaultTab: WorkspaceTab = 'pianoroll') => {
    engineRef.current?.stop();
    setScore(newScore);
    setHistory([newScore.notes]);
    setHistoryIndex(0);
    setMixer(createDefaultMixer());
    setSettings((prev) => ({
      ...prev,
      tempoBpm: newScore.tempoBpm,
      transposeSemitones: 0,
    }));
    setCurrentBeat(0);
    setCurrentVerse(1);
    setActiveTab(defaultTab);
    setErrorMsg(null);
  }, []);

  const handleFileUpload = async (file: File) => {
    setErrorMsg(null);
    setIsProcessing(true);
    setProgressText('Leyendo archivo...');
    setProgressPct(10);

    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.mid') || lower.endsWith('.midi')) {
        renderedPagesRef.current = [];
        const buf = await file.arrayBuffer();
        const parsed = parseMidiFile(buf, file.name);
        loadNewScore(parsed, 'pianoroll');
      } else if (lower.endsWith('.xml') || lower.endsWith('.musicxml') || lower.endsWith('.mxl')) {
        renderedPagesRef.current = [];
        const parsed = await parseMusicXmlFile(file);
        loadNewScore(parsed, 'pianoroll');
      } else if (lower.endsWith('.pdf')) {
        const pages = await renderPdfToCanvases(file, (p, total) => {
          setProgressText(`Renderizando PDF página ${p} de ${total}...`);
          setProgressPct(Math.round((p / total) * 30));
        });
        renderedPagesRef.current = pages;
        const freshSettings = { ...DEFAULT_OMR_SETTINGS };
        setOmrSettings(freshSettings);
        const result = await runAutonomousOmr(
          pages,
          file.name.replace(/\.pdf$/i, ''),
          'omr-pdf',
          freshSettings,
          (stage, pct) => {
            setProgressText(stage);
            setProgressPct(30 + pct * 0.7);
          }
        );
        loadNewScore(result, 'omr');
      } else if (/\.(png|jpe?g|webp|bmp)$/i.test(lower)) {
        setProgressText('Preparando imagen de partitura...');
        setProgressPct(20);
        const pages = await loadImageToCanvas(file);
        renderedPagesRef.current = pages;
        const freshSettings = { ...DEFAULT_OMR_SETTINGS };
        setOmrSettings(freshSettings);
        const result = await runAutonomousOmr(
          pages,
          file.name.replace(/\.(png|jpe?g|webp|bmp)$/i, ''),
          'omr-image',
          freshSettings,
          (stage, pct) => {
            setProgressText(stage);
            setProgressPct(20 + pct * 0.8);
          }
        );
        loadNewScore(result, 'omr');
      } else {
        throw new Error(
          'Formato no soportado. Usa PDF, JPG, PNG, MusicXML (.xml/.musicxml/.mxl) o MIDI (.mid).'
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ocurrió un error al procesar el archivo.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLoadDemo = async (demoId: 'sublime' | 'santo' | 'omr-synthetic') => {
    setErrorMsg(null);
    if (demoId === 'sublime') {
      renderedPagesRef.current = [];
      loadNewScore(createAmazingGraceDemo(), 'pianoroll');
      return;
    }
    if (demoId === 'santo') {
      renderedPagesRef.current = [];
      loadNewScore(createSantoSantoDemo(), 'pianoroll');
      return;
    }

    // Synthetic OMR demo: generate a real Grand Staff image and run our local CV OMR engine on it!
    setIsProcessing(true);
    setProgressText('Generando imagen de partitura coral Sol+Fa...');
    setProgressPct(15);
    try {
      const canvas = generateSyntheticSheetMusicCanvas();
      const pages: RenderedSheetPage[] = [
        { pageIndex: 0, canvas, width: canvas.width, height: canvas.height },
      ];
      renderedPagesRef.current = pages;
      const freshSettings = { ...DEFAULT_OMR_SETTINGS };
      setOmrSettings(freshSettings);
      const result = await runAutonomousOmr(
        pages,
        'Himno de Prueba OMR (Sol Mayor)',
        'omr-image',
        freshSettings,
        (stage, pct) => {
          setProgressText(stage);
          setProgressPct(15 + pct * 0.85);
        }
      );
      loadNewScore(result, 'omr');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error ejecutando el OMR de demostración.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReanalyzeOmr = async (nextSettings: OmrSettings) => {
    if (!score || renderedPagesRef.current.length === 0) return;
    setIsProcessing(true);
    setProgressText('Re-analizando partitura con nuevos parámetros OMR...');
    setProgressPct(20);
    try {
      const result = await runAutonomousOmr(
        renderedPagesRef.current,
        score.title,
        score.sourceType === 'omr-pdf' ? 'omr-pdf' : 'omr-image',
        nextSettings,
        (stage, pct) => {
          setProgressText(stage);
          setProgressPct(pct);
        }
      );
      setScore(result);
      setHistory([result.notes]);
      setHistoryIndex(0);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al re-analizar OMR.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleChangeNotes = useCallback(
    (nextNotes: NoteEvent[], pushHistory = true) => {
      setScore((prev) => (prev ? { ...prev, notes: nextNotes } : prev));
      if (pushHistory) {
        setHistory((prevHist) => {
          const sliced = prevHist.slice(0, historyIndex + 1);
          const nextHist = [...sliced, nextNotes].slice(-40);
          setHistoryIndex(nextHist.length - 1);
          return nextHist;
        });
      }
    },
    [historyIndex]
  );

  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return;
    const prevIdx = historyIndex - 1;
    setHistoryIndex(prevIdx);
    setScore((prev) => (prev ? { ...prev, notes: history[prevIdx] } : prev));
  }, [history, historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const nextIdx = historyIndex + 1;
    setHistoryIndex(nextIdx);
    setScore((prev) => (prev ? { ...prev, notes: history[nextIdx] } : prev));
  }, [history, historyIndex]);

  const handleCleanupOverlaps = useCallback(() => {
    if (!score) return;
    const cleaned = cleanupVoiceOverlaps(score.notes);
    handleChangeNotes(cleaned, true);
  }, [score, handleChangeNotes]);

  const handlePreviewNote = useCallback(
    (pitch: number, voice: VoiceId) => {
      engineRef.current?.previewNote(pitch, voice, settings.instrument === 'choir' ? 'piano' : settings.instrument);
    },
    [settings.instrument]
  );

  const totalBeats = useMemo(() => {
    if (!score) return 16;
    const single = getSingleVerseDurationBeats(score.notes, score.timeSignature);
    return Math.max(
      1,
      settings.verseCount * single + Math.max(0, settings.verseCount - 1) * settings.versePauseBeats
    );
  }, [score, settings.verseCount, settings.versePauseBeats]);

  const currentSec = beatsToSeconds(currentBeat, settings.tempoBpm);
  const totalSec = beatsToSeconds(totalBeats, settings.tempoBpm);

  return (
    <div className="min-h-screen bg-[#060913] text-slate-100 flex flex-col">
      {/* Hidden global file input for "Cargar otro archivo" */}
      <input
        ref={fileInputHeaderRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.musicxml,.xml,.mxl,.mid,.midi"
        onChange={(e) => {
          if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Sticky Studio Header & Transport Bar */}
      <header className="sticky top-0 z-40 border-b border-slate-800/90 bg-slate-950/92 backdrop-blur-md">
        <div className="mx-auto max-w-[1440px] px-3 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => {
                engineRef.current?.stop();
                setScore(null);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-lg shadow-sky-500/20 hover:brightness-110 transition"
              title="Ir a la pantalla de inicio / Subir partitura"
            >
              <Music4 className="h-5 w-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-white">Estudio Coral OMR</span>
                <span className="hidden md:inline-block rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  Local · 0 Créditos
                </span>
              </div>
              {score ? (
                <input
                  value={score.title}
                  onChange={(e) => setScore({ ...score, title: e.target.value })}
                  className="bg-transparent text-xs text-slate-300 hover:text-white focus:text-white focus:outline-none border-b border-transparent focus:border-sky-500 w-52 sm:w-64 truncate"
                  title="Haz clic para editar el título del himno"
                />
              ) : (
                <p className="text-[11px] text-slate-400">PDF · Imagen · MusicXML · MIDI → SATB</p>
              )}
            </div>
          </div>

          {/* Center Transport Controls (when a score is loaded) */}
          {score && (
            <div className="flex flex-1 flex-wrap items-center justify-center gap-2.5 max-w-2xl">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => (isPlaying ? engineRef.current?.pause() : engineRef.current?.play())}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500 text-slate-950 shadow-md shadow-sky-500/25 hover:bg-sky-400 transition"
                  title={isPlaying ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'}
                >
                  {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
                </button>
                <button
                  onClick={() => engineRef.current?.stop()}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white transition"
                  title="Detener y volver al inicio"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
                <button
                  onClick={() => setSettings((s) => ({ ...s, loop: !s.loop }))}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
                    settings.loop
                      ? 'border-sky-400/60 bg-sky-500/20 text-sky-300'
                      : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                  title="Repetir himno en bucle"
                >
                  <Repeat className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Progress scrub slider */}
              <div className="flex flex-1 min-w-[180px] items-center gap-2">
                <span className="font-mono text-[11px] text-slate-300 w-10 text-right">
                  {formatDuration(currentSec)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={totalBeats}
                  step={0.25}
                  value={Math.min(totalBeats, currentBeat)}
                  onChange={(e) => engineRef.current?.seek(parseFloat(e.target.value))}
                  className="flex-1 h-1.5 cursor-pointer"
                />
                <span className="font-mono text-[11px] text-slate-400 w-10">
                  {formatDuration(totalSec)}
                </span>
              </div>

              <span className="rounded-md border border-sky-500/30 bg-sky-950/40 px-2 py-1 font-mono text-[11px] font-semibold text-sky-300">
                Estrofa {currentVerse}/{settings.verseCount}
              </span>
            </div>
          )}

          {/* Right: Score Metadata & Upload New */}
          <div className="flex items-center gap-2 shrink-0">
            {score && (
              <>
                <select
                  value={score.keySignatureFifths}
                  onChange={(e) =>
                    setScore({ ...score, keySignatureFifths: parseInt(e.target.value, 10) })
                  }
                  title="Armadura de la partitura"
                  className="hidden lg:block shrink-0 whitespace-nowrap rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200"
                >
                  {KEY_SIGNATURES.map((k) => (
                    <option key={k.fifths} value={k.fifths}>
                      {k.majorNameEs}
                    </option>
                  ))}
                </select>
                <select
                  value={`${score.timeSignature.numerator}/${score.timeSignature.denominator}`}
                  onChange={(e) => {
                    const [num, den] = e.target.value.split('/').map(Number);
                    setScore({ ...score, timeSignature: { numerator: num, denominator: den } });
                  }}
                  title="Compás de la partitura"
                  className="hidden lg:block shrink-0 whitespace-nowrap rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-200"
                >
                  <option value="4/4">4/4</option>
                  <option value="3/4">3/4</option>
                  <option value="2/4">2/4</option>
                  <option value="6/8">6/8</option>
                  <option value="3/2">3/2</option>
                </select>
                <button
                  onClick={() => fileInputHeaderRef.current?.click()}
                  className="flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-sky-400 hover:text-white transition"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-sky-400" />
                  <span className="hidden sm:inline">Abrir partitura</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Error Toast / Banner */}
      {errorMsg && (
        <div className="mx-auto max-w-4xl w-full px-4 pt-3">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/40 bg-rose-950/50 px-3.5 py-2.5 text-xs text-rose-200">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
              {errorMsg}
            </span>
            <button onClick={() => setErrorMsg(null)} className="text-rose-300 hover:text-white font-bold">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 mx-auto w-full max-w-[1440px] px-3 sm:px-5 py-4">
        {!score ? (
          <UploadDropzone
            onSelectFile={handleFileUpload}
            onLoadDemo={handleLoadDemo}
            isProcessing={isProcessing}
            progressText={progressText}
            progressPct={progressPct}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {/* Workspace Navigation Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/80 p-1">
                <button
                  onClick={() => setActiveTab('pianoroll')}
                  className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                    activeTab === 'pianoroll'
                      ? 'bg-sky-500 text-slate-950 shadow'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                  }`}
                >
                  <Sliders className="h-3.5 w-3.5" />
                  Piano Roll SATB
                </button>

                {score.omrAnalysis && (
                  <button
                    onClick={() => setActiveTab('omr')}
                    className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                      activeTab === 'omr'
                        ? 'bg-sky-500 text-slate-950 shadow'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                    }`}
                  >
                    <ScanEye className="h-3.5 w-3.5" />
                    Visor Partitura OMR
                  </button>
                )}

                <button
                  onClick={() => setActiveTab('export')}
                  className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                    activeTab === 'export'
                      ? 'bg-emerald-400 text-slate-950 shadow'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                  }`}
                >
                  <Download className="h-3.5 w-3.5" />
                  Descargar .MID / .WAV
                </button>
              </div>

              {/* Quick score metadata badge */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="rounded-md border border-slate-800 bg-slate-900/70 px-2.5 py-1">
                  Origen:{' '}
                  <strong className="text-slate-200 uppercase text-[11px]">{score.sourceType}</strong>
                </span>
                <span className="rounded-md border border-slate-800 bg-slate-900/70 px-2.5 py-1">
                  Armadura: <strong className="text-slate-200">{getKeyInfo(score.keySignatureFifths).majorNameEs}</strong>
                </span>
                <span className="rounded-md border border-slate-800 bg-slate-900/70 px-2.5 py-1 font-mono">
                  {score.timeSignature.numerator}/{score.timeSignature.denominator}
                </span>
              </div>
            </div>

            {/* Active Workspace View */}
            {activeTab === 'pianoroll' && (
              <PianoRollEditor
                notes={score.notes}
                timeSignature={score.timeSignature}
                currentBeat={currentBeat}
                versePauseBeats={settings.versePauseBeats}
                isPlaying={isPlaying}
                transposeSemitones={settings.transposeSemitones}
                onChangeNotes={handleChangeNotes}
                onPreviewNote={handlePreviewNote}
                onSeek={(beat) => engineRef.current?.seek(beat)}
                onUndo={handleUndo}
                onRedo={handleRedo}
                canUndo={historyIndex > 0}
                canRedo={historyIndex < history.length - 1}
                onCleanupOverlaps={handleCleanupOverlaps}
              />
            )}

            {activeTab === 'omr' && score.omrAnalysis && (
              <OmrSheetViewer
                analysis={score.omrAnalysis}
                settings={omrSettings}
                isReanalyzing={isProcessing}
                onChangeSettings={setOmrSettings}
                onReanalyze={handleReanalyzeOmr}
              />
            )}

            {activeTab === 'export' && <ExportStudioPanel score={score} settings={settings} />}

            {/* Persistent Choral Mixer + Estrofas + Tempo + Tono Panel */}
            <ChoralMixerPanel
              notes={score.notes}
              timeSignature={score.timeSignature}
              keySignatureFifths={score.keySignatureFifths}
              baseTempoBpm={score.tempoBpm}
              mixer={mixer}
              settings={settings}
              onChangeMixer={setMixer}
              onChangeSettings={setSettings}
            />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
