import sodium from 'libsodium-wrappers';

let initialized = false;

async function ensureReady() {
    if (!initialized) {
        await sodium.ready;
        initialized = true;
    }
}

// Encrypts plaintext using NaCl sealed-box with the repo's public key.
// GitHub requires this encoding before accepting secrets via the Actions API.
// Input: base64-encoded repo public key (from GitHub's public-key endpoint).
// Output: base64-encoded sealed ciphertext.
export async function sealForGitHub(plaintext: string, publicKeyB64: string): Promise<string> {
    await ensureReady();
    const pubKey = sodium.from_base64(publicKeyB64, sodium.base64_variants.ORIGINAL);
    const message = sodium.from_string(plaintext);
    const sealed = sodium.crypto_box_seal(message, pubKey);
    return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
}
