import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAgEX6gSM10oX4L9HtL2krFL4rOrvGqgRU",
  authDomain: "despacho-1eef3.firebaseapp.com",
  projectId: "despacho-1eef3",
  storageBucket: "despacho-1eef3.firebasestorage.app",
  messagingSenderId: "51256065309",
  appId: "1:51256065309:web:6b3584573524a3315d75f4"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const ADMIN_EMAIL = "admin@despacho.com";
