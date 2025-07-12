import React, { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Dimensions, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { login } from '../utils/auth';
import LottieView from 'lottie-react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CLAPPER_WIDTH = SCREEN_WIDTH * 0.85;
const CLAPPER_HEIGHT = CLAPPER_WIDTH * 0.8;

const actionMessages = {
  watch: 'Sign in to watch this movie',
  like: 'Sign in to like this movie',
  dislike: 'Sign in to dislike this movie',
  favorite: 'Sign in to add this movie to your favorites',
} as const;

type ActionType = keyof typeof actionMessages;

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { action } = useLocalSearchParams<{ action: ActionType }>();
  const [isAnimating, setIsAnimating] = useState(false);
  const animationRef = useRef<LottieView>(null);

  // Generate a random movie title based on email
  const getMovieTitle = (email: string) => {
    if (!email) return 'Your Movie Adventure';
    const words = email.split('@')[0].split(/[._-]/);
    return words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  // Generate a random scene number based on password
  const getSceneNumber = (password: string) => {
    if (!password) return 'SCENE 00';
    const hash = password.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return `SCENE ${(hash % 100).toString().padStart(2, '0')}`;
  };

  const handleSignIn = async () => {
    if (isAnimating) return;
    
    setIsAnimating(true);
    // Play the clapper animation
    animationRef.current?.play();

    // Wait for animation to complete (adjust timing based on your animation)
    setTimeout(async () => {
      const success = await login(email, password);
      if (success) {
        router.back();
      }
      setIsAnimating(false);
    }, 2000); // Adjust this timing based on your animation duration
  };

  return (
    <View style={styles.container}>
      {/* Movie Clapper Animation */}
      <View style={styles.clapperContainer}>
        <BlurView intensity={30} tint="dark" style={styles.clapper}>
          {/* Lottie Animation */}
          <View style={styles.animationContainer}>
            <LottieView
              ref={animationRef}
              source={require('../../assets/lottie/clapperboard.json')}
              style={styles.animation}
              autoPlay={false}
              loop={false}
              speed={1}
            />
          </View>

          {/* Movie Info Overlay */}
          <View style={styles.infoOverlay}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>MOVIE:</Text>
              <Text style={styles.infoValue} numberOfLines={1}>{getMovieTitle(email)}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>SCENE:</Text>
              <Text style={styles.infoValue}>{getSceneNumber(password)}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>DATE:</Text>
              <Text style={styles.infoValue}>{new Date().toLocaleDateString()}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>TIME:</Text>
              <Text style={styles.infoValue}>
                {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          </View>
        </BlurView>
      </View>

      {/* Login Form */}
      <View style={styles.formContainer}>
        <View style={styles.inputContainer}>
          <Ionicons name="mail-outline" size={20} color="#666" style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Enter your email"
            placeholderTextColor="#666"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
        </View>

        <View style={styles.inputContainer}>
          <Ionicons name="lock-closed-outline" size={20} color="#666" style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Enter your password"
            placeholderTextColor="#666"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
          />
        </View>

        <TouchableOpacity 
          style={[styles.loginButton, isAnimating && styles.loginButtonDisabled]}
          onPress={handleSignIn}
          disabled={isAnimating}
        >
          <Text style={styles.loginButtonText}>
            {isAnimating ? 'Action!' : 'Sign In'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 40 : 20,
  },
  clapperContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  clapper: {
    width: CLAPPER_WIDTH,
    height: CLAPPER_HEIGHT,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#9ccadf',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  animationContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  animation: {
    width: '100%',
    height: '100%',
  },
  infoOverlay: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    padding: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  infoLabel: {
    color: '#9ccadf',
    fontSize: 16,
    fontWeight: '600',
    width: '25%',
    letterSpacing: 1,
  },
  infoValue: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '500',
    flex: 1,
    marginLeft: 10,
  },
  formContainer: {
    gap: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 16,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    height: 50,
    color: '#fff',
    fontSize: 16,
  },
  loginButton: {
    backgroundColor: '#e50914',
    borderRadius: 12,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
}); 