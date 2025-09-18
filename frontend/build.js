#!/usr/bin/env node

/**
 * Simple build script to replace environment variables in frontend files
 * This allows customization of API_BASE_URL during deployment
 */

const fs = require('fs');
const path = require('path');

// Get API_BASE_URL from environment or use default
const API_BASE_URL = process.env.API_BASE_URL || 'https://dkc-secretshare-api.dom-kirby-creative.workers.dev';

console.log(`Building frontend with API_BASE_URL: ${API_BASE_URL}`);

// Read the app.js file
const appJsPath = path.join(__dirname, 'app.js');
let appJsContent = fs.readFileSync(appJsPath, 'utf8');

// Replace the API_BASE_URL placeholder with the actual value
const apiUrlPattern = /const API_BASE_URL = \(typeof process[^;]+;/;
const replacement = `const API_BASE_URL = '${API_BASE_URL}';`;

if (apiUrlPattern.test(appJsContent)) {
    appJsContent = appJsContent.replace(apiUrlPattern, replacement);
    console.log('✅ API_BASE_URL updated in app.js');
} else {
    console.log('⚠️  API_BASE_URL pattern not found in app.js');
}

// Create dist directory if it doesn't exist
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir);
}

// Copy all files to dist directory with replacements
const filesToCopy = ['index.html', 'crypto.js', '_routes.json'];

// Copy app.js with replacements
fs.writeFileSync(path.join(distDir, 'app.js'), appJsContent);
console.log('✅ app.js copied to dist/');

// Copy other files as-is
filesToCopy.forEach(file => {
    const sourcePath = path.join(__dirname, file);
    const destPath = path.join(distDir, file);
    
    if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, destPath);
        console.log(`✅ ${file} copied to dist/`);
    } else {
        console.log(`⚠️  ${file} not found, skipping`);
    }
});

console.log(`\n🎉 Build complete! Files are in ./dist/`);
console.log(`📡 API calls will be made to: ${API_BASE_URL}`);