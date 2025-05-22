import React, { useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Animated } from 'react-native';
import DitherBackground from '@/components/homepage/DitherBackground';
import { FontAwesome } from '@expo/vector-icons';

const Saved = () => {
  const scrollY = useRef(new Animated.Value(0)).current;

  return (
    <View style={styles.container}>
      {/* Dithering Background */}
      <DitherBackground 
        color="#ffffff"
        opacity={0.25}
        patternSize={16}
        dotSize={2}
        scrollY={scrollY}
      />
      
      {/* Header */}
      <View style={styles.header}>
        <FontAwesome name="bookmark" size={24} color="#9ccadf" />
        <Text style={styles.headerTitle}>Saved Movies</Text>
      </View>

      {/* Content */}
      <Animated.ScrollView
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        <Text style={styles.emptyText}>
          Your saved movies will appear here
        </Text>
      </Animated.ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
    gap: 12,
    zIndex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  content: {
    flex: 1,
    zIndex: 1,
  },
  contentContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
  },
});

export default Saved;