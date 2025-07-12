import { Stack } from 'expo-router';
import { Platform, Dimensions } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Calculate border radius as a percentage of screen width
const TOP_RADIUS = SCREEN_WIDTH * 0.05; // 5% of screen width
const BOTTOM_RADIUS = SCREEN_WIDTH * 0.13; // 13% of screen width

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: 'rgba(0, 0, 0, 0.85)', // Semi-transparent dark background
          borderTopLeftRadius: TOP_RADIUS,
          borderTopRightRadius: TOP_RADIUS,
          borderBottomLeftRadius: BOTTOM_RADIUS,
          borderBottomRightRadius: BOTTOM_RADIUS,
          marginTop: Platform.OS === 'ios' ? 10 : 0,
          borderWidth: 1,
          borderColor: 'rgba(149, 149, 149, 0.96)',
          shadowColor: '#000',
          shadowOffset: {
            width: 0,
            height: -4,
          },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 5,
        },
        gestureEnabled: true,
        gestureDirection: 'vertical',
        animationDuration: 200,
      }}
    />
  );
} 