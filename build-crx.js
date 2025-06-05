const { Crx } = require('crx');
const path = require('path');
const fs = require('fs');

async function buildCrx() {
  const outputDir = path.join(__dirname, 'dist');
  const crxOutput = path.join(__dirname, 'extension.crx');

  const pemBase64 = process.env.EXTENSION_KEY_BASE64;
  let keyBuffer;

  if (pemBase64) {
    try {
      keyBuffer = Buffer.from(pemBase64, 'base64');
    } catch (err) {
      console.error('Invalid EXTENSION_KEY_BASE64. Must be base64-encoded PEM.');
      process.exit(1);
    }
  }

  const crx = new Crx({ key: keyBuffer });

  try {
    await crx.load(outputDir);
    const crxBuffer = await crx.pack();
    fs.writeFileSync(crxOutput, crxBuffer);
  } catch (err) {
    console.error('Failed to build CRX:', err);
    process.exit(1);
  }

  if (!pemBase64) {
    const newKeyBase64 = crx.key.toString('base64');
    console.warn('\nNo EXTENSION_KEY_BASE64 was set.');
    console.warn('To make future builds consistent, store this as a GitHub secret named EXTENSION_KEY_BASE64:\n');
    console.warn(newKeyBase64);
  } else {
    console.log('✅ Built extension.crx using provided key.');
  }
}

buildCrx().catch(err => {
  console.error(err);
  process.exit(1);
});
