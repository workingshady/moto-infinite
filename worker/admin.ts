// Admin role. Admins are Google accounts (keyed by `sub`, never by e-mail) pinned in their own Account Durable Object.
// Bootstrap: a verified sign-in whose token says email_verified === true, with an @gmail.com address listed in the
// ADMIN_EMAILS var (wrangler.jsonc, comma separated), pins that account as admin. The e-mail is only compared here,
// never stored. From then on the pin decides: removing the e-mail from ADMIN_EMAILS does NOT unpin an account
// (Google lets an e-mail move to another account, the `sub` never changes). To unpin: POST /api/admin/unpin
// (an admin, for themself or another account key), or "Delete my cloud data" on that account.

/** E-mails allowed to bootstrap admin (lower case, gmail only). */
export function adminEmailList(raw: string | undefined): string[] {
  return String(raw ?? '').split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@gmail\.com$/.test(e));
}

/** True when this verified Google sign-in may pin its account as admin. */
export function adminBootstrap(claims: { email?: unknown; email_verified?: unknown }, adminEmails: string | undefined): boolean {
  if (claims.email_verified !== true || typeof claims.email !== 'string') return false;
  const email = claims.email.trim().toLowerCase();
  return email.endsWith('@gmail.com') && adminEmailList(adminEmails).includes(email);
}

/** Admin flag after a sign-in: once pinned it stays pinned (only an explicit unpin clears it). */
export function nextAdminPin(pinned: boolean, bootstrap: boolean): boolean {
  return pinned || bootstrap;
}
