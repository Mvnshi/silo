/**
 * Silo iOS Share Extension target (built by @bacons/apple-targets during
 * `expo prebuild`). A lean native share sheet — it grabs the shared URL/text/
 * image, lets the user confirm + pick a category, then deep-links the payload
 * into the app (`silo://share?...`) where the SAME extractor + classify
 * pipeline runs (see app/share.tsx). The App Group lets the extension hand off
 * shared images via a file the app can read.
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = (config) => ({
  type: 'share',
  displayName: 'Add to Silo',
  // Must match the app's App Group (set in app.json ios.entitlements).
  entitlements: {
    'com.apple.security.application-groups': ['group.com.silo.app'],
  },
  deploymentTarget: '15.1',
});
