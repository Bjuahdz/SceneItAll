import React, { useState, useEffect } from 'react';
import { View, TouchableOpacity, Text, Dimensions, Modal, Animated, StatusBar } from 'react-native';
import YoutubePlayer from 'react-native-youtube-iframe';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

interface TrailerPlayerProps {
  videoId: string | null;
  onClose: () => void;
  rating: string;
}

const TrailerPlayer: React.FC<TrailerPlayerProps> = ({
  videoId,
  onClose,
  rating,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const fadeAnim = useState(new Animated.Value(0))[0];
  const slideAnim = useState(new Animated.Value(Dimensions.get('window').height))[0];
  
  // Get screen dimensions
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  
  // Adjust these values to change the size
  const SCREEN_RATIO = 0.45; // Decrease this value to make it smaller (e.g., 0.65 for 65% of screen)
  const ASPECT_RATIO = 16/9;
  
  // Calculate video dimensions
  const containerHeight = screenHeight * SCREEN_RATIO;
  const containerWidth = containerHeight * ASPECT_RATIO;

  // Calculate center position
  const centerX = (screenWidth - containerHeight) / 2;
  const centerY = (screenHeight - containerWidth) / 2;

  useEffect(() => {
    if (videoId) {
      setIsPlaying(false);
      fadeAnim.setValue(0);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11
      }).start();
    }
  }, [videoId]);

  useEffect(() => {
    let showTimeout: NodeJS.Timeout;
    let hideTimeout: NodeJS.Timeout;

    if (isPlaying) {
      showTimeout = setTimeout(() => {
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }).start();

        hideTimeout = setTimeout(() => {
          Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 800,
            useNativeDriver: true,
          }).start();
        }, 5000);
      }, 4500);
    }

    return () => {
      clearTimeout(showTimeout);
      clearTimeout(hideTimeout);
    };
  }, [isPlaying]);

  // Add effect to handle status bar
  useEffect(() => {
    if (videoId) {
      StatusBar.setHidden(true, 'fade');
    }
    return () => {
      StatusBar.setHidden(false, 'fade');
    };
  }, [videoId]);

  const handleClose = () => {
    Animated.spring(slideAnim, {
      toValue: screenHeight,
      useNativeDriver: true,
      tension: 65,
      friction: 11
    }).start(() => {
      onClose();
    });
  };

  return (
    <>
      <StatusBar hidden />
      <Modal
        animationType="none"
        transparent={true}
        visible={videoId !== null}
        onRequestClose={handleClose}
        statusBarTranslucent={true}
        presentationStyle="overFullScreen"
      >
        <Animated.View style={{
          flex: 1,
          transform: [{ translateY: slideAnim }],
        }}>
          <BlurView
            intensity={15}
            tint="dark"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.65)',
            }}
          />
          <View style={{
            flex: 1,
            position: 'relative',
          }}>
            {videoId && (
              <View style={{
                position: 'absolute',
                left: centerX,
                top: centerY,
                width: containerWidth,
                height: containerHeight,
                backgroundColor: 'rgba(0,0,0,0.4)',
                borderRadius: 12,
                overflow: 'hidden',
                transform: [
                  { rotate: '90deg' },
                  { translateX: (containerWidth - containerHeight) / 2 },
                  { translateY: (containerWidth - containerHeight) / 2 },
                ],
                shadowColor: '#000',
                shadowOffset: {
                  width: 0,
                  height: 2,
                },
                shadowOpacity: 0.5,
                shadowRadius: 8,
                elevation: 5,
              }}>
                <YoutubePlayer
                  height={containerHeight}
                  width={containerWidth}
                  videoId={videoId}
                  play={true}
                  onChangeState={(event) => {
                    if (event === 'ended') {
                      handleClose();
                      setIsPlaying(false);
                    } else if (event === 'playing') {
                      setIsPlaying(true);
                    }
                  }}
                  webViewProps={{
                    androidLayerType: 'hardware',
                    scrollEnabled: false,
                  }}
                  initialPlayerParams={{
                    preventFullScreen: true,
                    controls: true,
                    modestbranding: true,
                    rel: false,
                    showinfo: false,
                    playsinline: 1,
                  }}
                />

                {/* Rating Overlay */}
                <Animated.View
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    opacity: fadeAnim,
                    zIndex: 1,
                  }}
                >
                  <LinearGradient
                    colors={['rgba(0,0,0,0.95)', 'rgba(0,0,0,0.7)', 'transparent']}
                    style={{
                      paddingTop: 24,
                      paddingBottom: 45,
                      paddingHorizontal: 24,
                    }}
                  >
                    <View style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                    }}>
                      <View style={{
                        backgroundColor: rating === 'R' ? 'rgba(178, 34, 34, 0.2)' : 'rgba(0,0,0,0.6)', // Red tint for R rating
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: rating === 'R' ? 'rgba(252, 0, 0, 0.3)' : 'rgba(255,255,255,0.15)',
                      }}>
                        <Text style={{
                          color: 'white',
                          fontSize: 16,
                          fontWeight: '600',
                        }}>
                          {rating}
                        </Text>
                      </View>
                      {rating === 'R' && (
                        <Text style={{
                          color: 'rgba(255,255,255,0.9)',
                          fontSize: 14,
                          fontWeight: '500',
                        }}>
                          Viewer Discretion Be Advised
                        </Text>
                      )}
                    </View>
                  </LinearGradient>
                </Animated.View>
              </View>
            )}
            
            <TouchableOpacity
              onPress={handleClose}
              style={{
                position: 'absolute',
                bottom: 20,
                right: 20,
                width: 62,
                height: 42,
                backgroundColor: 'rgba(0,0,0,0.4)',
                borderRadius: 16,
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 2,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.15)',
                shadowColor: '#fff',
                shadowOffset: {
                  width: 0,
                  height: 0,
                },
                shadowOpacity: 0.1,
                shadowRadius: 8,
                elevation: 5,
              }}
            >
              <Text style={{
                color: 'white',
                fontSize: 25,
                fontWeight: '600',
              }}>
                ✕
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Modal>
    </>
  );
};

export default TrailerPlayer; 