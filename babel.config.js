module.exports = function (api) {
    // Was api.cache(true): that caches the resolved config forever, so plugin
    // changes here survived even `expo start -c`. Invalidate on env instead.
    api.cache.invalidate(() => process.env.NODE_ENV);
    return {
      presets: [
        ["babel-preset-expo", { jsxImportSource: "nativewind" }],
        "nativewind/babel",
      ],
      plugins: [
        // Reanimated 4 moved the worklet transform into react-native-worklets.
        // The legacy "react-native-reanimated/plugin" does not transform worklets
        // here, which leaves __RUNTIME_KIND misconfigured. Must stay last.
        "react-native-worklets/plugin",
      ],
    };
  };
  