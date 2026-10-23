import { describe, expect, test } from "bun:test";
import { fileBase, parseFileName, stamp } from "../src/core/naming";

describe("naming", () => {
  test("stamp is compact and sortable", () => {
    expect(stamp(new Date(2026, 6, 7, 14, 5, 9))).toBe("20260707_140509");
  });

  test("fileBase drops the room id and separators", () => {
    expect(
      fileBase("creator", "12345", new Date(2026, 6, 7, 14, 5, 9).getTime()),
    ).toBe("creator_20260707_140509");
    expect(
      fileBase("creator", null, new Date(2026, 6, 7, 14, 5, 9).getTime()),
    ).toBe("creator_20260707_140509");
  });

  test("parseFileName reads current names", () => {
    expect(parseFileName("creator_20260707_140509.mp4")).toEqual({
      uniqueId: "creator",
      roomId: null,
      startedAt: new Date(2026, 6, 7, 14, 5, 9).getTime(),
    });
  });

  test("parseFileName keeps reading legacy names with room id and dashes", () => {
    expect(parseFileName("creator_12345_2026-07-07_14-05-09.ts")).toEqual({
      uniqueId: "creator",
      roomId: "12345",
      startedAt: new Date(2026, 6, 7, 14, 5, 9).getTime(),
    });
  });

  test("parseFileName rejects foreign names", () => {
    expect(parseFileName("holiday-video.mp4")).toBeNull();
  });
});
