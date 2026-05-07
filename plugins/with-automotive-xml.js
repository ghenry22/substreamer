const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withAutomotiveXml = (config) => {
    return withDangerousMod(config, [
        'android',
        async (config) => {
            // 1. Locate the dynamic Android res/xml directory
            const resDirectory = path.join(
                config.modRequest.platformProjectRoot,
                'app/src/main/res/xml'
            );

            // 2. Ensure the 'xml' directory actually exists
            if (!fs.existsSync(resDirectory)) {
                fs.mkdirSync(resDirectory, { recursive: true });
            }

            // 3. Define the exact XML payload Google requires for music apps
            const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<automotiveApp>
    <uses name="media"/>
</automotiveApp>`;

            // 4. Write the file to disk before the compilation step begins
            const filePath = path.join(resDirectory, 'automotive_app_desc.xml');
            fs.writeFileSync(filePath, xmlContent);

            return config;
        },
    ]);
};

module.exports = withAutomotiveXml;