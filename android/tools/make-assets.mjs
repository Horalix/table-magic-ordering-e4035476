/**
 * Makes what the two waiter apps are drawn and heard with, from the brand
 * files the websites already use:
 *
 *   - the launcher icon in every density, round and adaptive (Android 8+
 *     masks the icon itself, so the mark is drawn smaller on its own colour
 *     and can never be cut by a circle or a squircle);
 *   - the splash image shown while Chrome opens the waiter screen;
 *   - each restaurant's colours (res/values/colors.xml);
 *   - the alert chime (res/raw/table_alert.wav): three rising notes, twice.
 *     A tablet's own notification sound is a soft blip made for a pocket;
 *     this one is made to be heard across a dining room, and to be told
 *     apart from every phone at the tables.
 *
 * Run from the repository root:  node android/tools/make-assets.mjs
 * Its output is committed, so building the apps needs none of this.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'android', 'app', 'src');

const VENUES = {
  lasoul: {
    icon: 'public/icons/maskable-512.png',
    colorPrimary: '#7E9B79',
    navigationColor: '#F7F4EC',
    backgroundColor: '#F7F4EC',
  },
  veraitalia: {
    icon: 'public/brand/vera/icon-512.png',
    colorPrimary: '#F4EFE6',
    navigationColor: '#F4EFE6',
    backgroundColor: '#F4EFE6',
  },
};

/** Launcher sizes in px: the 48dp icon and the 108dp adaptive layer. */
const DENSITIES = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };
/** The part of the adaptive layer every launcher shape keeps is its middle 61%; the mark is drawn inside it. */
const FOREGROUND_SCALE = 0.72;

const hex = ({ r, g, b }) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const out = (...parts) => {
  const file = path.join(SRC, ...parts);
  mkdirSync(path.dirname(file), { recursive: true });
  return file;
};

async function icons(flavor, venue) {
  const source = path.join(ROOT, venue.icon);
  // The icon's own ground, read from its corner, so the adaptive background continues it.
  const { data } = await sharp(source).extract({ left: 6, top: 6, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  const ground = { r: data[0], g: data[1], b: data[2] };

  for (const [density, [legacy, layer]] of Object.entries(DENSITIES)) {
    const square = await sharp(source).resize(legacy, legacy).png().toBuffer();
    await sharp(square).toFile(out(flavor, 'res', `mipmap-${density}`, 'ic_launcher.png'));
    const circle = Buffer.from(`<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}"/></svg>`);
    await sharp(square).composite([{ input: circle, blend: 'dest-in' }]).png()
      .toFile(out(flavor, 'res', `mipmap-${density}`, 'ic_launcher_round.png'));

    const inner = Math.round(layer * FOREGROUND_SCALE);
    const mark = await sharp(source).resize(inner, inner).png().toBuffer();
    await sharp({ create: { width: layer, height: layer, channels: 4, background: { ...ground, alpha: 1 } } })
      .composite([{ input: mark, gravity: 'centre' }]).png()
      .toFile(out(flavor, 'res', `mipmap-${density}`, 'ic_launcher_foreground.png'));
  }

  await sharp(source).resize(512, 512).png().toFile(out(flavor, 'res', 'drawable-nodpi', 'splash.png'));

  writeFileSync(out(flavor, 'res', 'values', 'colors.xml'), [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- Written by android/tools/make-assets.mjs. -->',
    '<resources>',
    `    <color name="colorPrimary">${venue.colorPrimary}</color>`,
    `    <color name="navigationColor">${venue.navigationColor}</color>`,
    `    <color name="backgroundColor">${venue.backgroundColor}</color>`,
    `    <color name="ic_launcher_background">${hex(ground)}</color>`,
    '</resources>',
    '',
  ].join('\n'));
  return hex(ground);
}

/** The chime, as 16-bit mono PCM in a WAV file: no codec for a tablet to lack. */
function chime() {
  const RATE = 44100;
  // E6, G#6, B6: a major chord going up, bright enough to carry over a room.
  const NOTES = [1318.51, 1661.22, 1975.53];
  const NOTE_GAP = 0.16;
  const PHRASE_GAP = 0.85;
  const LENGTH = PHRASE_GAP * 2 + 0.75;
  const samples = new Float64Array(Math.ceil(RATE * LENGTH));

  const strike = (frequency, at) => {
    const start = Math.floor(at * RATE);
    for (let i = start; i < samples.length; i += 1) {
      const t = (i - start) / RATE;
      if (t > 1.1) break;
      // A struck bell: a fast attack, a long fall, and two quieter overtones.
      const envelope = Math.min(1, t / 0.004) * Math.exp(-t * 5.5);
      samples[i] += envelope * (
        Math.sin(2 * Math.PI * frequency * t)
        + 0.35 * Math.sin(2 * Math.PI * frequency * 2 * t)
        + 0.15 * Math.sin(2 * Math.PI * frequency * 3 * t)
      );
    }
  };
  for (const phrase of [0, PHRASE_GAP]) NOTES.forEach((note, n) => strike(note, phrase + n * NOTE_GAP));

  const peak = samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => pcm.writeInt16LE(Math.round((v / peak) * 0.92 * 32767), i * 2));

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);       // PCM
  header.writeUInt16LE(1, 22);       // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(out('main', 'res', 'raw', 'table_alert.wav'), Buffer.concat([header, pcm]));
  return LENGTH;
}

for (const [flavor, venue] of Object.entries(VENUES)) {
  console.log(`${flavor}: icons on ${await icons(flavor, venue)}`);
}
console.log(`chime: ${chime().toFixed(2)} s`);
