export const avatarColours = {
  pearl: { name: 'Pearl', light: '#ffffff', body: '#e6e4ed', shade: '#8c899d', shadow: '#575364' },
  lilac: { name: 'Lilac', light: '#faf2ff', body: '#c8a6f5', shade: '#8b63bb', shadow: '#503568' },
  mint: { name: 'Mint', light: '#edfff6', body: '#9cdec0', shade: '#579e82', shadow: '#315d4e' },
  sky: { name: 'Sky', light: '#f0faff', body: '#9dcff3', shade: '#5b91bb', shadow: '#365671' },
  peach: { name: 'Peach', light: '#fff8ed', body: '#f4c095', shade: '#c0855d', shadow: '#795338' },
  rose: { name: 'Rose', light: '#fff1f5', body: '#efabc4', shade: '#b16b89', shadow: '#714358' },
} as const;
export const avatarStyles = { pebble: 'Pebble', orb: 'Orb', pixel: 'Pixel' } as const;
export type AvatarColour = keyof typeof avatarColours;
export type AvatarStyle = keyof typeof avatarStyles;
export type AvatarAppearance = { colour: AvatarColour; style: AvatarStyle };
export const defaultAvatar: AvatarAppearance = { colour: 'pearl', style: 'pebble' };
