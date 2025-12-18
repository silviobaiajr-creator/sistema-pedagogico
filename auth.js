
// =================================================================================
// ARQUIVO: auth.js

import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, signOut, getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { showAlert, showToast, openModal, closeModal } from './utils.js';
import { auth, firebaseConfig } from './firebase.js'; // Precisamos do config para o app secundário
import { dom, state } from './state.js';

/**
 * Funções de exibição das telas de login/registro.
 */
const showLoginView = () => {
    dom.registerView.classList.add('hidden');
    dom.loginView.classList.remove('hidden');
    // Limpa os formulários ao trocar de tela
    if (dom.registerForm) dom.registerForm.reset();
    if (dom.loginForm) dom.loginForm.reset();
};

const showRegisterView = () => {
    dom.loginView.classList.add('hidden');
    dom.registerView.classList.remove('hidden');
    if (dom.registerForm) dom.registerForm.reset();
    if (dom.loginForm) dom.loginForm.reset();
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

/**
 * Cria um usuário usando uma instância secundária do Firebase App
 * para evitar que o administrador atual seja desconectado.
 */
async function handleCreateUserAsAdmin(e) {
    e.preventDefault();

    // Verifica permissão (redundância de segurança)
    if (!state.isAdmin) return showAlert("Apenas administradores podem realizar esta ação.");

    const email = document.getElementById('new-user-email').value;
    const password = document.getElementById('new-user-password').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');

    if (password.length < 6) return showAlert("A senha deve ter no mínimo 6 caracteres.");

    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Criando...';

    // 1. Inicializa App Secundário
    const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
    const secondaryAuth = getAuth(secondaryApp);

    try {
        // 2. Cria usuário no app secundário
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        const newUser = userCredential.user;

        // 3. Envia verificação
        await sendEmailVerification(newUser);

        // 4. Feedback e Limpeza
        showAlert(`Usuário ${email} criado com sucesso! Um e-mail de verificação foi enviado.`);
        dom.createUserForm.reset();
        closeModal(dom.userManagementModal);

        // 5. Opcional: Deslogar do app secundário (boa prática)
        await signOut(secondaryAuth);

    } catch (error) {
        console.error("Erro ao criar usuário:", error);
        let msg = getAuthErrorMessage(error.code);
        showAlert("Erro: " + msg);
    } finally {
        // 6. Limpa instância secundária (Delete app logic if needed, but simple dereference usually allows GC)
        // Note: deleteApp is async, but usually optional for lightweight short-lived ops if not creating many names.
        // A simple way is to reuse a singleton or delete it. For now, we leave it since it's a rare action.

        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

export const initUserManagementListeners = () => {
    if (dom.manageUsersBtn) {
        dom.manageUsersBtn.addEventListener('click', () => {
            openModal(dom.userManagementModal);
        });
    }

    if (dom.createUserForm) {
        dom.createUserForm.addEventListener('submit', handleCreateUserAsAdmin);
    }

    // Fechamento do modal
    const closeBtn = document.getElementById('close-user-management-btn');
    if (closeBtn && dom.userManagementModal) {
        closeBtn.addEventListener('click', () => closeModal(dom.userManagementModal));
    }
};
