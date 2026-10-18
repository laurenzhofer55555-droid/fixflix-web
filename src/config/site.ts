/**
 * Operator details for the Impressum (§ 5 DDG) and the privacy policy.
 * German law requires real data here before the site is public — replace
 * every TODO.
 */
export const site = {
  name: 'Laurenz Hofer',
  street: 'Berg 112',
  city: '83734 Hausham',
  email: 'kontakt@fixflix.space',
  phone: '',
}

export const siteIsConfigured = !Object.values(site).some((value) => value.startsWith('TODO'))
