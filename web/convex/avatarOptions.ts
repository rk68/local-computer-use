import { v } from 'convex/values';
import { avatarColours, avatarStyles } from '../shared/avatar';
export const avatarAppearance = v.object({
  colour: v.union(...Object.keys(avatarColours).map(colour => v.literal(colour as keyof typeof avatarColours))),
  style: v.union(...Object.keys(avatarStyles).map(style => v.literal(style as keyof typeof avatarStyles))),
});
