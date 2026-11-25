import {
  MixerState,
  NoteEvent,
  PlaybackSettings,
  ScoreData,
  SynthInstrument,
  VoiceId,
  VOICE_IDS,
  VOICE_META,
} from '../types/music';
import { expandScoreWithVerses, getBeatsPerMeasure, midiToFrequency } from '../utils/musicTheory';

// ============================================================================
// FORMANT & SYNTHESIS PARAMETERS PER CHORAL VOICE
// ============================================================================

const VOICE_FORMANTS: Record<VoiceId, [number, number, number]> = {
  soprano: [800, 1250, 2800],
  contralto: [680, 1120, 2500],
  tenor: [580, 1020, 2350],
  bajo: [460, 880, 2100],
};

function createReverbImpulse(ctx: BaseAudioContext, seconds = 1.65, decay = 2.6): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const channelData = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const env = Math.pow(1 - i / length, decay);
      // Slight low-pass smoothing by averaging consecutive noise samples
      const n = (Math.random() * 2 - 1) * 0.55;
      channelData[i] = i > 0 ? channelData[i - 1] * 0.35 + n * env * 0.65 : n * env;
    }
  }
  return impulse;
}

export function computeEffectiveVoiceGain(
  voice: VoiceId,
  mixer: MixerState
): { gain: number; isBoostedLead: boolean } {
  const anySolo = VOICE_IDS.some((v) => mixer[v].solo);
  const anyHighlighted = VOICE_IDS.some((v) => mixer[v].highlighted);
  const st = mixer[voice];

  if (st.muted) return { gain: 0, isBoostedLead: false };
  if (anySolo && !st.solo) return { gain: 0, isBoostedLead: false };

  let gain = st.volume;
  let isBoostedLead = false;

  if (anyHighlighted) {
    if (st.highlighted) {
      gain *= 1.48;
      isBoostedLead = true;
    } else {
      gain *= 0.36;
    }
  }

  return { gain: Math.max(0, Math.min(2.0, gain)), isBoostedLead };
}

/**
 * Schedule a single synthesized note into any BaseAudioContext (live AudioContext or OfflineAudioContext).
 */
export function scheduleSynthNote(
  ctx: BaseAudioContext,
  destination: AudioNode,
  reverbSend: AudioNode | null,
  params: {
    voice: VoiceId;
    pitch: number;
    startTime: number;
    durationSec: number;
    velocity: number;
    gainScale: number;
    pan: number;
    instrument: SynthInstrument;
    isBoostedLead?: boolean;
  }
): void {
  const { voice, pitch, startTime, durationSec, velocity, gainScale, pan, instrument, isBoostedLead } = params;
  if (gainScale <= 0.001 || durationSec <= 0.01) return;

  const freq = midiToFrequency(pitch);
  const velNorm = Math.max(0.15, Math.min(1.0, velocity / 127));
  const baseAmp = 0.24 * velNorm * gainScale;

  const outGain = ctx.createGain();
  const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
  if (panner) {
    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), startTime);
    outGain.connect(panner);
    panner.connect(destination);
    if (reverbSend) panner.connect(reverbSend);
  } else {
    outGain.connect(destination);
    if (reverbSend) outGain.connect(reverbSend);
  }

  const safeDur = Math.max(0.06, durationSec);
  const release = instrument === 'piano' ? 0.16 : instrument === 'organ' ? 0.10 : 0.22;
  const stopTime = startTime + safeDur + release + 0.04;

  if (instrument === 'choir') {
    // Warm formant-filtered choral voice with gentle vibrato
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, startTime);
    osc2.frequency.setValueAtTime(freq * 1.0025, startTime); // subtle choral ensemble detune

    // Vibrato LFO
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.setValueAtTime(voice === 'soprano' ? 5.2 : voice === 'bajo' ? 4.4 : 4.8, startTime);
    lfoGain.gain.setValueAtTime(freq * 0.0045, startTime);
    lfo.connect(lfoGain);
    lfoGain.connect(osc1.frequency);
    lfoGain.connect(osc2.frequency);

    // Pre-filter mix
    const srcMix = ctx.createGain();
    srcMix.gain.setValueAtTime(0.55, startTime);
    osc1.connect(srcMix);
    osc2.connect(srcMix);

    // Two parallel vocal formant filters (F1 & F2) + warm lowpass
    const [f1Freq, f2Freq] = VOICE_FORMANTS[voice];
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.setValueAtTime(f1Freq, startTime);
    f1.Q.setValueAtTime(3.2, startTime);

    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.setValueAtTime(f2Freq, startTime);
    f2.Q.setValueAtTime(4.0, startTime);

    const warmLp = ctx.createBiquadFilter();
    warmLp.type = 'lowpass';
    warmLp.frequency.setValueAtTime(isBoostedLead ? 3200 : 1850, startTime);

    const f1Gain = ctx.createGain();
    f1Gain.gain.setValueAtTime(1.15, startTime);
    const f2Gain = ctx.createGain();
    f2Gain.gain.setValueAtTime(isBoostedLead ? 0.85 : 0.52, startTime);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.45, startTime);

    srcMix.connect(f1);
    srcMix.connect(f2);
    srcMix.connect(warmLp);
    f1.connect(f1Gain);
    f2.connect(f2Gain);
    warmLp.connect(bodyGain);
    f1Gain.connect(outGain);
    f2Gain.connect(outGain);
    bodyGain.connect(outGain);

    // Vocal envelope
    const attack = Math.min(0.095, safeDur * 0.35);
    outGain.gain.setValueAtTime(0.0001, startTime);
    outGain.gain.linearRampToValueAtTime(baseAmp, startTime + attack);
    outGain.gain.setValueAtTime(baseAmp * 0.92, startTime + Math.max(attack, safeDur - 0.03));
    outGain.gain.exponentialRampToValueAtTime(0.0001, startTime + safeDur + release);

    osc1.start(startTime);
    osc2.start(startTime);
    lfo.start(startTime);
    osc1.stop(stopTime);
    osc2.stop(stopTime);
    lfo.stop(stopTime);
  } else if (instrument === 'piano') {
    // Rehearsal piano: clear attack + natural harmonic decay
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const osc3 = ctx.createOscillator();
    osc1.type = 'triangle';
    osc2.type = 'sine';
    osc3.type = 'sine';
    osc1.frequency.setValueAtTime(freq, startTime);
    osc2.frequency.setValueAtTime(freq * 2, startTime);
    osc3.frequency.setValueAtTime(freq * 3, startTime);

    const g1 = ctx.createGain();
    const g2 = ctx.createGain();
    const g3 = ctx.createGain();
    g1.gain.setValueAtTime(0.75, startTime);
    g2.gain.setValueAtTime(0.22, startTime);
    g3.gain.setValueAtTime(0.08, startTime);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(7500, freq * 8), startTime);
    lp.frequency.exponentialRampToValueAtTime(Math.max(700, freq * 2.2), startTime + safeDur + 0.25);

    osc1.connect(g1);
    osc2.connect(g2);
    osc3.connect(g3);
    g1.connect(lp);
    g2.connect(lp);
    g3.connect(lp);
    lp.connect(outGain);

    outGain.gain.setValueAtTime(0.0001, startTime);
    outGain.gain.linearRampToValueAtTime(baseAmp * 1.25, startTime + 0.012);
    outGain.gain.exponentialRampToValueAtTime(baseAmp * 0.45, startTime + Math.min(0.35, safeDur));
    outGain.gain.setValueAtTime(baseAmp * 0.42, startTime + safeDur);
    outGain.gain.exponentialRampToValueAtTime(0.0001, startTime + safeDur + release);

    osc1.start(startTime);
    osc2.start(startTime);
    osc3.start(startTime);
    osc1.stop(stopTime);
    osc2.stop(stopTime);
    osc3.stop(stopTime);
  } else if (instrument === 'organ') {
    // Pipe organ drawbars (8', 4', 2' + gentle 16' for bass)
    const harmonics = voice === 'bajo' ? [0.5, 1, 2, 3] : [1, 2, 3, 4];
    const weights = voice === 'bajo' ? [0.35, 0.65, 0.28, 0.12] : [0.68, 0.34, 0.16, 0.08];
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2800, startTime);
    lp.connect(outGain);

    harmonics.forEach((h, idx) => {
      const osc = ctx.createOscillator();
      const hg = ctx.createGain();
      osc.type = idx === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq * h, startTime);
      hg.gain.setValueAtTime(weights[idx], startTime);
      osc.connect(hg);
      hg.connect(lp);
      osc.start(startTime);
      osc.stop(stopTime);
    });

    outGain.gain.setValueAtTime(0.0001, startTime);
    outGain.gain.linearRampToValueAtTime(baseAmp * 0.88, startTime + 0.032);
    outGain.gain.setValueAtTime(baseAmp * 0.88, startTime + Math.max(0.035, safeDur - 0.02));
    outGain.gain.exponentialRampToValueAtTime(0.0001, startTime + safeDur + release);
  } else {
    // Lush ensemble strings
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';
    osc1.frequency.setValueAtTime(freq * 0.997, startTime);
    osc2.frequency.setValueAtTime(freq * 1.003, startTime);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(isBoostedLead ? 2900 : 1900, startTime);
    lp.Q.setValueAtTime(1.1, startTime);

    osc1.connect(lp);
    osc2.connect(lp);
    lp.connect(outGain);

    const attack = Math.min(0.14, safeDur * 0.4);
    outGain.gain.setValueAtTime(0.0001, startTime);
    outGain.gain.linearRampToValueAtTime(baseAmp * 0.72, startTime + attack);
    outGain.gain.setValueAtTime(baseAmp * 0.68, startTime + Math.max(attack, safeDur - 0.02));
    outGain.gain.exponentialRampToValueAtTime(0.0001, startTime + safeDur + release);

    osc1.start(startTime);
    osc2.start(startTime);
    osc1.stop(stopTime);
    osc2.stop(stopTime);
  }

  // If this voice is Highlighted (Destacar), add a soft crystalline bell/piano attack cue
  // so singers immediately lock onto their exact entrance pitch!
  if (isBoostedLead && instrument !== 'piano') {
    const cueOsc = ctx.createOscillator();
    const cueGain = ctx.createGain();
    cueOsc.type = 'triangle';
    cueOsc.frequency.setValueAtTime(freq, startTime);
    cueGain.gain.setValueAtTime(0.0001, startTime);
    cueGain.gain.linearRampToValueAtTime(baseAmp * 0.36, startTime + 0.01);
    cueGain.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.min(0.28, safeDur));
    cueOsc.connect(cueGain);
    cueGain.connect(outGain);
    cueOsc.start(startTime);
    cueOsc.stop(startTime + Math.min(0.32, safeDur) + 0.02);
  }
}

function scheduleMetronomeClick(ctx: BaseAudioContext, dest: AudioNode, time: number, accent: boolean): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(accent ? 1320 : 880, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(accent ? 0.16 : 0.09, time + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + 0.055);
}

// ============================================================================
// REAL-TIME CHORAL AUDIO PLAYER
// ============================================================================

export class ChoralAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;

  private isPlaying = false;
  private currentBeat = 0;
  private lastTickTime = 0;
  private schedulerTimer: number | null = null;
  private rafId: number | null = null;

  private score: ScoreData | null = null;
  private expandedNotes: NoteEvent[] = [];
  private verseLengthBeats = 16;
  private totalBeats = 16;
  private mixer: MixerState | null = null;
  private settings: PlaybackSettings | null = null;

  private scheduledNoteIds = new Set<string>();
  private lastMetronomeBeat = -1;

  public onBeatUpdate?: (beat: number, currentVerse: number, isPlaying: boolean) => void;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.85;

      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -10;
      compressor.knee.value = 18;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.008;
      compressor.release.value = 0.15;

      this.reverbNode = this.ctx.createConvolver();
      this.reverbNode.buffer = createReverbImpulse(this.ctx, 1.6, 2.7);
      this.reverbGain = this.ctx.createGain();
      this.reverbGain.gain.value = 0.24;

      this.masterGain.connect(compressor);
      this.reverbNode.connect(this.reverbGain);
      this.reverbGain.connect(compressor);
      compressor.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public updateState(score: ScoreData, mixer: MixerState, settings: PlaybackSettings): void {
    this.score = score;
    this.mixer = mixer;
    this.settings = settings;
    const expanded = expandScoreWithVerses(
      score.notes,
      score.timeSignature,
      settings.verseCount,
      settings.versePauseBeats,
      settings.transposeSemitones
    );
    this.expandedNotes = expanded.expandedNotes;
    this.verseLengthBeats = expanded.verseLengthBeats;
    this.totalBeats = Math.max(1, expanded.totalBeats);
    if (this.currentBeat > this.totalBeats) {
      this.currentBeat = 0;
    }
  }

  public previewNote(pitch: number, voice: VoiceId, instrument: SynthInstrument = 'piano'): void {
    const ctx = this.ensureContext();
    if (!this.masterGain) return;
    scheduleSynthNote(ctx, this.masterGain, this.reverbNode, {
      voice,
      pitch,
      startTime: ctx.currentTime + 0.01,
      durationSec: 0.42,
      velocity: 100,
      gainScale: 0.95,
      pan: 0,
      instrument,
    });
  }

  public play(fromBeat?: number): void {
    if (!this.score || !this.settings || !this.mixer) return;
    const ctx = this.ensureContext();

    if (fromBeat !== undefined) {
      this.currentBeat = Math.max(0, Math.min(this.totalBeats, fromBeat));
    }
    if (this.currentBeat >= this.totalBeats - 0.05) {
      this.currentBeat = 0;
    }

    this.isPlaying = true;
    this.lastTickTime = ctx.currentTime;
    this.scheduledNoteIds.clear();
    this.lastMetronomeBeat = Math.floor(this.currentBeat) - 1;

    this.startLoops();
    this.emitUpdate();
  }

  public pause(): void {
    this.isPlaying = false;
    this.stopLoops();
    this.emitUpdate();
  }

  public stop(): void {
    this.isPlaying = false;
    this.stopLoops();
    this.currentBeat = 0;
    this.scheduledNoteIds.clear();
    this.lastMetronomeBeat = -1;
    this.emitUpdate();
  }

  public seek(beat: number): void {
    this.currentBeat = Math.max(0, Math.min(this.totalBeats, beat));
    this.scheduledNoteIds.clear();
    this.lastMetronomeBeat = Math.floor(this.currentBeat) - 1;
    if (this.ctx) this.lastTickTime = this.ctx.currentTime;
    this.emitUpdate();
  }

  public getCurrentBeat(): number {
    return this.currentBeat;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  private startLoops(): void {
    this.stopLoops();
    this.schedulerTimer = window.setInterval(() => this.scheduleWindow(), 35);
    const rafStep = () => {
      if (!this.isPlaying || !this.ctx || !this.settings) return;
      const now = this.ctx.currentTime;
      const dt = Math.max(0, now - this.lastTickTime);
      this.lastTickTime = now;

      const beatsPerSec = this.settings.tempoBpm / 60;
      this.currentBeat += dt * beatsPerSec;

      if (this.currentBeat >= this.totalBeats) {
        if (this.settings.loop) {
          this.currentBeat = 0;
          this.scheduledNoteIds.clear();
          this.lastMetronomeBeat = -1;
        } else {
          this.stop();
          return;
        }
      }
      this.emitUpdate();
      this.rafId = window.requestAnimationFrame(rafStep);
    };
    this.rafId = window.requestAnimationFrame(rafStep);
  }

  private stopLoops(): void {
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private scheduleWindow(): void {
    if (!this.isPlaying || !this.ctx || !this.masterGain || !this.settings || !this.mixer || !this.score) return;

    const now = this.ctx.currentTime;
    const beatsPerSec = this.settings.tempoBpm / 60;
    const lookaheadSec = 0.16;
    const lookaheadBeats = lookaheadSec * beatsPerSec;
    const winStart = this.currentBeat;
    const winEnd = this.currentBeat + lookaheadBeats;

    // Schedule notes falling in [winStart - 0.03, winEnd]
    for (const note of this.expandedNotes) {
      if (note.startBeat >= winStart - 0.04 && note.startBeat <= winEnd) {
        if (this.scheduledNoteIds.has(note.id)) continue;
        this.scheduledNoteIds.add(note.id);

        const { gain, isBoostedLead } = computeEffectiveVoiceGain(note.voice, this.mixer);
        if (gain <= 0.001) continue;

        const deltaBeats = Math.max(0, note.startBeat - this.currentBeat);
        const startTime = now + deltaBeats / beatsPerSec;
        const durationSec = Math.max(0.05, note.durationBeats / beatsPerSec);
        const pan = this.settings.stereoSpread ? this.mixer[note.voice].pan : 0;

        scheduleSynthNote(this.ctx, this.masterGain, this.reverbNode, {
          voice: note.voice,
          pitch: note.pitch,
          startTime,
          durationSec,
          velocity: note.velocity,
          gainScale: gain,
          pan,
          instrument: this.settings.instrument,
          isBoostedLead,
        });
      }
    }

    // Schedule metronome clicks
    if (this.settings.metronome) {
      const bpmMeasure = getBeatsPerMeasure(this.score.timeSignature);
      const startInt = Math.max(this.lastMetronomeBeat + 1, Math.floor(winStart));
      const endInt = Math.floor(winEnd);
      for (let b = startInt; b <= endInt; b++) {
        if (b >= this.totalBeats) break;
        const deltaBeats = b - this.currentBeat;
        if (deltaBeats >= -0.02) {
          const clickTime = now + Math.max(0, deltaBeats) / beatsPerSec;
          const isAccent = Math.round(b % bpmMeasure) === 0;
          scheduleMetronomeClick(this.ctx, this.masterGain, clickTime, isAccent);
          this.lastMetronomeBeat = b;
        }
      }
    }
  }

  private emitUpdate(): void {
    const stride = this.verseLengthBeats + (this.settings?.versePauseBeats ?? 0);
    const currentVerse = Math.min(
      this.settings?.verseCount ?? 1,
      Math.floor(this.currentBeat / Math.max(1, stride)) + 1
    );
    this.onBeatUpdate?.(this.currentBeat, currentVerse, this.isPlaying);
  }

  public dispose(): void {
    this.stop();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}

// ============================================================================
// OFFLINE STEREO WAV RENDERER (16-bit PCM 44.1 kHz, 100% Client-Side)
// ============================================================================

export interface WavExportOptions {
  score: ScoreData;
  tempoBpm: number;
  transposeSemitones: number;
  verseCount: number;
  versePauseBeats: number;
  instrument: SynthInstrument;
  stereoSpread: boolean;
  mode: 'full' | 'single' | 'highlighted';
  targetVoice?: VoiceId;
  customMixer?: MixerState;
}

export async function renderScoreToWav(opts: WavExportOptions): Promise<Uint8Array> {
  const sampleRate = 44100;
  const { expandedNotes, totalBeats } = expandScoreWithVerses(
    opts.score.notes,
    opts.score.timeSignature,
    opts.verseCount,
    opts.versePauseBeats,
    opts.transposeSemitones
  );

  const beatsPerSec = Math.max(30, opts.tempoBpm) / 60;
  const totalSec = Math.max(1.5, totalBeats / beatsPerSec + 1.8); // tail for reverb
  const totalFrames = Math.ceil(totalSec * sampleRate);

  const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);
  const masterGain = offlineCtx.createGain();
  masterGain.gain.value = 0.88;

  const compressor = offlineCtx.createDynamicsCompressor();
  compressor.threshold.value = -8;
  compressor.knee.value = 16;
  compressor.ratio.value = 4;

  const reverb = offlineCtx.createConvolver();
  reverb.buffer = createReverbImpulse(offlineCtx, 1.5, 2.7);
  const reverbGain = offlineCtx.createGain();
  reverbGain.gain.value = 0.22;

  masterGain.connect(compressor);
  reverb.connect(reverbGain);
  reverbGain.connect(compressor);
  compressor.connect(offlineCtx.destination);

  const leadInSec = 0.08;

  for (const note of expandedNotes) {
    let gainScale = 1.0;
    let isBoostedLead = false;

    if (opts.mode === 'single' && opts.targetVoice) {
      if (note.voice !== opts.targetVoice) continue;
      gainScale = 1.25;
    } else if (opts.mode === 'highlighted' && opts.targetVoice) {
      if (note.voice === opts.targetVoice) {
        gainScale = 1.48;
        isBoostedLead = true;
      } else {
        gainScale = 0.36;
      }
    } else if (opts.customMixer) {
      const eff = computeEffectiveVoiceGain(note.voice, opts.customMixer);
      gainScale = eff.gain;
      isBoostedLead = eff.isBoostedLead;
      if (gainScale <= 0.001) continue;
    }

    const startTime = leadInSec + note.startBeat / beatsPerSec;
    const durationSec = Math.max(0.05, note.durationBeats / beatsPerSec);
    const pan = opts.stereoSpread ? VOICE_META[note.voice].defaultPan : 0;

    scheduleSynthNote(offlineCtx, masterGain, reverb, {
      voice: note.voice,
      pitch: note.pitch,
      startTime,
      durationSec,
      velocity: note.velocity,
      gainScale,
      pan,
      instrument: opts.instrument,
      isBoostedLead,
    });
  }

  const audioBuffer = await offlineCtx.startRendering();
  return encodeAudioBufferToWav(audioBuffer);
}

function encodeAudioBufferToWav(buffer: AudioBuffer): Uint8Array {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataByteLength = numFrames * blockAlign;

  const wavBuffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(wavBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // 16-bit
  writeString(36, 'data');
  view.setUint32(40, dataByteLength, true);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch));

  // Soft peak normalize if signal approaches clipping
  let peak = 0;
  for (let ch = 0; ch < numChannels; ch++) {
    const data = channels[ch];
    for (let i = 0; i < numFrames; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }
  const normScale = peak > 0.96 ? 0.94 / peak : 1.0;

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i] * normScale));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Uint8Array(wavBuffer);
}
