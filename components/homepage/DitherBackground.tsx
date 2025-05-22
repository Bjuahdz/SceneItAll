import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface DitherBackgroundProps {
  color?: string;
  opacity?: number;
  patternSize?: number;
  dotSize?: number;
  scrollY?: Animated.Value;
}

interface Dot {
  x: number;
  y: number;
  opacity: number;
  scale: number;
  phase: number;
  fadeInDelay: number;
}

const DitherBackground: React.FC<DitherBackgroundProps> = ({
  color = '#ffffff',
  opacity = 0.25,
  patternSize = 16,
  dotSize = 2,
  scrollY = new Animated.Value(0),
}) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Generate dots only once and memoize them
  const dots = useMemo(() => {
    const pattern: Dot[] = [];
    const gridSize = Math.ceil(SCREEN_WIDTH / patternSize);
    const rows = Math.ceil(SCREEN_HEIGHT / patternSize);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < gridSize; x++) {
        const value = Math.sin(x * 0.1 + y * 0.1) * Math.cos(x * 0.2 - y * 0.2);

        if (value > 0.2) {
          pattern.push({
            x: x * patternSize,
            y: y * patternSize,
            opacity: 0.4 + Math.abs(value) * 0.6,
            scale: 0.9 + Math.abs(value) * 0.5,
            phase: Math.random() * Math.PI * 2,
            fadeInDelay: Math.random() * 2000,
          });
        }
      }
    }
    return pattern;
  }, []);

  // Start fade-in animation
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 3000,
      useNativeDriver: true,
    }).start();
  }, []);

  const renderDots = () => {
    return dots.map((dot, index) => {
      // Create scroll-based movement
      const translateX = scrollY.interpolate({
        inputRange: [-SCREEN_HEIGHT, 0, SCREEN_HEIGHT],
        outputRange: [
          Math.sin(dot.phase) * patternSize * 3,
          Math.sin(dot.phase) * patternSize * 1.5,
          Math.sin(dot.phase + Math.PI) * patternSize * 3,
        ],
        extrapolate: 'clamp',
      });

      const translateY = scrollY.interpolate({
        inputRange: [-SCREEN_HEIGHT, 0, SCREEN_HEIGHT],
        outputRange: [
          Math.cos(dot.phase) * patternSize * 2,
          Math.cos(dot.phase) * patternSize,
          Math.cos(dot.phase + Math.PI) * patternSize * 2,
        ],
        extrapolate: 'clamp',
      });

      // Add scroll-based scale animation
      const scale = scrollY.interpolate({
        inputRange: [-SCREEN_HEIGHT, 0, SCREEN_HEIGHT],
        outputRange: [1.3, 1, 1.3],
        extrapolate: 'clamp',
      });

      // Create scroll-based opacity animation
      const scrollOpacity = scrollY.interpolate({
        inputRange: [-SCREEN_HEIGHT, 0, SCREEN_HEIGHT],
        outputRange: [0.8, 1, 0.8],
        extrapolate: 'clamp',
      });

      return (
        <Animated.View
          key={`dot-${index}`}
          style={[
            styles.dot,
            {
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              backgroundColor: color,
              opacity: Animated.multiply(
                Animated.multiply(dot.opacity * opacity, fadeAnim),
                scrollOpacity
              ),
              position: 'absolute',
              left: dot.x,
              top: dot.y,
              transform: [
                { scale },
                { translateX },
                { translateY },
              ],
            },
          ]}
        />
      );
    });
  };

  return (
    <View style={styles.container}>
      {renderDots()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  dot: {
    position: 'absolute',
  },
});

export default React.memo(DitherBackground); 