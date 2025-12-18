
// ARQUIVO: firebase.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// Configuração padrão que serve como fallback caso a configuração dinâmica não seja fornecida.
const firebaseConfig = {
    apiKey: "AIzaSyCDWtwnD_3V9En9qEEYtlP_dpOTvt-P9ks",
    authDomain: "acompanhamento-vida-escolar.firebaseapp.com",
    projectId: "acompanhamento-vida-escolar",
    // CORREÇÃO: O bucket criado no console usa o domínio .firebasestorage.app
    storageBucket: "acompanhamento-vida-escolar.firebasestorage.app",
    messagingSenderId: "315669308837",
    appId: "1:315669308837:web:053497df9ceea4df5c4c9c"
};

// As variáveis são inicializadas como nulas para garantir que sempre tenham um valor definido.
let app = null;
let auth = null;
let db = null;
let storage = null;

try {
    // Tenta obter a configuração injetada (dinâmica). Se não existir ou for inválida, usa a configuração padrão (fallback).
    const finalConfig = (typeof __firebase_config !== 'undefined' && __firebase_config)
        ? JSON.parse(__firebase_config)
        : firebaseConfig;

    // Verifica se a configuração final é válida antes de tentar inicializar o Firebase.
    if (finalConfig && finalConfig.apiKey) {
        app = initializeApp(finalConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        storage = getStorage(app);
    } else {
        // Se a configuração for inválida, lança um erro para ser capturado pelo bloco 'catch'.
        throw new Error("A configuração do Firebase é inválida ou está em falta.");
    }
} catch (error) {
    // Se qualquer parte da inicialização falhar, este bloco será executado.
    console.error("Falha ao inicializar o Firebase:", error);

    // Exibe uma mensagem de erro clara e visível para o utilizador.
    document.body.innerHTML = `<div style="padding: 2rem; text-align: center; color: #b91c1c; background-color: #fee2e2; font-family: sans-serif; height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center;">
        <h1 style="font-size: 1.5rem; font-weight: bold;">Erro Crítico na Aplicação</h1>
        <p style="margin-top: 0.5rem;">Não foi possível conectar aos serviços necessários (Firebase).</p>
        <p style="margin-top: 0.2rem;">A aplicação não pode continuar.</p>
        <p style="margin-top: 1rem; font-size: 0.875rem; color: #7f1d1d;">Por favor, verifique a consola do navegador para mais detalhes técnicos.</p>
    </div>`;
}

// Exporta as instâncias do Firebase.
export { app, auth, db, storage, firebaseConfig };
