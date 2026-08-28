/** Tiny handcrafted GTFS fixtures for pipeline tests. */
import type { CityConfig } from "../config/city";

export function testConfig(overrides: Partial<CityConfig> = {}): CityConfig {
  return {
    id: "testville",
    name: "Testville",
    subtitle: "unit fixture",
    feed: {
      url: "https://example.invalid/feed.zip",
      name: "test-feed",
      publisher: "Fixture",
      license: "ODbL",
      licenseUrl: "https://example.invalid/license",
      attributionHtml: "Fixture",
    },
    timezone: "Asia/Kolkata",
    tzLabel: "IST",
    referenceDate: "2026-09-01",
    defaultView: { lat: 13.0, lon: 80.0, weekday: 1, depSec: 30600, zoom: 11 },
    walking: { speedMps: 1.33, detour: 1.3, transferRadiusM: 300, minTransferSec: 60 },
    bands: [900, 1800, 2700, 3600],
    gridCellM: 200,
    indexCellM: 500,
    mapStyleUrl: "https://example.invalid/style",
    mapStyleFallback: null,
    excludeServiceIds: [],
    validatorErrorAllowlist: [],
    dataNotes: [],
    ...overrides,
  };
}

/**
 * Base feed: stops A,B,C,D ~200 m apart along a meridian + far stop Z.
 * Services: WK (daily 2026), SAT (Saturdays), EXPIRED (2020),
 * an XSS-payload-named service with zero trips.
 * Trips: t1 A->B->C->D (C's times blank -> interpolated), t2 past-midnight
 * 25:00, t3 Saturday, t4 on the expired service, plus malformed/dangling rows.
 */
export function baseFeed(): Map<string, string> {
  const files = new Map<string, string>();
  files.set(
    "stops.txt",
    [
      "stop_id,stop_name,stop_lat,stop_lon",
      "A,Alpha,13.0000,80.0000",
      "B,Beta,13.0018,80.0000",
      "C,Gamma,13.0036,80.0000",
      "D,Delta,13.0054,80.0000",
      "Z,Zulu,13.2000,80.2000",
      "BADROW,only-two-fields",
      "A,DuplicateAlpha,13.5,80.5",
    ].join("\n"),
  );
  files.set(
    "calendar.txt",
    [
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
      "WK,1,1,1,1,1,1,1,20260101,20261231",
      "SAT,0,0,0,0,0,1,0,20260101,20261231",
      "EXPIRED,1,1,1,1,1,1,1,20200101,20201231",
      "'/><script>alert(1)</script>,1,0,0,0,0,0,0,20260101,20261231",
    ].join("\n"),
  );
  files.set(
    "trips.txt",
    [
      "route_id,service_id,trip_id",
      "r1,WK,t1",
      "r1,WK,t2",
      "r1,SAT,t3",
      "r1,EXPIRED,t4",
      "r1,NO_SUCH_SERVICE,t5",
      "r1,WK",
    ].join("\n"),
  );
  files.set(
    "stop_times.txt",
    [
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
      "t1,08:00:00,08:00:00,A,1",
      "t1,08:04:00,08:04:00,B,2",
      "t1,,,C,3",
      "t1,08:10:00,08:10:00,D,4",
      "t2,25:00:00,25:00:00,A,1",
      "t2,25:05:00,25:05:00,B,2",
      "t3,09:00:00,09:00:00,A,1",
      "t3,09:06:00,09:06:00,B,2",
      "t4,10:00:00,10:00:00,A,1",
      "t4,10:05:00,10:05:00,B,2",
      "t1,08:20:00,08:20:00,GHOST,5",
      "badrow,1",
    ].join("\n"),
  );
  return files;
}
