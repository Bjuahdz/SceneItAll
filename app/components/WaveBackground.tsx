import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import {
  Canvas,
  Shader,
  Skia,
  vec,
  Fill,
} from '@shopify/react-native-skia';
import { useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Wave shader with dithering
const fragmentShader = `
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_waveSpeed;
uniform float u_waveFrequency;
uniform float u_waveAmplitude;
uniform vec4 u_waveColor;
uniform float u_colorNum;
uniform float u_pixelSize;

// Noise functions
vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec2 fade(vec2 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

float cnoise(vec2 P) {
  vec4 Pi = floor(P.xyxy) + vec4(0.0,0.0,1.0,1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0,0.0,1.0,1.0);
  Pi = mod289(Pi);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = fract(i * (1.0/41.0)) * 2.0 - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x, gy.x);
  vec2 g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z);
  vec2 g11 = vec2(gx.w, gy.w);
  vec4 norm = taylorInvSqrt(vec4(dot(g00,g00), dot(g01,g01), dot(g10,g10), dot(g11,g11)));
  g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
}

// FBM (Fractal Brownian Motion)
float fbm(vec2 p) {
  float value = 0.0;
  float amp = 1.0;
  float freq = u_waveFrequency;
  for (int i = 0; i < 8; i++) {
    value += amp * abs(cnoise(p));
    p *= freq;
    amp *= u_waveAmplitude;
  }
  return value;
}

// Wave pattern
float pattern(vec2 p) {
  vec2 p2 = p - u_time * u_waveSpeed;
  return fbm(p - fbm(p + fbm(p2)));
}

// Dithering function using a procedural approach instead of a lookup table
float getDitherValue(vec2 coord) {
  float x = mod(coord.x, 8.0);
  float y = mod(coord.y, 8.0);
  
  // Simplified dithering pattern
  float value = 0.0;
  if (x < 4.0) {
    if (y < 4.0) {
      value = 0.0;
    } else {
      value = 0.5;
    }
  } else {
    if (y < 4.0) {
      value = 0.75;
    } else {
      value = 0.25;
    }
  }
  
  // Add some noise to break up the pattern
  value += cnoise(coord * 0.1) * 0.1;
  
  return value;
}

// Dithering function
vec3 dither(vec2 uv, vec3 color) {
  vec2 scaledCoord = floor(uv * u_resolution / u_pixelSize);
  float ditherValue = getDitherValue(scaledCoord);
  float step = 1.0 / (u_colorNum - 1.0);
  color += (ditherValue - 0.5) * step;
  float bias = 0.2;
  color = clamp(color - bias, 0.0, 1.0);
  return floor(color * (u_colorNum - 1.0) + 0.5) / (u_colorNum - 1.0);
}

half4 main(vec2 fragCoord) {
  vec2 uv = fragCoord / u_resolution.xy;
  uv -= 0.5;
  uv.x *= u_resolution.x / u_resolution.y;
  
  float f = pattern(uv);
  vec3 col = mix(vec3(0.0), u_waveColor.rgb, f);
  
  // Apply dithering
  col = dither(fragCoord, col);
  
  return half4(col, u_waveColor.a);
}
`;

// Create shader effect
const shader = Skia.RuntimeEffect.Make(fragmentShader);

interface WaveBackgroundProps {
  backgroundColor?: string;
  waveSpeed?: number;
  waveFrequency?: number;
  waveAmplitude?: number;
  waveColor?: string;
  colorNum?: number;
  pixelSize?: number;
}

export default function WaveBackground({
  backgroundColor = 'rgba(0, 0, 0, 0.85)',
  waveSpeed = 0.05,
  waveFrequency = 3,
  waveAmplitude = 0.3,
  waveColor = '#9ccadf',
  colorNum = 4,
  pixelSize = 2,
}: WaveBackgroundProps) {
  // Animation value
  const time = useSharedValue(0);

  // Convert hex color to RGB
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16) / 255,
      parseInt(result[2], 16) / 255,
      parseInt(result[3], 16) / 255,
      0.8
    ] : [0.612, 0.792, 0.875, 0.8]; // Default to #9ccadf
  };

  // Start animation
  React.useEffect(() => {
    time.value = withRepeat(
      withTiming(10, { duration: 5000 }),
      -1,
      true
    );
  }, []);

  if (!shader) {
    return null;
  }

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <Canvas style={styles.canvas}>
        <Fill>
          <Shader
            source={shader}
            uniforms={{
              u_resolution: vec(SCREEN_WIDTH, SCREEN_HEIGHT),
              u_time: time.value,
              u_waveSpeed: waveSpeed,
              u_waveFrequency: waveFrequency,
              u_waveAmplitude: waveAmplitude,
              u_waveColor: hexToRgb(waveColor),
              u_colorNum: colorNum,
              u_pixelSize: pixelSize,
            }}
          />
        </Fill>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  canvas: {
    flex: 1,
  },
}); 