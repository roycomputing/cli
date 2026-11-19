import { createHash } from "node:crypto";

const certificateSuffix = "-cert-v01@openssh.com";
const certificateFields = new Map([
  ["ssh-ed25519", 1],
  ["ssh-rsa", 2],
  ["ssh-dss", 4],
  ["ecdsa-sha2-nistp256", 2],
  ["ecdsa-sha2-nistp384", 2],
  ["ecdsa-sha2-nistp521", 2],
  ["sk-ssh-ed25519", 2],
  ["sk-ecdsa-sha2-nistp256", 3],
]);

function fieldEnd(blob: Buffer, start: number): number {
  const end = start + 4 + blob.readUInt32BE(start);
  if (end > blob.length) {
    throw new Error("Incomplete SSH key field.");
  }
  return end;
}

// OpenSSH fingerprints the underlying public key of a certificate, excluding its nonce and signature.
function certifiedKey(type: string, blob: Buffer, typeEnd: number): Buffer {
  const base = type.slice(0, -certificateSuffix.length);
  const count = certificateFields.get(base);
  if (count === undefined) {
    throw new Error("Unknown SSH certificate type.");
  }
  const start = fieldEnd(blob, typeEnd);
  let end = start;
  for (let i = 0; i < count; i++) {
    end = fieldEnd(blob, end);
  }
  const name = Buffer.from(base.startsWith("sk-") ? base + "@openssh.com" : base);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(name.length);
  return Buffer.concat([length, name, blob.subarray(start, end)]);
}

export function sshFingerprint(key: string): string | null {
  const [type, encoded] = key.split(/\s+/u);
  if (!type || !encoded) {
    return null;
  }
  try {
    const blob = Buffer.from(atob(encoded), "latin1");
    const typeEnd = fieldEnd(blob, 0);
    if (blob.subarray(4, typeEnd).toString() !== type) {
      return null;
    }
    const bytes = type.endsWith(certificateSuffix) ? certifiedKey(type, blob, typeEnd) : blob;
    return "SHA256:" + createHash("sha256").update(bytes).digest("base64").replace(/=+$/u, "");
  } catch {
    return null;
  }
}
