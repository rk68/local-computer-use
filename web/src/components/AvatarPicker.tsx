import { avatarColours, avatarStyles, type AvatarAppearance, type AvatarColour, type AvatarStyle } from '../../shared/avatar';
import { HoloAvatar } from '../agent/HoloAvatar';
import { Icon } from './Icon';

export function AvatarPicker({ value, onChange, name, disabled }: { value: AvatarAppearance; onChange: (value: AvatarAppearance) => void; name: string; disabled: boolean }) {
  return <div className="avatar-picker">
    <div className="avatar-preview"><HoloAvatar appearance={value} /><div><strong>{name.trim() || 'Your Halo'}</strong><span>{avatarColours[value.colour].name} · {avatarStyles[value.style]}</span></div></div>
    <fieldset disabled={disabled}><legend>Colour</legend><div className="avatar-colours">
      {(Object.keys(avatarColours) as AvatarColour[]).map(colour => <label key={colour} className="avatar-colour-option" title={avatarColours[colour].name} data-selected={value.colour === colour}>
        <input className="sr-only" type="radio" name="avatar-colour" value={colour} checked={value.colour === colour} onChange={() => onChange({ ...value, colour })} />
        <span className="avatar-swatch" style={{ backgroundColor: avatarColours[colour].body }}>{value.colour === colour ? <Icon name="check" /> : null}</span><span className="sr-only">{avatarColours[colour].name}</span>
      </label>)}
    </div></fieldset>
    <fieldset disabled={disabled}><legend>Style</legend><div className="avatar-styles">
      {(Object.keys(avatarStyles) as AvatarStyle[]).map(style => <label key={style} className="avatar-style-option" data-selected={value.style === style}>
        <input className="sr-only" type="radio" name="avatar-style" value={style} checked={value.style === style} onChange={() => onChange({ ...value, style })} />
        <HoloAvatar appearance={{ ...value, style }} small /><span>{avatarStyles[style]}</span>
      </label>)}
    </div></fieldset>
  </div>;
}
