import { BottomTabBar } from 'expo-router/js-tabs';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassSurface } from './GlassSurface';
import { useTheme } from '../hooks/useTheme';

type TabBarProps = React.ComponentProps<typeof BottomTabBar>;

const BAR_HEIGHT = 64;
const SIDE_MARGIN = 14;

/**
 * Floating pill tab bar: glass capsule, icon with a label under it and a
 * darker (dark theme) / lighter (light theme) capsule behind the active tab.
 */
function FloatingTabBarBase({ state, descriptors, navigation }: TabBarProps) {
  const { colors, theme, primaryColor } = useTheme();
  const insets = useSafeAreaInsets();
  const dark = theme === 'dark';

  const activeColor = primaryColor ?? colors.textPrimary;
  const inactiveColor = dark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.72)';
  const barBase = dark ? 'rgba(28,28,31,0.62)' : 'rgba(255,255,255,0.5)';
  const activePill = dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.07)';

  return (
    <View
      pointerEvents="box-none"
      style={[styles.outer, { paddingBottom: Math.max(insets.bottom - 8, 12) }]}
    >
      <View style={[styles.bar, { backgroundColor: barBase }]}>
        <GlassSurface radius={BAR_HEIGHT / 2} strength={dark ? 0.7 : 0.9} style={StyleSheet.absoluteFill} />
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const label = options.title ?? route.name;
          const color = focused ? activeColor : inactiveColor;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };
          const onLongPress = () => {
            navigation.emit({ type: 'tabLongPress', target: route.key });
          };

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={label}
              onPress={onPress}
              onLongPress={onLongPress}
              style={styles.item}
            >
              {focused && <View style={[styles.activePill, { backgroundColor: activePill }]} />}
              {options.tabBarIcon?.({ focused, color, size: 26 })}
              <Text style={[styles.label, { color }]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const FloatingTabBar = memo(FloatingTabBarBase);

const styles = StyleSheet.create({
  outer: {
    paddingHorizontal: SIDE_MARGIN,
  },
  bar: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    flexDirection: 'row',
    alignItems: 'stretch',
    padding: 5,
    overflow: 'hidden',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  activePill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: (BAR_HEIGHT - 10) / 2,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
});
