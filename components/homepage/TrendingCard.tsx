import { Link } from "expo-router";
import { View, Text, TouchableOpacity, Image, StyleSheet, Dimensions } from "react-native";
import React, { useEffect, useMemo, useState } from "react";
import MaskedView from "@react-native-masked-view/masked-view";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  SharedValue,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { TrendingMovie } from "@/interfaces/interfaces";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = SCREEN_WIDTH * 0.7;
const CARD_HEIGHT = CARD_WIDTH * 1.5;

// Every logo is contain-fit into one shared box and bottom-anchored to a single
// baseline, so all logos rest on the same line regardless of their intrinsic
// width/height. Taller logos simply extend further up past the card's top edge.
const LOGO_BOX_WIDTH = CARD_WIDTH * 0.9;
const LOGO_BOX_HEIGHT = 80;
// Where every logo's bottom edge rests, in px below the card's top edge.
const LOGO_BASELINE = 30;

// 3D ranking number with layered depth + gradient front face
const TrendingNumber = React.memo(({ number }: { number: number }) => {
  const TOTAL_LAYERS = 2;

  const layers = useMemo(() => {
    const elements = [];

    for (let i = TOTAL_LAYERS; i > 0; i--) {
      const depth = Math.pow(i, 1.5) / 2;

      elements.push(
        <Text
          key={`base-${i}`}
          style={[
            styles.rankingLayer,
            {
              left: depth,
              top: depth,
              color: "#2a5e7e",
              zIndex: TOTAL_LAYERS - i,
            },
          ]}
        >
          {number}
        </Text>
      );
    }

    elements.push(
      <MaskedView
        key="front"
        style={{ zIndex: TOTAL_LAYERS }}
        maskElement={<Text style={styles.rankingLayer}>{number}</Text>}
      >
        <LinearGradient
          colors={["#e8f0f5", "#9ccadf", "#4a8eae"]}
          locations={[0.1, 0.5, 0.9]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={styles.rankingGradient}
        />
      </MaskedView>
    );

    return elements;
  }, [number]);

  return <>{layers}</>;
});

interface ExtendedTrendingMovie extends TrendingMovie {
  logo_path?: string | null;
  clean_poster_url?: string;
}

interface TrendingCardProps {
  movie: ExtendedTrendingMovie;
  index: number;
  scrollX: SharedValue<number>;
  itemWidth: number;
}

const TrendingCard = React.memo(({ movie, index, scrollX, itemWidth }: TrendingCardProps) => {
  const { movie_id, poster_url, title } = movie;
  const posterUri = (movie.clean_poster_url || poster_url).replace("/w500", "/w1280");
  const logoPath = movie.logo_path;

  // Resolve the logo's contain-fit height deterministically. Image.getSize reports
  // intrinsic dimensions identically for cached and uncached images, unlike onLoad,
  // which can skip dimensions for cached ones.
  const [logoHeight, setLogoHeight] = useState(LOGO_BOX_HEIGHT);

  useEffect(() => {
    if (!logoPath) return;
    let isMounted = true;

    Image.getSize(
      `https://image.tmdb.org/t/p/w1280${logoPath}`,
      (width, height) => {
        if (!isMounted || !width || !height) return;
        const aspectRatio = width / height;
        const fitByWidth = aspectRatio >= LOGO_BOX_WIDTH / LOGO_BOX_HEIGHT;
        setLogoHeight(fitByWidth ? LOGO_BOX_WIDTH / aspectRatio : LOGO_BOX_HEIGHT);
      },
      () => {}
    );

    return () => {
      isMounted = false;
    };
  }, [logoPath]);

  // All scroll-driven styling runs on the UI thread via Reanimated worklets.
  // The legacy Animated version of this file froze at mount-time values on the
  // new architecture, which made slot 0 (mounted at its own active offset) sit
  // permanently higher than every other card.
  const center = index * itemWidth;

  const cardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollX.value,
      [center - itemWidth, center, center + itemWidth],
      [0.55, 1, 0.55],
      Extrapolation.CLAMP
    ),
  }));

  // Float the logo: full presence when centered, dimmed + slightly sunk when not.
  // translateY returns to exactly 0 at center for every card, so the active logo
  // always rests on the shared LOGO_BASELINE.
  const logoStyle = useAnimatedStyle(() => {
    const range = [center - itemWidth * 0.75, center, center + itemWidth * 0.75];
    return {
      opacity: interpolate(scrollX.value, range, [0.25, 1, 0.25], Extrapolation.CLAMP),
      transform: [
        { translateY: interpolate(scrollX.value, range, [10, 0, 10], Extrapolation.CLAMP) },
        { scale: interpolate(scrollX.value, range, [0.94, 1, 0.94], Extrapolation.CLAMP) },
      ],
    };
  });

  const numberStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollX.value,
      [center - itemWidth * 0.75, center, center + itemWidth * 0.75],
      [0.2, 1, 0.2],
      Extrapolation.CLAMP
    ),
  }));

  return (
    <Link href={`/movie/${movie_id}`} asChild>
      <TouchableOpacity activeOpacity={0.9}>
        <Animated.View style={[styles.container, cardStyle]}>
          <View style={styles.card}>
            <Image
              source={{ uri: posterUri, cache: "force-cache" }}
              style={styles.posterImage}
              resizeMode="cover"
              fadeDuration={0}
            />

            <LinearGradient
              colors={["rgba(0,0,0,0.45)", "rgba(0,0,0,0.18)", "transparent"]}
              locations={[0, 0.3, 0.6]}
              style={styles.topGradient}
            />

            <LinearGradient
              colors={["transparent", "rgba(0,0,0,0.25)", "rgba(0,0,0,0.75)"]}
              locations={[0.45, 0.65, 1]}
              style={styles.bottomGradient}
            />
          </View>

          <Animated.View style={[styles.rankingContainer, numberStyle]}>
            <TrendingNumber number={index + 1} />
          </Animated.View>

          <Animated.View style={[styles.logoBox, logoStyle]}>
            {logoPath ? (
              <Image
                source={{ uri: `https://image.tmdb.org/t/p/w1280${logoPath}` }}
                style={{ width: LOGO_BOX_WIDTH, height: logoHeight }}
                resizeMode="contain"
                fadeDuration={0}
              />
            ) : (
              <Text style={styles.logoFallbackText} numberOfLines={2}>
                {title}
              </Text>
            )}
          </Animated.View>
        </Animated.View>
      </TouchableOpacity>
    </Link>
  );
});

const styles = StyleSheet.create({
  container: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    marginVertical: 10,
    overflow: "visible",
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 30,
    overflow: "hidden",
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  posterImage: {
    width: "100%",
    height: "100%",
    position: "absolute",
    top: 0,
    left: 0,
  },
  topGradient: {
    position: "absolute",
    left: -20,
    right: -20,
    top: -20,
    height: "50%",
    zIndex: 1,
  },
  bottomGradient: {
    position: "absolute",
    left: -20,
    right: -20,
    bottom: -20,
    height: "50%",
    zIndex: 1,
  },
  logoBox: {
    position: "absolute",
    top: LOGO_BASELINE - LOGO_BOX_HEIGHT,
    left: 0,
    right: 0,
    height: LOGO_BOX_HEIGHT,
    zIndex: 20,
    alignItems: "center",
    justifyContent: "flex-end",
    // Scale shrinks toward the baseline so the logo's bottom edge stays put.
    transformOrigin: "center bottom",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.9,
    shadowRadius: 3,
  },
  logoFallbackText: {
    width: LOGO_BOX_WIDTH,
    color: "white",
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 0.5,
    textShadowColor: "rgba(0, 0, 0, 0.85)",
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 8,
  },
  rankingContainer: {
    position: "absolute",
    bottom: -40,
    left: -40,
    zIndex: 10,
    width: 180,
    height: 180,
  },
  rankingLayer: {
    position: "absolute",
    fontSize: 160,
    fontWeight: "900",
    color: "#2a5e7e",
    left: 0,
    top: 0,
  },
  rankingGradient: {
    width: 180,
    height: 180,
  },
});

export default TrendingCard;
