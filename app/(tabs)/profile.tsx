import { View, Text, ScrollView, Image, StyleSheet, TouchableOpacity, Dimensions } from 'react-native'
import React, { useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { UserProfile } from '../../interfaces/UserProfile'
import { MaterialIcons, FontAwesome5, Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { BlurView } from 'expo-blur'

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HEADER_HEIGHT = 240;

// Placeholder profile data - will be replaced with real data later
const mockProfile: UserProfile = {
  id: '1',
  username: 'MovieBuff',
  avatarUrl: 'https://placeholder.com/150',
  backdropUrl: 'https://placeholder.com/500',
  favoriteMovies: [],
  movieRankings: [],
  pinnedQuotes: [],
  friends: [],
  viewerTypes: ['Horror Fiend', 'Drama Enthusiast'],
  watchedGenres: { 'Horror': 28, 'Drama': 15, 'Action': 12 },
  totalMoviesWatched: 47
}

const Profile = () => {
  const [profile, setProfile] = useState<UserProfile>(mockProfile)
  
  // Convert genre watch counts to percentage for the chart
  const genrePercentages = React.useMemo(() => {
    const total = Object.values(profile.watchedGenres).reduce((acc, curr) => acc + curr, 0);
    return Object.entries(profile.watchedGenres).map(([genre, count]) => ({
      genre,
      percentage: (count / total) * 100
    })).sort((a, b) => b.percentage - a.percentage);
  }, [profile.watchedGenres]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Cinematic Profile Header */}
        <View style={styles.headerContainer}>
          <Image
            source={{ uri: profile.backdropUrl }}
            style={styles.backdrop}
          />
          <LinearGradient
            colors={['rgba(0,0,0,0.2)', 'rgba(0,0,0,0.8)']}
            style={StyleSheet.absoluteFill}
          />
          
          {/* Profile Info */}
          <View style={styles.profileInfo}>
            <TouchableOpacity style={styles.avatarContainer}>
              <Image
                source={{ uri: profile.avatarUrl }}
                style={styles.avatar}
              />
              <View style={styles.editIconContainer}>
                <Ionicons name="camera" size={14} color="white" />
              </View>
            </TouchableOpacity>
            
            <Text style={styles.username}>{profile.username}</Text>
            
            <View style={styles.viewerTypes}>
              {profile.viewerTypes.map((type, index) => (
                <View key={index} style={styles.viewerType}>
                  <Text style={styles.viewerTypeText}>{type}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity style={styles.editProfileButton}>
              <Text style={styles.editProfileText}>Edit Profile</Text>
            </TouchableOpacity>
          </View>
          
          {/* Change Backdrop Button */}
          <TouchableOpacity 
            style={styles.backdropButton}
            activeOpacity={0.7}
          >
            <Ionicons name="image" size={18} color="white" />
          </TouchableOpacity>
        </View>

        {/* Stats Section */}
        <View style={styles.statsSection}>
          <Text style={styles.sectionTitle}>Quick Statistics</Text>
          
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <View style={styles.statIconContainer}>
                <Ionicons name="film" size={20} color="#9ccadf" />
              </View>
              <Text style={styles.statValue}>{profile.totalMoviesWatched}</Text>
              <Text style={styles.statLabel}>Movies Watched</Text>
            </View>
            
            <View style={styles.statItem}>
              <View style={styles.statIconContainer}>
                <Ionicons name="trophy" size={20} color="#9ccadf" />
              </View>
              <Text style={styles.statValue}>{profile.movieRankings.length}</Text>
              <Text style={styles.statLabel}>Movies Ranked</Text>
            </View>
            
            <View style={styles.statItem}>
              <View style={styles.statIconContainer}>
                <Ionicons name="people" size={20} color="#9ccadf" />
              </View>
              <Text style={styles.statValue}>{profile.friends.length}</Text>
              <Text style={styles.statLabel}>Friends</Text>
            </View>
          </View>
        </View>
        
        {/* Genre Chart Section */}
        <View style={styles.genreSection}>
          <Text style={styles.sectionTitle}>What You Watch</Text>
          
          <View style={styles.genreChartContainer}>
            {genrePercentages.map((item, index) => (
              <View key={index} style={styles.genreBar}>
                <Text style={styles.genreLabel}>{item.genre}</Text>
                <View style={styles.barContainer}>
                  <View style={[styles.barFill, { width: `${item.percentage}%` }]} />
                </View>
                <Text style={styles.percentageText}>{Math.round(item.percentage)}%</Text>
              </View>
            ))}
          </View>
          
          <TouchableOpacity style={styles.analyzeButton}>
            <Text style={styles.analyzeText}>View Complete Analysis</Text>
            <Ionicons name="analytics" size={18} color="#9ccadf" />
          </TouchableOpacity>
        </View>
        
        {/* Rankings & Features Section */}
        <View style={styles.actionsSection}>
          <Text style={styles.sectionTitle}>Your Movie Experience</Text>
          
          <TouchableOpacity style={styles.actionButton}>
            <View style={styles.actionIconContainer}>
              <Ionicons name="trophy" size={24} color="#9ccadf" />
            </View>
            <View style={styles.actionTextContainer}>
              <Text style={styles.actionTitle}>Movie Rankings</Text>
              <Text style={styles.actionSubtitle}>Rank your movies from D to S tier</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color="#9ccadf" />
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.actionButton}>
            <View style={styles.actionIconContainer}>
              <Ionicons name="people" size={24} color="#9ccadf" />
            </View>
            <View style={styles.actionTextContainer}>
              <Text style={styles.actionTitle}>Connect with Friends</Text>
              <Text style={styles.actionSubtitle}>Find movie enthusiasts like you</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color="#9ccadf" />
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.actionButton}>
            <View style={styles.actionIconContainer}>
              <Ionicons name="settings-sharp" size={24} color="#9ccadf" />
            </View>
            <View style={styles.actionTextContainer}>
              <Text style={styles.actionTitle}>Account Settings</Text>
              <Text style={styles.actionSubtitle}>Manage profile & preferences</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color="#9ccadf" />
          </TouchableOpacity>
    </View>

        {/* Footer Space */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  headerContainer: {
    height: HEADER_HEIGHT,
    width: SCREEN_WIDTH,
    position: 'relative',
  },
  backdrop: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  backdropButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  profileInfo: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    borderColor: '#000000',
  },
  editIconContainer: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    backgroundColor: '#9ccadf',
    padding: 6,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#000000',
  },
  username: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginTop: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2
  },
  viewerTypes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 6,
  },
  viewerType: {
    backgroundColor: 'rgba(156, 202, 223, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#9ccadf',
  },
  viewerTypeText: {
    color: '#9ccadf',
    fontSize: 12,
    fontWeight: '600',
  },
  editProfileButton: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  editProfileText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  statsSection: {
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 4,
  },
  statIconContainer: {
    backgroundColor: 'rgba(156, 202, 223, 0.1)',
    padding: 8,
    borderRadius: 20,
    marginBottom: 8,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  statLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
  },
  genreSection: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  genreChartContainer: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
  },
  genreBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  genreLabel: {
    color: 'white',
    width: 60,
    fontSize: 12,
  },
  barContainer: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 4,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#9ccadf',
    borderRadius: 4,
  },
  percentageText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    width: 35,
    textAlign: 'right',
  },
  analyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    alignSelf: 'center',
  },
  analyzeText: {
    color: '#9ccadf',
    fontSize: 14,
    fontWeight: '600',
  },
  actionsSection: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  actionIconContainer: {
    backgroundColor: 'rgba(156, 202, 223, 0.1)',
    padding: 10,
    borderRadius: 12,
    marginRight: 16,
  },
  actionTextContainer: {
    flex: 1,
  },
  actionTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  actionSubtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 2,
  },
})

export default Profile