// =================================================================================
// ARQUIVO: main.js
// --- MÓDULOS IMPORTADOS ---

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { onSnapshot, query, writeBatch, doc, where, getDocs, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from './firebase.js';
import { state, dom, initializeDOMReferences } from './state.js';
import { showToast, closeModal, shareContent, openModal, loadScript } from './utils.js';
// (NOVO - Reset) Importa updateRecordWithHistory
import { loadStudents, loadSchoolConfig, getCollectionRef, deleteRecord, updateRecordWithHistory, getStudentsCollectionRef } from './firestore.js';

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

// (ADICIONADO - Híbrida Admin) Lista de Super Administradores (Chave-Mestra)
// Estes emails TÊM SEMPRE acesso de admin, independentemente do que está na base de dados.
const SUPER_ADMIN_EMAILS = [
    'silviobaiajr@gmail.com' // Email do dono da aplicação
];

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

            // ==============================================================================
            // --- (CORREÇÃO ROBUSTEZ) Lógica de Admin Prioritária ---
            // A verificação de Admin agora acontece ANTES de carregar dados pesados.
            // Isso garante que o botão "Gerir Alunos" apareça mesmo se a lista de alunos falhar.
            // ==============================================================================
            
            // 1. Define Admin IMEDIATAMENTE com base na lista fixa (Super Admin)
            state.isAdmin = SUPER_ADMIN_EMAILS.includes(user.email);

            // 2. Tenta carregar configurações (para pegar admins secundários e nome da escola)
            try {
                await loadSchoolConfig(); 
                const dbAdminList = state.config.adminEmails || [];
                // Se não for super admin, verifica se está na lista do banco
                if (!state.isAdmin) {
                    state.isAdmin = dbAdminList.includes(user.email);
                }
                dom.headerSchoolName.textContent = state.config.schoolName || 'Sistema de Acompanhamento';
            } catch (configError) {
                console.warn("Aviso: Não foi possível carregar configurações.", configError);
                // Não bloqueia o fluxo. O Super Admin já está garantido no passo 1.
            }

            // 3. Atualiza a UI dos botões de Admin AGORA (Sem esperar pelos alunos)
            if (state.isAdmin) {
                if(dom.settingsBtn) dom.settingsBtn.classList.remove('hidden');
                if(dom.manageStudentsBtn) dom.manageStudentsBtn.classList.remove('hidden');
            } else {
                if(dom.settingsBtn) dom.settingsBtn.classList.add('hidden');
                if(dom.manageStudentsBtn) dom.manageStudentsBtn.classList.add('hidden');
            }

            // 4. Só agora tenta carregar os dados pesados (Alunos, etc.)
            try {
                await loadStudents();
                setupFirestoreListeners();
            } catch (error) {
                console.error("Erro no carregamento de dados:", error);
                // Mostra aviso amigável, mas mantém a interface funcional para o Admin corrigir
                if (state.isAdmin) {
                    showToast("Aviso: Lista de alunos vazia ou inacessível. Use 'Gerir Alunos' para importar.");
                } else {
                    showToast("Erro ao carregar dados. Tente recarregar a página.");
                }
            }
            
            render(); // Chama o render principal

        } else {
            // Logout
            state.userId = null; state.userEmail = null; state.students = []; state.occurrences = []; state.absences = [];
            dom.mainContent.classList.add('hidden');
            dom.userProfile.classList.add('hidden');
            dom.loginScreen.classList.remove('hidden');
            
            // Garante que os botões de admin fiquem escondidos ao sair
            if(dom.settingsBtn) dom.settingsBtn.classList.add('hidden');
            if(dom.manageStudentsBtn) dom.manageStudentsBtn.classList.add('hidden');
            
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
 * (MODIFICADO - Correção Bug)
 */
function switchTab(tabName) {
    state.activeTab = tabName;
    const isOccurrences = tabName === 'occurrences';
    
    // (MODIFICADO - Lógica explícita para evitar bugs de 'toggle')
    if (isOccurrences) {
        dom.tabOccurrences.classList.add('tab-active');
        dom.tabAbsences.classList.remove('tab-active');
        dom.tabContentOccurrences.classList.remove('hidden');
        dom.tabContentAbsences.classList.add('hidden');
    } else {
        dom.tabOccurrences.classList.remove('tab-active');
        dom.tabAbsences.classList.add('tab-active');
        dom.tabContentOccurrences.classList.add('hidden');
        dom.tabContentAbsences.classList.remove('hidden');
    }
    
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
// --- (INÍCIO DA CORREÇÃO) ---
// A função 'handlePrintClick' (que usava requestAnimationFrame) foi REMOVIDA.
// A função 'setupModalCloseButtons' abaixo foi modificada para usar
// 'window.print()' diretamente, conforme a versão funcional (3d911...).
// ==============================================================================

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
    // (CORRIGIDO O ID QUE CAUSAVA O ERRO DA IMAGEM)
    document.getElementById('ficha-share-btn').addEventListener('click', () => shareContent(document.getElementById('ficha-view-title').textContent, document.getElementById('ficha-view-content').innerText));

    // Botões de Impressão (CORRIGIDO: Voltando ao window.print() simples)
    document.getElementById('print-btn').addEventListener('click', () => window.print());
    document.getElementById('report-print-btn').addEventListener('click', () => window.print());
    document.getElementById('ficha-print-btn').addEventListener('click', () => window.print());
}

// ==============================================================================
// --- TESTE DE CARGA (STRESS TEST) ---
// Ferramenta secreta para o Gestor de Produto testar escalabilidade.
// Uso: Abra a consola e digite: runStressTest(500)
// ==============================================================================

window.runStressTest = async (count = 100) => {
    if (!confirm(`⚠️ ATENÇÃO: Isso vai gerar ${count} alunos falsos no banco de dados!\n\nIsso pode consumir sua quota do Firebase e deixar o app lento se não houver paginação.\n\nDeseja continuar?`)) return;

    console.log(`🚀 Iniciando Stress Test: Gerando ${count} alunos...`);
    showToast(`Gerando ${count} alunos... (Veja a consola)`);

    const batchSize = 400; // Limite do Firestore é 500
    const batches = [];
    let currentBatch = writeBatch(db);
    let operationCount = 0;

    const firstNames = ["João", "Maria", "Ana", "Pedro", "Lucas", "Julia", "Beatriz", "Carlos", "Mariana", "Gabriel"];
    const lastNames = ["Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira", "Lima", "Gomes"];
    const turmas = ["1A", "1B", "2A", "3C", "4B", "5A", "6D", "9A"];

    for (let i = 0; i < count; i++) {
        const randomName = `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]} ${Math.floor(Math.random() * 1000)}`;
        const matricula = `TEST-${Date.now()}-${i}`;
        
        const studentData = {
            matricula: matricula,
            name: randomName,
            class: turmas[Math.floor(Math.random() * turmas.length)],
            endereco: "Rua Teste de Carga, 123",
            contato: "99999-9999",
            resp1: "Responsável Teste 1",
            resp2: "Responsável Teste 2",
            isTest: true // Flag para identificar dados de teste
        };

        // Referência ao documento na coleção 'students'
        const docRef = doc(getStudentsCollectionRef(), matricula);
        currentBatch.set(docRef, studentData);
        operationCount++;

        if (operationCount >= batchSize) {
            batches.push(currentBatch);
            currentBatch = writeBatch(db);
            operationCount = 0;
        }
    }

    if (operationCount > 0) {
        batches.push(currentBatch);
    }

    try {
        console.log(`💾 Salvando em ${batches.length} lotes...`);
        for (let i = 0; i < batches.length; i++) {
            await batches[i].commit();
            console.log(`✅ Lote ${i + 1}/${batches.length} salvo.`);
            showToast(`Salvando lote ${i + 1}/${batches.length}...`);
        }
        
        console.log("🎉 Stress Test Concluído! Recarregue a página.");
        showToast("Concluído! Recarregue a página para ver o impacto.");
        
        // Força recarregamento para ver o "peso"
        // window.location.reload(); 

    } catch (error) {
        console.error("❌ Erro no Stress Test:", error);
        showToast("Erro ao gerar dados de teste.");
    }
};