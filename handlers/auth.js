// ARQUIVO: handlers/auth.js
// RESPONSABILIDADE: Lógica de autenticação (Login, Registo).

import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { auth } from '../firebase.js'; // Ajuste o caminho conforme a estrutura do seu projeto
import { showToast } from '../utils.js'; // Ajuste o caminho conforme a estrutura do seu projeto

/**
 * Lida com a submissão do formulário de login.
 * @param {Event} e - O evento de submissão do formulário.
 */
export async function handleLogin(e) {
    e.preventDefault();
    try {
        // Assume que os IDs 'login-email' e 'login-password' existem no HTML
        const emailInput = document.getElementById('login-email');
        const passwordInput = document.getElementById('login-password');
        
        if (!emailInput || !passwordInput) {
            console.error("Elementos do formulário de login não encontrados.");
            showToast("Erro interno. Contacte o suporte.");
            return;
        }

        const email = emailInput.value;
        const password = passwordInput.value;
        await signInWithEmailAndPassword(auth, email, password);
        // O onAuthStateChanged no main.js cuidará de mostrar o conteúdo principal
    } catch (error) {
        console.error("Erro de Login:", error);
        showToast("Email ou senha inválidos.");
    }
}

/**
 * Lida com a submissão do formulário de registo.
 * @param {Event} e - O evento de submissão do formulário.
 */
export async function handleRegister(e) {
    e.preventDefault();
    try {
        // Assume que os IDs 'register-email' e 'register-password' existem no HTML
        const emailInput = document.getElementById('register-email');
        const passwordInput = document.getElementById('register-password');

        if (!emailInput || !passwordInput) {
            console.error("Elementos do formulário de registo não encontrados.");
            showToast("Erro interno. Contacte o suporte.");
            return;
        }

        const email = emailInput.value;
        const password = passwordInput.value;
        await createUserWithEmailAndPassword(auth, email, password);
        // O onAuthStateChanged no main.js cuidará de mostrar o conteúdo principal
    } catch (error) {
        console.error("Erro de Registo:", error);
        showToast(getAuthErrorMessage(error.code));
    }
}

/**
 * Retorna uma mensagem de erro amigável para o utilizador com base no código de erro do Firebase Auth.
 * @param {string} code - O código de erro do Firebase (ex: 'auth/email-already-in-use').
 * @returns {string} - A mensagem de erro traduzida.
 */
export function getAuthErrorMessage(code) {
    switch (code) {
        case 'auth/email-already-in-use':
            return "Este email já está a ser utilizado por outra conta.";
        case 'auth/weak-password':
            return "A senha é muito fraca. Use pelo menos 6 caracteres.";
        case 'auth/invalid-email':
            return "O formato do email fornecido é inválido.";
        case 'auth/operation-not-allowed':
            return "Registo com email/senha não está ativado.";
        case 'auth/user-not-found': // Erro comum no login
        case 'auth/wrong-password': // Erro comum no login
            return "Email ou senha inválidos.";
        default:
            console.error("Código de erro Auth não reconhecido:", code);
            return "Ocorreu um erro durante a autenticação. Tente novamente.";
    }
}

