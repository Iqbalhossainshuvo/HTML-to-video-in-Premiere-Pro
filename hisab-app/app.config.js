/*
 * Google sign-in needs OAuth client IDs from Google Cloud (see README).
 * They are read from environment variables so no secret lives in the repo:
 *   GOOGLE_WEB_CLIENT_ID   – "Web application" client (optional on Android)
 *   GOOGLE_IOS_CLIENT_ID   – "iOS" client (needed only for iPhone builds)
 */
const iosClientId = process.env.GOOGLE_IOS_CLIENT_ID || '';
// com.googleusercontent.apps.XXXX – the reversed iOS client id
const iosUrlScheme = iosClientId ? iosClientId.split('.').reverse().join('.') : '';

module.exports = {
  expo: {
    name: 'হিসাব খাতা',
    slug: 'hisab-khata',
    scheme: 'hisabkhata',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    backgroundColor: '#F2F2F7',
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.iqbalhossain.hisabkhata',
      buildNumber: '1',
    },
    android: {
      package: 'com.iqbalhossain.hisabkhata',
      versionCode: 1,
      adaptiveIcon: {
        backgroundColor: '#0A84FF',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      blockedPermissions: [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.RECORD_AUDIO',
      ],
    },
    web: { favicon: './assets/favicon.png' },
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#0A84FF',
    },
    plugins: [
      'expo-router',
      ...(iosUrlScheme ? [['@react-native-google-signin/google-signin', { iosUrlScheme }]] : []),
    ],
    experiments: { typedRoutes: false },
    extra: {
      googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID || '',
      googleIosClientId: iosClientId,
    },
  },
};
