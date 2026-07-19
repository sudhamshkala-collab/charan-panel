import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB_WcTQNPffOAi8-b5B0dQoVBUauPycnTk",
  authDomain: "jeedimetla-charan.firebaseapp.com",
  projectId: "jeedimetla-charan",
  storageBucket: "jeedimetla-charan.firebasestorage.app",
  messagingSenderId: "610581844088",
  appId: "1:610581844088:web:20b5ab3ff8aad3cc61dd8d",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };
