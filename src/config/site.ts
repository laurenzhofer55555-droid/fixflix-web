/**
 * Operator details for the Impressum (§ 5 DDG) and the privacy policy.
 * German law requires real data here before the site is public — replace
 * every TODO.
 */
export const site = {
  name: 'TODO Vor- und Nachname',
  street: 'TODO Straße und Hausnummer',
  city: 'TODO PLZ Ort',
  email: 'TODO kontakt@deine-domain.de',
  phone: '',
}

export const siteIsConfigured = !Object.values(site).some((value) => value.startsWith('TODO'))
