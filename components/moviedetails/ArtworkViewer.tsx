/**
 * ArtworkViewer — the expanded "floating card" for a single poster or backdrop.
 *
 * Tapping a card in the Extras rails used to jump straight to the OS share sheet, so
 * there was no way to actually LOOK at the artwork. Now the tapped card lifts out of
 * the rail, grows to a floating card over a dimmed stage, and offers the two things a
 * fan actually wants — Download and Share — as one tap each.
 *
 * How the expand stays smooth:
 *   · The card is laid out ONCE at its final rect. The open/close animation is a pure
 *     transform (translate + uniform scale) that maps that rect back onto the tapped
 *     card's on-screen rect at progress 0. No width/height animation, so nothing
 *     re-lays-out mid-flight and it all runs on the UI thread.
 *   · The scale is uniform because the floating card is sized to the artwork's own
 *     aspect ratio, which is the same aspect as the rail card it came from. A
 *     non-uniform scale would visibly stretch the image on the way out.
 *   · The caller derives the rail card's rect from the TOUCH at press time (see
 *     RailCard), so the card returns to wherever it actually is now — not where it was
 *     when the rail first rendered.
 *
 * Resolution: `viewUri` is a screen-sized render (w780/w1280). The full `originalUri`
 * is fetched ONLY on Download or Share — some originals are 4–8 MB and there is no
 * reason to pay that just to look at one.
 *
 * NOT a React Native <Modal>, deliberately. A Modal mounts its children in a separate
 * native root, and Reanimated's UI-thread view registry does not reliably attach to it
 * on iOS — shared-value styles simply never reach the views, so the card renders frozen
 * at progress 0 and the controls stay at opacity 0. That is exactly how the first
 * version failed in Expo Go. The rest of this app already knew better: every animated
 * full-screen layer (the capture chrome, the cinema scrim) is an absoluteFill sibling
 * at the root of MovieDetailsView, and ReceiptsSheet — the one real Modal — sticks to
 * entering/exiting layout animations, which DO cross the boundary.
 *
 * So this renders as a plain absoluteFill layer and must be mounted at the ROOT of the
 * detail view, outside the ScrollView. Mounted any deeper it gets clipped by the scroll
 * container and cannot cover the screen.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
// TouchableOpacity, not Pressable, for anything that lays out a ROW.
//
// On this stack (RN 0.81 / Fabric / Expo Go SDK 54) a Pressable whose `style` is a
// FUNCTION — `({ pressed }) => [...]` — loses `flexDirection` and `flex`. Not the whole
// style: `alignItems` and `justifyContent` still apply. So a row silently becomes a
// centred column and `flex: 1` never splits the space — icon stacks above label, and
// two 50/50 actions collapse into content-width blobs jammed left.
//
// The app's other function-style Pressables (TrailerPlayer's close, MovieSimilarTab's
// card, CapturePill's options) look fine ONLY because none of them set flexDirection or
// flex — they are default-column or fixed-size, so they never depend on what goes
// missing. Don't take them as proof the pattern is safe here.
//
// Pressable with a STATIC style is fine — the scrim below uses one. It is specifically
// the callback form. Press feedback comes from activeOpacity instead, matching what the
// rest of this app already does.
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  Dimensions,
  Alert,
  ActivityIndicator,
  BackHandler,
  Linking,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  interpolate,
  runOnJS,
  FadeIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';

const ACCENT = '#9ccadf';
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ── Viewer material ─────────────────────────────────────────────────────────
// One material for every piece of chrome here: a matte near-black plate with a
// hairline edge and small tracked caps. The first pass used frosted pills and a filled
// accent button, which read as three unrelated iOS controls dropped on top of a movie
// ticket. Matte + hairline matches the ticket the detail page already is, and it is
// distinctly NOT the system look — which is the point.
//
// Matte rather than blur is also the reliable choice: BlurView behind a rounded,
// overflow-hidden pill was rendering as nothing at all here.
const SURFACE = 'rgba(12,12,14,0.94)';
const HAIRLINE = 'rgba(255,255,255,0.15)';
const OK = '#7fd1a5';
const WARN = '#e8b465';

// Margin around the floating card, plus the space reserved below it for the actions.
// Deliberately NOT full-bleed: the point is a card lifted above the page, not a new screen.
const STAGE_MARGIN = 26;
// Reserved for the actions AND the result strip that appears after a save. Sized for
// the taller state on purpose: if the card resized when the strip appeared, the whole
// composition would jump at the exact moment we're telling the user it worked.
const ACTIONS_SPACE = 172;

const OPEN_MS = 320;
const CLOSE_MS = 240;

export type ArtworkSource = {
  viewUri: string;      // screen-sized render, shown while viewing
  originalUri: string;  // full resolution — fetched only on Download / Share
  aspect: number;       // width / height, so the expand is a uniform scale
  fileName: string;
  label: string;        // "Poster" | "Backdrop" — used in the share dialog title
  origin: { x: number; y: number; width: number; height: number }; // window coords
};

type SaveStatus = 'idle' | 'working' | 'saved' | 'denied' | 'error';

const ArtworkViewer = ({
  item,
  onClose,
}: {
  item: ArtworkSource | null;
  onClose: () => void;
}) => {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [sharing, setSharing] = useState(false);

  // Final resting rect: the largest box that fits the stage while keeping the
  // artwork's aspect, centred in the space above the actions.
  const target = useMemo(() => {
    const aspect = item?.aspect && item.aspect > 0 ? item.aspect : 2 / 3;
    const availW = SCREEN_W - STAGE_MARGIN * 2;
    const availH = SCREEN_H - insets.top - insets.bottom - ACTIONS_SPACE - STAGE_MARGIN * 2;

    let w = availW;
    let h = w / aspect;
    if (h > availH) {
      h = availH;
      w = h * aspect;
    }
    return {
      w,
      h,
      x: (SCREEN_W - w) / 2,
      y: insets.top + STAGE_MARGIN + Math.max(0, (availH - h) / 2),
    };
  }, [item?.aspect, insets.top, insets.bottom]);

  // Open whenever a new item arrives. Status resets too, so a second poster never
  // shows the previous one's "Saved" state.
  useEffect(() => {
    if (!item) return;
    setStatus('idle');
    setSharing(false);
    progress.value = 0;
    progress.value = withTiming(1, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
  }, [item, progress]);

  // Collapse back to the rail card, THEN let the parent unmount us.
  const handleClose = useCallback(() => {
    progress.value = withTiming(
      0,
      { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        'worklet';
        if (finished) runOnJS(onClose)();
      }
    );
  }, [onClose, progress]);

  const cardStyle = useAnimatedStyle(() => {
    if (!item) return { opacity: 0 };
    const { origin } = item;
    // Map the final rect back onto the tapped card at progress 0.
    const fromScale = origin.width / target.w;
    const dx = origin.x + origin.width / 2 - (target.x + target.w / 2);
    const dy = origin.y + origin.height / 2 - (target.y + target.h / 2);
    return {
      opacity: 1,
      transform: [
        { translateX: interpolate(progress.value, [0, 1], [dx, 0]) },
        { translateY: interpolate(progress.value, [0, 1], [dy, 0]) },
        { scale: interpolate(progress.value, [0, 1], [fromScale, 1]) },
      ],
    };
  });

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  // Chrome trails the card slightly so the expand reads as the card leading the motion.
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.55, 1], [0, 0, 1]),
  }));

  const handleDownload = useCallback(async () => {
    if (!item || status === 'working') return;
    setStatus('working');
    try {
      // Write-only: we never need to READ the user's library, just add to it. Keeps the
      // permission prompt to the narrower "add photos" grant.
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        setStatus('denied');
        return;
      }
      const dest = `${FileSystem.cacheDirectory}${item.fileName}`;
      const { uri } = await FileSystem.downloadAsync(item.originalUri, dest);
      await MediaLibrary.saveToLibraryAsync(uri);
      setStatus('saved');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Error saving artwork:', error);
      setStatus('error');
    }
  }, [item, status]);

  const handleShare = useCallback(async () => {
    if (!item || sharing) return;
    setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing unavailable', 'This device cannot open the share sheet.');
        return;
      }
      const dest = `${FileSystem.cacheDirectory}${item.fileName}`;
      const { uri } = await FileSystem.downloadAsync(item.originalUri, dest);
      await Sharing.shareAsync(uri, {
        mimeType: 'image/jpeg',
        dialogTitle: `Share ${item.label}`,
      });
    } catch (error) {
      console.error('Error sharing artwork:', error);
      Alert.alert('Could not share', 'Something went wrong preparing that image.');
    } finally {
      setSharing(false);
    }
  }, [item, sharing]);

  // iOS has no public API to set the wallpaper, and "Use as Wallpaper" is an action
  // Photos.app provides for its own assets — there is no UIActivityType that would put
  // it in our share sheet, even if we shared the saved PHAsset instead of a file. So we
  // can't finish the job in-app; what we CAN do is remove the hunting. This drops the
  // user into Photos with the poster sitting first in Recents.
  // Just opens Photos. There is no better target available:
  //
  //   · No public API opens a specific asset, and the one person who decompiled Photos
  //     hunting for it could not make asset-level navigation work either.
  //   · `photos-navigation://album?name=recents` sounds right and isn't — it drops you
  //     on the ALBUMS LIST inside Collections, which is further from the photo than
  //     doing nothing. Tried 2026-07-28, reverted the same day. Don't re-add it.
  //
  // So Photos opens wherever the user last left it, and the result strip tells them
  // what to look for instead of pretending we put them there.
  const handleOpenPhotos = useCallback(async () => {
    for (const url of ['photos-redirect://', 'photos://']) {
      try {
        await Linking.openURL(url);
        return;
      } catch {
        // try the next scheme
      }
    }
    console.warn('Could not open the Photos app from the artwork viewer.');
  }, []);

  // The primary button carries the whole flow: Download → Saving → Open Photos. Icon and
  // label always change together, so there is never a glyph whose meaning you must guess.
  const primary = {
    idle: {
      icon: 'download-outline' as const, label: 'DOWNLOAD',
      tint: ACCENT, onPress: handleDownload,
    },
    working: {
      icon: 'download-outline' as const, label: 'SAVING',
      tint: ACCENT, onPress: undefined,
    },
    saved: {
      icon: 'images-outline' as const, label: 'OPEN PHOTOS',
      tint: ACCENT, onPress: handleOpenPhotos,
    },
    denied: {
      icon: 'settings-outline' as const, label: 'SETTINGS',
      tint: WARN, onPress: () => Linking.openSettings(),
    },
    error: {
      icon: 'refresh-outline' as const, label: 'TRY AGAIN',
      tint: WARN, onPress: handleDownload,
    },
  }[status];

  // The result strip. Every state names what happened AND what to do next — the saved
  // case is where the wallpaper steps live, since we can't perform them ourselves.
  const result = {
    idle: null,
    working: null,
    saved: {
      icon: 'checkmark-circle' as const,
      tint: OK,
      title: 'SAVED TO PHOTOS',
      // Says where it is rather than where we sent them — true wherever Photos happens
      // to open, which is the part we don't control.
      hint: 'It’s your newest photo. Open it, then Share → Use as Wallpaper.',
    },
    denied: {
      icon: 'lock-closed-outline' as const,
      tint: WARN,
      title: 'PHOTO ACCESS OFF',
      hint: 'Turn on “Add Photos Only” in Settings to save artwork.',
    },
    error: {
      icon: 'alert-circle-outline' as const,
      tint: WARN,
      title: 'COULDN’T SAVE',
      hint: 'Check your connection and try again.',
    },
  }[status];

  // Android hardware back closes the viewer instead of popping the whole detail layer.
  // A Modal gave this for free via onRequestClose; without one it has to be explicit.
  useEffect(() => {
    if (!item) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });
    return () => sub.remove();
  }, [item, handleClose]);

  // After every hook, so hook order stays identical across renders.
  if (!item) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]}>
      <View style={StyleSheet.absoluteFill}>
        {/* Tap anywhere off the card to collapse it back. */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close artwork"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.card,
            { left: target.x, top: target.y, width: target.w, height: target.h },
            cardStyle,
          ]}
          pointerEvents="none"
        >
          <Image
            source={{ uri: item.viewUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={0}
            cachePolicy="memory-disk"
            recyclingKey={item.viewUri}
          />
        </Animated.View>

        <Animated.View
          style={[styles.chrome, { paddingBottom: Math.max(insets.bottom, 16) }, chromeStyle]}
          pointerEvents="box-none"
        >
          {/* ONE plate: the status line and both verbs share a single edge, divided
              by hairlines rather than floating apart as separate controls. */}
          <View style={styles.plate}>
            {/* Keyed on status so each transition re-runs the entrance instead of
                swapping text in place — it arrives, it doesn't blink. */}
            {result && (
              <Animated.View
                key={status}
                entering={FadeIn.duration(240)}
                style={styles.statusRow}
              >
                <Ionicons name={result.icon} size={14} color={result.tint} />
                <View style={styles.statusText}>
                  <Text style={[styles.statusTitle, { color: result.tint }]}>
                    {result.title}
                  </Text>
                  <Text style={styles.statusHint}>{result.hint}</Text>
                </View>
              </Animated.View>
            )}

            <View style={styles.actionRow}>
              <TouchableOpacity
                onPress={primary.onPress}
                disabled={status === 'working'}
                activeOpacity={0.6}
                style={styles.action}
                accessibilityRole="button"
                accessibilityLabel={primary.label}
              >
                {status === 'working' ? (
                  <ActivityIndicator size="small" color={ACCENT} />
                ) : (
                  <Ionicons name={primary.icon} size={15} color={primary.tint} />
                )}
                <Text style={[styles.actionLabel, { color: primary.tint }]} numberOfLines={1}>
                  {primary.label}
                </Text>
              </TouchableOpacity>

              <View style={styles.divider} />

              <TouchableOpacity
                onPress={handleShare}
                disabled={sharing}
                activeOpacity={0.6}
                style={styles.action}
                accessibilityRole="button"
                accessibilityLabel="Share"
              >
                <Ionicons name="share-outline" size={15} color="rgba(255,255,255,0.7)" />
                <Text style={[styles.actionLabel, styles.actionMuted]} numberOfLines={1}>
                  SHARE
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>

        {/* Explicit way out — labelled, not a bare glyph. Frosted rather than a
            flat grey chip, and set in the same tracked micro-caps the rest of the
            app uses for small controls, so it reads as chrome instead of a button
            dropped on top of the artwork. */}
        <Animated.View
          style={[styles.closeWrap, { top: Math.max(insets.top, 12) }, chromeStyle]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            onPress={handleClose}
            activeOpacity={0.6}
            style={styles.closeChip}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={12} color="rgba(255,255,255,0.7)" />
            <Text style={styles.closeLabel} numberOfLines={1}>
              CLOSE
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // Above EVERY layer in MovieDetailsView. The detail page's top bar is zIndex 1000, so
  // anything lower renders beneath the title chevron and the star.
  root: {
    zIndex: 2000,
    elevation: 2000,
  },
  scrim: {
    backgroundColor: 'rgba(0,0,0,0.88)',
  },
  card: {
    position: 'absolute',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  chrome: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: STAGE_MARGIN,
  },
  // The single control surface. Status and both verbs live inside ONE hairline edge and
  // are separated by hairlines, so it reads as one instrument rather than loose buttons.
  plate: {
    borderRadius: 12, // squarer than an iOS pill on purpose — this is a ticket, not a sheet
    overflow: 'hidden',
    backgroundColor: SURFACE,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  statusText: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  statusHint: {
    fontSize: 11,
    lineHeight: 15,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 3,
  },
  actionRow: {
    flexDirection: 'row',
    height: 52,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  // Hierarchy comes from the accent on the label, not from a filled slab. A solid pale
  // button was the single most system-looking thing in here.
  actionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  actionMuted: {
    color: 'rgba(255,255,255,0.7)',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: HAIRLINE,
  },
  // Full-width with the chip aligned right. The old version pinned only `right`, which
  // let the chip's width collapse and wrap the label under the icon.
  closeWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: STAGE_MARGIN,
    alignItems: 'flex-end',
  },
  closeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 8, // same corner language as the plate
    backgroundColor: SURFACE,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
  },
  closeLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
});

export default ArtworkViewer;
