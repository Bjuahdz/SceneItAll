import { View, Text, StyleSheet } from 'react-native';
import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

// Placeholder screen — the Saved experience will be rebuilt as part of the
// refactor (see REVIVAL_LOG.md, Section 3). The route must exist for the tab bar.
const Saved = () => {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.emptyState}>
        <Ionicons name="bookmark-outline" size={48} color="#9ccadf" />
        <Text style={styles.emptyStateText}>Saved</Text>
        <Text style={styles.emptyStateSubtext}>Coming soon</Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    marginTop: 12,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 4,
  },
});

export default Saved;
