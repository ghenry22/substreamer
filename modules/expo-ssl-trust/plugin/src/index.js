const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo config plugin for expo-ssl-trust.
 *
 * Android: Generates a network_security_config.xml that trusts user-installed
 * certificates in addition to system CAs. This provides a fallback for any
 * networking layers that bypass our custom OkHttpClientFactory.
 *
 * iOS: No config changes needed — the custom URLProtocol handles trust.
 */
function withSslTrust(config) {
  // Step 1: Create network_security_config.xml
  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const resXmlDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "xml"
      );

      // Ensure the xml directory exists
      if (!fs.existsSync(resXmlDir)) {
        fs.mkdirSync(resXmlDir, { recursive: true });
      }

      const networkSecurityConfig = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Default configuration: trust system CAs -->
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
            <!-- Trust user-installed CA certificates (for self-signed server certs) -->
            <certificates src="user" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;

      const configPath = path.join(resXmlDir, "network_security_config.xml");
      fs.writeFileSync(configPath, networkSecurityConfig, "utf8");

      return config;
    },
  ]);

  // Step 2: Reference network_security_config.xml in AndroidManifest.xml
  config = withAndroidManifest(config, async (config) => {
    const manifest = config.modResults;
    const application = manifest.manifest.application?.[0];

    if (application) {
      application.$["android:networkSecurityConfig"] =
        "@xml/network_security_config";
    }

    return config;
  });

  return config;
}

module.exports = withSslTrust;
