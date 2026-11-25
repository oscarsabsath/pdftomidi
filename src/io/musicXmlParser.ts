import { unzipSync, strFromU8 } from 'fflate';
import { NoteEvent, ScoreData, TimeSignature, VoiceId, VOICE_IDS } from '../types/music';
import { autoSeparateSATB } from '../utils/musicTheory';

const STEP_TO_SEMITONE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function detectVoiceFromName(name: string): VoiceId | null {
  const l = name.toLowerCase();
  if (l.includes('soprano') || /\bs\b/.test(l)) return 'soprano';
  if (l.includes('contralto') || l.includes('alto') || /\ba\b/.test(l)) return 'contralto';
  if (l.includes('tenor') || /\bt\b/.test(l)) return 'tenor';
  if (l.includes('bajo') || l.includes('bass') || /\bb\b/.test(l)) return 'bajo';
  return null;
}

export async function parseMusicXmlFile(file: File): Promise<ScoreData> {
  let xmlText = '';
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith('.mxl')) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const files = unzipSync(buf);
    // Find container.xml to locate rootfile, or first .xml/.musicxml file
    let targetPath: string | null = null;
    if (files['META-INF/container.xml']) {
      const containerXml = strFromU8(files['META-INF/container.xml']);
      const match = containerXml.match(/full-path="([^"]+)"/);
      if (match && files[match[1]]) targetPath = match[1];
    }
    if (!targetPath) {
      targetPath =
        Object.keys(files).find(
          (k) => !k.startsWith('META-INF/') && (k.endsWith('.xml') || k.endsWith('.musicxml'))
        ) ?? null;
    }
    if (!targetPath) throw new Error('No se encontró ningún archivo MusicXML dentro del contenedor .mxl.');
    xmlText = strFromU8(files[targetPath]);
  } else {
    xmlText = await file.text();
  }

  return parseMusicXmlString(xmlText, file.name);
}

export function parseMusicXmlString(xmlText: string, fileName: string): ScoreData {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Error al leer el archivo MusicXML: formato XML inválido.');
  }

  const titleEl =
    doc.querySelector('work > work-title') ||
    doc.querySelector('movement-title') ||
    doc.querySelector('credit > credit-words');
  const title = titleEl?.textContent?.trim() || fileName.replace(/\.(musicxml|mxl|xml)$/i, '');

  // Part list names
  const partNames = new Map<string, string>();
  doc.querySelectorAll('part-list > score-part').forEach((sp) => {
    const id = sp.getAttribute('id') || '';
    const name = sp.querySelector('part-name')?.textContent?.trim() || '';
    partNames.set(id, name);
  });

  let tempoBpm = 92;
  let timeSignature: TimeSignature = { numerator: 4, denominator: 4 };
  let keySignatureFifths = 0;

  const parts = Array.from(doc.querySelectorAll('part'));

  interface RawXmlNote {
    partIdx: number;
    partId: string;
    partName: string;
    staffNum: number;
    xmlVoice: string;
    pitch: number;
    startBeat: number;
    durationBeats: number;
    clefSign: 'G' | 'F';
  }

  const rawNotes: RawXmlNote[] = [];

  parts.forEach((partEl, partIdx) => {
    const partId = partEl.getAttribute('id') || `P${partIdx + 1}`;
    const partName = partNames.get(partId) || '';
    let divisions = 1;
    let measureStartBeat = 0;
    const clefByStaff = new Map<number, 'G' | 'F'>();
    clefByStaff.set(1, 'G');
    clefByStaff.set(2, 'F');

    // Track ongoing tied notes by key
    const openTies = new Map<string, RawXmlNote>();

    const measures = Array.from(partEl.querySelectorAll('measure'));
    for (const measureEl of measures) {
      let cursorDivs = 0;
      let lastNoteStartDivs = 0;
      let maxMeasureDivs = 0;

      // Read attributes
      const attrs = measureEl.querySelectorAll('attributes');
      attrs.forEach((attr) => {
        const divText = attr.querySelector('divisions')?.textContent;
        if (divText) {
          const parsed = parseFloat(divText);
          if (parsed > 0) divisions = parsed;
        }
        const fifthsText = attr.querySelector('key > fifths')?.textContent;
        if (fifthsText !== undefined && fifthsText !== null && partIdx === 0) {
          const f = parseInt(fifthsText, 10);
          if (!Number.isNaN(f)) keySignatureFifths = f;
        }
        const beatsText = attr.querySelector('time > beats')?.textContent;
        const beatTypeText = attr.querySelector('time > beat-type')?.textContent;
        if (beatsText && beatTypeText && partIdx === 0) {
          const num = parseInt(beatsText, 10);
          const den = parseInt(beatTypeText, 10);
          if (num > 0 && den > 0) timeSignature = { numerator: num, denominator: den };
        }
        attr.querySelectorAll('clef').forEach((clefEl) => {
          const num = parseInt(clefEl.getAttribute('number') || '1', 10);
          const sign = clefEl.querySelector('sign')?.textContent?.trim();
          if (sign === 'F') clefByStaff.set(num, 'F');
          else if (sign === 'G') clefByStaff.set(num, 'G');
        });
      });

      // Tempo from sound or metronome
      const soundTempo = measureEl.querySelector('sound[tempo]')?.getAttribute('tempo');
      if (soundTempo) {
        const t = parseFloat(soundTempo);
        if (t >= 30 && t <= 240) tempoBpm = Math.round(t);
      }

      for (const child of Array.from(measureEl.children)) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'backup') {
          const dur = parseFloat(child.querySelector('duration')?.textContent || '0');
          cursorDivs = Math.max(0, cursorDivs - dur);
        } else if (tag === 'forward') {
          const dur = parseFloat(child.querySelector('duration')?.textContent || '0');
          cursorDivs += dur;
          if (cursorDivs > maxMeasureDivs) maxMeasureDivs = cursorDivs;
        } else if (tag === 'note') {
          if (child.querySelector('grace')) continue;
          const isChord = Boolean(child.querySelector('chord'));
          const isRest = Boolean(child.querySelector('rest'));
          const dur = parseFloat(child.querySelector('duration')?.textContent || '0');
          const startDivs = isChord ? lastNoteStartDivs : cursorDivs;

          if (!isChord) {
            lastNoteStartDivs = cursorDivs;
            cursorDivs += dur;
            if (cursorDivs > maxMeasureDivs) maxMeasureDivs = cursorDivs;
          }

          if (isRest) continue;

          const pitchEl = child.querySelector('pitch');
          if (!pitchEl) continue;

          const step = pitchEl.querySelector('step')?.textContent?.trim().toUpperCase() || 'C';
          const octave = parseInt(pitchEl.querySelector('octave')?.textContent || '4', 10);
          const alter = parseFloat(pitchEl.querySelector('alter')?.textContent || '0');
          const midiPitch = (octave + 1) * 12 + (STEP_TO_SEMITONE[step] ?? 0) + Math.round(alter);

          const staffNum = parseInt(child.querySelector('staff')?.textContent || '1', 10);
          const xmlVoice = child.querySelector('voice')?.textContent?.trim() || '1';
          const startBeat = measureStartBeat + startDivs / divisions;
          const durationBeats = Math.max(0.125, dur / divisions);

          // Handle ties
          const ties = Array.from(child.querySelectorAll('tie')).map((t) => t.getAttribute('type'));
          const tieKey = `${partIdx}_${staffNum}_${xmlVoice}_${midiPitch}`;

          if (ties.includes('stop') && openTies.has(tieKey)) {
            const existing = openTies.get(tieKey)!;
            existing.durationBeats += durationBeats;
            if (!ties.includes('start')) openTies.delete(tieKey);
            continue;
          }

          const noteObj: RawXmlNote = {
            partIdx,
            partId,
            partName,
            staffNum,
            xmlVoice,
            pitch: Math.max(21, Math.min(108, midiPitch)),
            startBeat: Math.round(startBeat * 16) / 16,
            durationBeats: Math.round(durationBeats * 16) / 16,
            clefSign: clefByStaff.get(staffNum) ?? (staffNum >= 2 ? 'F' : 'G'),
          };

          rawNotes.push(noteObj);
          if (ties.includes('start')) {
            openTies.set(tieKey, noteObj);
          }
        }
      }

      const expectedMeasureBeats = (timeSignature.numerator * 4) / timeSignature.denominator;
      const actualBeats = maxMeasureDivs > 0 ? maxMeasureDivs / divisions : expectedMeasureBeats;
      measureStartBeat += actualBeats;
    }
  });

  // Map raw MusicXML notes to SATB voices
  let notes: NoteEvent[] = [];

  if (parts.length === 4) {
    // 4-part score: check part names or order by average pitch descending
    const partToVoice = new Map<number, VoiceId>();
    const namedMatches = parts.map((p, idx) => detectVoiceFromName(partNames.get(p.getAttribute('id') || '') || ''));
    if (namedMatches.filter(Boolean).length === 4) {
      namedMatches.forEach((v, idx) => partToVoice.set(idx, v!));
    } else {
      const avgs = parts.map((_, idx) => {
        const pn = rawNotes.filter((n) => n.partIdx === idx);
        const avg = pn.length ? pn.reduce((s, x) => s + x.pitch, 0) / pn.length : 70 - idx * 8;
        return { idx, avg };
      });
      avgs.sort((a, b) => b.avg - a.avg);
      avgs.forEach((item, i) => partToVoice.set(item.idx, VOICE_IDS[i]));
    }

    let idCounter = 1;
    notes = rawNotes.map((n) => ({
      id: `xml_${idCounter++}`,
      voice: partToVoice.get(n.partIdx) ?? 'soprano',
      pitch: n.pitch,
      startBeat: n.startBeat,
      durationBeats: n.durationBeats,
      velocity: 92,
    }));
  } else {
    // Grand Staff (1 part with 2 staves or 2 parts) or Piano reduction:
    // Separate Treble staff notes into Soprano/Contralto and Bass staff notes into Tenor/Bajo
    const trebleRaw = rawNotes.filter((n) => n.clefSign === 'G' && (parts.length === 1 ? n.staffNum === 1 : n.partIdx === 0));
    const bassRaw = rawNotes.filter((n) => !trebleRaw.includes(n));

    if (trebleRaw.length > 0 && bassRaw.length > 0) {
      const assignTwoVoices = (list: RawXmlNote[], highVoice: VoiceId, lowVoice: VoiceId): NoteEvent[] => {
        // Check if MusicXML already uses 2 distinct xmlVoices cleanly
        const distinctVoices = Array.from(new Set(list.map((n) => n.xmlVoice)));
        if (distinctVoices.length === 2) {
          const avgs = distinctVoices.map((v) => {
            const vn = list.filter((n) => n.xmlVoice === v);
            return { v, avg: vn.reduce((s, x) => s + x.pitch, 0) / vn.length };
          });
          avgs.sort((a, b) => b.avg - a.avg);
          let c = 1;
          return list.map((n) => ({
            id: `xml_${highVoice}_${c++}`,
            voice: n.xmlVoice === avgs[0].v ? highVoice : lowVoice,
            pitch: n.pitch,
            startBeat: n.startBeat,
            durationBeats: n.durationBeats,
            velocity: 92,
          }));
        }

        // Otherwise group by onset beat and split higher/lower
        const sorted = [...list].sort((a, b) => a.startBeat - b.startBeat || b.pitch - a.pitch);
        const out: NoteEvent[] = [];
        let c = 1;
        let i = 0;
        while (i < sorted.length) {
          const cluster: RawXmlNote[] = [sorted[i]];
          let j = i + 1;
          while (j < sorted.length && Math.abs(sorted[j].startBeat - sorted[i].startBeat) <= 0.08) {
            cluster.push(sorted[j]);
            j++;
          }
          cluster.sort((a, b) => b.pitch - a.pitch);
          if (cluster.length === 1) {
            out.push({
              id: `xml_${highVoice}_${c++}`,
              voice: highVoice,
              pitch: cluster[0].pitch,
              startBeat: cluster[0].startBeat,
              durationBeats: cluster[0].durationBeats,
              velocity: 92,
            });
          } else {
            cluster.forEach((n, idx) => {
              out.push({
                id: `xml_${highVoice}_${c++}`,
                voice: idx === 0 ? highVoice : lowVoice,
                pitch: n.pitch,
                startBeat: n.startBeat,
                durationBeats: n.durationBeats,
                velocity: 92,
              });
            });
          }
          i = j;
        }
        return out;
      };

      notes = [
        ...assignTwoVoices(trebleRaw, 'soprano', 'contralto'),
        ...assignTwoVoices(bassRaw, 'tenor', 'bajo'),
      ];
    } else {
      notes = autoSeparateSATB(
        rawNotes.map((n) => ({
          pitch: n.pitch,
          startBeat: n.startBeat,
          durationBeats: n.durationBeats,
          velocity: 92,
          preferredClef: n.clefSign === 'F' ? 'bass' : 'treble',
        }))
      );
    }
  }

  return {
    id: `score_xml_${Date.now()}`,
    title,
    sourceType: 'musicxml',
    tempoBpm,
    timeSignature,
    keySignatureFifths,
    notes: notes.sort((a, b) => a.startBeat - b.startBeat || b.pitch - a.pitch),
  };
}
