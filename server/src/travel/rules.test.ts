import { describe, expect, it } from "vitest";
import { departureAt, googleMapsUrl, parseRouteDuration, shouldAlertDeparture, shouldRefreshTravel, wazeUrl } from "./rules.js";

const H = 3600_000;
const M = 60_000;

describe("départ", () => {
  it("part assez tôt pour le trajet et la marge", () => {
    expect(departureAt(10 * H, 25, 10)).toBe(10 * H - 35 * M);
  });

  it("prévient dans les 5 minutes avant le départ, jusqu'au rendez-vous", () => {
    const start = 10 * H;
    const dep = departureAt(start, 25, 10);
    expect(shouldAlertDeparture(dep - 6 * M, dep, start)).toBe(false);
    expect(shouldAlertDeparture(dep - 4 * M, dep, start)).toBe(true);
    expect(shouldAlertDeparture(start - M, dep, start)).toBe(true);
    expect(shouldAlertDeparture(start, dep, start)).toBe(false);
  });
});

describe("shouldRefreshTravel", () => {
  const start = 10 * H;
  it("calcule une première fois dans les 3 heures, puis toutes les 15 minutes dans la dernière heure", () => {
    expect(shouldRefreshTravel(start - 4 * H, start, null)).toBe(false);
    expect(shouldRefreshTravel(start - 2 * H, start, null)).toBe(true);
    expect(shouldRefreshTravel(start - 90 * M, start, start - 2 * H)).toBe(false);
    expect(shouldRefreshTravel(start - 50 * M, start, start - 70 * M)).toBe(true);
    expect(shouldRefreshTravel(start - 50 * M, start, start - 55 * M)).toBe(false);
  });
});

describe("liens et durées", () => {
  it("lit la durée de l'API Routes", () => {
    expect(parseRouteDuration("1534s")).toBe(26);
    expect(parseRouteDuration("60s")).toBe(1);
    expect(() => parseRouteDuration("abc")).toThrow();
  });

  it("construit les liens Google Maps et Waze", () => {
    expect(googleMapsUrl("10 rue de la République, Lyon", "TRANSIT")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=10+rue+de+la+R%C3%A9publique%2C+Lyon&travelmode=transit",
    );
    expect(wazeUrl("Part-Dieu, Lyon")).toBe("https://waze.com/ul?q=Part-Dieu%2C+Lyon&navigate=yes");
  });
});
