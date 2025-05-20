import React from 'react';
import { View, StyleSheet, TouchableOpacity, Animated, Dimensions } from 'react-native';

interface PaginationProps {
  currentIndex: number;
  totalItems: number;
  onPageChange: (index: number) => void;
  scrollX?: Animated.Value;
  primaryColor?: string;
  accentColor?: string;
  dotsStyle?: 'round' | 'line';
  containerStyle?: object;
  itemWidth?: number;
  itemSpacing?: number;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const Pagination = ({
  currentIndex,
  totalItems,
  onPageChange,
  scrollX = new Animated.Value(0),
  primaryColor = '#9ccadf',
  accentColor,
  dotsStyle = 'round',
  containerStyle = {},
  itemWidth = SCREEN_WIDTH,
  itemSpacing = 0
}: PaginationProps) => {
  const dotColor = accentColor || primaryColor;
  const isLineStyle = dotsStyle === 'line';
  
  // No need to render pagination for single item
  if (totalItems <= 1) return null;
  
  // The total width of each item including spacing
  const totalItemWidth = itemWidth + itemSpacing;
  
  // Simple function to navigate to a page
  const handleDotPress = (index: number) => {
    if (index >= 0 && index < totalItems) {
      onPageChange(index);
    }
  };

  return (
    <View style={[styles.container, containerStyle]}>
      <View style={styles.dotsContainer}>
        {Array.from({ length: totalItems }).map((_, index) => {
          // Create a simple animated dot
          if (scrollX) {
            // Basic input range for the current position
            const inputRange = [
              (index - 1) * totalItemWidth,
              index * totalItemWidth,
              (index + 1) * totalItemWidth
            ];
            
            // Simple scale animation
            const scale = scrollX.interpolate({
              inputRange,
              outputRange: isLineStyle ? [1, 1.7, 1] : [1, 1.3, 1],
              extrapolate: 'clamp',
            });
            
            // Simple opacity animation
            const opacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.4, 1, 0.4],
              extrapolate: 'clamp',
            });
            
            return (
              <TouchableOpacity 
                key={`dot-${index}`}
                activeOpacity={0.7}
                onPress={() => handleDotPress(index)}
                style={styles.dotTouchable}
              >
                <Animated.View 
                  style={[
                    styles.dot, 
                    isLineStyle && styles.lineDot,
                    { 
                      transform: isLineStyle
                        ? [{ scaleX: scale }] 
                        : [{ scale }],
                      opacity,
                      backgroundColor: index === currentIndex 
                        ? dotColor 
                        : 'rgba(255, 255, 255, 0.3)'
                    }
                  ]}
                />
              </TouchableOpacity>
            );
          } else {
            // Simple static dot
            return (
              <TouchableOpacity 
                key={`dot-${index}`}
                activeOpacity={0.7}
                onPress={() => handleDotPress(index)}
                style={styles.dotTouchable}
              >
                <View 
                  style={[
                    styles.dot, 
                    isLineStyle && styles.lineDot,
                    { 
                      backgroundColor: index === currentIndex 
                        ? dotColor 
                        : 'rgba(255, 255, 255, 0.3)'
                    }
                  ]} 
                />
              </TouchableOpacity>
            );
          }
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    height: 20,
  },
  dotTouchable: {
    padding: 6,
    marginHorizontal: 3,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#9ccadf',
  },
  lineDot: {
    width: 12, // More modest width
    height: 3.5, // Slightly taller than original
    borderRadius: 1.75, // Rounded edges
  }
});

export default React.memo(Pagination);
