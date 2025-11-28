
// =================================================================================
// ARQUIVO: auth.js

import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { showAlert, showToast } from './utils.js';
import { auth } from './firebase.js';
import { dom } from './state.js';

/**
 * Funções de exibição das telas de login/registro.
 */
const showLoginView = () => {
    dom.registerView.classList.add('hidden');
    dom.loginView.classList.remove('hidden');
    // Limpa os formulários ao trocar de tela
    if(dom.registerForm) dom.registerForm.reset();
    if(dom.loginForm) dom.loginForm.reset();
};

const showRegisterView = () => {
    dom.loginView.classList.add('hidden');
    dom.registerView.classList.remove('hidden');
    if(dom.registerForm) dom.registerForm.reset();
    if(dom.loginForm) dom.loginForm.reset();
};

/**
 * Lida com a submissão do formulário de login.
 */
async function handleLogin(e) {
    e.preventDefault();
    try {
        await signInWithEmailAndPassword(auth, document.getElementById('login-email').value, document.getElementById('login-password').value);
        // O redirecionamento acontece no listener onAuthStateChanged no main.js
    } catch (error) {
        console.error("Erro de Login:", error);
        showAlert("Email ou senha inválidos.");
    }
}

/**
 * Lida com a submissão do formulário de registro.
 * AGORA COM VERIFICAÇÃO DE EMAIL.
 */
async function handleRegister(e) {
    e.preventDefault();
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;

    try {
        // 1. Cria o usuário
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // 2. Envia o email de verificação
        await sendEmailVerification(user);

        // 3. Alerta o usuário
        showAlert(`Conta criada com sucesso! Enviamos um link de confirmação para ${email}. Por favor, verifique sua caixa de entrada (e spam) antes de fazer login.`);

        // 4. Desloga imediatamente para impedir acesso sem verificação
        await signOut(auth);

        // 5. Volta para a tela de login
        showLoginView();

    } catch (error) {
        console.error("Erro de Registo:", error);
        showAlert(getAuthErrorMessage(error.code));
    }
}

/**
 * Retorna uma mensagem de erro amigável para autenticação.
 */
function getAuthErrorMessage(code) {
    switch (code) {
        case 'auth/email-already-in-use': return "Este email já está a ser utilizado.";
        case 'auth/weak-password': return "A sua senha é muito fraca (mínimo 6 caracteres).";
        case 'auth/invalid-email': return "O formato do email é inválido.";
        default: return "Erro ao criar a conta. Tente novamente.";
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
