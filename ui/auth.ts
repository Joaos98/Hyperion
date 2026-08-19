import type { Invite, User } from '../domain/index.js'

/** What the server said was wrong — the message a Login/Setup/Register form shows as-is. */
export class AuthError extends Error {}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const sent = (await response.json().catch(() => undefined)) as { error?: string } | undefined
    throw new AuthError(sent?.error ?? `That didn't work (${response.status}).`)
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

/**
 * Who this browser is signed in as, and whether first-run Setup is still open — the one
 * call `ui/main.ts`'s bootstrap makes before deciding whether to show the app, Login, or
 * Setup. Never throws: an unreachable server is treated the same as "not signed in" by
 * the caller, not specially here.
 */
export function whoAmI(): Promise<{ user: User | null; setupOpen: boolean }> {
  return api('/session')
}

export async function login(displayName: string, password: string): Promise<User> {
  const { user } = await api<{ user: User }>('/login', { method: 'POST', body: JSON.stringify({ displayName, password }) })
  return user
}

export function logout(): Promise<void> {
  return api('/logout', { method: 'POST' })
}

export async function completeSetup(setupToken: string, displayName: string, password: string): Promise<User> {
  const { user } = await api<{ user: User }>('/setup', {
    method: 'POST',
    body: JSON.stringify({ setupToken, displayName, password }),
  })
  return user
}

export async function registerWithInvite(code: string, displayName: string, password: string): Promise<User> {
  const { user } = await api<{ user: User }>('/register', {
    method: 'POST',
    body: JSON.stringify({ code, displayName, password }),
  })
  return user
}

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return api('/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) })
}

export async function createInvite(): Promise<Invite> {
  const { invite } = await api<{ invite: Invite }>('/invites', { method: 'POST' })
  return invite
}

export async function listInvites(): Promise<Invite[]> {
  const { invites } = await api<{ invites: Invite[] }>('/invites')
  return invites
}

export function deleteInvite(code: string): Promise<void> {
  return api(`/invites/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

export async function listUsers(): Promise<User[]> {
  const { users } = await api<{ users: User[] }>('/users')
  return users
}

export function resetUserPassword(userId: string, newPassword: string): Promise<void> {
  return api(`/users/${encodeURIComponent(userId)}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  })
}
