import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle, ImageStyle } from 'react-native';
import { Image } from 'expo-image';

const initialsOf = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

/**
 * Avatar — a person's headshot, or their initials on a tinted surface when no
 * photo exists. Size and shape come from the passed `style` (a circle for the
 * crew strip, a portrait for the cast grid), so one component serves both and a
 * missing photo never leaves a broken image or an empty hole.
 */
const Avatar = ({
  imageUrl,
  name,
  style,
  initialsSize = 18,
}: {
  imageUrl: string | null;
  name: string;
  style?: StyleProp<ViewStyle>;
  initialsSize?: number;
}) => {
  if (imageUrl) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={[styles.base, style] as StyleProp<ImageStyle>}
        contentFit="cover"
        transition={150}
        cachePolicy="memory-disk"
      />
    );
  }
  return (
    <View style={[styles.base, styles.fallback, style]}>
      <Text style={[styles.initials, { fontSize: initialsSize }]}>{initialsOf(name)}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    backgroundColor: 'rgba(156,202,223, 0.08)',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(156,202,223, 0.18)',
  },
  initials: {
    color: 'rgba(156,202,223, 0.85)',
    fontWeight: '500',
  },
});

export default Avatar;
