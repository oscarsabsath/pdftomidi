import React, { useRef, useState } from 'react';
import {
  FileImage,
  FileMusic,
  FileText,
  ScanEye,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';

interface UploadDropzoneProps {
  onSelectFile: (file: File) => void;
  onLoadDemo: (demoId: 'sublime' | 'santo' | 'omr-synthetic') => void;
  isProcessing: boolean;
  progressText: string;
  progressPct: number;
}

export const UploadDropzone: React.FC<UploadDropzoneProps> = ({
  onSelectFile,
  onLoadDemo,
  isProcessing,
  progressText,
  progressPct,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onSelectFile(files[0]);
  };

  return (
    <div className="mx-auto max-w-4xl py-6 px-4">
      {/* Hero Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300 mb-3">
          <ShieldCheck className="h-3.5 w-3.5" />
          100% Autónomo en tu Navegador · Sin Gasto de Créditos ni APIs Externas
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
          Estudio Híbrido OMR Coral <span className="text-sky-400">SATB</span>
        </h1>
        <p className="mt-2 text-sm text-slate-400 max-w-2xl mx-auto">
          Sube una partitura en <strong className="text-slate-200">PDF, JPG/PNG, MusicXML o MIDI</strong>. Detectamos automáticamente pentagramas (Clave de Sol y Fa), armadura, compás y las 4 voces (<span className="text-sky-400">Soprano</span>, <span className="text-emerald-400">Contralto</span>, <span className="text-amber-400">Tenor</span>, <span className="text-pink-400">Bajo</span>) listas para editar, ensayar por estrofas y descargar en <strong className="text-slate-200">.MID y .WAV</strong>.
        </p>
      </div>

      {/* Main Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !isProcessing && inputRef.current?.click()}
        className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-8 sm:p-10 text-center transition ${
          isDragging
            ? 'border-sky-400 bg-sky-500/10 scale-[1.01]'
            : 'border-slate-700/90 bg-slate-900/60 hover:border-sky-500/60 hover:bg-slate-900/90'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.musicxml,.xml,.mxl,.mid,.midi"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
          className="hidden"
        />

        {isProcessing ? (
          <div className="max-w-md mx-auto py-4">
            <ScanEye className="h-10 w-10 text-sky-400 mx-auto animate-pulse mb-3" />
            <div className="text-sm font-semibold text-white mb-2">{progressText || 'Procesando partitura...'}</div>
            <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-200"
                style={{ width: `${Math.max(8, progressPct)}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-2 font-mono">{Math.round(progressPct)}%</p>
          </div>
        ) : (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 border border-sky-500/30 text-sky-400">
              <Upload className="h-7 w-7" />
            </div>
            <p className="text-base font-semibold text-white">
              Arrastra tu partitura aquí o haz clic para seleccionar archivo
            </p>
            <p className="mt-1.5 text-xs text-slate-400">
              Motor OMR visual local para PDF e imágenes + lectura exacta para MusicXML y MIDI
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1 text-slate-300">
                <FileText className="h-3.5 w-3.5 text-rose-400" />
                PDF Multipágina (OMR)
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1 text-slate-300">
                <FileImage className="h-3.5 w-3.5 text-sky-400" />
                Imagen JPG / PNG (OMR)
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1 text-slate-300">
                <FileMusic className="h-3.5 w-3.5 text-emerald-400" />
                MusicXML (.xml / .mxl)
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1 text-slate-300">
                <FileMusic className="h-3.5 w-3.5 text-amber-400" />
                MIDI (.mid)
              </span>
            </div>
          </>
        )}
      </div>

      {/* Quick Start Demos */}
      <div className="mt-6">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 text-center mb-3">
          O prueba el estudio al instante con un himno de demostración
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            disabled={isProcessing}
            onClick={() => onLoadDemo('omr-synthetic')}
            className="flex flex-col items-start gap-1 rounded-xl border border-sky-500/35 bg-sky-950/25 p-3.5 text-left hover:border-sky-400 hover:bg-sky-950/40 transition disabled:opacity-50"
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-sky-300">
              <ScanEye className="h-4 w-4" />
              Probar Motor OMR en Vivo
            </div>
            <p className="text-[11px] text-slate-400">
              Genera una imagen real de partitura Sol+Fa y ejecuta el reconocimiento OMR automático SATB.
            </p>
          </button>

          <button
            disabled={isProcessing}
            onClick={() => onLoadDemo('sublime')}
            className="flex flex-col items-start gap-1 rounded-xl border border-slate-800 bg-slate-900/75 p-3.5 text-left hover:border-emerald-500/50 hover:bg-slate-900 transition disabled:opacity-50"
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
              <Sparkles className="h-4 w-4" />
              Sublime Gracia (SATB)
            </div>
            <p className="text-[11px] text-slate-400">
              Arreglo coral completo a 4 voces en Fa Mayor (3/4), ideal para probar estrofas y ensayo.
            </p>
          </button>

          <button
            disabled={isProcessing}
            onClick={() => onLoadDemo('santo')}
            className="flex flex-col items-start gap-1 rounded-xl border border-slate-800 bg-slate-900/75 p-3.5 text-left hover:border-amber-500/50 hover:bg-slate-900 transition disabled:opacity-50"
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
              <Sparkles className="h-4 w-4" />
              Santo, Santo, Santo (SATB)
            </div>
            <p className="text-[11px] text-slate-400">
              Himno tradicional en Re Mayor (4/4) con armonía coral completa y descarga .MID/.WAV.
            </p>
          </button>
        </div>
      </div>
    </div>
  );
};
