// =================================================================================
// ARQUIVO: module-auth.js (NOVO ARQUIVO)
// RESPONSABILIDADE: Gerenciar todo o fluxo de autenticação,
// incluindo listeners de formulário, troca de telas de login/registro
// e o observador principal onAuthStateChanged.
// =================================================================================

// --- MÓDULOS IMPORTADOS ---
import { 
    onAuthStateChanged, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { auth } from './firebase.js';
import { dom } from './state.js';
import { showToast } from './utils.js';

// --- FUNÇÕES DE UI (Movidas de ui.js) ---

/**
 * Mostra a tela de login e esconde a de registro.
 */
const showLoginView = () => {
    dom.registerView.classList.add('hidden');
    dom.loginView.classList.remove('hidden');
};

/**
 * Mostra a tela de registro e esconde a de login.
 */
const showRegisterView = () => {
    dom.loginView.classList.add('hidden');
    dom.registerView.classList.remove('hidden');
};

// --- FUNÇÕES DE LÓGICA (Movidas de main.js) ---

/**
 * Tenta registrar um novo usuário.
 * @param {Event} e - O evento de submit do formulário.
 */
async function handleRegister(e) { 
    e.preventDefault(); 
    try { 
        // Busca os valores dentro do formulário de registro
        const email = dom.registerForm.querySelector('#register-email').value;
        const password = dom.registerForm.querySelector('#register-password').value;
        
        await createUserWithEmailAndPassword(auth, email, password); 
        // O onAuthStateChanged vai lidar com o sucesso automaticamente
    } catch (error) { 
        console.error("Erro de Registo:", error); 
        showToast(getAuthErrorMessage(error.code));
    }
}

/**
 * Tenta logar um usuário existente.
 * @param {Event} e - O evento de submit do formulário.
 */
async function handleLogin(e) { 
    e.preventDefault(); 
    try { 
        // Busca os valores dentro do formulário de login
        const email = dom.loginForm.querySelector('#login-email').value;
        const password = dom.loginForm.querySelector('#login-password').value;

        await signInWithEmailAndPassword(auth, email, password); 
        // O onAuthStateChanged vai lidar com o sucesso automaticamente
    } catch (error) { 
        console.error("Erro de Login:", error); 
        showToast("Email ou senha inválidos."); 
    } 
}

/**
 * Lida com o clique no botão de logout.
 */
function handleLogout() {
    signOut(auth);
}

/**
 * Converte códigos de erro do Firebase Auth em mensagens amigáveis.
 * @param {string} code - O código de erro.
 * @returns {string} A mensagem para o usuário.
 */
function getAuthErrorMessage(code) {
    switch (code) {
        case 'auth/email-already-in-use': return "Este email já está a ser utilizado.";
        case 'auth/weak-password': return "A sua senha é muito fraca.";
        default: return "Erro ao criar a conta.";
    }
}

// --- FUNÇÃO PÚBLICA DE INICIALIZAÇÃO ---

/**
 * Inicializa o módulo de autenticação.
 * Esta é a única função exportada que o main.js irá chamar.
 * * @param {function} onLogin - Callback a ser executada no login (recebe 'user').
 * @param {function} onLogout - Callback a ser executada no logout.
 */
export function initAuth(onLogin, onLogout) {
    
    // 1. Configura o observador principal do Firebase
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // --- Usuário está LOGADO ---
            
            // Atualiza a UI principal
            dom.loginScreen.classList.add('hidden');
            dom.mainContent.classList.remove('hidden');
            dom.userProfile.classList.remove('hidden');
            dom.userEmail.textContent = user.email || `Utilizador: ${user.uid.substring(0, 8)}`;
            
            // Chama a callback de sucesso (passada pelo main.js)
            // É o main.js que vai decidir o que carregar (dados, listeners, etc.)
            onLogin(user);

        } else {
            // --- Usuário está DESLOGADO ---
            
            // Atualiza a UI principal
            dom.mainContent.classList.add('hidden');
            dom.userProfile.classList.add('hidden');
            dom.loginScreen.classList.remove('hidden');
            
            // Chama a callback de logout (passada pelo main.js)
            // É o main.js que vai decidir o que limpar (listeners, estado, etc.)
            onLogout();
        }
    });

    // 2. Configura os listeners dos formulários e botões de autenticação
    dom.loginForm.addEventListener('submit', handleLogin);
    dom.registerForm.addEventListener('submit', handleRegister);
    dom.logoutBtn.addEventListener('click', handleLogout);
    
    // Listeners para trocar entre as telas de login e registro
    dom.showRegisterViewBtn.addEventListener('click', showRegisterView);
    dom.showLoginViewBtn.addEventListener('click', showLoginView);
    
    console.log("Módulo de Autenticação (module-auth.js) inicializado.");
}

