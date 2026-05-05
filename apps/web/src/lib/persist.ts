/**
 * Layout persistence: localStorage auto-save (session continuity) +
 * JSON file export/import (sharing, backup).
 *
 * Two formats:
 *
 *   - SessionState (localStorage): saved regions + active editing
 *     state. The active state lets a browser refresh restore not just
 *     the saved layout but also work-in-progress.
 *   - LayoutExport (downloaded file): just the saved regions. The
 *     editing state is transient and not part of "the layout".
 *
 * Both share a `format_version` for forward compatibility. v1 is the
 * only version right now; future schema migrations live here.
 */

import { VERSION as TOOL_VERSION } from '@monome-iii-studio/codegen';
import type { RegionMode } from '@monome-iii-studio/codegen';
import type { BehaviorKind } from '../recipes/types.ts';
import { downloadText } from './download.ts';

const FORMAT_VERSION = 1;
const STORAGE_KEY = 'monome-iii-studio:session-v1';

export type SavedRegionJSON = {
  id: string;
  name: string;
  cellKeys: string[];
  mode: RegionMode;
  recipeKind: BehaviorKind;
  values: Record<string, unknown>;
  colorIndex: number;
};

export type LayoutExport = {
  format_version: number;
  tool_version: string;
  layoutName: string;
  regions: SavedRegionJSON[];
};

export type SessionState = LayoutExport & {
  selection: string[];
  recipeKind: BehaviorKind | null;
  mode: RegionMode;
  values: Record<string, unknown>;
};

export function makeLayoutExport(
  layoutName: string,
  regions: SavedRegionJSON[],
): LayoutExport {
  return {
    format_version: FORMAT_VERSION,
    tool_version: TOOL_VERSION,
    layoutName,
    regions,
  };
}

// ---------- localStorage ----------

export function saveSession(state: SessionState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded, private mode, etc. — silent best-effort.
  }
}

export function loadSession(): SessionState | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.format_version !== FORMAT_VERSION) return null;
    if (!Array.isArray(parsed.regions)) return null;
    return parsed as SessionState;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---------- JSON file export / import ----------

export function exportLayout(layout: LayoutExport): void {
  const filename = (layout.layoutName || 'untitled') + '.layout.json';
  downloadText(filename, JSON.stringify(layout, null, 2));
}

export async function importLayoutFile(file: File): Promise<LayoutExport> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (parsed?.format_version !== FORMAT_VERSION) {
    throw new Error(
      `Unsupported layout file version: ${parsed?.format_version ?? 'missing'}`,
    );
  }
  if (!Array.isArray(parsed.regions)) {
    throw new Error('Invalid layout file: missing regions array');
  }
  return parsed as LayoutExport;
}
