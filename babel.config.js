module.exports = function (api) {
    api.cache(true);
    return {
      presets: [
        ["babel-preset-expo", { jsxImportSource: "nativewind" }],
        "nativewind/babel",
      ],
      plugins: [
        // Must be last per Reanimated docs
        "react-native-reanimated/plugin",
      ],
    };
  };
  