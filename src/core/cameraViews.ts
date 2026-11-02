// Camera views the player can cycle through (V / L / right stick up). Shared by Player, HUD and menus.

export const CAM_VIEWS = ['chase', 'far', 'hood', 'fp', 'cine', 'top'] as const;
export type CamView = (typeof CAM_VIEWS)[number];

export const CAM_LABEL: Record<CamView, string> = {
  chase: 'Chase', far: 'Far chase', hood: 'Hood', fp: 'First person', cine: 'Cinematic', top: 'Top-down',
};

export const isCamView = (v: unknown): v is CamView => typeof v === 'string' && (CAM_VIEWS as readonly string[]).includes(v);
