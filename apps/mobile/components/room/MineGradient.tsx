// The own-bubble gradient (`--c-mine`, theme.mineGradient) drawn with react-native-svg so no extra
// native module is needed. Absolute-fill background; the bubble keeps its own radius via overflow.
import { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { mineGradient } from '../../theme';

export function MineGradient() {
  // One gradient id per instance: ids are global in the SVG namespace.
  const id = `mine${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {mineGradient.colors.map((c, i) => <Stop key={c} offset={mineGradient.locations[i]} stopColor={c} />)}
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}
