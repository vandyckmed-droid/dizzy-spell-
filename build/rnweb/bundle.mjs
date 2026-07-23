import esbuild from 'esbuild';
import path from 'node:path';
const R = p => path.resolve(p);
await esbuild.build({
  entryPoints: ['build/rnweb/entry.js'],
  bundle: true,
  outfile: 'build/rnweb/out.js',
  format: 'iife',
  loader: { '.js': 'jsx', '.json': 'json' },
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"', '__DEV__': 'true', 'process.env.EXPO_OS':'"web"' },
  alias: {
    'react-native': 'react-native-web',
    'expo-haptics': R('build/rnweb/stubs/haptics.js'),
    'expo-status-bar': R('build/rnweb/stubs/statusbar.js'),
    '@react-native-async-storage/async-storage': R('build/rnweb/stubs/asyncstorage.js'),
    'react-native-safe-area-context': R('build/rnweb/stubs/safearea.js'),
    'react-native-svg': R('build/rnweb/stubs/svg.js'),
  },
  logLevel: 'info',
});
console.log('bundled build/rnweb/out.js');
