// Line icons drawn with react-native-svg (24-unit grid, 1.75 stroke), the same set the web's
// components/Icon.tsx uses, so both products read alike. Decorative by default; pass a label to
// expose one to VoiceOver / TalkBack.
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../theme';

export type IconName =
  | 'lock' | 'clock' | 'shield' | 'user' | 'key' | 'plus' | 'search' | 'settings' | 'qr' | 'copy' | 'share'
  | 'chevronRight' | 'chevronLeft' | 'close' | 'eye' | 'flame' | 'check' | 'mail' | 'link' | 'ban' | 'apple' | 'google' | 'alert';

type Props = { name: IconName; size?: number; color?: string; label?: string };

export function Icon({ name, size = 20, color = colors.text, label }: Props) {
  const a11y = label ? { accessible: true, accessibilityLabel: label, accessibilityRole: 'image' as const } : { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no' as const };
  const p = { stroke: color, strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...a11y}>
      {name === 'lock' && (<><Rect x={5} y={11} width={14} height={10} rx={2.5} {...p} /><Path d="M8 11V7.5a4 4 0 0 1 8 0V11" {...p} /></>)}
      {name === 'clock' && (<><Circle cx={12} cy={12} r={9} {...p} /><Path d="M12 7v5l3 2" {...p} /></>)}
      {name === 'shield' && (<><Path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" {...p} /><Path d="M9 12l2 2 4-4" {...p} /></>)}
      {name === 'user' && (<><Circle cx={12} cy={8} r={4} {...p} /><Path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" {...p} /></>)}
      {name === 'key' && (<><Circle cx={8} cy={14} r={4} {...p} /><Path d="M11 11l9-9M16 6l3 3M14 8l2 2" {...p} /></>)}
      {name === 'plus' && <Path d="M12 5v14M5 12h14" {...p} />}
      {name === 'search' && (<><Circle cx={11} cy={11} r={6.5} {...p} /><Path d="M16 16l5 5" {...p} /></>)}
      {name === 'settings' && (<><Circle cx={12} cy={12} r={3} {...p} /><Path d="M12 2.5l1.7 2.3 2.8-.6 1 2.7 2.7 1-.6 2.8L21.5 12l-1.9 1.3.6 2.8-2.7 1-1 2.7-2.8-.6L12 21.5l-1.7-2.3-2.8.6-1-2.7-2.7-1 .6-2.8L2.5 12l1.9-1.3-.6-2.8 2.7-1 1-2.7 2.8.6z" {...p} /></>)}
      {name === 'qr' && (<><Rect x={3} y={3} width={7} height={7} rx={1.5} {...p} /><Rect x={14} y={3} width={7} height={7} rx={1.5} {...p} /><Rect x={3} y={14} width={7} height={7} rx={1.5} {...p} /><Path d="M14 14h3v3h-3zM20 14v1M17 20h4M20 18v3" {...p} /></>)}
      {name === 'copy' && (<><Rect x={9} y={9} width={11} height={11} rx={2} {...p} /><Path d="M5 15V6a2 2 0 0 1 2-2h9" {...p} /></>)}
      {name === 'share' && (<><Path d="M12 3v12M7 8l5-5 5 5" {...p} /><Path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" {...p} /></>)}
      {name === 'chevronRight' && <Path d="M9 6l6 6-6 6" {...p} />}
      {name === 'chevronLeft' && <Path d="M15 6l-6 6 6 6" {...p} />}
      {name === 'close' && <Path d="M6 6l12 12M18 6L6 18" {...p} />}
      {name === 'eye' && (<><Path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" {...p} /><Circle cx={12} cy={12} r={3} {...p} /></>)}
      {name === 'flame' && <Path d="M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.5.5-2.5 1.5-3.5.3 1 .8 1.6 1.5 2C11.5 8 11 5.5 12 3z" {...p} />}
      {name === 'check' && <Path d="M5 12.5l4.5 4.5L19 7.5" {...p} />}
      {name === 'mail' && (<><Rect x={3} y={5} width={18} height={14} rx={2.5} {...p} /><Path d="M3.5 7l8.5 6 8.5-6" {...p} /></>)}
      {name === 'link' && (<><Path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" {...p} /><Path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" {...p} /></>)}
      {name === 'ban' && (<><Circle cx={12} cy={12} r={9} {...p} /><Path d="M5.6 5.6l12.8 12.8" {...p} /></>)}
      {name === 'alert' && (<><Path d="M12 3l9.5 17h-19z" {...p} /><Path d="M12 9v5M12 17v.5" {...p} /></>)}
      {name === 'apple' && <Path d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.5 0-2.9.9-3.7 2.3-1.6 2.8-.4 6.9 1.2 9.1.8 1.1 1.7 2.3 2.9 2.3 1.2 0 1.6-.8 3-.8s1.8.8 3 .7c1.3 0 2.1-1.1 2.8-2.2.9-1.3 1.3-2.5 1.3-2.6-.1 0-2.6-1-2.6-3.6zM14.1 5.9c.6-.8 1.1-1.8 1-2.9-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.8 1 .1 2.1-.5 2.7-1.3z" fill={color} />}
      {name === 'google' && (<>
        <Path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4c-.2 1.2-.9 2.3-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z" fill="#4285F4" />
        <Path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6C4.8 19.8 8.1 22 12 22z" fill="#34A853" />
        <Path d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1C2.4 8.8 2 10.4 2 12s.4 3.2 1.1 4.6L6.4 14z" fill="#FBBC05" />
        <Path d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9C17 2.9 14.7 2 12 2 8.1 2 4.8 4.2 3.1 7.4L6.4 10c.8-2.3 3-4.1 5.6-4.1z" fill="#EA4335" />
      </>)}
    </Svg>
  );
}
