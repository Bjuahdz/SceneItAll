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
 *   - "row" (filmmakers list): a headshot thumbnail beside name + role. Full
 *     width, so one person fills the row and any number stacks without gaps or
 *     truncated names.
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
 */
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
  const remeasure = useCallback<PersonCardRemeasure>((cb) => {
    const attempt = (retriesLeft: number) => {
      const node = cardRef.current;
      if (!node) {
        cb(null);
        return;
      }
      node.measureInWindow((x, y, w) => {
        if (w > 0) {
          cb({ x, y, width: w, height: (w * 4) / 3 });
        } else if (retriesLeft > 0) {
          requestAnimationFrame(() => attempt(retriesLeft - 1));
        } else {
          cb(null);
        }
      });
    };
    attempt(8);
  }, []);

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      if (!onPress) return;
      const { pageX, pageY, locationX, locationY } = e.nativeEvent;
      const w = widthRef.current;
      const rect =
        w > 0
          ? { x: pageX - locationX, y: pageY - locationY, width: w, height: (w * 4) / 3 }
          : null;
      onPress(rect, remeasure);
    },
    [onPress, remeasure]
  );

  if (variant === 'row') {
    return (
      <View style={styles.row}>
        <Avatar imageUrl={person.imageUrl} name={person.name} style={styles.rowThumb} initialsSize={18} />
        <View style={styles.rowBody}>
          <Text numberOfLines={1} style={styles.rowName}>
            {person.name}
          </Text>
          {!!person.role && (
            <Text numberOfLines={1} style={styles.rowRole}>
              {person.role}
            </Text>
          )}
        </View>
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
  // Row (filmmakers list)
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 7,
  },
  rowThumb: {
    width: 52,
    height: 66,
    borderRadius: 10,
  },
  rowBody: {
    flex: 1,
  },
  rowName: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 15,
    fontWeight: '500',
  },
  rowRole: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    marginTop: 3,
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
