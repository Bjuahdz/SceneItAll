import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Avatar from './Avatar';

export type Person = {
  id: string | number;
  name: string;
  role: string;
  imageUrl: string | null;
};

/**
 * PersonCard — a face behind a name, used wherever people appear so the whole
 * app speaks one visual language for cast and crew (and authors later).
 *   - "portrait" (cast grid): a tall headshot with name + role beneath.
 *   - "row" (filmmakers list): a headshot thumbnail beside name + role. Full
 *     width, so one person fills the row and any number stacks without gaps or
 *     truncated names.
 */
const PersonCard = ({
  person,
  variant = 'portrait',
}: {
  person: Person;
  variant?: 'portrait' | 'row';
}) => {
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
    <View style={styles.portrait}>
      <Avatar imageUrl={person.imageUrl} name={person.name} style={styles.rect} initialsSize={22} />
      <Text numberOfLines={2} style={styles.portraitName}>
        {person.name}
      </Text>
      {!!person.role && (
        <Text numberOfLines={1} style={styles.portraitRole}>
          {person.role}
        </Text>
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
