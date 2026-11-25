import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eye,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { OmrAnalysisResult, OmrSettings, VOICE_META } from '../types/music';
import { getKeyInfo, KEY_SIGNATURES, midiToNoteName } from '../utils/musicTheory';

interface OmrSheetViewerProps {
  analysis: OmrAnalysisResult;
  settings: OmrSettings;
  isReanalyzing: boolean;
  onChangeSettings: (next: OmrSettings) => void;
  onReanalyze: (settings: OmrSettings) => void;
}

export const OmrSheetViewer: React.FC<OmrSheetViewerProps> = ({
  analysis,
  settings,
  isReanalyzing,
  onChangeSettings,
  onReanalyze,
}) => {
  const [pageIdx, setPageIdx] = useState(0);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showStaves, setShowStaves] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const safePageIdx = Math.min(pageIdx, Math.max(0, analysis.pages.length - 1));
  const currentPage = analysis.pages[safePageIdx];

  useEffect(() => {
    if (!currentPage || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    img.onload = () => {
      canvas.width = currentPage.width;
      canvas.height = currentPage.height;
      ctx.drawImage(img, 0, 0);

      if (!showOverlay) return;

      // 1. Draw detected staves & barlines
      if (showStaves) {
        for (const st of currentPage.staves) {
          const isTreble = st.clef === 'treble';
          const color = isTreble ? 'rgba(56, 189, 248, 0.45)' : 'rgba(244, 114, 182, 0.45)';
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          for (const ly of st.lineYs) {
            ctx.beginPath();
            ctx.moveTo(st.leftX, ly);
            ctx.lineTo(st.rightX, ly);
            ctx.stroke();
          }

          // Clef pill badge at left of staff
          ctx.fillStyle = isTreble ? 'rgba(14, 165, 233, 0.92)' : 'rgba(219, 39, 119, 0.92)';
          ctx.beginPath();
          ctx.roundRect(Math.max(6, st.leftX - 78), st.lineYs[0], 70, 26, 5);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 13px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(isTreble ? 'Sol (S/A)' : 'Fa (T/B)', Math.max(6, st.leftX - 78) + 35, st.lineYs[0] + 13);

          // Barlines
          ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
          ctx.lineWidth = 2.5;
          for (const bx of st.barlineXs) {
            ctx.beginPath();
            ctx.moveTo(bx, st.lineYs[0] - 8);
            ctx.lineTo(bx, st.lineYs[4] + 8);
            ctx.stroke();
          }
        }
      }

      // 2. Draw detected color-coded SATB notes
      for (const n of currentPage.detectedNotes) {
        const meta = VOICE_META[n.voice];
        ctx.save();
        ctx.strokeStyle = meta.color;
        ctx.fillStyle = `${meta.color}40`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(n.x, n.y, n.w * 0.65, n.h * 0.65, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (showLabels) {
          const tag = `${meta.shortLabel}:${midiToNoteName(n.pitch)}`;
          ctx.font = 'bold 12px JetBrains Mono, monospace';
          const tw = ctx.measureText(tag).width + 8;
          const ly = n.stemDir === 'down' ? n.y + n.h * 0.95 + 10 : n.y - n.h * 0.95 - 12;
          ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
          ctx.beginPath();
          ctx.roundRect(n.x - tw / 2, ly - 8, tw, 16, 4);
          ctx.fill();
          ctx.fillStyle = meta.colorLight;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(tag, n.x, ly);
        }
        ctx.restore();
      }
    };
    img.src = currentPage.imageUrl;
  }, [currentPage, showOverlay, showLabels, showStaves]);

  const keyInfo = getKeyInfo(analysis.detectedKeyFifths);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-800/90 bg-slate-950/90 p-3.5 shadow-xl">
      {/* Diagnostics Summary Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-md bg-sky-500/15 border border-sky-500/30 px-2.5 py-1 font-semibold text-sky-300">
            OMR Local 100% Autónomo
          </span>
          <span className="rounded-md bg-slate-900 border border-slate-800 px-2.5 py-1 text-slate-300">
            Pentagramas: <strong className="text-white">{analysis.totalStaves}</strong> ({analysis.totalSystems} sistemas)
          </span>
          <span className="rounded-md bg-slate-900 border border-slate-800 px-2.5 py-1 text-slate-300">
            Armadura: <strong className="text-white">{keyInfo.majorNameEs}</strong> ({keyInfo.sharpsOrFlatsLabel})
          </span>
          <span className="rounded-md bg-slate-900 border border-slate-800 px-2.5 py-1 text-slate-300">
            Compás: <strong className="text-white">{analysis.detectedTimeSignature.numerator}/{analysis.detectedTimeSignature.denominator}</strong>
          </span>
          <span className="rounded-md bg-slate-900 border border-slate-800 px-2.5 py-1 text-slate-300">
            Notas: <strong className="text-emerald-300">{analysis.totalNotes}</strong> · Confianza:{' '}
            <strong className="text-white">{Math.round(analysis.averageConfidence * 100)}%</strong>
          </span>
        </div>

        {/* Overlay Layer Toggles */}
        <div className="flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
            <input
              type="checkbox"
              checked={showOverlay}
              onChange={(e) => setShowOverlay(e.target.checked)}
              className="rounded border-slate-700 bg-slate-900"
            />
            <Eye className="h-3.5 w-3.5 text-sky-400" />
            Capa OMR
          </label>
          {showOverlay && (
            <>
              <label className="flex items-center gap-1 cursor-pointer text-slate-400">
                <input
                  type="checkbox"
                  checked={showStaves}
                  onChange={(e) => setShowStaves(e.target.checked)}
                />
                Pentagramas
              </label>
              <label className="flex items-center gap-1 cursor-pointer text-slate-400">
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(e) => setShowLabels(e.target.checked)}
                />
                Etiquetas
              </label>
            </>
          )}
        </div>
      </div>

      {/* Warnings if any */}
      {analysis.warnings.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/35 bg-amber-950/35 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            {analysis.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        </div>
      )}

      {/* OMR Fine-Tuning Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 rounded-lg border border-slate-800 bg-slate-900/70 p-2.5 text-xs">
        <div className="flex flex-col gap-1">
          <span className="text-slate-400 flex items-center justify-between">
            <span>Contraste/Umbral</span>
            <span className="font-mono text-slate-200">{settings.thresholdBias > 0 ? `+${settings.thresholdBias}` : settings.thresholdBias}</span>
          </span>
          <input
            type="range"
            min={-35}
            max={35}
            step={5}
            value={settings.thresholdBias}
            onChange={(e) => onChangeSettings({ ...settings, thresholdBias: parseInt(e.target.value, 10) })}
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-slate-400 flex items-center justify-between">
            <span>Sensibilidad notas</span>
            <span className="font-mono text-slate-200">{Math.round(settings.sensitivity * 100)}%</span>
          </span>
          <input
            type="range"
            min={0.35}
            max={0.95}
            step={0.05}
            value={settings.sensitivity}
            onChange={(e) => onChangeSettings({ ...settings, sensitivity: parseFloat(e.target.value) })}
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-slate-400">Armadura</span>
          <select
            value={settings.keyOverride}
            onChange={(e) =>
              onChangeSettings({
                ...settings,
                keyOverride: e.target.value === 'auto' ? 'auto' : parseInt(e.target.value, 10),
              })
            }
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200"
          >
            <option value="auto">Auto ({keyInfo.majorNameEs})</option>
            {KEY_SIGNATURES.map((k) => (
              <option key={k.fifths} value={k.fifths}>
                {k.majorNameEs} ({k.sharpsOrFlatsLabel})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-slate-400">Compás</span>
          <select
            value={settings.timeSigOverride}
            onChange={(e) => onChangeSettings({ ...settings, timeSigOverride: e.target.value })}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200"
          >
            <option value="auto">
              Auto ({analysis.detectedTimeSignature.numerator}/{analysis.detectedTimeSignature.denominator})
            </option>
            <option value="4/4">4/4</option>
            <option value="3/4">3/4</option>
            <option value="2/4">2/4</option>
            <option value="6/8">6/8</option>
            <option value="3/2">3/2</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-slate-400">Pentagramas</span>
          <select
            value={settings.layoutMode}
            onChange={(e) =>
              onChangeSettings({
                ...settings,
                layoutMode: e.target.value as OmrSettings['layoutMode'],
              })
            }
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200"
          >
            <option value="auto">Auto</option>
            <option value="grand-staff">Gran Pentagrama (Sol+Fa)</option>
            <option value="four-staves">4 Pentagramas SATB</option>
          </select>
        </div>

        <div className="flex items-end">
          <button
            onClick={() => onReanalyze(settings)}
            disabled={isReanalyzing}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isReanalyzing ? 'animate-spin' : ''}`} />
            {isReanalyzing ? 'Analizando...' : 'Re-analizar OMR'}
          </button>
        </div>
      </div>

      {/* Sheet Image Canvas with Overlay */}
      <div className="relative max-h-[520px] overflow-auto rounded-lg border border-slate-800 bg-slate-900 p-2">
        {analysis.pages.length > 1 && (
          <div className="sticky top-2 z-10 mb-2 flex items-center justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/90 px-3 py-1 text-xs shadow-lg">
              <button
                onClick={() => setPageIdx((p) => Math.max(0, p - 1))}
                disabled={safePageIdx === 0}
                className="p-0.5 text-slate-300 hover:text-white disabled:opacity-35"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="font-mono text-slate-200">
                Página {safePageIdx + 1} / {analysis.pages.length}
              </span>
              <button
                onClick={() => setPageIdx((p) => Math.min(analysis.pages.length - 1, p + 1))}
                disabled={safePageIdx >= analysis.pages.length - 1}
                className="p-0.5 text-slate-300 hover:text-white disabled:opacity-35"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <canvas ref={canvasRef} className="mx-auto max-w-full h-auto rounded shadow-md bg-white" />
      </div>

      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5 text-sky-400" />
          Si alguna nota faltó o cambió de altura en una foto escaneada, ajústala directamente en la pestaña{' '}
          <strong className="text-slate-200">Piano Roll</strong>.
        </span>
        {currentPage && currentPage.deskewAngleDeg !== 0 && (
          <span className="font-mono text-sky-300">
            Auto-enderezado: {currentPage.deskewAngleDeg > 0 ? '+' : ''}
            {currentPage.deskewAngleDeg}°
          </span>
        )}
      </div>
    </div>
  );
};
