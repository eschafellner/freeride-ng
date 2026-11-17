import { rideDescription, type RideMeta, type RideTrack } from './rideLog';

/**
 * Export als TCX (Garmin Training Center XML, v2). Eine Runde mit allen Messpunkten,
 * Leistung und Tempo in der ActivityExtension. Ohne GPS-Position: Strava & Co. werten
 * das als Indoor-Fahrt. Die Reihenfolge der Elemente folgt dem XML-Schema.
 */

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const num = (v: number, digits = 1) => String(Math.round(v * 10 ** digits) / 10 ** digits);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toTcx(meta: RideMeta, track: RideTrack): string {
  const s = meta.summary;
  const n = track.ts.length;
  const start = iso(n ? track.ts[0]! : meta.startedAt);
  const out: string[] = [];
  out.push(
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"' +
      ' xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">',
    '  <Activities>',
    '    <Activity Sport="Biking">',
    `      <Id>${start}</Id>`,
    `      <Lap StartTime="${start}">`,
    `        <TotalTimeSeconds>${num(s.movingSec)}</TotalTimeSeconds>`,
    `        <DistanceMeters>${num(s.distance)}</DistanceMeters>`,
    `        <MaximumSpeed>${num(s.maxSpeed, 2)}</MaximumSpeed>`,
    `        <Calories>${Math.round(s.kj)}</Calories>`,
  );
  if (s.avgHr > 0) {
    out.push(
      `        <AverageHeartRateBpm><Value>${Math.round(s.avgHr)}</Value></AverageHeartRateBpm>`,
      `        <MaximumHeartRateBpm><Value>${Math.round(s.maxHr)}</Value></MaximumHeartRateBpm>`,
    );
  }
  out.push('        <Intensity>Active</Intensity>');
  if (s.avgCadence > 0) out.push(`        <Cadence>${Math.min(254, Math.round(s.avgCadence))}</Cadence>`);
  out.push('        <TriggerMethod>Manual</TriggerMethod>', '        <Track>');
  for (let i = 0; i < n; i++) {
    const hr = track.hr[i]!;
    out.push(
      '          <Trackpoint>' +
        `<Time>${iso(track.ts[i]!)}</Time>` +
        `<AltitudeMeters>${num(track.alt[i]!)}</AltitudeMeters>` +
        `<DistanceMeters>${num(track.dist[i]!)}</DistanceMeters>` +
        (hr > 0 ? `<HeartRateBpm><Value>${Math.round(hr)}</Value></HeartRateBpm>` : '') +
        `<Cadence>${Math.min(254, Math.round(track.cadence[i]!))}</Cadence>` +
        '<Extensions><ns3:TPX>' +
        `<ns3:Speed>${num(track.speed[i]!, 2)}</ns3:Speed>` +
        `<ns3:Watts>${Math.round(track.power[i]!)}</ns3:Watts>` +
        '</ns3:TPX></Extensions>' +
        '</Trackpoint>',
    );
  }
  out.push(
    '        </Track>',
    '        <Extensions><ns3:LX>' +
      `<ns3:AvgSpeed>${num(s.avgSpeed, 2)}</ns3:AvgSpeed>` +
      `<ns3:AvgWatts>${Math.round(s.avgPower)}</ns3:AvgWatts>` +
      `<ns3:MaxWatts>${Math.round(s.maxPower)}</ns3:MaxWatts>` +
      '</ns3:LX></Extensions>',
    '      </Lap>',
    `      <Notes>${esc(rideDescription(meta))}</Notes>`,
    '    </Activity>',
    '  </Activities>',
    '</TrainingCenterDatabase>',
    '',
  );
  return out.join('\n');
}
