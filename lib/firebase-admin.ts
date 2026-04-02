import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

function effectiveProjectId(): string | undefined {
  return (
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
    undefined
  );
}

function effectiveStorageBucket(): string | undefined {
  return (
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ||
    undefined
  );
}

export function hasEnvFirebaseConfig(): boolean {
  return !!(
    effectiveProjectId() &&
    process.env.FIREBASE_CLIENT_EMAIL?.trim() &&
    process.env.FIREBASE_PRIVATE_KEY?.trim() &&
    effectiveStorageBucket()
  );
}

function getPrivateKey(): string {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  if (!key) {
    throw new Error("Missing FIREBASE_PRIVATE_KEY");
  }
  return key.replace(/\\n/g, "\n");
}

export function getFirebaseApp(): App {
  if (!hasEnvFirebaseConfig()) {
    throw new Error("NOT_CONFIGURED");
  }

  const existing = getApps()[0];
  if (existing) return existing;

  const projectId = effectiveProjectId()!;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL!;
  const storageBucket = effectiveStorageBucket()!;

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey: getPrivateKey(),
    }),
    storageBucket,
  });
}

export function getSpecBucket() {
  const app = getFirebaseApp();
  const name =
    effectiveStorageBucket() ?? app.options.storageBucket;
  if (!name) {
    throw new Error("NOT_CONFIGURED");
  }
  return getStorage(app).bucket(name);
}
