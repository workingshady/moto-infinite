import { describe, expect, it } from 'vitest';
import { adminBootstrap, adminEmailList, nextAdminPin } from './admin';

const LIST = 'workingshady@gmail.com, Other.Admin@gmail.com,someone@example.com';

describe('admin bootstrap and pinning', () => {
  it('reads the ADMIN_EMAILS list (gmail only, case-insensitive)', () => {
    expect(adminEmailList(LIST)).toEqual(['workingshady@gmail.com', 'other.admin@gmail.com']);
    expect(adminEmailList(undefined)).toEqual([]);
  });

  it('pins only verified gmail addresses that are listed', () => {
    expect(adminBootstrap({ email: 'workingshady@gmail.com', email_verified: true }, LIST)).toBe(true);
    expect(adminBootstrap({ email: 'WorkingShady@Gmail.com', email_verified: true }, LIST)).toBe(true);
    expect(adminBootstrap({ email: 'workingshady@gmail.com', email_verified: false }, LIST)).toBe(false);
    expect(adminBootstrap({ email: 'workingshady@gmail.com' }, LIST)).toBe(false);
    expect(adminBootstrap({ email: 'someone@example.com', email_verified: true }, LIST)).toBe(false); // not gmail
    expect(adminBootstrap({ email: 'stranger@gmail.com', email_verified: true }, LIST)).toBe(false);
    expect(adminBootstrap({ email_verified: true }, LIST)).toBe(false);
    expect(adminBootstrap({ email: 'workingshady@gmail.com', email_verified: 'true' }, LIST)).toBe(false); // must be a real boolean
  });

  it('keeps a pin once set, even when the e-mail is later removed from ADMIN_EMAILS', () => {
    expect(nextAdminPin(false, adminBootstrap({ email: 'workingshady@gmail.com', email_verified: true }, LIST))).toBe(true);
    expect(nextAdminPin(true, adminBootstrap({ email: 'workingshady@gmail.com', email_verified: true }, ''))).toBe(true);
    expect(nextAdminPin(false, adminBootstrap({ email: 'workingshady@gmail.com', email_verified: true }, ''))).toBe(false);
  });
});
