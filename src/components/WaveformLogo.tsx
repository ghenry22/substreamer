import { StyleSheet, View, type ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { LOGO_ASPECT, LOGO_PATHS, LOGO_VIEWBOX } from '../constants/logo';

/** The app's brand logo (XW mark), drawn as vector paths. */
type Props = {
  /** Overall size (dp) – the logo is this wide, centred in a square box. */
  size?: number;
  /** Logo colour. Accepts any RN `ColorValue` so the tab-icon callback's
   *  `OpaqueColorValue` (SDK 56 / RN 0.85 typing tightening) flows in. */
  color?: ColorValue;
};

export default function WaveformLogo({ size = 130, color = '#FFFFFF' }: Props) {
  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size / LOGO_ASPECT} viewBox={LOGO_VIEWBOX}>
        {LOGO_PATHS.map((d, i) => (
          <Path key={i} d={d} fill={color} />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
