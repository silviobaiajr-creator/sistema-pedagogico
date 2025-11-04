// =================================================================================
// ARQUIVO: auth.js
// RESPONSABILIDADE: Gerenciar a lógica de autenticação (Login, Registro)
// e a UI da tela de login.
// =================================================================================

import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { showToast } from './utils.js';
import { auth } from './firebase.js';
import { dom } from './state.js';

/**
 * Funções de exibição das telas de login/registro.
 * (Movidas de ui.js)
 */
const showLoginView = () => {
    dom.registerView.classList.add('hidden');
    dom.loginView.classList.remove('hidden');
};

const showRegisterView = () => {
    dom.loginView.classList.add('hidden');
    dom.registerView.classList.remove('hidden');
};

/**
 * Lida com a submissão do formulário de login.
 * (Movido de main.js)
 */
async function handleLogin(e) {
    e.preventDefault();
    try {
        await signInWithEmailAndPassword(auth, document.getElementById('login-email').value, document.getElementById('login-password').value);
    } catch (error) {
        console.error("Erro de Login:", error);
        showToast("Email ou senha inválidos.");
    }
}

/**
 * Lida com a submissão do formulário de registro.
 * (Movido de main.js)
 */
async function handleRegister(e) {
    e.preventDefault();
    try {
        await createUserWithEmailAndPassword(auth, document.getElementById('register-email').value, document.getElementById('register-password').value);
    } catch (error) {
        console.error("Erro de Registo:", error);
        showToast(getAuthErrorMessage(error.code));
    }
}

/**
 * Retorna uma mensagem de erro amigável para autenticação.
 * (Movido de main.js)
 */
function getAuthErrorMessage(code) {
    switch (code) {
        case 'auth/email-already-in-use': return "Este email já está a ser utilizado.";
        case 'auth/weak-password': return "A sua senha é muito fraca.";
        default: return "Erro ao criar a conta.";
    }
}

/**
 * Função principal do módulo: anexa os listeners de eventos
 * aos elementos de autenticação.
 */
export const initAuthListeners = () => {
    // Referências diretas do objeto dom
    const { loginForm, registerForm, showRegisterViewBtn, showLoginViewBtn } = dom;

    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }
    if (showRegisterViewBtn) {
        showRegisterViewBtn.addEventListener('click', showRegisterView);
    }
    if (showLoginViewBtn) {
        showLoginViewBtn.addEventListener('click', showLoginView);
    }
};
