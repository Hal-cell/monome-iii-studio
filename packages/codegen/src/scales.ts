/**
 * Scale support for note-output recipes (step sequencer's note_per_row,
 * note keyboard).
 *
 * Each scale is defined by its semitone offsets from the root for a
 * single octave. `noteAtDegree(root, scale, n)` walks N steps up the
 * scale and returns the resulting MIDI note, wrapping into higher
 * octaves as needed (and below 0 by symmetry — useful for note
 * keyboards where some cells fall below the root).
 *
 * Chromatic is the no-op scale: every degree corresponds to one
 * semitone. Recipes default to chromatic so the existing fixtures
 * (and any user's existing layouts) keep their pre-scale behaviour.
 */

export type ScaleName =
  | 'chromatic'
  | 'major'
  | 'minor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian';

const SCALE_INTERVALS: Record<ScaleName, ReadonlyArray<number>> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  // Diatonic modes (in order around the circle of fifths starting on
  // Ionian). Each is a 7-note rotation of the major scale.
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10], // = aeolian
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

export const SCALE_NAMES: ReadonlyArray<ScaleName> = [
  'chromatic',
  'major',
  'minor',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'locrian',
];

/**
 * Walk `degree` steps up from `rootNote` along `scale`, returning the
 * resulting MIDI note. Negative degrees walk down. Wraps octaves.
 */
export function noteAtDegree(
  rootNote: number,
  scale: ScaleName,
  degree: number,
): number {
  const intervals = SCALE_INTERVALS[scale];
  const len = intervals.length;
  const octave = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  return rootNote + octave * 12 + intervals[idx]!;
}
