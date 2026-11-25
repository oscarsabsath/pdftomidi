import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Eraser,
  Maximize2,
  MousePointer2,
  Pencil,
  Redo2,
  Sparkles,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { NoteEvent, TimeSignature, VoiceId, VOICE_IDS, VOICE_META } from '../types/music';
import {
  getBeatsPerMeasure,
  getSingleVerseDurationBeats,
  isBlackKey,
  midiToNoteName,
  nextNoteId,
} from '../utils/musicTheory';

interface PianoRollEditorProps {
  notes: NoteEvent[];
  timeSignature: TimeSignature;
  currentBeat: number;
  versePauseBeats: number;
  isPlaying: boolean;
  transposeSemitones: number;
  onChangeNotes: (nextNotes: NoteEvent[], pushHistory?: boolean) => void;
  onPreviewNote: (pitch: number, voice: VoiceId) => void;
  onSeek: (beat: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onCleanupOverlaps: () => void;
}

type EditorTool = 'select' | 'draw' | 'erase';

const MIN_PITCH = 36; // C2
const MAX_PITCH = 84; // C6
const NUM_PITCHES = MAX_PITCH - MIN_PITCH + 1;
const KEYBOARD_WIDTH = 58;
const RULER_HEIGHT = 28;
const ROW_HEIGHT = 17;

export const PianoRollEditor: React.FC<PianoRollEditorProps> = ({
  notes,
  timeSignature,
  currentBeat,
  versePauseBeats,
  isPlaying,
  transposeSemitones,
  onChangeNotes,
  onPreviewNote,
  onSeek,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onCleanupOverlaps,
}) => {
  const [tool, setTool] = useState<EditorTool>('select');
  const [activeVoice, setActiveVoice] = useState<VoiceId>('soprano');
  const [focusVoice, setFocusVoice] = useState<VoiceId | 'all'>('all');
  const [snapBeats, setSnapBeats] = useState<number>(0.5); // 0 = free, 0.25, 0.5, 1
  const [drawDuration, setDrawDuration] = useState<number>(1);
  const [pxPerBeat, setPxPerBeat] = useState<number>(48);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);
  const rulerCanvasRef = useRef<HTMLCanvasElement>(null);
  const keysCanvasRef = useRef<HTMLCanvasElement>(null);

  const dragRef = useRef<{
    mode: 'move' | 'resize' | 'none';
    noteId: string;
    startClientX: number;
    startClientY: number;
    origNotes: NoteEvent[];
    lastPreviewPitch: number;
    moved: boolean;
  }>({
    mode: 'none',
    noteId: '',
    startClientX: 0,
    startClientY: 0,
    origNotes: [],
    lastPreviewPitch: -1,
    moved: false,
  });

  const beatsPerMeasure = getBeatsPerMeasure(timeSignature);
  const verseLengthBeats = useMemo(
    () => Math.max(beatsPerMeasure * 4, getSingleVerseDurationBeats(notes, timeSignature)),
    [notes, timeSignature, beatsPerMeasure]
  );
  const totalGridBeats = verseLengthBeats + beatsPerMeasure; // extra measure for adding notes

  const gridWidth = Math.max(820, Math.ceil(totalGridBeats * pxPerBeat));
  const gridHeight = NUM_PITCHES * ROW_HEIGHT;

  // Map global playhead (across multiple verses) onto the single-verse editor timeline
  const stride = verseLengthBeats + Math.max(0, versePauseBeats);
  const localPlayBeat = stride > 0 ? currentBeat % stride : 0;
  const playheadInVerse = localPlayBeat <= verseLengthBeats;

  // Scroll vertically to middle choral register (C3-C5) on initial mount
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) {
      const targetPitch = 68; // G#4 near top of visible area
      const y = (MAX_PITCH - targetPitch) * ROW_HEIGHT;
      el.scrollTop = Math.max(0, y - 40);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        onRedo();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault();
        onChangeNotes(notes.filter((n) => !selectedIds.has(n.id)), true);
        setSelectedIds(new Set());
        return;
      }
      if (['1', '2', '3', '4'].includes(e.key)) {
        const v = VOICE_IDS[parseInt(e.key, 10) - 1];
        setActiveVoice(v);
        if (selectedIds.size > 0) {
          onChangeNotes(
            notes.map((n) => (selectedIds.has(n.id) ? { ...n, voice: v } : n)),
            true
          );
        }
      }
      if (e.key === 'ArrowUp' && selectedIds.size > 0) {
        e.preventDefault();
        onChangeNotes(
          notes.map((n) => (selectedIds.has(n.id) ? { ...n, pitch: Math.min(MAX_PITCH, n.pitch + 1) } : n)),
          true
        );
      }
      if (e.key === 'ArrowDown' && selectedIds.size > 0) {
        e.preventDefault();
        onChangeNotes(
          notes.map((n) => (selectedIds.has(n.id) ? { ...n, pitch: Math.max(MIN_PITCH, n.pitch - 1) } : n)),
          true
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [notes, selectedIds, onChangeNotes, onUndo, onRedo]);

  const snapValue = useCallback(
    (val: number) => {
      if (snapBeats <= 0) return Math.round(val * 16) / 16;
      return Math.round(val / snapBeats) * snapBeats;
    },
    [snapBeats]
  );

  // Active pitches currently playing (for keyboard highlight)
  const activePitches = useMemo(() => {
    const map = new Map<number, VoiceId>();
    if (!isPlaying || !playheadInVerse) return map;
    for (const n of notes) {
      if (localPlayBeat >= n.startBeat && localPlayBeat < n.startBeat + n.durationBeats) {
        map.set(n.pitch, n.voice);
      }
    }
    return map;
  }, [notes, isPlaying, localPlayBeat, playheadInVerse]);

  // Draw Left Piano Keyboard
  useEffect(() => {
    const canvas = keysCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = KEYBOARD_WIDTH * dpr;
    canvas.height = gridHeight * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    for (let p = MAX_PITCH; p >= MIN_PITCH; p--) {
      const y = (MAX_PITCH - p) * ROW_HEIGHT;
      const black = isBlackKey(p);
      const playingVoice = activePitches.get(p);

      if (playingVoice) {
        ctx.fillStyle = VOICE_META[playingVoice].color;
      } else {
        ctx.fillStyle = black ? '#0f172a' : '#1e293b';
      }
      ctx.fillRect(0, y, KEYBOARD_WIDTH, ROW_HEIGHT);

      if (black && !playingVoice) {
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, y + 1, KEYBOARD_WIDTH * 0.64, ROW_HEIGHT - 2);
      }

      // Bottom separator
      ctx.strokeStyle = p % 12 === 0 ? '#475569' : '#0f172a';
      ctx.lineWidth = p % 12 === 0 ? 1.2 : 0.7;
      ctx.beginPath();
      ctx.moveTo(0, y + ROW_HEIGHT - 0.5);
      ctx.lineTo(KEYBOARD_WIDTH, y + ROW_HEIGHT - 0.5);
      ctx.stroke();

      // Label C notes and F notes for easy choral reading
      if (p % 12 === 0 || p % 12 === 5 || playingVoice) {
        ctx.fillStyle = playingVoice ? '#020617' : p % 12 === 0 ? '#e2e8f0' : '#64748b';
        ctx.font = p % 12 === 0 ? '600 10px JetBrains Mono, monospace' : '500 9px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(midiToNoteName(p), KEYBOARD_WIDTH - 5, y + ROW_HEIGHT / 2);
      }
    }
  }, [gridHeight, activePitches]);

  // Draw Top Measure Ruler
  useEffect(() => {
    const canvas = rulerCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = gridWidth * dpr;
    canvas.height = RULER_HEIGHT * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0b1222';
    ctx.fillRect(0, 0, gridWidth, RULER_HEIGHT);

    // Highlight verse boundary
    const verseEndX = verseLengthBeats * pxPerBeat;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.fillRect(verseEndX, 0, gridWidth - verseEndX, RULER_HEIGHT);

    const totalMeasures = Math.ceil(totalGridBeats / beatsPerMeasure);
    for (let m = 0; m <= totalMeasures; m++) {
      const beat = m * beatsPerMeasure;
      const x = beat * pxPerBeat;

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, RULER_HEIGHT);
      ctx.stroke();

      if (m < totalMeasures) {
        ctx.fillStyle = beat < verseLengthBeats ? '#cbd5e1' : '#64748b';
        ctx.font = '600 10px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`C.${m + 1}`, x + 5, RULER_HEIGHT / 2);
      }

      // Beat sub-ticks
      for (let b = 1; b < beatsPerMeasure; b++) {
        const bx = (beat + b) * pxPerBeat;
        ctx.strokeStyle = '#1e293b';
        ctx.beginPath();
        ctx.moveTo(bx + 0.5, RULER_HEIGHT - 7);
        ctx.lineTo(bx + 0.5, RULER_HEIGHT);
        ctx.stroke();
      }
    }

    // Verse end marker
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(verseEndX, 0);
    ctx.lineTo(verseEndX, RULER_HEIGHT);
    ctx.stroke();

    // Playhead triangle
    if (playheadInVerse) {
      const px = localPlayBeat * pxPerBeat;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(px - 6, 0);
      ctx.lineTo(px + 6, 0);
      ctx.lineTo(px, 10);
      ctx.closePath();
      ctx.fill();
    }
  }, [gridWidth, totalGridBeats, beatsPerMeasure, pxPerBeat, verseLengthBeats, localPlayBeat, playheadInVerse]);

  // Draw Main Piano Roll Grid & Notes
  useEffect(() => {
    const canvas = gridCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = gridWidth * dpr;
    canvas.height = gridHeight * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    // 1. Pitch Rows
    for (let p = MAX_PITCH; p >= MIN_PITCH; p--) {
      const y = (MAX_PITCH - p) * ROW_HEIGHT;
      const black = isBlackKey(p);
      ctx.fillStyle = black ? '#080e1c' : '#0d1527';
      ctx.fillRect(0, y, gridWidth, ROW_HEIGHT);

      // Subtle C4 middle-C highlight band
      if (p === 60) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.06)';
        ctx.fillRect(0, y, gridWidth, ROW_HEIGHT);
      }

      ctx.strokeStyle = p % 12 === 0 ? '#1f2d45' : '#131d33';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + ROW_HEIGHT - 0.5);
      ctx.lineTo(gridWidth, y + ROW_HEIGHT - 0.5);
      ctx.stroke();
    }

    // 2. Vertical Grid Lines (Beats & Measures)
    const subStep = pxPerBeat >= 64 ? 0.5 : 1;
    for (let b = 0; b <= totalGridBeats; b += subStep) {
      const x = Math.round(b * pxPerBeat) + 0.5;
      const isMeasure = Math.abs(b % beatsPerMeasure) < 0.001;
      const isWholeBeat = Math.abs(b % 1) < 0.001;

      ctx.strokeStyle = isMeasure ? '#2d3f5e' : isWholeBeat ? '#19253d' : '#111a2e';
      ctx.lineWidth = isMeasure ? 1.25 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, gridHeight);
      ctx.stroke();
    }

    // Dim area beyond current verse end
    const verseEndX = verseLengthBeats * pxPerBeat;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
    ctx.fillRect(verseEndX, 0, gridWidth - verseEndX, gridHeight);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(verseEndX, 0);
    ctx.lineTo(verseEndX, gridHeight);
    ctx.stroke();
    ctx.setLineDash([]);

    // 3. Draw Notes (draw non-focused voices first, then focused/selected on top)
    const orderedNotes = [...notes].sort((a, b) => {
      const aFocus = focusVoice === 'all' || a.voice === focusVoice ? 1 : 0;
      const bFocus = focusVoice === 'all' || b.voice === focusVoice ? 1 : 0;
      if (aFocus !== bFocus) return aFocus - bFocus;
      const aSel = selectedIds.has(a.id) ? 1 : 0;
      const bSel = selectedIds.has(b.id) ? 1 : 0;
      return aSel - bSel;
    });

    for (const n of orderedNotes) {
      if (n.pitch < MIN_PITCH || n.pitch > MAX_PITCH) continue;
      const meta = VOICE_META[n.voice];
      const x = n.startBeat * pxPerBeat + 1;
      const y = (MAX_PITCH - n.pitch) * ROW_HEIGHT + 1.5;
      const w = Math.max(8, n.durationBeats * pxPerBeat - 2);
      const h = ROW_HEIGHT - 3;

      const isSelected = selectedIds.has(n.id);
      const isDimmed = focusVoice !== 'all' && n.voice !== focusVoice;
      const isSounding =
        isPlaying &&
        playheadInVerse &&
        localPlayBeat >= n.startBeat &&
        localPlayBeat < n.startBeat + n.durationBeats;

      ctx.save();
      ctx.globalAlpha = isDimmed ? 0.24 : 1;

      // Rounded note rectangle
      const radius = 4;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.fillStyle = isSounding ? meta.colorLight : meta.color;
      ctx.fill();

      // Subtle inner top sheen
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(x + 2, y + 1, Math.max(0, w - 4), 2.5);

      // Border
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeStyle = isSelected ? '#ffffff' : meta.colorDark;
      ctx.stroke();

      // Resize grip on right edge
      if (w > 18 && !isDimmed) {
        ctx.fillStyle = 'rgba(2, 6, 23, 0.35)';
        ctx.fillRect(x + w - 4, y + 3, 2, h - 6);
      }

      // Label note name + voice initial if wide enough
      if (w >= 34) {
        ctx.fillStyle = '#020617';
        ctx.font = '700 9.5px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const label = w >= 54 ? `${meta.shortLabel}·${midiToNoteName(n.pitch)}` : midiToNoteName(n.pitch);
        ctx.fillText(label, x + 5, y + h / 2 + 0.5);
      }

      ctx.restore();
    }

    // 4. Playhead Vertical Line
    if (playheadInVerse) {
      const px = localPlayBeat * pxPerBeat;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, gridHeight);
      ctx.stroke();
    }
  }, [
    gridWidth,
    gridHeight,
    totalGridBeats,
    beatsPerMeasure,
    pxPerBeat,
    verseLengthBeats,
    notes,
    selectedIds,
    focusVoice,
    isPlaying,
    localPlayBeat,
    playheadInVerse,
  ]);

  // Hit-test note under canvas coordinates
  const findNoteAt = (x: number, y: number): { note: NoteEvent; onRightEdge: boolean } | null => {
    // Prefer notes in focused voice first
    const candidates = [...notes].reverse().sort((a, b) => {
      const af = focusVoice === 'all' || a.voice === focusVoice ? 1 : 0;
      const bf = focusVoice === 'all' || b.voice === focusVoice ? 1 : 0;
      return bf - af;
    });

    for (const n of candidates) {
      const nx = n.startBeat * pxPerBeat;
      const ny = (MAX_PITCH - n.pitch) * ROW_HEIGHT;
      const nw = Math.max(8, n.durationBeats * pxPerBeat);
      if (x >= nx && x <= nx + nw && y >= ny && y <= ny + ROW_HEIGHT) {
        const onRightEdge = x >= nx + nw - Math.min(9, nw * 0.35);
        return { note: n, onRightEdge };
      }
    }
    return null;
  };

  const getGridCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = gridCanvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const beat = Math.max(0, x / pxPerBeat);
    const pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, MAX_PITCH - Math.floor(y / ROW_HEIGHT)));
    return { x, y, beat, pitch };
  };

  const handleGridMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 2) {
      // Right-click deletes note directly
      e.preventDefault();
      const { x, y } = getGridCoords(e);
      const hit = findNoteAt(x, y);
      if (hit) {
        onChangeNotes(notes.filter((n) => n.id !== hit.note.id), true);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(hit.note.id);
          return next;
        });
      }
      return;
    }

    const { x, y, beat, pitch } = getGridCoords(e);
    const hit = findNoteAt(x, y);

    if (tool === 'erase') {
      if (hit) {
        onChangeNotes(notes.filter((n) => n.id !== hit.note.id), true);
      }
      return;
    }

    if (hit) {
      const n = hit.note;
      let nextSelected = new Set(selectedIds);
      if (e.shiftKey) {
        if (nextSelected.has(n.id)) nextSelected.delete(n.id);
        else nextSelected.add(n.id);
      } else if (!nextSelected.has(n.id)) {
        nextSelected = new Set([n.id]);
      }
      setSelectedIds(nextSelected);
      setActiveVoice(n.voice);
      onPreviewNote(n.pitch + transposeSemitones, n.voice);

      dragRef.current = {
        mode: hit.onRightEdge ? 'resize' : 'move',
        noteId: n.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origNotes: notes.map((item) => ({ ...item })),
        lastPreviewPitch: n.pitch,
        moved: false,
      };
      return;
    }

    // Clicked empty space
    if (tool === 'draw' || e.detail === 2) {
      const snappedStart = Math.max(0, snapBeats > 0 ? Math.floor(beat / snapBeats) * snapBeats : Math.round(beat * 8) / 8);
      const newNote: NoteEvent = {
        id: nextNoteId(),
        voice: activeVoice,
        pitch,
        startBeat: snappedStart,
        durationBeats: drawDuration,
        velocity: activeVoice === 'soprano' ? 98 : 90,
      };
      onChangeNotes([...notes, newNote], true);
      setSelectedIds(new Set([newNote.id]));
      onPreviewNote(pitch + transposeSemitones, activeVoice);
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleGridMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag.mode === 'none') {
      // Update cursor hover feedback
      const canvas = gridCanvasRef.current;
      if (!canvas) return;
      if (tool === 'erase') {
        canvas.style.cursor = 'not-allowed';
      } else if (tool === 'draw') {
        canvas.style.cursor = 'crosshair';
      } else {
        const { x, y } = getGridCoords(e);
        const hit = findNoteAt(x, y);
        canvas.style.cursor = hit ? (hit.onRightEdge ? 'ew-resize' : 'grab') : 'default';
      }
      return;
    }

    const dxPx = e.clientX - drag.startClientX;
    const dyPx = e.clientY - drag.startClientY;
    if (Math.abs(dxPx) > 2 || Math.abs(dyPx) > 2) drag.moved = true;

    const deltaBeatsRaw = dxPx / pxPerBeat;
    const deltaPitch = -Math.round(dyPx / ROW_HEIGHT);
    const affectedIds = selectedIds.has(drag.noteId) ? selectedIds : new Set([drag.noteId]);

    if (drag.mode === 'move') {
      const anchorOrig = drag.origNotes.find((n) => n.id === drag.noteId);
      if (anchorOrig) {
        const newPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, anchorOrig.pitch + deltaPitch));
        if (newPitch !== drag.lastPreviewPitch) {
          drag.lastPreviewPitch = newPitch;
          onPreviewNote(newPitch + transposeSemitones, anchorOrig.voice);
        }
      }

      const updated = drag.origNotes.map((orig) => {
        if (!affectedIds.has(orig.id)) return orig;
        const nextStart = Math.max(0, snapValue(orig.startBeat + deltaBeatsRaw));
        const nextPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, orig.pitch + deltaPitch));
        return { ...orig, startBeat: nextStart, pitch: nextPitch };
      });
      onChangeNotes(updated, false);
    } else if (drag.mode === 'resize') {
      const updated = drag.origNotes.map((orig) => {
        if (!affectedIds.has(orig.id)) return orig;
        const minDur = snapBeats > 0 ? snapBeats : 0.25;
        const nextDur = Math.max(minDur, snapValue(orig.durationBeats + deltaBeatsRaw));
        return { ...orig, durationBeats: nextDur };
      });
      onChangeNotes(updated, false);
    }
  };

  const finishDrag = () => {
    if (dragRef.current.mode !== 'none') {
      const moved = dragRef.current.moved;
      dragRef.current.mode = 'none';
      if (moved) {
        // Commit final dragged state into undo history
        onChangeNotes(notes, true);
      }
    }
  };

  const handleRulerClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = rulerCanvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const beat = Math.max(0, Math.min(verseLengthBeats, x / pxPerBeat));
    onSeek(beat);
  };

  const handleKeysMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = keysCanvasRef.current!.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, MAX_PITCH - Math.floor(y / ROW_HEIGHT)));
    onPreviewNote(pitch + transposeSemitones, activeVoice);
  };

  const reassignSelectedVoice = (voice: VoiceId) => {
    setActiveVoice(voice);
    if (selectedIds.size > 0) {
      onChangeNotes(
        notes.map((n) => (selectedIds.has(n.id) ? { ...n, voice } : n)),
        true
      );
    }
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    onChangeNotes(notes.filter((n) => !selectedIds.has(n.id)), true);
    setSelectedIds(new Set());
  };

  return (
    <div className="flex flex-col rounded-xl border border-slate-800/90 bg-slate-950/90 shadow-2xl overflow-hidden">
      {/* Piano Roll Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-slate-900/85 px-3 py-2">
        {/* Left: Edit tools + Active Voice Color Picker */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg bg-slate-950 p-0.5 border border-slate-800">
            <button
              onClick={() => setTool('select')}
              title="Seleccionar / Mover / Redimensionar (doble clic para añadir)"
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                tool === 'select'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MousePointer2 className="h-3.5 w-3.5" />
              Editar
            </button>
            <button
              onClick={() => setTool('draw')}
              title="Dibujar notas nuevas en la voz activa"
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                tool === 'draw'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Pencil className="h-3.5 w-3.5" />
              Lápiz
            </button>
            <button
              onClick={() => setTool('erase')}
              title="Borrar notas (o clic derecho en cualquier modo)"
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                tool === 'erase'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eraser className="h-3.5 w-3.5" />
              Borrar
            </button>
          </div>

          <div className="h-5 w-px bg-slate-800 hidden sm:block" />

          {/* Voice color selector (sets active drawing voice AND reassigns selected notes) */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-slate-400 mr-1 hidden md:inline">Voz activa:</span>
            {VOICE_IDS.map((v, idx) => {
              const meta = VOICE_META[v];
              const isAct = activeVoice === v;
              return (
                <button
                  key={v}
                  onClick={() => reassignSelectedVoice(v)}
                  title={`${meta.label} (Tecla ${idx + 1})${selectedIds.size > 0 ? ' — Clic para reasignar selección' : ''}`}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold transition border ${
                    isAct
                      ? 'bg-slate-800 text-white border-slate-600 shadow-sm'
                      : 'bg-slate-950/70 text-slate-400 border-slate-800/80 hover:text-slate-200'
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: meta.color }}
                  />
                  <span className="hidden sm:inline">{meta.label}</span>
                  <span className="sm:hidden">{meta.shortLabel}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Snap, Draw Duration, Focus Filter, Undo/Redo, Zoom */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={focusVoice}
            onChange={(e) => setFocusVoice(e.target.value as VoiceId | 'all')}
            className="rounded-md border border-slate-700/80 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
            title="Enfocar visualmente una sola voz"
          >
            <option value="all">Ver: 4 Voces</option>
            {VOICE_IDS.map((v) => (
              <option key={v} value={v}>
                Enfocar: {VOICE_META[v].label}
              </option>
            ))}
          </select>

          <select
            value={snapBeats}
            onChange={(e) => setSnapBeats(parseFloat(e.target.value))}
            className="rounded-md border border-slate-700/80 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
            title="Cuadrícula magnética (Snap)"
          >
            <option value={1}>Rejilla: Negra (1)</option>
            <option value={0.5}>Rejilla: Corchea (1/2)</option>
            <option value={0.25}>Rejilla: Semicorchea (1/4)</option>
            <option value={0}>Rejilla: Libre</option>
          </select>

          {tool === 'draw' && (
            <select
              value={drawDuration}
              onChange={(e) => setDrawDuration(parseFloat(e.target.value))}
              className="rounded-md border border-sky-700/60 bg-slate-950 px-2 py-1 text-xs text-sky-200 focus:outline-none"
              title="Duración de nuevas notas"
            >
              <option value={4}>Redonda (4t)</option>
              <option value={3}>Blanca c/punt. (3t)</option>
              <option value={2}>Blanca (2t)</option>
              <option value={1}>Negra (1t)</option>
              <option value={0.5}>Corchea (0.5t)</option>
            </select>
          )}

          <div className="flex items-center gap-1">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              title="Deshacer (Ctrl+Z)"
              className="rounded-md border border-slate-800 bg-slate-950 p-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-35"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              title="Rehacer (Ctrl+Y)"
              className="rounded-md border border-slate-800 bg-slate-950 p-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-35"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onCleanupOverlaps}
              title="Limpiar solapamientos dentro de la misma voz"
              className="flex items-center gap-1 rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <span className="hidden xl:inline">Limpiar</span>
            </button>
            {selectedIds.size > 0 && (
              <button
                onClick={deleteSelected}
                title="Eliminar notas seleccionadas (Supr)"
                className="flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-950/60 px-2 py-1 text-xs text-rose-300 hover:bg-rose-900/70"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{selectedIds.size}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 border-l border-slate-800 pl-2">
            <button
              onClick={() => setPxPerBeat((z) => Math.max(24, z - 10))}
              title="Alejar zoom horizontal"
              className="rounded-md border border-slate-800 bg-slate-950 p-1.5 text-slate-300 hover:bg-slate-800"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setPxPerBeat((z) => Math.min(110, z + 10))}
              title="Acercar zoom horizontal"
              className="rounded-md border border-slate-800 bg-slate-950 p-1.5 text-slate-300 hover:bg-slate-800"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                const containerW = scrollContainerRef.current?.clientWidth ?? 900;
                const fit = Math.max(24, Math.min(84, (containerW - KEYBOARD_WIDTH - 24) / Math.max(8, totalGridBeats)));
                setPxPerBeat(Math.round(fit));
              }}
              title="Ajustar himno al ancho visible"
              className="rounded-md border border-slate-800 bg-slate-950 p-1.5 text-slate-300 hover:bg-slate-800"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Piano Roll Viewport */}
      <div
        ref={scrollContainerRef}
        className="relative h-[430px] overflow-auto select-none bg-[#060a14]"
        onMouseUp={finishDrag}
        onMouseLeave={finishDrag}
      >
        <div className="relative" style={{ width: KEYBOARD_WIDTH + gridWidth, height: RULER_HEIGHT + gridHeight }}>
          {/* Top-Left Corner Box */}
          <div
            className="sticky top-0 left-0 z-30 flex items-center justify-center border-b border-r border-slate-800 bg-slate-900 text-[10px] font-mono text-slate-400"
            style={{ width: KEYBOARD_WIDTH, height: RULER_HEIGHT }}
          >
            SATB
          </div>

          {/* Sticky Top Timeline Ruler */}
          <div
            className="sticky top-0 z-20 border-b border-slate-800"
            style={{ marginLeft: KEYBOARD_WIDTH, marginTop: -RULER_HEIGHT, width: gridWidth, height: RULER_HEIGHT }}
          >
            <canvas
              ref={rulerCanvasRef}
              onClick={handleRulerClick}
              style={{ width: gridWidth, height: RULER_HEIGHT }}
              className="block cursor-pointer"
            />
          </div>

          {/* Sticky Left Piano Keyboard */}
          <div
            className="sticky left-0 z-10 border-r border-slate-800"
            style={{ width: KEYBOARD_WIDTH, height: gridHeight }}
          >
            <canvas
              ref={keysCanvasRef}
              onMouseDown={handleKeysMouseDown}
              style={{ width: KEYBOARD_WIDTH, height: gridHeight }}
              className="block cursor-pointer"
            />
          </div>

          {/* Main Note Grid Canvas */}
          <div
            style={{
              position: 'absolute',
              left: KEYBOARD_WIDTH,
              top: RULER_HEIGHT,
              width: gridWidth,
              height: gridHeight,
            }}
          >
            <canvas
              ref={gridCanvasRef}
              onMouseDown={handleGridMouseDown}
              onMouseMove={handleGridMouseMove}
              onContextMenu={(e) => e.preventDefault()}
              style={{ width: gridWidth, height: gridHeight }}
              className="block"
            />
          </div>
        </div>
      </div>

      {/* Helpful Footer Tip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 bg-slate-900/70 px-3 py-1.5 text-[11px] text-slate-400">
        <span>
          <strong className="text-slate-300">Tip:</strong> Arrastra una nota para corregir tono/tiempo · Borde derecho para cambiar duración · Doble clic para añadir · Clic derecho o <kbd className="rounded bg-slate-800 px-1 text-slate-300">Supr</kbd> para borrar · Teclas <kbd className="rounded bg-slate-800 px-1 text-slate-300">1-4</kbd> para reasignar voz.
        </span>
        <span className="font-mono text-slate-300">
          {notes.length} notas · Estrofa base: {Math.round(verseLengthBeats / beatsPerMeasure)} compases
        </span>
      </div>
    </div>
  );
};
