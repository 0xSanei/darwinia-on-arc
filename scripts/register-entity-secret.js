// Register Circle Entity Secret manually (bypass SDK due to 400 issue).
// Flow:
//   1. GET https://api.circle.com/v1/w3s/config/entity/publicKey
//   2. Generate 32-byte hex Entity Secret
//   3. RSA-OAEP-SHA256 encrypt Entity Secret with Circle's public key
//   4. POST https://api.circle.com/v1/w3s/config/entity/entitySecret
//      body: { entitySecretCiphertext: <base64> }
//   5. Save recovery file from response
//
// Run once per API key. Output prints the plaintext secret — paste into .env.local.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const apiKey = envContent
  .split('\n')
  .find((l) => l.startsWith('CIRCLE_API_KEY='))
  ?.split('=')[1]
  ?.trim();

if (!apiKey) {
  console.error('ERROR: CIRCLE_API_KEY not found in .env.local');
  process.exit(1);
}

async function main() {
  // Step 1: fetch Circle's public key
  console.log('Step 1: fetching Circle public key...');
  const pkRes = await fetch('https://api.circle.com/v1/w3s/config/entity/publicKey', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!pkRes.ok) {
    console.error(`GET publicKey failed: ${pkRes.status} ${pkRes.statusText}`);
    console.error(await pkRes.text());
    process.exit(1);
  }
  const pkData = await pkRes.json();
  const publicKey = pkData.data.publicKey;
  console.log('  ok, got RSA public key (length:', publicKey.length, ')');

  // Step 2: generate 32-byte entity secret
  const entitySecret = crypto.randomBytes(32).toString('hex');
  console.log('Step 2: generated Entity Secret:', entitySecret);

  // Step 3: encrypt with RSA-OAEP-SHA256
  console.log('Step 3: encrypting with RSA-OAEP-SHA256...');
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKey,
      oaepHash: 'sha256',
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    },
    Buffer.from(entitySecret, 'hex'),
  );
  const ciphertext = encrypted.toString('base64');
  console.log('  ciphertext length:', ciphertext.length);

  // Step 4: POST to register
  console.log('Step 4: POSTing entitySecretCiphertext...');
  const regRes = await fetch('https://api.circle.com/v1/w3s/config/entity/entitySecret', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ entitySecretCiphertext: ciphertext }),
  });
  const regText = await regRes.text();
  if (!regRes.ok) {
    console.error(`POST entitySecret failed: ${regRes.status} ${regRes.statusText}`);
    console.error(regText);
    process.exit(1);
  }
  const regData = JSON.parse(regText);
  console.log('  ok, registered.');
  console.log('  response:', JSON.stringify(regData, null, 2));

  // Step 5: save recovery file
  if (regData.data?.recoveryFile) {
    const recoveryPath = path.join(__dirname, '..', `recovery_file_${Date.now()}.dat`);
    fs.writeFileSync(recoveryPath, regData.data.recoveryFile);
    console.log('Step 5: recovery file saved to:', recoveryPath);
  } else {
    console.warn('Step 5: no recoveryFile in response — check manually');
  }

  // Step 6: write Entity Secret to .env.local
  console.log('\n=== DONE ===');
  console.log('Paste this into .env.local:');
  console.log(`CIRCLE_ENTITY_SECRET=${entitySecret}`);
  console.log('\nBack up the recovery_file_*.dat — it is the ONLY way to reset this secret.');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
