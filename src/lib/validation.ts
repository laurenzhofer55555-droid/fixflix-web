export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export function isValidPlz(plz: string): boolean {
  return /^\d{5}$/.test(plz)
}
