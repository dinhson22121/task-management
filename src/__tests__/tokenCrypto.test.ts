import { decrypt, encrypt } from '../lib/tokenCrypto';

describe('tokenCrypto', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const plaintext = 'super-secret-oauth-token-value';
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('produces ciphertext bytes that differ from the plaintext', () => {
    const plaintext = 'another-secret-value';
    const ciphertext = encrypt(plaintext);
    expect(Buffer.from(ciphertext).toString('utf8')).not.toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext on repeated calls (random IV)', () => {
    const plaintext = 'same-input';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
