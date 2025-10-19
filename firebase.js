// ARQUIVO: firebase.js
// Responsabilidade: Configurar e inicializar o Firebase.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCDWtwnD_3V9En9qEEYtlP_dpOTvt-P9ks",
    authDomain: "acompanhamento-vida-escolar.firebaseapp.com",
    projectId: "acompanhamento-vida-escolar",
    storageBucket: "acompanhamento-vida-escolar.appspot.com",
    messagingSenderId: "315669308837",
    appId: "1:315669308837:web:053497df9ceea4df5c4c9c"
};

// Configuração geral da escola
export const config = {
    schoolName: "EMEF. DILMA DOS SANTOS CARVALHO",
    city: "Cidade (Exemplo)"
};

// Inicializa e exporta os serviços do Firebase
const finalConfig = (typeof __firebase_config !== 'undefined' && __firebase_config !== '{}') 
    ? JSON.parse(__firebase_config) 
    : firebaseConfig;

let app, auth, db;

if (Object.keys(finalConfig).length < 2) {
    document.body.innerHTML = `<div class="p-8 text-center text-red-700 bg-red-100"><h1>Configuração Incompleta do Firebase</h1><p class="mt-2">A aplicação não pode ser iniciada.</p></div>`;
} else {
    app = initializeApp(finalConfig);
    auth = getAuth(app);
    db = getFirestore(app);
}

export { app, auth, db };

