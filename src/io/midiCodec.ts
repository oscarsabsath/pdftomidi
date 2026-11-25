import { NoteEvent, ScoreData, SynthInstrument, TimeSignature, VoiceId, VOICE_IDS, VOICE_META } from '../types/music';
import { autoSeparateSATB, expandScoreWithVerses } from '../utils/musicTheory';

// ============================================================================
// MIDI PARSER (Standard MIDI File Format 0 & 1)
// ============================================================================

function readUint32(data: Uint8Array, offset: number): number {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function readUint16(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

function readVarLen(data: Uint8Array, offset: number): { value: number; nextOffset: number } {
  let value = 0;
  let idx = offset;
  while (idx < data.length) {
    const byte = data[idx++];
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return { value, nextOffset: idx };
}

function detectVoiceFromTrackName(name: string): VoiceId | null {
  const lower = name.toLowerCase();
  if (lower.includes('soprano') || /\bsop\b/.test(lower)) return 'soprano';
  if (lower.includes('contralto') || lower.includes('alto') || /\balt\b/.test(lower)) return 'contralto';
  if (lower.includes('tenor') || /\bten\b/.test(lower)) return 'tenor';
  if (lower.includes('bajo') || lower.includes('bass') || /\bbas\b/.test(lower)) return 'bajo';
  return null;
}

export function parseMidiFile(buffer: ArrayBuffer, fileName: string): ScoreData {
  const data = new Uint8Array(buffer);
  if (data.length < 14 || String.fromCharCode(data[0], data[1], data[2], data[3]) !== 'MThd') {
    throw new Error('El archivo no tiene una cabecera MIDI válida (MThd).');
  }

  const headerLen = readUint32(data, 4);
  const numTracks = readUint16(data, 10);
  const division = readUint16(data, 12);
  const ticksPerBeat = (division & 0x8000) === 0 ? division : 480;

  let offset = 8 + headerLen;
  let tempoBpm = 92;
  let timeSignature: TimeSignature = { numerator: 4, denominator: 4 };
  let keySignatureFifths = 0;
  let titleFromMeta = '';

  interface ParsedTrackNote {
    pitch: number;
    startBeat: number;
    durationBeats: number;
    velocity: number;
    channel: number;
    trackIndex: number;
    trackVoiceHint: VoiceId | null;
  }

  const allTrackNotes: ParsedTrackNote[] = [];
  const trackVoiceHints: (VoiceId | null)[] = [];

  for (let t = 0; t < numTracks && offset + 8 <= data.length; t++) {
    const chunkType = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
    const chunkLen = readUint32(data, offset + 4);
    const trackStart = offset + 8;
    const trackEnd = Math.min(data.length, trackStart + chunkLen);
    offset = trackEnd;

    if (chunkType !== 'MTrk') continue;

    let pos = trackStart;
    let absTicks = 0;
    let runningStatus = 0;
    let trackName = '';
    const activeNotes = new Map<string, { startTick: number; velocity: number; channel: number }>();

    while (pos < trackEnd) {
      const vl = readVarLen(data, pos);
      absTicks += vl.value;
      pos = vl.nextOffset;
      if (pos >= trackEnd) break;

      let status = data[pos];
      if (status < 0x80) {
        status = runningStatus;
      } else {
        pos++;
        if (status < 0xf0) runningStatus = status;
      }

      if (status === 0xff) {
        // Meta event
        if (pos >= trackEnd) break;
        const metaType = data[pos++];
        const metaLen = readVarLen(data, pos);
        pos = metaLen.nextOffset;
        const metaEnd = Math.min(trackEnd, pos + metaLen.value);

        if (metaType === 0x03) {
          // Track name
          const txt = new TextDecoder('utf-8').decode(data.subarray(pos, metaEnd)).trim();
          trackName = txt;
          if (!titleFromMeta && t === 0 && txt.length > 0 && !detectVoiceFromTrackName(txt)) {
            titleFromMeta = txt;
          }
        } else if (metaType === 0x51 && metaLen.value >= 3) {
          const usPerBeat = (data[pos] << 16) | (data[pos + 1] << 8) | data[pos + 2];
          if (usPerBeat > 0) tempoBpm = Math.round(60_000_000 / usPerBeat);
        } else if (metaType === 0x58 && metaLen.value >= 2) {
          const num = data[pos];
          const denPow = data[pos + 1];
          timeSignature = { numerator: num, denominator: Math.pow(2, denPow) };
        } else if (metaType === 0x59 && metaLen.value >= 1) {
          const rawFifths = data[pos];
          keySignatureFifths = rawFifths > 127 ? rawFifths - 256 : rawFifths;
        }
        pos = metaEnd;
      } else if (status === 0xf0 || status === 0xf7) {
        // SysEx
        const sysexLen = readVarLen(data, pos);
        pos = Math.min(trackEnd, sysexLen.nextOffset + sysexLen.value);
      } else {
        const type = status & 0xf0;
        const channel = status & 0x0f;

        if (type === 0x90 || type === 0x80) {
          const pitch = data[pos++];
          const velocity = data[pos++];
          if (channel === 9) continue; // Ignore percussion channel 10

          const key = `${channel}_${pitch}`;
          const isNoteOn = type === 0x90 && velocity > 0;
          if (isNoteOn) {
            // Close existing overlapping note on same pitch/channel
            const prev = activeNotes.get(key);
            if (prev && absTicks > prev.startTick) {
              allTrackNotes.push({
                pitch,
                startBeat: prev.startTick / ticksPerBeat,
                durationBeats: Math.max(0.125, (absTicks - prev.startTick) / ticksPerBeat),
                velocity: prev.velocity,
                channel,
                trackIndex: t,
                trackVoiceHint: detectVoiceFromTrackName(trackName),
              });
            }
            activeNotes.set(key, { startTick: absTicks, velocity, channel });
          } else {
            const prev = activeNotes.get(key);
            if (prev) {
              const dur = Math.max(0.125, (absTicks - prev.startTick) / ticksPerBeat);
              allTrackNotes.push({
                pitch,
                startBeat: prev.startTick / ticksPerBeat,
                durationBeats: dur,
                velocity: prev.velocity,
                channel,
                trackIndex: t,
                trackVoiceHint: detectVoiceFromTrackName(trackName),
              });
              activeNotes.delete(key);
            }
          }
        } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
          pos += 2;
        } else if (type === 0xc0 || type === 0xd0) {
          pos += 1;
        }
      }
    }

    // Flush unclosed notes
    for (const [key, prev] of activeNotes.entries()) {
      const pitch = parseInt(key.split('_')[1], 10);
      allTrackNotes.push({
        pitch,
        startBeat: prev.startTick / ticksPerBeat,
        durationBeats: Math.max(0.5, (absTicks - prev.startTick) / ticksPerBeat),
        velocity: prev.velocity,
        channel: prev.channel,
        trackIndex: t,
        trackVoiceHint: detectVoiceFromTrackName(trackName),
      });
    }

    trackVoiceHints.push(detectVoiceFromTrackName(trackName));
  }

  // Decide how to map notes to SATB voices:
  // 1) If tracks are explicitly named Soprano / Contralto / Tenor / Bajo
  const namedVoicesFound = new Set(allTrackNotes.map((n) => n.trackVoiceHint).filter(Boolean));
  let notes: NoteEvent[] = [];

  if (namedVoicesFound.size >= 2) {
    let idx = 1;
    notes = allTrackNotes.map((n) => ({
      id: `mid_${idx++}`,
      voice: n.trackVoiceHint ?? autoSeparateSATB([n])[0].voice,
      pitch: n.pitch,
      startBeat: Math.round(n.startBeat * 16) / 16,
      durationBeats: Math.max(0.125, Math.round(n.durationBeats * 16) / 16),
      velocity: n.velocity,
    }));
  } else {
    // 2) Check if there are exactly 4 distinct tracks with notes (typical SATB MIDI without names)
    const tracksWithNotes = Array.from(new Set(allTrackNotes.map((n) => n.trackIndex)));
    if (tracksWithNotes.length === 4) {
      // Rank tracks by average pitch descending -> S, A, T, B
      const avgByTrack = tracksWithNotes.map((ti) => {
        const tn = allTrackNotes.filter((n) => n.trackIndex === ti);
        const avg = tn.reduce((s, x) => s + x.pitch, 0) / tn.length;
        return { ti, avg };
      });
      avgByTrack.sort((a, b) => b.avg - a.avg);
      const trackToVoice = new Map<number, VoiceId>();
      avgByTrack.forEach((item, i) => trackToVoice.set(item.ti, VOICE_IDS[i]));

      let idx = 1;
      notes = allTrackNotes.map((n) => ({
        id: `mid_${idx++}`,
        voice: trackToVoice.get(n.trackIndex) ?? 'soprano',
        pitch: n.pitch,
        startBeat: Math.round(n.startBeat * 16) / 16,
        durationBeats: Math.max(0.125, Math.round(n.durationBeats * 16) / 16),
        velocity: n.velocity,
      }));
    } else {
      // 3) Polyphonic piano/organ MIDI: use chord-aware SATB auto-separation
      notes = autoSeparateSATB(
        allTrackNotes.map((n) => ({
          pitch: n.pitch,
          startBeat: Math.round(n.startBeat * 16) / 16,
          durationBeats: Math.max(0.125, Math.round(n.durationBeats * 16) / 16),
          velocity: n.velocity,
        }))
      );
    }
  }

  const cleanTitle = titleFromMeta || fileName.replace(/\.(mid|midi)$/i, '');

  return {
    id: `score_midi_${Date.now()}`,
    title: cleanTitle,
    sourceType: 'midi',
    tempoBpm: Math.max(40, Math.min(200, tempoBpm)),
    timeSignature,
    keySignatureFifths,
    notes: notes.sort((a, b) => a.startBeat - b.startBeat || b.pitch - a.pitch),
  };
}

// ============================================================================
// MIDI ENCODER (Standard MIDI File Format 1)
// ============================================================================

function writeVarLen(value: number): number[] {
  let v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

function uint32Bytes(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function uint16Bytes(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}

function asciiBytes(str: string): number[] {
  return Array.from(new TextEncoder().encode(str));
}

function makeTrackChunk(eventsBytes: number[]): number[] {
  return [0x4d, 0x54, 0x72, 0x6b, ...uint32Bytes(eventsBytes.length), ...eventsBytes];
}

function getGmProgramForInstrument(instrument: SynthInstrument): number {
  switch (instrument) {
    case 'choir':
      return 52; // Choir Aahs
    case 'piano':
      return 0; // Acoustic Grand Piano
    case 'organ':
      return 19; // Church Organ
    case 'strings':
      return 48; // String Ensemble 1
  }
}

export interface MidiExportOptions {
  score: ScoreData;
  tempoBpm: number;
  transposeSemitones: number;
  verseCount: number;
  versePauseBeats: number;
  instrument: SynthInstrument;
  mode: 'full' | 'single' | 'highlighted';
  targetVoice?: VoiceId;
}

export function encodeMidiFile(opts: MidiExportOptions): Uint8Array {
  const ticksPerBeat = 480;
  const { expandedNotes } = expandScoreWithVerses(
    opts.score.notes,
    opts.score.timeSignature,
    opts.verseCount,
    opts.versePauseBeats,
    opts.transposeSemitones
  );

  const voicesToInclude: VoiceId[] =
    opts.mode === 'single' && opts.targetVoice ? [opts.targetVoice] : [...VOICE_IDS];

  const tracks: number[][] = [];

  // Track 0: Tempo, Time Signature, Key Signature, Title
  const metaTrack: number[] = [];
  const titleBytes = asciiBytes(opts.score.title);
  metaTrack.push(0x00, 0xff, 0x03, ...writeVarLen(titleBytes.length), ...titleBytes);

  const usPerBeat = Math.round(60_000_000 / Math.max(30, opts.tempoBpm));
  metaTrack.push(0x00, 0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff);

  const denPow = Math.round(Math.log2(opts.score.timeSignature.denominator));
  metaTrack.push(0x00, 0xff, 0x58, 0x04, opts.score.timeSignature.numerator, denPow, 24, 8);

  const fifthsByte = opts.score.keySignatureFifths < 0 ? 256 + opts.score.keySignatureFifths : opts.score.keySignatureFifths;
  metaTrack.push(0x00, 0xff, 0x59, 0x02, fifthsByte & 0xff, 0x00);

  // End of track
  metaTrack.push(0x00, 0xff, 0x2f, 0x00);
  tracks.push(makeTrackChunk(metaTrack));

  const gmProgram = getGmProgramForInstrument(opts.instrument);

  for (const voice of voicesToInclude) {
    const meta = VOICE_META[voice];
    const ch = meta.midiChannel;
    const voiceNotes = expandedNotes.filter((n) => n.voice === voice);

    const trackBytes: number[] = [];
    const nameBytes = asciiBytes(meta.label);
    trackBytes.push(0x00, 0xff, 0x03, ...writeVarLen(nameBytes.length), ...nameBytes);

    // Program change
    const program =
      opts.mode === 'highlighted' && opts.targetVoice === voice ? 0 : gmProgram; // Piano lead when highlighted for extra clarity
    trackBytes.push(0x00, 0xc0 | ch, program);

    // Volume CC7 & Pan CC10
    let ccVol = 105;
    if (opts.mode === 'highlighted' && opts.targetVoice) {
      ccVol = opts.targetVoice === voice ? 127 : 58;
    }
    const ccPan = Math.round((meta.defaultPan * 0.5 + 0.5) * 127);
    trackBytes.push(0x00, 0xb0 | ch, 7, ccVol);
    trackBytes.push(0x00, 0xb0 | ch, 10, Math.max(0, Math.min(127, ccPan)));

    interface RawEvent {
      tick: number;
      order: number; // 0 = noteOff, 1 = noteOn
      bytes: number[];
    }
    const rawEvents: RawEvent[] = [];

    for (const n of voiceNotes) {
      const startTick = Math.max(0, Math.round(n.startBeat * ticksPerBeat));
      const endTick = Math.max(startTick + 10, Math.round((n.startBeat + n.durationBeats) * ticksPerBeat) - 4);
      let vel = n.velocity;
      if (opts.mode === 'highlighted' && opts.targetVoice) {
        vel = opts.targetVoice === voice ? 118 : 56;
      }
      rawEvents.push({ tick: startTick, order: 1, bytes: [0x90 | ch, n.pitch & 0x7f, Math.max(1, Math.min(127, vel))] });
      rawEvents.push({ tick: endTick, order: 0, bytes: [0x80 | ch, n.pitch & 0x7f, 0] });
    }

    rawEvents.sort((a, b) => a.tick - b.tick || a.order - b.order);

    let lastTick = 0;
    for (const ev of rawEvents) {
      const delta = Math.max(0, ev.tick - lastTick);
      lastTick = ev.tick;
      trackBytes.push(...writeVarLen(delta), ...ev.bytes);
    }

    // End of track
    trackBytes.push(0x00, 0xff, 0x2f, 0x00);
    tracks.push(makeTrackChunk(trackBytes));
  }

  // Header chunk: MThd, len=6, format=1, numTracks, division=480
  const header = [
    0x4d, 0x54, 0x68, 0x64,
    ...uint32Bytes(6),
    ...uint16Bytes(1),
    ...uint16Bytes(tracks.length),
    ...uint16Bytes(ticksPerBeat),
  ];

  const totalLen = header.length + tracks.reduce((sum, t) => sum + t.length, 0);
  const out = new Uint8Array(totalLen);
  let ptr = 0;
  out.set(header, ptr);
  ptr += header.length;
  for (const t of tracks) {
    out.set(t, ptr);
    ptr += t.length;
  }
  return out;
}
