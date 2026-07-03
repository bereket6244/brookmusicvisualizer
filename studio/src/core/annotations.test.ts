import { describe, expect, it } from "vitest";

import { parseAnnotations } from "./annotations";

const file = {
  format: "music-visualizer-annotations",
  version: "1.0",
  timeline: "samples/prelude_c.timeline.json",
  labels: [
    { id: "subject-1", type: "motif", name: "Subject entry 1",
      start_seconds: 0, end_seconds: 3.5, track: 1, tags: ["subject", "voice-1"] },
    { id: "answer-1", type: "motif", name: "Answer entry 1",
      start_seconds: 3.5, end_seconds: 7, track: 2, tags: ["answer", "voice-2"] },
    { id: "section-a", type: "section", name: "Exposition",
      start_seconds: 0, end_seconds: 20 },
    { id: "climax", type: "marker", name: "Climax", start_seconds: 12,
      note_ids: [40, 41] },
  ],
};

describe("parseAnnotations", () => {
  it("rejects wrong format", () => {
    expect(() => parseAnnotations({ format: "nope", labels: [] })).toThrow();
    expect(() => parseAnnotations({ format: "music-visualizer-annotations" }))
      .toThrow(/labels/);
  });

  it("rejects labels without id/start", () => {
    expect(() => parseAnnotations({
      format: "music-visualizer-annotations",
      version: "1.0",
      labels: [{ type: "motif" }],
    })).toThrow();
  });
});

describe("AnnotationSet queries", () => {
  const set = parseAnnotations(file);

  it("labelsAt uses half-open ranges; markers match at their instant", () => {
    expect(set.labelsAt(1).map((l) => l.id)).toEqual(["subject-1", "section-a"]);
    // t=3.5: subject-1 ends (exclusive), answer-1 starts (inclusive).
    expect(set.labelsAt(3.5).map((l) => l.id)).toEqual(["section-a", "answer-1"]);
    expect(set.labelsAt(12).map((l) => l.id)).toContain("climax");
    expect(set.labelsAt(12.01).map((l) => l.id)).not.toContain("climax");
  });

  it("labelsOverlapping finds ranged and marker labels in a window", () => {
    const ids = set.labelsOverlapping(3, 13).map((l) => l.id);
    expect(ids).toEqual(
      expect.arrayContaining(["subject-1", "answer-1", "section-a", "climax"]));
    expect(set.labelsOverlapping(30, 40)).toEqual([]);
  });

  it("filters by type, tag, track, and note id", () => {
    expect(set.labelsOfType("motif").length).toBe(2);
    expect(set.labelsWithTag("subject")[0].id).toBe("subject-1");
    expect(set.labelsForTrack(2)[0].id).toBe("answer-1");
    expect(set.labelsForNote(41)[0].id).toBe("climax");
    expect(set.get("section-a")?.name).toBe("Exposition");
  });
});
