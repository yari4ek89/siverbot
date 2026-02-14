export function getSourceProfile(sourceName, config) {
  const name = (sourceName || '').trim().toLowerCase();

  if (config.uavOnlySources.includes(name)) {
    return { defaultThreatType: 'uav', allowLocationOnly: true };
  }

  if (config.missileOnlySources.includes(name)) {
    return { defaultThreatType: 'missile', allowLocationOnly: true };
  }

  return { defaultThreatType: 'unknown', allowLocationOnly: false };
}
