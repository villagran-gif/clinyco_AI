export function buildSupportSearchCandidates({ email = null, phone = null, name = null, channelDisplayName = null, sourceProfileName = null, channelExternalId = null }) {
  const strong = { email, phone, channelExternalId };
  const weak = { name, channelDisplayName, sourceProfileName };
  return { strong, weak };
}

export function shouldFallbackToNameSearch(candidates) {
  return !candidates?.strong?.email && !candidates?.strong?.phone && !candidates?.strong?.channelExternalId;
}
