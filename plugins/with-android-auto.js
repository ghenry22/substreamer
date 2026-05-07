const { withAndroidManifest } = require('@expo/config-plugins');

const withAndroidAutoManifest = (config) => {
    return withAndroidManifest(config, async (config) => {
        // config.modResults is the parsed AndroidManifest.xml as a JS object
        const androidManifest = config.modResults;

        // Target the <application> node
        const mainApplication = androidManifest.manifest.application[0];

        // Initialize the meta-data array if it doesn't exist yet
        if (!mainApplication['meta-data']) {
            mainApplication['meta-data'] = [];
        }

        // Check if we already injected it to avoid duplicates on rebuilds
        const hasAutoMeta = mainApplication['meta-data'].some(
            (meta) => meta.$['android:name'] === 'com.google.android.gms.car.application'
        );

        if (!hasAutoMeta) {
            // Inject the required Android Auto flag
            mainApplication['meta-data'].push({
                $: {
                    'android:name': 'com.google.android.gms.car.application',
                    'android:resource': '@xml/automotive_app_desc',
                },
            });
        }

        // 1. Initialize the services array if it doesn't exist
        if (!mainApplication.service) {
            mainApplication.service = [];
        }

        // 2. Register your new Kotlin Service
        mainApplication.service.push({
            $: {
                // Point this to the kotlinaudio service path!
                'android:name': 'com.doublesymmetry.kotlinaudio.service.MusicService',
                'android:exported': 'true',
            },
            'intent-filter': [
                {
                    action: [
                        // This is the action Media3 uses for Android Auto
                        { $: { 'android:name': 'android.media.browse.MediaBrowserService' } },
                    ],
                },
            ],
        });

        return config;
    });
};

module.exports = withAndroidAutoManifest;