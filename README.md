# SceneItAll

A React Native movie discovery app built with Expo. Browse trending and upcoming films, explore by genre, inspect box-office winners and flops, and dive into rich movie detail pages — all powered by [The Movie Database (TMDB)](https://www.themoviedb.org/) API with search analytics stored in [Appwrite](https://appwrite.io/).

> **Status:** Actively in development. The app is stable enough for local development and Expo Go testing. Several screens and features are placeholders while the product vision takes shape.

---

## Features

### Search — the primary surface
Search covers films, shows, people, collections and studios in one pass:

- **Recents board** — a poster-tile grid of everything you've opened before
- **Quick searches** — trending suggestions offered while the field is empty
- **Kind row** — films · shows · people · collections · studios, as navigation rather than a filter
- **Filter sheet** — sort, decade, genre and rating controls, scoped to whichever kind is on screen
- **Graceful empties** — a first-run guide, did-you-mean suggestions, and honest no-artwork states

### Entity pages
Tap a person, collection or studio and you land on their own page: artwork, biography or facts,
and a filmography whose rows expand in place into detail cards, with released and upcoming
sections kept apart.

### Movie details
Tap any movie to open a detail sheet with:

- Textless poster and title logo artwork
- Overview, certification, runtime, budget, revenue, and profit
- People-forward cast and filmmaker sections — a face behind every name, each one a door to
  that person's page
- Where to watch, box office, and an artwork viewer
- Official YouTube trailers, staged in a cinema mode
- Voice **takes** — record a spoken reaction to a film, kept in a per-title journal

### Discovery
A separate **Discover** tab carries the browsing experience — hero carousel, trending, upcoming,
genre rows, and an interactive box-office gain/loss chart.

### Navigation
- A custom floating blur bar that morphs between poses and is never hidden
- A detached search satellite that owns the search field
- Deep linking via Expo Router (`/movie/[id]`)

### Home
A **Home** dashboard built from your own journal: your themes drawn as a constellation you can
scrub, and a summary card of films, takes, time spoken and nights recorded.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | [Expo SDK 54](https://expo.dev/) · [React Native 0.81](https://reactnative.dev/) |
| Language | [TypeScript](https://www.typescriptlang.org/) |
| Routing | [Expo Router v6](https://docs.expo.dev/router/introduction/) (file-based) |
| Styling | [NativeWind v4](https://www.nativewind.dev/) (Tailwind CSS for React Native) |
| Animation | [React Native Reanimated v4](https://docs.swmansion.com/react-native-reanimated/) · [React Native Gesture Handler](https://docs.swmansion.com/react-native-gesture-handler/) |
| Images | [expo-image](https://docs.expo.dev/versions/latest/sdk/image/) |
| Charts | [react-native-svg](https://github.com/software-mansion/react-native-svg) |
| Backend | [Appwrite Cloud](https://cloud.appwrite.io/) (search analytics / trending) |
| Local data | [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/) (slates, takes, preferences) |
| Graphics | [React Native Skia](https://shopify.github.io/react-native-skia/) (the Home dashboard canvas) |
| Movie data | [TMDB API v3](https://developer.themoviedb.org/docs) |

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [npm](https://www.npmjs.com/)
- [Expo Go](https://expo.dev/go) on a physical device, or an iOS Simulator / Android Emulator
- A [TMDB API](https://www.themoviedb.org/settings/api) account (API Read Access Token)
- An [Appwrite](https://cloud.appwrite.io/) project with a database collection for search analytics

### Installation

```bash
git clone https://github.com/Bjuahdz/SceneItAll.git
cd SceneItAll
npm install
```

> **Note:** This project uses a `.npmrc` with `legacy-peer-deps=true` to resolve peer-dependency conflicts with Expo SDK 54. Do not remove it unless you know what you are changing.

### Environment variables

Create a `.env` file in the project root (never commit this file):

```env
EXPO_PUBLIC_MOVIE_API_KEY=your_tmdb_api_read_access_token
EXPO_PUBLIC_APPWRITE_PROJECT_ID=your_appwrite_project_id
EXPO_PUBLIC_APPWRITE_DATABASE_ID=your_appwrite_database_id
EXPO_PUBLIC_APPWRITE_COLLECTION_ID=your_appwrite_collection_id
```

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_MOVIE_API_KEY` | TMDB **API Read Access Token** (Bearer auth) |
| `EXPO_PUBLIC_APPWRITE_PROJECT_ID` | Appwrite project ID |
| `EXPO_PUBLIC_APPWRITE_DATABASE_ID` | Appwrite database ID |
| `EXPO_PUBLIC_APPWRITE_COLLECTION_ID` | Collection used for search-term analytics |

All variables use the `EXPO_PUBLIC_` prefix so Expo can inject them at build time. See [Expo environment variables](https://docs.expo.dev/guides/environment-variables/) for details.

**Appwrite collection schema** (for trending searches):

| Attribute | Type | Purpose |
|-----------|------|---------|
| `searchTerm` | string | The query users searched for |
| `movie_id` | integer | TMDB movie ID |
| `title` | string | Movie title |
| `count` | integer | Number of times searched |
| `poster_url` | string | Poster image URL |

Configure collection permissions so the client SDK can read and write documents (guest/anonymous access is used in development).

### Run the app

```bash
npx expo start -c
```

Scan the QR code with Expo Go, or press `i` / `a` for iOS Simulator / Android Emulator.

Use `-c` to clear the Metro cache after changing environment variables or dependencies.

---

## Project structure

```
SceneItAll/
├── app/                    # Expo Router screens
│   ├── (tabs)/             # Tab navigator (Home, Search, Saved, Profile)
│   │   ├── index.tsx       # Home dashboard (placeholder)
│   │   ├── search.tsx      # Primary discovery surface
│   │   └── saved.tsx       # Saved movies (stub)
│   ├── movie/[id].tsx      # Movie detail screen
│   └── _layout.tsx         # Root layout
├── components/
│   ├── homepage/           # Hero, trending, upcoming, box office, genre rows
│   ├── moviedetails/       # Detail tabs, action buttons
│   └── search/             # Search bar, genre sections
├── services/
│   ├── api.ts              # TMDB API client and fetch helpers
│   ├── appwrite.ts         # Trending analytics (read/write)
│   └── useFetch.ts         # Shared data-fetching hook
├── interfaces/             # TypeScript type definitions
├── constants/              # Icons, images, shared constants
└── assets/                 # Fonts, icons, images
```

---

## Architecture overview

```
┌─────────────────┐     Bearer token      ┌──────────────┐
│   SceneItAll    │ ────────────────────► │   TMDB API   │
│   (Expo app)    │                       │  (movie data)│
└────────┬────────┘                       └──────────────┘
         │
         │  Client SDK (read/write)
         ▼
┌─────────────────┐
│  Appwrite Cloud │  ← search counts, trending rankings
└─────────────────┘
```

- **TMDB** provides all movie metadata, images, videos, and discovery endpoints.
- **Appwrite** stores anonymized search analytics. Each search increments a counter; the trending section reads the top entries.
- **Caching** — TMDB image responses and box-office section results are cached in memory to reduce API load.

---

## Development notes

### Dependency management

Use `npx expo install <package>` for anything with native code. Expo pins versions to match the installed SDK and the Expo Go binary:

```bash
npx expo install react-native-reanimated
```

Avoid `npm install` for native modules unless you know the target version.

### Key pinned versions

- `react-native-worklets@0.5.1` — must match Expo SDK 54's bundled native binary
- `react@19.1.0` — pinned by Expo SDK 54

### Platform notes

- **iOS / Expo Go** — fully supported for development and testing
- **Android emulator** — Appwrite may reject requests until an Android platform is registered in the Appwrite console (package `host.exp.exponent` for Expo Go)

### Type checking

```bash
npx tsc --noEmit
```

Some pre-existing TypeScript warnings remain; they do not block Metro bundling.

---

## Roadmap (high level)

SceneItAll is evolving from a TMDB-powered movie browser into a more personal media companion. Direction is still being defined, but near-term areas include:

- [ ] Movie detail screen polish (header animation, overview expand/collapse)
- [ ] User authentication and session management
- [ ] Home dashboard with personal notes, ratings, and stats
- [ ] Voice capture flow (UI shell exists in the tab bar)
- [ ] Saved movies persistence
- [ ] Legacy `Animated` API migration to Reanimated
- [ ] Dependency cleanup and SDK patch alignment

---

## Contributing

This is a personal project, but issues and suggestions are welcome. If you open a PR, please do not include `.env` files or API keys.

---

## Acknowledgments

- Movie data provided by [The Movie Database (TMDB)](https://www.themoviedb.org/)
- Built with [Expo](https://expo.dev/) and the React Native ecosystem

---

## Author

**Bryan Hernandez** — [@Bjuahdz](https://github.com/Bjuahdz)
