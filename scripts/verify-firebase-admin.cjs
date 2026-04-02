/**
 * Loads env from parent process (e.g. dotenv-cli -e .env.local).
 * Does not print secrets; only OK/FAIL and error messages.
 */
const { cert, getApps, initializeApp } = require("firebase-admin/app");

function getPrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  if (!key) throw new Error("Missing FIREBASE_PRIVATE_KEY");
  return key.replace(/\\n/g, "\n");
}

function effectiveProjectId() {
  return (
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
    ""
  );
}

function effectiveStorageBucket() {
  return (
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ||
    ""
  );
}

function hasEnv() {
  return !!(
    effectiveProjectId() &&
    process.env.FIREBASE_CLIENT_EMAIL?.trim() &&
    process.env.FIREBASE_PRIVATE_KEY?.trim() &&
    effectiveStorageBucket()
  );
}

(async () => {
  if (!hasEnv()) {
    console.error(
      "FAIL: Missing project id (FIREBASE_PROJECT_ID or NEXT_PUBLIC_FIREBASE_PROJECT_ID), FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, or storage bucket (FIREBASE_STORAGE_BUCKET or NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)",
    );
    process.exit(1);
  }

  const pk = getPrivateKey();
  const pemOk =
    pk.includes("BEGIN PRIVATE KEY") && pk.includes("END PRIVATE KEY");
  if (!pemOk) {
    console.error(
      "FAIL: FIREBASE_PRIVATE_KEY is not PEM-shaped (use quoted value with \\n for newlines in .env.local)",
    );
    process.exit(1);
  }

  try {
    for (const a of getApps()) {
      a.delete();
    }
  } catch {
    // ignore
  }

  try {
    const credential = cert({
      projectId: effectiveProjectId(),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: pk,
    });
    initializeApp({
      credential,
      storageBucket: effectiveStorageBucket(),
    });
    await credential.getAccessToken();
    console.log(
      "OK: Env vars present, PEM shape OK, service account token issued (private key accepted by Google)",
    );
  } catch (e) {
    console.error("FAIL:", e && e.message ? e.message : e);
    process.exit(1);
  }
})();
