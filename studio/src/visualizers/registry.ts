/**
 * Visualizer discovery.
 *
 * Every folder under visualizers/dev/<id>/ or visualizers/final/<id>/
 * with an index.ts default-exporting a VisualizerDefinition is picked up
 * automatically via Vite's import.meta.glob (eager, so the registry is
 * synchronous and available in both the studio and the render page).
 *
 * Status is derived from the folder: dev/ => "dev", final/ => "final".
 * Promoting an experiment is literally `git mv dev/foo final/foo`.
 */

import type { VisualizerDefinition } from "./types";

const modules = import.meta.glob<{ default: VisualizerDefinition }>(
  ["./dev/*/index.ts", "./final/*/index.ts"],
  { eager: true },
);

const registry = new Map<string, VisualizerDefinition>();

for (const [path, mod] of Object.entries(modules)) {
  const def = mod.default;
  if (!def?.id || typeof def.create !== "function") {
    console.warn(`visualizer at ${path} has no valid default export, skipped`);
    continue;
  }
  if (registry.has(def.id)) {
    console.warn(`duplicate visualizer id "${def.id}" (${path}), skipped`);
    continue;
  }
  def.status = path.includes("/final/") ? "final" : "dev";
  registry.set(def.id, def);
}

export function listVisualizers(): VisualizerDefinition[] {
  // Final visualizers first, then dev, alphabetical within each group.
  return [...registry.values()].sort((a, b) =>
    a.status === b.status
      ? a.name.localeCompare(b.name)
      : a.status === "final" ? -1 : 1,
  );
}

export function getVisualizer(id: string): VisualizerDefinition | undefined {
  return registry.get(id);
}
