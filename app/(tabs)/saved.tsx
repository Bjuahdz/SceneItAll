import { View, Text, StyleSheet, ScrollView, Dimensions } from 'react-native';
import React from 'react';
import WaveBackground from '../components/WaveBackground';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const Saved = () => {
  const scrollY = useRef(new Animated.Value(0)).current;

  return (
    <SafeAreaView style={styles.container}>
      {/* Wave Background */}
      <WaveBackground
        backgroundColor="rgba(0, 0, 0, 0.85)"
      />

      {/* Content */}
      <ScrollView 
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Saved Movies</Text>
          <View style={styles.headerIcons}>
            <Ionicons name="search" size={24} color="#9ccadf" style={styles.icon} />
            <Ionicons name="options" size={24} color="#9ccadf" style={styles.icon} />
          </View>
        </View>

        {/* Placeholder for saved movies */}
        <View style={styles.emptyState}>
          <Ionicons name="bookmark" size={64} color="#9ccadf" />
          <Text style={styles.emptyStateText}>
            Your saved movies will appear here
          </Text>
          <Text style={styles.emptyStateSubtext}>
            Save movies to watch later or keep track of your favorites
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerIcons: {
    flexDirection: 'row',
    gap: 16,
  },
  icon: {
    opacity: 0.8,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
    textAlign: 'center',
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 8,
    textAlign: 'center',
    maxWidth: SCREEN_WIDTH * 0.7,
  },
});

export default Saved;