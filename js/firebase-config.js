// Configuración de Firebase — proyecto nyxar-runas
// Generado a partir del bloque que copiaste en la consola de Firebase.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyASCvqvT2eaLSOXq3Og34R8E1D6Fv8WMqM",
  authDomain: "nyxar-runas.firebaseapp.com",
  projectId: "nyxar-runas",
  storageBucket: "nyxar-runas.firebasestorage.app",
  messagingSenderId: "45325571682",
  appId: "1:45325571682:web:4cf1633999a120984d633b"
};

export const ADMIN_EMAIL = "nyxar.sv@gmail.com";

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
