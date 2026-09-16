import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB1rHvssYWryzEnqBiL3-bymlM2HSe9YL4",
  authDomain: "agrivision-84da7.firebaseapp.com",
  projectId: "agrivision-84da7",
  storageBucket: "agrivision-84da7.firebasestorage.app",
  messagingSenderId: "221566506121",
  appId: "1:221566506121:web:8347819dab07d763606258"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
