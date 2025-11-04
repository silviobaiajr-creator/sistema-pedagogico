// =================================================================================
// ARQUIVO: main.js (REFATORADO)
// RESPONSABILIDADE: Ponto de entrada, autenticação, gerenciamento de estado
// de alto nível (troca de abas) e inicialização dos módulos de funcionalidade.
//
// ATUALIZAÇÃO (IMPRESSÃO - CORREÇÃO MOBILE):
// 1. A chamada window.print() foi envolvida em um setTimeout(..., 0).
// 2. Isso corrige um bug em navegadores mobile (race condition) onde a
//    janela de impressão era chamada ANTES do navegador aplicar a classe
//    'printing-now', resultando em uma página em branco.
//
// ATUALIZAÇÃO (RESET DE AÇÃO - 01/11/2025):
// 1. Importada a `occurrenceStepLogic` do logic.js.
// 2. Importada a `updateRecordWithHistory` do firestore.js.
// 3. A função `handleDeleteConfirmation` foi atualizada para lidar com
//    o novo tipo de ação 'occurrence-reset', permitindo o rollback de etapas.
// =================================================================================

// --- MÓDULOS IMPORTADOS ---

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { onSnapshot, query, writeBatch, doc, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from './firebase.js';
import { state, dom, initializeDOMReferences } from './state.js';
import { showToast, closeModal, shareContent, openModal, loadScript } from './utils.js';
// (NOVO - Reset) Importa updateRecordWithHistory
import { loadStudents, loadSchoolConfig, getCollectionRef, deleteRecord, updateRecordWithHistory } from './firestore.js';

// Módulos de Funcionalidade
import { initAuthListeners } from './auth.js';
import { initSettingsListeners } from './settings.js';
import { initStudentListeners } from './students.js';
import { initOccurrenceListeners, renderOccurrences } from './occurrence.js'; // Novo
import { initAbsenceListeners, renderAbsences } from './absence.js';     // Novo

// Módulos de UI e Lógica (agora menores)
import { render } from './ui.js';
// (NOVO - Reset) Importa a lógica de reset
import { occurrenceStepLogic } from './logic.js';

// --- (ADICIONADO - SUGESTÃO 1) LISTA DE ADMINISTRAÇÃO ---
// Defina aqui os emails dos utilizadores que terão acesso
// aos botões de Configuração e Gestão de Alunos.
const ADMIN_EMAILS = [
    'admin@suaescola.com',
    'gestor@suaescola.com',
    'silvio.baia.jr@gmail.com' // Exemplo
];
// --- FIM DA ADIÇÃO ---


// --- INICIALIZAÇÃO DA APLICAÇÃO ---

document.addEventListener('DOMContentLoaded', () => {
    initializeDOMReferences();
    state.db = db;

    onAuthStateChanged(auth, async user => {
        detachFirestoreListeners();
        if (user) {
            state.userId = user.uid;
            state.userEmail = user.email;

            // --- (ADICIONADO - SUGESTÃO 1) VERIFICAÇÃO DE ADMIN ---
            state.isAdmin = ADMIN_EMAILS.includes(user.email);
            // --- FIM DA ADIÇÃO ---

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

                // --- (ADICIONADO - SUGESTÃO 1) LÓGICA DE VISIBILIDADE DOS BOTÕES ---
                if (state.isAdmin) {
                    dom.settingsBtn.classList.remove('hidden');
                    dom.manageStudentsBtn.classList.remove('hidden');
                } else {
                    dom.settingsBtn.classList.add('hidden');
                    dom.manageStudentsBtn.classList.add('hidden');
                }
                // --- FIM DA ADIÇÃO ---

            } catch (error) {
                showToast(error.message);
            }
        } else {
            state.userId = null; state.userEmail = null; state.students = []; state.occurrences = []; state.absences = [];
            
            // --- (ADICIONADO - SUGESTÃO 1) Garante que isAdmin seja falso no logout ---
            state.isAdmin = false;
            // --- FIM DA ADIÇÃO ---
            
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
    dom.tabContentAbsences.classList.toggle('hidden', !isOccurrences);
    render(); // O render do ui.js vai decidir qual função específica chamar
}

/**
 * Lida com a confirmação de exclusão (genérico).
 * Esta função é chamada pelos listeners em occurrence.js e absence.js
 * --- (NOVO - Reset) Esta função agora também lida com o RESET de etapas. ---
 */
async function handleDeleteConfirmation() {
    if (!state.recordToDelete) return;
    
    // (NOVO - Reset) Desestruturação expandida para o reset
    const { type, id, recordId, actionToReset, historyAction } = state.recordToDelete;
    
    try {
        if (type === 'occurrence') {
            // Lógica original de exclusão de incidente (inalterada)
            const q = query(getCollectionRef('occurrence'), where('occurrenceGroupId', '==', id));
            const querySnapshot = await getDocs(q);
            const batch = writeBatch(db);
            querySnapshot.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            showToast('Incidente e todos os registros associados foram excluídos.');

        // --- (NOVO - Reset) Lógica para resetar uma etapa da ocorrência ---
        } else if (type === 'occurrence-reset') {
            const logic = occurrenceStepLogic[actionToReset];
            if (!logic) {
                throw new Error(`Lógica de reset não encontrada para a ação: ${actionToReset}`);
            }

            // 1. Prepara o objeto de atualização (limpa os campos)
            const dataToUpdate = {};
            for (const field of logic.fieldsToClear) {
                dataToUpdate[field] = null; // Seta o campo para null
            }
            
            // 2. Define o status para o qual deve reverter
            dataToUpdate.statusIndividual = logic.statusAfterReset;

            // 3. Executa a atualização (usando a função importada)
            // Usa o 'recordId' do state.recordToDelete
            await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
            showToast('Etapa resetada com sucesso.');
        // --- FIM DA NOVIDADE ---
            
        } else if (type === 'absence-cascade') {
            // Lógica original de exclusão em cascata (inalterada)
            const { ctId, analiseId } = state.recordToDelete;
            const batch = writeBatch(db);
            batch.delete(doc(getCollectionRef('absence'), ctId));
            if (analiseId) batch.delete(doc(getCollectionRef('absence'), analiseId));
            await batch.commit();
            showToast('Encaminhamento e Análise excluídos.');
        } else {
            // Lógica original de exclusão simples (inalterada)
            await deleteRecord(type, id);
            showToast('Registro excluído com sucesso.');
        }
    } catch (error) { 
        // (NOVO - Reset) Mensagem de erro genérica
        showToast(type === 'occurrence-reset' ? 'Erro ao resetar a etapa.' : 'Erro ao excluir.'); 
        console.error("Erro na confirmação:", error); 
    } finally { 
        state.recordToDelete = null; 
        closeModal(dom.deleteConfirmModal); 
    }
}


// ==============================================================================
// --- LÓGICA DE IMPRESSÃO CORRIGIDA (Híbrida Definitiva + Mobile) ---
// ==============================================================================

/**
 * Prepara o DOM para impressão adicionando uma classe específica ao modal
 * e limpa depois.
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
    
    // Encontra o backdrop pai, que tem a classe .printable-area
    const printableBackdrop = contentElement.closest('.printable-area');
    if (!printableBackdrop) {
         console.error("Backdrop '.printable-area' pai não encontrado para:", contentElementId);
         showToast("Erro ao preparar a área de impressão.");
         return;
    }

    // 1. Adiciona classe específica ('printing-now')
    //    APENAS ao backdrop do modal que queremos imprimir.
    printableBackdrop.classList.add('printing-now');

    // 2. Define a função de limpeza
    const cleanupAfterPrint = () => {
        printableBackdrop.classList.remove('printing-now');
        // REMOVIDO: window.removeEventListener('afterprint', cleanupAfterPrint);
    };

    // 3. REMOVIDO: window.addEventListener('afterprint', cleanupAfterPrint);

    // 4. Chama a impressão com a nova lógica (sem afterprint)
    try {
        // ==================================================================
        // INÍCIO DA NOVA CORREÇÃO (Sem 'afterprint')
        // ==================================================================
        
        // Passo A: Espera 150ms para o navegador aplicar a classe .printing-now
        setTimeout(() => {
            try {
                // Passo B: Chama a impressão. O JS vai "pausar" aqui.
                window.print();
            
                // Passo C: O JS "descongela" aqui (depois de imprimir ou cancelar).
                // Agenda a limpeza para rodar logo em seguida.
                // Usamos 500ms como um "cooldown" seguro para o navegador.
                setTimeout(cleanupAfterPrint, 500); 

            } catch (printError) {
                // Se o window.print() falhar, limpa imediatamente.
                console.error("Erro durante a chamada window.print():", printError);
                showToast("Não foi possível abrir a janela de impressão.");
                cleanupAfterPrint(); // Limpa se a impressão falhar
            }
        }, 150); // 150ms de espera (aumentado de 100)
        // ==================================================================
        // FIM DA NOVA CORREÇÃO
        // ==================================================================
        
    } catch (e) {
        // Este catch externo pega erros síncronos (raro)
        console.error("Erro ao preparar a impressão:", e);
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
