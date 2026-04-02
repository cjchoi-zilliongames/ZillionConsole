import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseApp } from "./firebase-admin";

export function getFirestoreDb() {
  const app = getFirebaseApp();
  return getFirestore(app);
}
