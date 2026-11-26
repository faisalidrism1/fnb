// In-memory admin session token store (never persisted in localStorage or sessionStorage)
let adminBearerToken: string | null = null;

export function getAdminToken(): string | null {
  return adminBearerToken;
}

export function isAdminAuthenticated(): boolean {
  return adminBearerToken !== null && adminBearerToken.length > 0;
}

export function clearLegacyAdminStorage(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('fnb_admin_unlocked');
    }
  } catch {}
}

export function setAdminToken(token: string | null): void {
  adminBearerToken = token && token.trim().length > 0 ? token.trim() : null;
  clearLegacyAdminStorage();
}

export function getAdminAuthHeaders(): Record<string, string> {
  if (!adminBearerToken) return {};
  return { Authorization: `Bearer ${adminBearerToken}` };
}
