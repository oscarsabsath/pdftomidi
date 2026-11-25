# Estudio Coral OMR (PDF / Imagen / MusicXML / MIDI → SATB)

Aplicación web **100% autónoma en el navegador** (sin APIs externas ni gasto de créditos) para convertir partituras corales en pistas separadas por voz (**Soprano, Contralto, Tenor y Bajo**), editar notas visualmente en un Piano Roll por colores, ensayar con reproductor coral y descargar archivos `.mid`, `.wav` y paquetes `.zip`.

## Funcionalidades principales

- **Carga híbrida de partituras**: PDF multipágina (`pdfjs-dist` local), imágenes (`JPG`/`PNG`/`WebP`), `MusicXML` (`.xml`, `.musicxml`, `.mxl`) y `MIDI` (`.mid`).
- **Motor OMR local autónomo**:
  - Binarización adaptativa y auto-enderezado (*deskew*).
  - Detección automática de pentagramas de 5 líneas (Gran Pentagrama Clave de Sol + Fa o 4 pentagramas SATB).
  - Detección de armadura, compás, barras de compás, cabezas rellenas/huecas (negras, corcheas, blancas, redondas, puntillos) y separación SATB por clave y dirección de plica.
  - Visor interactivo de partitura con capa OMR por colores y re-análisis en vivo.
- **Piano Roll SATB interactivo por colores**:
  - Editar, mover, redimensionar, dibujar y borrar notas con vista previa de audio.
  - Teclado lateral interactivo, filtro por voz, rejilla magnética (*snap*), `Ctrl+Z` / `Ctrl+Y` y limpieza de solapamientos.
- **Selector de Estrofas / Repeticiones**: configura de 1 a 12 estrofas con respiro opcional entre estrofas, aplicado tanto a la reproducción como a las descargas `.mid` y `.wav`.
- **Reproductor Coral Web Audio**:
  - Controles por voz: **Destacar**, **Solo**, **Silenciar** y volumen independiente.
  - **Tempo (BPM)**, **Transposición de tono (`-12` a `+12` st)**, **4 timbres locales** (*Coro Vocal con formantes SATB*, *Piano Ensayo*, *Órgano Iglesia*, *Cuerdas*), **Metrónomo** y **Estéreo coral**.
- **Descarga directa `.MID`, `.WAV` y `.ZIP`**:
  - Coro completo (`.mid` multipista de 4 canales y `.wav` estéreo 44.1 kHz 16-bit).
  - Por voz individual (`Solo .MID`, `Solo .WAV` y `Destacada .WAV` para ensayo).
  - Paquete `.ZIP` con todo organizado en un clic.

## Uso local

```bash
npm install
npm run dev
```

Compilación de producción:

```bash
npm run build
```
