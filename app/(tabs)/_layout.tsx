// Import necessary components from expo-router and react-native
import { Tabs } from "expo-router";
import { 
  ImageBackground, 
  Image, 
  Text, 
  View, 
  TouchableOpacity, 
  Animated, 
  Dimensions
} from "react-native";
import React, { useState, useRef, useEffect } from "react";

// Import icon and image assets from the app's constants
import { icons } from "@/constants/icons";
import { images } from "@/constants/images";

/**
 * TabIcon Component - Renders the tab icon with different styles based on focus state
 * @param focused - Boolean indicating if the tab is currently active
 * @param icon - Icon asset to display
 * @param title - Text label for the tab
 */
function TabIcon({ focused, icon, title }: any) {
  // When tab is focused, display a background image with the icon and title
  if (focused) {
    return (
      <ImageBackground
        source={images.highlight}
        className="flex flex-row w-full flex-1 min-w-[112px] min-h-16 mt-2 justify-center items-center rounded-full overflow-hidden"
      >
        <Image source={icon} tintColor="#151312" className="size-5" />
        <Text className="text-secondary text-base font-semibold ml-2">
          {title}
        </Text>
      </ImageBackground>
    );
  }

  // When tab is not focused, show only the icon with minimal styling
  return (
    <View className="size-full justify-center items-center mt-2 rounded-full">
      <Image source={icon} tintColor="#A8B5DB" className="size-5" />
    </View>
  );
}

/**
 * Animated TabBar Layout - Creates a pull-out navigation bar that appears on tap
 */
export default function TabsLayout() {
  // State to track if the tab bar is visible
  const [isTabBarVisible, setIsTabBarVisible] = useState(false);
  
  // Animation value for the tab bar slide-in/out
  const slideAnimation = useRef(new Animated.Value(-350)).current;
  
  // Screen dimensions
  const { width } = Dimensions.get('window');
  
  // Toggle the tab bar visibility with animation
  const toggleTabBar = () => {
    setIsTabBarVisible(!isTabBarVisible);
    
    // Animate the tab bar sliding in or out
    Animated.spring(slideAnimation, {
      toValue: isTabBarVisible ? -350 : 0,
      friction: 8,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };
  
  // Hide tab bar when component mounts
  useEffect(() => {
    slideAnimation.setValue(-350);
  }, []);

  return (
    <>
      {/* Ultra-subtle pull-tab for the navigation */}
      <TouchableOpacity
        onPress={toggleTabBar}
        style={{
          position: 'absolute',
          bottom: 130,
          right: 0,
          zIndex: 999,
          backgroundColor: "rgba(26, 25, 23, 0.8)",
          borderTopLeftRadius: 20,
          borderBottomLeftRadius: 20,
          width: 13,
          height: 90,
          borderWidth: 1,
          borderColor: 'rgba(255, 255, 255, 0.05)',
          borderRightWidth: 0,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <View 
          style={{
            width: 3,
            height: 20,
            backgroundColor: 'rgba(168, 181, 219, 0.5)',
            borderRadius: 3,
          }}
        />
      </TouchableOpacity>

      {/* Animated Tab Bar */}
      <Tabs
        screenOptions={{
          tabBarShowLabel: false,
          
          // Style for individual tab items within the bar
          tabBarItemStyle: {
            width: "auto",
            height: "auto",
            justifyContent: "center",
            alignItems: "center",
            paddingHorizontal: 12,
          },
          
          // Style for the entire tab bar container (initially hidden)
          tabBarStyle: {
            backgroundColor: "#1A1917",
            borderRadius: 30,
            marginHorizontal: 50,
            marginBottom: 40,
            height: 50,
            position: "absolute",
            overflow: "hidden",
            borderWidth: 1,
            borderColor: "#1A1917",
            width: "auto",
            alignSelf: "center",
            paddingHorizontal: 1,
            transform: [{ translateX: slideAnimation }],
            // Hide the default tab bar since we're using our own animation
            display: "flex",
          },
        }}
      >
        {/* Home Tab */}
        <Tabs.Screen
          name="index"
          options={{
            title: "index",
            headerShown: false,
            tabBarIcon: ({ focused }) => (
              <TabIcon focused={focused} icon={icons.home} title="Home" />
            ),
          }}
        />

        {/* Search Tab */}
        <Tabs.Screen
          name="search"
          options={{
            title: "Search",
            headerShown: false,
            tabBarIcon: ({ focused }) => (
              <TabIcon focused={focused} icon={icons.search} title="Search" />
            ),
          }}
        />

        {/* Saved Tab */}
        <Tabs.Screen
          name="saved"
          options={{
            title: "Saved",
            headerShown: false,
            tabBarIcon: ({ focused }) => (
              <TabIcon focused={focused} icon={icons.save} title="Saved" />
            ),
          }}
        />

        {/* Profile Tab */}
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            headerShown: false,
            tabBarIcon: ({ focused }) => (
              <TabIcon focused={focused} icon={icons.person} title="Profile" />
            ),
          }}
        />
      </Tabs>
    </>
  );
}