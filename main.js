// =================================================================================
// ARQUIVO: main.js (REFATORADO)
// RESPONSABILIDADE: Ponto de entrada, autenticação, gerenciamento de estado
// de alto nível (troca de abas) e inicialização dos módulos de funcionalidade.
//
// ATUALIZAÇÃO (IMPRESSÃO):
// 1. Adicionada a função `handlePrintClick` para preparar o DOM antes de imprimir.
// 2. Modificada `setupModalCloseButtons` para usar `handlePrintClick` nos
//    botões de impressão, resolvendo o bug das páginas em branco.
// =================================================================================

// --- MÓDULOS IMPORTADOS ---

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebase/auth";
import { onSnapshot, query, writeBatch, doc, where, getDocs } from "https://www.gstatic.com/firebase/firestore";
import { auth, db } from './firebase.js';
import { state, dom, initializeDOMReferences } from './state.js';
import { showToast, closeModal, shareContent, openModal, loadScript } from './utils.js';
import { loadStudents, loadSchoolConfig, getCollectionRef, deleteRecord } from './firestore.js';

// Módulos de Funcionalidade
import { initAuthListeners } from './auth.js';
import { initSettingsListeners } from './settings.js';
import { initStudentListeners } from './students.js';
import { initOccurrenceListeners, renderOccurrences } from './occurrence.js'; // Novo
import { initAbsenceListeners, renderAbsences } from './absence.js';     // Novo

// Módulos de UI e Lógica (agora menores)
import { render } from './ui.js';
// import * as logic from './logic.js'; // logic.js agora é usado por absence.js

// --- INICIALIZAÇÃO DA APLICAÇÃO ---

document.addEventListener('DOMContentLoaded', () => {
    initializeDOMReferences();
    state.db = db;

    onAuthStateChanged(auth, async user => {
        detachFirestoreListeners();
        if (user) {
            state.userId = user.uid;
            state.userEmail = user.email;
            dom.userEmail.textContent = user.email || `Utilizador: ${user.uid.substring(0, 8)}`;
            dom.loginScreen.classList.add('hidden');
            dom.mainContent.classList.remove('hidden');
            dom.userProfile.classList.remove('hidden');
            try {
                await loadSchoolConfig();
                await loadStudents();
                dom.headerSchoolName.textContent = state.config.schoolName || 'Sistema de Acompanhamento';
                setupFirestoreListeners();
                render(); // Chama o render principal
            } catch (error) {
                showToast(error.message);
            }
        } else {
            state.userId = null; state.userEmail = null; state.students = []; state.occurrences = []; state.absences = [];
            dom.mainContent.classList.add('hidden');
            dom.userProfile.classList.add('hidden');
            dom.loginScreen.classList.remove('hidden');
            render();
        }
    });

    setupEventListeners();
});

// --- SINCRONIZAÇÃO COM O BANCO DE DADOS (FIRESTORE) ---

function setupFirestoreListeners() {
    if (!state.userId) return;

    // Listener de Ocorrências (agora chama renderOccurrences)
    const occurrencesQuery = query(getCollectionRef('occurrence'));
    state.unsubscribeOccurrences = onSnapshot(occurrencesQuery, (snapshot) => {
        state.occurrences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'occurrences') renderOccurrences(); // Chama o render específico
    }, (error) => console.error("Erro ao buscar ocorrências:", error));

    // Listener de Busca Ativa (agora chama renderAbsences)
    const absencesQuery = query(getCollectionRef('absence'));
    state.unsubscribeAbsences = onSnapshot(absencesQuery, (snapshot) => {
        state.absences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'absences') renderAbsences(); // Chama o render específico
    }, (error) => console.error("Erro ao buscar ações:", error));
};

function detachFirestoreListeners() {
    if (state.unsubscribeOccurrences) state.unsubscribeOccurrences();
    if (state.unsubscribeAbsences) state.unsubscribeAbsences();
    state.unsubscribeOccurrences = null;
    state.unsubscribeAbsences = null;
};

// --- CONFIGURAÇÃO CENTRAL DE EVENTOS DA UI ---

function setupEventListeners() {
    // Autenticação
    initAuthListeners();
    dom.logoutBtn.addEventListener('click', () => signOut(auth));

    // Navegação por Abas
    dom.tabOccurrences.addEventListener('click', () => switchTab('occurrences'));
    dom.tabAbsences.addEventListener('click', () => switchTab('absences'));

    // Fechar Modais (Genérico)
    setupModalCloseButtons();

    // --- INICIALIZAÇÃO DOS MÓDULOS DE FUNCIONALIDADE ---
    initSettingsListeners();
    initStudentListeners();
    initOccurrenceListeners(); // NOVO
    initAbsenceListeners();    // NOVO

    // Ações em Modais Genéricos (que permanecem aqui)
    document.getElementById('confirm-delete-btn').addEventListener('click', handleDeleteConfirmation);

    // Listener para fechar menus kebab
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.kebab-menu-container')) {
            document.querySelectorAll('.kebab-menu-dropdown').forEach(d => d.classList.add('hidden'));
            document.querySelectorAll('.process-content').forEach(c => {
                if (c.style.maxHeight && c.style.maxHeight !== '0px') {
                    c.style.overflow = 'hidden';
                }
            });
        }
    });
}

// --- HANDLERS E FUNÇÕES AUXILIARES (Genéricos) ---

function getFirestoreErrorMessage(code) {
    switch (code) {
        case 'permission-denied': return "Permissão negada. Verifique as suas credenciais.";
        case 'not-found': return "Documento não encontrado.";
        default: return "Ocorreu um erro na operação com a base de dados.";
    }
}

/**
 * Troca a aba ativa e chama o render principal do ui.js
 */
function switchTab(tabName) {
    state.activeTab = tabName;
    const isOccurrences = tabName === 'occurrences';
    dom.tabOccurrences.classList.toggle('tab-active', isOccurrences);
    dom.tabAbsences.classList.toggle('tab-active', !isOccurrences);
    dom.tabContentOccurrences.classList.toggle('hidden', !isOccurrences);
    dom.tabContentAbsences.classList.toggle('hidden', isOccurrences);
    render(); // O render do ui.js vai decidir qual função específica chamar
}

/**
 * Lida com a confirmação de exclusão (genérico).
 * Esta função é chamada pelos listeners em occurrence.js e absence.js
 */
async function handleDeleteConfirmation() {
    if (!state.recordToDelete) return;
    const { type, id } = state.recordToDelete;
    try {
        if (type === 'occurrence') {
            const q = query(getCollectionRef('occurrence'), where('occurrenceGroupId', '==', id));
            const querySnapshot = await getDocs(q);
            const batch = writeBatch(db);
            querySnapshot.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            showToast('Incidente e todos os registros associados foram excluídos.');
        } else if (type === 'absence-cascade') {
            const { ctId, analiseId } = state.recordToDelete;
            const batch = writeBatch(db);
            batch.delete(doc(getCollectionRef('absence'), ctId));
            if (analiseId) batch.delete(doc(getCollectionRef('absence'), analiseId));
            await batch.commit();
            showToast('Encaminhamento e Análise excluídos.');
        } else {
            await deleteRecord(type, id);
            showToast('Registro excluído com sucesso.');
        }
    } catch (error) { showToast('Erro ao excluir.'); console.error(error); } finally { state.recordToDelete = null; closeModal(dom.deleteConfirmModal); }
}


// ==============================================================================
// --- NOVA LÓGICA DE IMPRESSÃO (JavaScript Híbrido) ---
// ==============================================================================

/**
 * Prepara o DOM para impressão e limpa depois.
 * @param {string} contentElementId - O ID do elemento de conteúdo a ser impresso
 * (ex: 'notification-content', 'report-view-content').
 */
function handlePrintClick(contentElementId) {
    const contentElement = document.getElementById(contentElementId);
    if (!contentElement) {
        console.error("Elemento de impressão não encontrado:", contentElementId);
        showToast("Erro ao preparar documento para impressão.");
        return;
    }

    // 1. Adiciona classes de preparação ao body e ao conteúdo
    document.body.classList.add('is-printing');
    contentElement.classList.add('printing-content');

    // 2. Define a função de limpeza
    const cleanupAfterPrint = () => {
        document.body.classList.remove('is-printing');
        contentElement.classList.remove('printing-content');
        // Remove o próprio listener para não acumular
        window.removeEventListener('afterprint', cleanupAfterPrint);
    };

    // 3. Adiciona o listener para limpar *depois* da impressão
    window.addEventListener('afterprint', cleanupAfterPrint);

    // 4. Chama a impressão
    try {
        window.print();
        
        // Fallback: Se 'afterprint' não disparar (ex: usuário cancela),
        // um timeout curto pode remover as classes,
        // embora 'afterprint' seja o ideal.
        // Vamos confiar no 'afterprint' por enquanto para evitar
        // remover as classes *antes* da janela de impressão abrir.
        
    } catch (e) {
        console.error("Erro ao chamar window.print():", e);
        showToast("Não foi possível abrir a janela de impressão.");
        // Se falhar, limpa imediatamente
        cleanupAfterPrint();
    }
}


// --- CONFIGURAÇÃO DE LISTENERS DINÂMICOS ---

function setupModalCloseButtons() {
    // (Esta função permanece inalterada, pois lida com TODOS os modais)
    const modalMap = {
        'close-modal-btn': dom.occurrenceModal, 'cancel-btn': dom.occurrenceModal,
        'close-absence-modal-btn': dom.absenceModal, 'cancel-absence-btn': dom.absenceModal,
        'close-report-generator-btn': dom.reportGeneratorModal, 'cancel-report-generator-btn': dom.reportGeneratorModal,
        'close-notification-btn': dom.notificationModalBackdrop,
        'close-student-selection-modal-btn': document.getElementById('student-selection-modal'),
        'close-report-view-btn': dom.reportViewModalBackdrop,
        'close-ficha-view-btn': dom.fichaViewModalBackdrop,
        'close-history-view-btn': document.getElementById('history-view-modal-backdrop'),
        'close-students-modal-btn': dom.studentsModal,
        'cancel-delete-btn': dom.deleteConfirmModal,
        'close-settings-modal-btn': dom.settingsModal,
        'cancel-settings-btn': dom.settingsModal,
        'close-follow-up-modal-btn': dom.followUpModal,
        'cancel-follow-up-btn': dom.followUpModal,
        // (NOVO) Modais do fluxo Enviar ao CT
        'close-send-ct-modal-btn': dom.sendOccurrenceCtModal,
        'cancel-send-ct-modal-btn': dom.sendOccurrenceCtModal,
    };
    
    for (const [id, modal] of Object.entries(modalMap)) {
        const button = document.getElementById(id);
        if (button && modal) {
            // Remove listener antigo para evitar duplicatas
            const oldListener = button.__clickListener;
            if (oldListener) button.removeEventListener('click', oldListener);
            
            // Adiciona novo listener
            const newListener = () => closeModal(modal);
            button.addEventListener('click', newListener);
            button.__clickListener = newListener; // Armazena referência para remoção futura
            
            if (button.hasAttribute('onclick')) button.removeAttribute('onclick');
        }
    }
    
    // --- ATUALIZAÇÃO DOS BOTÕES DE SHARE E PRINT ---
    
    // Botões de Share (Partilhar)
    document.getElementById('share-btn').addEventListener('click', () => shareContent(document.getElementById('notification-title').textContent, document.getElementById('notification-content').innerText));
    document.getElementById('report-share-btn').addEventListener('click', () => shareContent(document.getElementById('report-view-title').textContent, document.getElementById('report-view-content').innerText));
    document.getElementById('ficha-share-btn').addEventListener('click', () => shareContent(document.getElementById('ficha-view-title').textContent, document.getElementById('ficha-view-content').innerText));

    // Botões de Impressão (AGORA USAM A NOVA FUNÇÃO HÍBRIDA)
    document.getElementById('print-btn').addEventListener('click', () => handlePrintClick('notification-content'));
    document.getElementById('report-print-btn').addEventListener('click', () => handlePrintClick('report-view-content'));
    document.getElementById('ficha-print-btn').addEventListener('click', () => handlePrintClick('ficha-view-content'));
}

