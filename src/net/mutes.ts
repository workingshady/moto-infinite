// Players muted locally (chat lines and emotes hidden). Per page session, keyed by room player id.
const muted = new Set<string>();

export const mutes = {
  has: (id: string) => muted.has(id),
  toggle(id: string) {
    if (muted.has(id)) muted.delete(id);
    else muted.add(id);
    return muted.has(id);
  },
};
