// Layers a build "variant" on top of app.json so the development build installs
// as a SEPARATE app ("Pocket Police (dev)") alongside the standalone one.
// APP_VARIANT is set per EAS build profile (see eas.json).
const base = require('./app.json').expo;

const variant = process.env.APP_VARIANT || 'production';
const isDev = variant === 'development';

module.exports = {
  ...base,
  name: isDev ? 'Pocket Police (dev)' : 'Pocket Police',
  // Distinct deep-link scheme so the two apps don't fight over vasulibhai:// links.
  scheme: isDev ? 'vasulibhaidev' : 'vasulibhai',
  ios: {
    ...base.ios,
    bundleIdentifier: isDev ? 'com.vasulibhai.app.dev' : 'com.vasulibhai.app',
  },
  android: {
    ...base.android,
    package: isDev ? 'com.vasulibhai.app.dev' : 'com.vasulibhai.app',
  },
};
