import React, { useCallback, useRef } from 'react';
import { GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Avatar from './Avatar';

export type Person = {
  id: string | number;
  name: string;
  role: string;
  imageUrl: string | null;
};

/** The headshot's on-screen rect — what a person page grows out of. */
export type PersonCardRect = { x: number; y: number; width: number; height: number };
export type PersonCardRemeasure = (cb: (rect: PersonCardRect | null) => void) => void;

/**
 * PersonCard — a face behind a name, used wherever people appear so the whole
 * app speaks one visual language for cast and crew (and authors later).
 *   - "portrait" (cast grid): a tall headshot with name + role beneath.
 *   - "row" (filmmakers list): B2 · PORTRAIT CHIP, Bryan's ruling 2026-08-13 —
 *     a 42×56 chip (the portrait card's own 3:4, miniature) ahead of the name,
 *     role on the right in the ledger's letterspaced caps. A list row, not a
 *     card: it scales from a one-director film to a six-writer one without
 *     changing the Details tab's texture (why B3's faces rail was rejected —
 *     one lone portrait left dead air beside it).
 *
 * ▸ TAPPABLE when `onPress` is given (enhance/cast): the card reports the rect a
 * person page should GROW from, and it is derived FROM THE TOUCH, never from a
 * tap-time measurement — Fabric's measureInWindow reads the committed tree,
 * which lags the glass (the marquee/tile verdict, learned three times). The
 * Pressable is an absoluteFill overlay with NO children, so `page − location`
 * is exactly the card's top-left; the packer-known half is the layout width,
 * and the headshot's height is width·4/3 by construction (see styles.rect).
 * The rect covers the HEADSHOT only — the page grows out of the photograph,
 * not the caption. `measureInWindow` survives as the RE-measure (with retries)
 * for animation starts, on a plain View ref — the reliable channel.
 *
 * ▸ THE ROW'S RECT IS THE CHIP'S, BY CONSTRUCTION: the chip is the row's first
 * child at its left edge, one vertical pad down, at a fixed 42×56 — so both
 * the touch-derived rect and the re-measure translate the row's origin by
 * constants instead of measuring the chip itself. Same 3:4 as every other
 * grow origin, which is what makes the chip → hero morph share real geometry.
 */

// The B2 chip and the row's frame — named because the rect derivation below
// must agree with the layout to the pixel.
const ROW_CHIP_W = 42;
const ROW_CHIP_H = 56; // = W · 4/3, the app's one portrait ratio
const ROW_PAD_V = 7;
const PersonCard = ({
  person,
  variant = 'portrait',
  onPress,
}: {
  person: Person;
  variant?: 'portrait' | 'row';
  /** Tap handler. `rect` is the headshot's touch-derived rect (null when the
   *  card hasn't laid out yet); `remeasure` re-asks for it fresh. */
  onPress?: (rect: PersonCardRect | null, remeasure: PersonCardRemeasure) => void;
}) => {
  const cardRef = useRef<View>(null);
  const widthRef = useRef(0);

  // The living measurement, retried across frames — Fabric returns 0×0 around
  // scrolls, sometimes for several consecutive frames (RecentTile's pattern).
  // For the row variant the measured box is the ROW; the chip's rect is that
  // origin translated by the layout constants above.
  const remeasure = useCallback<PersonCardRemeasure>(
    (cb) => {
      const attempt = (retriesLeft: number) => {
        const node = cardRef.current;
        if (!node) {
          cb(null);
          return;
        }
        node.measureInWindow((x, y, w) => {
          if (w > 0) {
            cb(
              variant === 'row'
                ? { x, y: y + ROW_PAD_V, width: ROW_CHIP_W, height: ROW_CHIP_H }
                : { x, y, width: w, height: (w * 4) / 3 }
            );
          } else if (retriesLeft > 0) {
            requestAnimationFrame(() => attempt(retriesLeft - 1));
          } else {
            cb(null);
          }
        });
      };
      attempt(8);
    },
    [variant]
  );

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      if (!onPress) return;
      const { pageX, pageY, locationX, locationY } = e.nativeEvent;
      // page − location = the pressed box's own top-left (the Pressable fills
      // it exactly, and carries no children to skew location).
      const bx = pageX - locationX;
      const by = pageY - locationY;
      if (variant === 'row') {
        // The chip needs nothing from layout — its box is constants.
        onPress({ x: bx, y: by + ROW_PAD_V, width: ROW_CHIP_W, height: ROW_CHIP_H }, remeasure);
        return;
      }
      const w = widthRef.current;
      const rect = w > 0 ? { x: bx, y: by, width: w, height: (w * 4) / 3 } : null;
      onPress(rect, remeasure);
    },
    [onPress, remeasure, variant]
  );

  if (variant === 'row') {
    return (
      <View ref={cardRef} style={styles.row}>
        <Avatar imageUrl={person.imageUrl} name={person.name} style={styles.rowChip} initialsSize={13} />
        <Text numberOfLines={1} style={styles.rowName}>
          {person.name}
        </Text>
        {!!person.role && (
          <Text numberOfLines={1} style={styles.rowRole}>
            {person.role}
          </Text>
        )}
        {/* Same law as the portrait card: LAST child, childless, covering the
            row — so page − location stays box-relative and nothing styled ever
            sits on the touch path. */}
        {onPress && (
          <Pressable
            onPress={handlePress}
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel={person.role ? `${person.name}, ${person.role}` : person.name}
          />
        )}
      </View>
    );
  }

  return (
    <View
      ref={cardRef}
      style={styles.portrait}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width;
      }}
    >
      <Avatar imageUrl={person.imageUrl} name={person.name} style={styles.rect} initialsSize={22} />
      <Text numberOfLines={2} style={styles.portraitName}>
        {person.name}
      </Text>
      {!!person.role && (
        <Text numberOfLines={1} style={styles.portraitRole}>
          {person.role}
        </Text>
      )}
      {/* LAST child, childless, covering the card — the only thing a finger can
          hit, which is what keeps location card-relative (the M6 scar). Bare
          wrapper, no visuals: the Fabric landmine about styled touchables. */}
      {onPress && (
        <Pressable
          onPress={handlePress}
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={person.role ? `${person.name}, ${person.role}` : person.name}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  // Row (filmmakers list) — B2 · PORTRAIT CHIP. Typography is the ledger's own
  // (the name/role voices the hand-rolled filmmaker rows shipped with), so the
  // chip is the only thing that changed when the rows became doors.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: ROW_PAD_V,
  },
  rowChip: {
    width: ROW_CHIP_W,
    height: ROW_CHIP_H,
    borderRadius: 6,
  },
  rowName: {
    flex: 1,
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14.5,
    fontWeight: '600',
  },
  rowRole: {
    flexShrink: 1,
    color: 'rgba(156,202,223,0.75)',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    textAlign: 'right',
  },

  // Portrait (cast grid)
  portrait: {
    alignItems: 'center',
  },
  rect: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 12,
    marginBottom: 8,
  },
  portraitName: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12.5,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 15,
  },
  portraitRole: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
  },
});

export default PersonCard;
