import { describe, expect, it } from "vitest";
import { parseAladhanTimings } from "./aladhan.js";
import { parseHadith, pickNumber } from "./hadith.js";

describe("parseAladhanTimings", () => {
  it("lit le format ISO 8601", () => {
    const body = {
      code: 200,
      data: {
        timings: {
          Fajr: "2026-11-20T06:41:00+01:00",
          Sunrise: "2026-11-20T08:01:00+01:00",
          Dhuhr: "2026-11-20T12:23:00+01:00",
          Asr: "2026-11-20T14:42:00+01:00",
          Maghrib: "2026-11-20T16:57:00+01:00",
          Isha: "2026-11-20T18:24:00+01:00",
        },
      },
    };
    expect(parseAladhanTimings(body, "2026-11-20", "Europe/Paris")).toEqual({
      fajr: "2026-11-20T06:41:00+01:00",
      dhuhr: "2026-11-20T12:23:00+01:00",
      asr: "2026-11-20T14:42:00+01:00",
      maghrib: "2026-11-20T16:57:00+01:00",
      isha: "2026-11-20T18:24:00+01:00",
    });
  });

  it("lit le format court avec fuseau entre parenthèses", () => {
    const body = {
      data: { timings: { Fajr: "05:10 (CEST)", Dhuhr: "13:45", Asr: "17:30", Maghrib: "21:20", Isha: "23:01 (CEST)" } },
    };
    const out = parseAladhanTimings(body, "2026-06-15", "Europe/Paris");
    expect(out.fajr).toBe("2026-06-15T05:10:00+02:00");
    expect(out.isha).toBe("2026-06-15T23:01:00+02:00");
  });

  it("refuse une réponse incomplète", () => {
    expect(() => parseAladhanTimings({ data: { timings: { Fajr: "06:00" } } }, "2026-11-20", "Europe/Paris")).toThrow();
  });
});

describe("parseHadith", () => {
  it("reprend le texte, le recueil et le numéro", () => {
    const body = {
      metadata: { name: "Sahih al Bukhari" },
      hadiths: [{ hadithnumber: 1, text: "  Les actions ne valent\n que par les intentions.  ", grades: [] }],
    };
    expect(parseHadith("fra-bukhari", body)).toEqual({
      edition: "fra-bukhari",
      collection: "Sahih al-Bukhari",
      number: "1",
      text: "Les actions ne valent que par les intentions.",
      grade: null,
    });
  });

  it("ignore un hadith sans traduction", () => {
    expect(parseHadith("fra-muslim", { hadiths: [{ hadithnumber: 12, text: "" }] })).toBeNull();
  });
});

describe("pickNumber", () => {
  it("est stable pour un jour et reste dans les bornes", () => {
    expect(pickNumber("2026-11-20", 0, 42)).toBe(pickNumber("2026-11-20", 0, 42));
    for (let i = 0; i < 50; i++) {
      const n = pickNumber(`2026-11-${i}`, i, 42);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(42);
    }
  });
});
