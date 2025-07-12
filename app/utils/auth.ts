import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Dummy credentials
const DUMMY_CREDENTIALS = {
  email: 'test@example.com',
  password: 'password123'
};

// This function will be called when a user tries to perform an action that requires authentication
export const showAuthModal = (action: 'watch' | 'like' | 'dislike' | 'favorite') => {
  // You can add logic here to check if the user is already authenticated
  // For now, we'll just show the login modal
  router.push({
    pathname: '/login',
    params: { action } // Pass the action as a parameter so we can show appropriate messaging
  });
};

// Helper function to check if user is authenticated
export const isAuthenticated = async () => {
  try {
    const token = await AsyncStorage.getItem('userToken');
    return !!token;
  } catch (error) {
    return false;
  }
};

// Dummy login function
export const login = async (email: string, password: string) => {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 1000));

  if (email === DUMMY_CREDENTIALS.email && password === DUMMY_CREDENTIALS.password) {
    // Store a dummy token
    await AsyncStorage.setItem('userToken', 'dummy-token-123');
    return true;
  }
  throw new Error('Invalid credentials');
};

// Logout function
export const logout = async () => {
  await AsyncStorage.removeItem('userToken');
}; 