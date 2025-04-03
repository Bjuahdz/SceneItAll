import React from 'react';
import { View, Text, TouchableOpacity, Image, FlatList, Dimensions, ScrollView } from 'react-native';
import GenreTag from './GenreTag';
import { LinearGradient } from 'expo-linear-gradient';

type TabType = 'details' | 'cast' | 'extras' | 'similar';

interface MovieTabBarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  movie: MovieDetails; // Updated to use proper type
}

const MovieTabBar = ({ activeTab, setActiveTab, movie }: MovieTabBarProps) => {
  const tabs: { id: TabType; label: string }[] = [
    { id: 'details', label: 'Details' },
    { id: 'cast', label: 'Cast' },
    { id: 'extras', label: 'Extras' },
    { id: 'similar', label: 'Similar' },
  ];

  return (
    <View style={{
      marginTop: 20,
    }}>
      {/* Tab Navigation */}
      <View style={{ 
        paddingHorizontal: 20,
      }}>
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 1,
          width: '100%',
        }}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={{
                paddingVertical: 12,
              }}
            >
              <Text style={{
                color: activeTab === tab.id ? '#9ccadf' : 'rgba(255,255,255,0.6)',
                fontSize: 16,
                fontWeight: activeTab === tab.id ? '700' : '500',
                letterSpacing: 0.3,
              }}>
                {tab.label}
              </Text>
              {activeTab === tab.id && (
                <View style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 2.5,
                  backgroundColor: '#9ccadf',
                  borderRadius: 1.25,
                }} />
              )}
            </TouchableOpacity>
          ))}
        </View>
        
        <View style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 1,
          backgroundColor: 'rgba(255,255,255,0.1)',
          marginHorizontal: 20,
        }} />
      </View>

      {/* Tab Content Area */}
      <View style={{
        paddingTop: 20,
        paddingHorizontal: 20,
        minHeight: 200,
      }}>
        {activeTab === 'details' && (
          <View style={{ gap: 16 }}>
            {/* Top Section: Genres and Status */}
            <View style={{ gap: 12, alignItems: 'center' }}>
              {/* Release Date - Moved to top */}
              <Text style={{
                color: 'rgba(255,255,255,0.8)',
                fontSize: 15,
                fontWeight: '500',
                letterSpacing: 0.5,
              }}>
                {new Date(movie.release_date).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </Text>

              {/* Status Badge - Now more subtle */}
              <View style={{
                backgroundColor: 'rgba(156, 202, 223, 0.1)',
                paddingHorizontal: 12,
                paddingVertical: 4,
                borderRadius: 4,
                borderWidth: 1,
                borderColor: 'rgba(156, 202, 223, 0.2)',
              }}>
                <Text style={{
                  color: 'rgba(156, 202, 223, 0.8)',
                  fontSize: 13,
                  fontWeight: '500',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}>
                  {movie.status}
                </Text>
              </View>

              {/* Genres - Redesigned with a more modern look */}
              <View style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 6,
                marginTop: 4,
                paddingHorizontal: 8,
              }}>
                {movie.genres.map((genre) => (
                  <View key={genre.id} style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: 'rgba(255, 255, 255, 0.12)',
                  }}>
                    <Text style={{
                      color: 'rgba(255, 255, 255, 0.9)',
                      fontSize: 12,
                      fontWeight: '500',
                    }}>
                      {genre.name}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Divider - Made more subtle */}
            <View style={{
              height: 1,
              backgroundColor: 'rgba(255,255,255,0.06)',
              marginVertical: 8,
            }} />

            {/* Key Info Section */}
            <View style={{
              flexDirection: 'row',
              justifyContent: 'space-around',
              paddingVertical: 8,
            }}>
              {/* Rating */}
              <View style={{ alignItems: 'center', gap: 4 }}>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
                  Rating
                </Text>
                <Text style={{ color: '#9ccadf', fontSize: 16, fontWeight: '600' }}>
                  {movie.certification}
                </Text>
              </View>

              {/* Runtime */}
              <View style={{ alignItems: 'center', gap: 4 }}>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
                  Runtime
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 16, fontWeight: '600' }}>
                  {movie.formattedRuntime}
                </Text>
              </View>

              {/* Language */}
              <View style={{ alignItems: 'center', gap: 4 }}>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
                  Language
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 16, fontWeight: '600' }}>
                  {movie.spoken_languages.find(lang => 
                    lang.iso_639_1 === movie.original_language
                  )?.english_name || movie.original_language.toUpperCase()}
                </Text>
              </View>
            </View>

            {/* Divider */}
            <View style={{
              height: 1,
              backgroundColor: 'rgba(255,255,255,0.1)',
              marginVertical: 4,
            }} />

            {/* Credits Section */}
            <View style={{ gap: 24, alignItems: 'center' }}>
              {/* Directors */}
              {movie.directors?.length > 0 && (
                <View style={{ alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
                    {movie.directors.length > 1 ? 'Directors' : 'Director'}
                  </Text>
                  {movie.directors.map(director => (
                    <Text key={director.id} style={{
                      color: 'rgba(255,255,255,0.9)',
                      fontSize: 18,
                      fontWeight: '600',
                    }}>
                      {director.name}
                    </Text>
                  ))}
                </View>
              )}

              {/* Writers */}
              {movie.writers?.length > 0 && (
                <View style={{ alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
                    Writers
                  </Text>
                  <View style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    gap: 8,
                    paddingHorizontal: 20,
                  }}>
                    {movie.writers.map((writer, index) => (
                      <Text key={`${writer.id}-${writer.job}`} style={{
                        color: 'rgba(255,255,255,0.9)',
                        fontSize: 14,
                        textAlign: 'center',
                      }}>
                        {writer.name}
                        <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                          {` (${writer.job})`}
                        </Text>
                        {index < movie.writers.length - 1 ? ', ' : ''}
                      </Text>
                    ))}
                  </View>
                </View>
              )}
            </View>

            {/* Production Companies with Grid Layout */}
            <View style={{ marginTop: 16 }}>
              <Text style={{
                color: 'rgba(255,255,255,0.6)',
                fontSize: 14,
                textAlign: 'center',
                marginBottom: 24,
              }}>
                Production Companies
              </Text>
              <View style={{
                width: '100%',
                paddingHorizontal: 20,
              }}>
                <View style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  rowGap: 32,
                }}>
                  {(() => {
                    // Checks if it's a Netflix movie by using Netflix id and name being mentioned in the movie metadata
                    const isNetflixMovie = 
                      movie.production_companies.some(company => 
                        company.id === 2591 || 
                        company.name.toLowerCase().includes('netflix')
                      ) ||
                      (movie.homepage && movie.homepage.includes('netflix.com')) ||
                      movie.title.toLowerCase().includes('netflix') ||
                      movie.tagline?.toLowerCase().includes('netflix') ||
                      movie.overview?.toLowerCase().includes('netflix');

                    // Create the list of companies to display
                    const companiesToShow = [
                      // Add Netflix if it's a Netflix movie and not already in the list
                      ...(isNetflixMovie && !movie.production_companies.some(company => 
                        company.id === 2591 || company.name.toLowerCase().includes('netflix')
                      ) ? [{
                        id: 2591,
                        name: 'Netflix',
                        logo_path: '/wwemzKWzjKYJFfCeiB57q3r4Bcm.png',
                        origin_country: 'US'
                      }] : []),
                      ...movie.production_companies.filter(company => company.logo_path)
                    ];

                    return companiesToShow.map((company, index, array) => {
                      const isLastOdd = index === array.length - 1 && array.length % 2 === 1;
                      
                      return (
                        <View key={company.id} style={{
                          width: isLastOdd ? '100%' : '48%',
                          alignItems: 'center',
                        }}>
                          <View style={{
                            shadowColor: '#fff',
                            shadowOffset: { width: 0, height: 0 },
                            shadowOpacity: 0.8,
                            shadowRadius: 20,
                            elevation: 15,
                          }}>
                            <Image
                              source={{ uri: `https://image.tmdb.org/t/p/w200${company.logo_path}` }}
                              style={{
                                width: 120,
                                height: 60,
                                resizeMode: 'contain',
                                opacity: 1,
                              }}
                            />
                          </View>
                          <Text style={{
                            color: 'rgba(255,255,255,0.7)',
                            fontSize: 12,
                            marginTop: 12,
                            textAlign: 'center',
                          }}>
                            {company.name}
                          </Text>
                        </View>
                      );
                    });
                  })()}
                </View>
              </View>
            </View>

            {/* Horizontal Divider between the prod companies and the Financial info  */}
            <View style={{
              height: 1,
              backgroundColor: 'rgba(255,255,255,0.1)',
              marginVertical: 8,
            }} />

            {/* Financial Info */}
            <View style={{ paddingVertical: 1 }}>
              <View style={{
                alignItems: 'center',
                flexDirection: 'column'
              }}>
                {/* Budget */}
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14}}>
                    BUDGET
                  </Text>
                  <Text style={{
                    color: 'rgba(255,255,255,0.9)',
                    fontSize: 16,
                    fontWeight: '600',
                    marginTop: 4,
                  }}>
                    {movie.formattedBudget}
                  </Text>
                </View>

                {/* Revenue */}
                <View style={{
                  alignItems: 'center',
                  flex: 1,
                  paddingHorizontal: 8,
                }}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
                    REVENUE
                  </Text>
                  <Text style={{
                    color: (movie.revenue - movie.budget) > 0 ? '#4ade80' : '#ef4444',
                    fontSize: 16,
                    fontWeight: '600',
                    marginTop: 4,
                  }}>
                    {movie.formattedRevenue}
                  </Text>
                </View>

                {/* Profit */}
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
                    ROI
                  </Text>
                  <Text style={{
                    color: (movie.revenue - movie.budget) > 0 ? '#4ade80' : '#ef4444',
                    fontSize: 16,
                    fontWeight: '600',
                    marginTop: 4,
                  }}>
                    {movie.formattedProfit}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}
        
        {/**Active tab is set to CAST: everthing below here is for the cast tab */}
        {activeTab === 'cast' && (
          <View style={{ gap: 24 }}>
            {/* Cast Header */}
            <View style={{ alignItems: 'center', gap: 8 }}>
              <Text style={{
                color: 'rgba(255,255,255,0.9)',
                fontSize: 24,
                fontWeight: '700',
                textAlign: 'center',
              }}>
                Main Cast
              </Text>
            </View>

            {/* Cast Grid */}
            <ScrollView 
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                paddingBottom: 20,
              }}
            >
              <View style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'space-evenly',
                gap: 16,
                paddingHorizontal: 4,
              }}>
                {(movie.cast?.slice(0, 12) || []).map((item) => (
                  <View key={item.id} style={{
                    width: '28%',
                    alignItems: 'center',
                    marginBottom: 24,
                  }}>
                    {/* Cast Member Photo Card */}
                    <View style={{
                      width: 100,
                      height: 130,
                      borderRadius: 12,
                      overflow: 'hidden',
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      shadowColor: '#9ccadf',
                      shadowOffset: { width: 0, height: 0 },
                      shadowOpacity: 0.4,
                      shadowRadius: 8,
                      elevation: 8,
                      marginBottom: 12,
                      borderWidth: 1,
                      borderColor: 'rgba(156, 202, 223, 0.3)',
                    }}>
                      <Image
                        source={{ 
                          uri: item.profile_path 
                            ? `https://image.tmdb.org/t/p/w200${item.profile_path}`
                            : 'https://via.placeholder.com/200x200?text=No+Image'
                        }}
                        style={{
                          width: '100%',
                          height: '100%',
                          resizeMode: 'cover',
                        }}
                      />
                      {/* Refined gradient overlay */}
                      <LinearGradient
                        colors={[
                          'transparent',
                          'rgba(0,0,0,0.5)',
                          'rgba(0,0,0,0.8)',
                          'rgba(0,0,0,0.9)',
                        ]}
                        locations={[0, 0.5, 0.8, 1]}
                        style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: '50%',
                          justifyContent: 'flex-end',
                          padding: 8,
                        }}
                      >
                        <Text style={{
                          color: 'rgba(255,255,255,0.95)',
                          fontSize: 12,
                          fontWeight: '600',
                          textAlign: 'center',
                          textShadowColor: 'rgba(0,0,0,0.5)',
                          textShadowOffset: { width: 0, height: 1 },
                          textShadowRadius: 2,
                        }}>
                          {item.name}
                        </Text>
                      </LinearGradient>
                    </View>

                    {/* Character Name Below Card */}
                    <Text style={{
                      color: 'rgba(255,255,255,0.6)',
                      fontSize: 15,
                      textAlign: 'center',
                      marginTop: 1,
                    }}>
                      {item.character}
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        )}
        {activeTab === 'extras' && (
          <Text style={{ color: 'rgba(255,255,255,0.9)' }}>Extras content coming soon...</Text>
        )}
        {activeTab === 'similar' && (
          <Text style={{ color: 'rgba(255,255,255,0.9)' }}>Similar movies coming soon...</Text>
        )}
      </View>
    </View>
  );
};

export default MovieTabBar; 