import React, { useEffect } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';

const DOT = 7; // inactive dot diameter
const ACTIVE_WIDTH = 22; // active pill width
const INACTIVE = 'rgba(255, 255, 255, 0.28)';

interface PaginationProps {
  currentIndex: number;
  totalItems: number;
  onPageChange?: (index: number) => void;
  /** Active pill colour. */
  color?: string;
}

/**
 * One dot. A single 0→1 `progress` shared value is set on the JS thread when `active`
 * flips, then width + colour + glow interpolate from it on the UI thread — so the
 * indicator animates only on index change, never per scroll frame. Index-driven on
 * purpose: scroll-value interpolation freezes at mount on the new architecture
 * (Fabric), which is what left every dot grey.
 */
const Dot = ({
  index,
  active,
  color,
  onPress,
}: {
  index: number;
  active: boolean;
  color: string;
  onPress?: (index: number) => void;
}) => {
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, { duration: 240 });
  }, [active, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: DOT + (ACTIVE_WIDTH - DOT) * progress.value,
    backgroundColor: interpolateColor(progress.value, [0, 1], [INACTIVE, color]),
    shadowOpacity: 0.85 * progress.value,
  }));

  return (
    <Pressable onPress={() => onPress?.(index)} hitSlop={10} style={styles.hit}>
      <Animated.View style={[styles.dot, { shadowColor: color }, animatedStyle]} />
    </Pressable>
  );
};

const Pagination = ({ currentIndex, totalItems, onPageChange, color = '#9ccadf' }: PaginationProps) => {
  if (totalItems <= 1) return null;

  return (
    <View style={styles.container}>
      {Array.from({ length: totalItems }).map((_, i) => (
        <Dot key={i} index={i} active={i === currentIndex} color={color} onPress={onPageChange} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  hit: {
    paddingHorizontal: 3,
  },
  dot: {
    height: DOT,
    borderRadius: DOT / 2,
    // Glow (iOS): shadowOpacity is animated 0 → on; inactive dots have no glow.
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 4,
  },
});

export default React.memo(Pagination);
