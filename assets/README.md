# Assets Directory

This directory should contain your app's icon and splash screen assets.

## Required Files

For the app to work properly in production, you need:

### 1. App Icon
- **File**: `icon.png`
- **Size**: 1024 x 1024 pixels
- **Format**: PNG with transparency
- **Purpose**: Used for app icon on iOS and Android

### 2. Splash Screen
- **File**: `splash.png`
- **Size**: 1242 x 2436 pixels (iPhone max size)
- **Format**: PNG
- **Purpose**: Loading screen when app starts

### 3. Android Adaptive Icon
- **File**: `adaptive-icon.png`
- **Size**: 1024 x 1024 pixels
- **Format**: PNG with transparency
- **Purpose**: Android adaptive icon (safe area in center)

## For Development

These assets are **optional during development**. The app will work in Expo Go without them.

## Creating Icons

### Quick Option
Use free tools to generate icons:
- https://www.appicon.co
- https://makeappicon.com
- https://icon.kitchen

### Manual Creation
1. Create a 1024x1024 PNG image
2. Use your app logo or a simple colored square
3. Save as `icon.png` in this directory

## Re-enabling Assets

Once you have the assets, update `app.json`:

```json
{
  "expo": {
    "icon": "./assets/icon.png",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#000000"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#000000"
      }
    }
  }
}
```

## Testing

The app works fine without these assets in development. You only need them for:
- Building standalone apps (with `eas build`)
- Publishing to app stores
- Custom branding

