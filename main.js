// =================================================================================
// ARQUIVO: main.js
// VERSÃO: 2.1 (Listeners Otimizados e Inicialização Segura)

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { onSnapshot, query, writeBatch, doc, where, getDocs, limit, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from './firebase.js';
import { state, dom, initializeDOMReferences } from './state.js';
import { showToast, closeModal, shareContent, openModal, loadScript } from './utils.js';
// Importa updateRecordWithHistory para o reset e funções de firestore
import { loadStudents, loadSchoolConfig, getCollectionRef, deleteRecord, updateRecordWithHistory } from './firestore.js';

// Módulos de Funcionalidade
import { initAuthListeners } from './auth.js';
import { initSettingsListeners } from './settings.js';
import { initStudentListeners } from './students.js';
import { initOccurrenceListeners, renderOccurrences } from './occurrence.js'; 
import { initAbsenceListeners, renderAbsences } from './absence.js';     

// Módulos de UI e Lógica
import { render } from './ui.js';
import { occurrenceStepLogic } from './logic.js';

// Lista de Super Administradores (Chave-Mestra)
const SUPER_ADMIN_EMAILS = [
    'silviobaiajr@gmail.com' 
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

            // 1. Define Admin IMEDIATAMENTE (Super Admin)
            state.isAdmin = SUPER_ADMIN_EMAILS.includes(user.email);

            // 2. Tenta carregar configurações
            try {
                await loadSchoolConfig(); 
                const dbAdminList = state.config.adminEmails || [];
                if (!state.isAdmin) {
                    state.isAdmin = dbAdminList.includes(user.email);
                }
                dom.headerSchoolName.textContent = state.config.schoolName || 'Sistema de Acompanhamento';
            } catch (configError) {
                console.warn("Aviso: Não foi possível carregar configurações.", configError);
            }

            // 3. Atualiza a UI dos botões de Admin
            if (state.isAdmin) {
                if(dom.settingsBtn) dom.settingsBtn.classList.remove('hidden');
                if(dom.manageStudentsBtn) dom.manageStudentsBtn.classList.remove('hidden');
            } else {
                if(dom.settingsBtn) dom.settingsBtn.classList.add('hidden');
                if(dom.manageStudentsBtn) dom.manageStudentsBtn.classList.add('hidden');
            }

            // 4. Carrega dados iniciais (Agora PAGINADOS e SEGUROS)
            try {
                await loadStudents(); // Carrega apenas os primeiros 50 alunos
                setupFirestoreListeners(); // Inicia listeners limitados aos últimos 100 registos
            } catch (error) {
                console.error("Erro no carregamento de dados:", error);
                if (state.isAdmin) {
                    showToast("Aviso: Lista de alunos vazia ou inacessível. Use 'Gerir Alunos' para importar.");
                } else {
                    showToast("Erro ao carregar dados. Tente recarregar a página.");
                }
            }
            
            render(); 

        } else {
            // Logout
            state.userId = null; state.userEmail = null; state.students = []; state.occurrences = []; state.absences = [];
            dom.mainContent.classList.add('hidden');
            dom.userProfile.classList.add('hidden');
            dom.loginScreen.classList.remove('hidden');
            
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

    // (SEGURANÇA DE ESCALA) Limitamos a 100 registos mais recentes para evitar crash.
    // Ocorrências
    const occurrencesQuery = query(
        getCollectionRef('occurrence'), 
        orderBy('createdAt', 'desc'), // Ordena por criação (mais recente primeiro)
        limit(100)                    // Traz apenas os últimos 100
    );
    
    state.unsubscribeOccurrences = onSnapshot(occurrencesQuery, (snapshot) => {
        state.occurrences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'occurrences') renderOccurrences(); 
    }, (error) => console.error("Erro ao buscar ocorrências:", error));

    // Busca Ativa
    const absencesQuery = query(
        getCollectionRef('absence'), 
        orderBy('createdAt', 'desc'), // Ordena por criação
        limit(100)                    // Traz apenas os últimos 100
    );

    state.unsubscribeAbsences = onSnapshot(absencesQuery, (snapshot) => {
        state.absences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'absences') renderAbsences(); 
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
    initAuthListeners();
    dom.logoutBtn.addEventListener('click', () => signOut(auth));

    dom.tabOccurrences.addEventListener('click', () => switchTab('occurrences'));
    dom.tabAbsences.addEventListener('click', () => switchTab('absences'));

    setupModalCloseButtons();

    initSettingsListeners();
    initStudentListeners();
    initOccurrenceListeners(); 
    initAbsenceListeners();    

    document.getElementById('confirm-delete-btn').addEventListener('click', handleDeleteConfirmation);

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

// --- HANDLERS E FUNÇÕES AUXILIARES ---

function switchTab(tabName) {
    state.activeTab = tabName;
    const isOccurrences = tabName === 'occurrences';
    
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
    
    render(); 
}

async function handleDeleteConfirmation() {
    if (!state.recordToDelete) return;
    
    const { type, id, recordId, actionToReset, historyAction } = state.recordToDelete;
    
    try {
        if (type === 'occurrence') {
            const q = query(getCollectionRef('occurrence'), where('occurrenceGroupId', '==', id));
            const querySnapshot = await getDocs(q);
            const batch = writeBatch(db);
            querySnapshot.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            showToast('Incidente excluído.');

        } else if (type === 'occurrence-reset') {
            const logic = occurrenceStepLogic[actionToReset];
            if (!logic) throw new Error(`Lógica não encontrada: ${actionToReset}`);

            const dataToUpdate = {};
            for (const field of logic.fieldsToClear) {
                dataToUpdate[field] = null; 
            }
            dataToUpdate.statusIndividual = logic.statusAfterReset;

            await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
            showToast('Etapa resetada com sucesso.');
            
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
    } catch (error) { 
        showToast('Erro ao processar exclusão/reset.'); 
        console.error("Erro:", error); 
    } finally { 
        state.recordToDelete = null; 
        closeModal(dom.deleteConfirmModal); 
    }
}

function setupModalCloseButtons() {
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
        'close-send-ct-modal-btn': dom.sendOccurrenceCtModal,
        'cancel-send-ct-modal-btn': dom.sendOccurrenceCtModal,
    };
    
    for (const [id, modal] of Object.entries(modalMap)) {
        const button = document.getElementById(id);
        if (button && modal) {
            const oldListener = button.__clickListener;
            if (oldListener) button.removeEventListener('click', oldListener);
            
            const newListener = () => closeModal(modal);
            button.addEventListener('click', newListener);
            button.__clickListener = newListener;
            
            if (button.hasAttribute('onclick')) button.removeAttribute('onclick');
        }
    }
    
    document.getElementById('share-btn').addEventListener('click', () => shareContent(document.getElementById('notification-title').textContent, document.getElementById('notification-content').innerText));
    document.getElementById('report-share-btn').addEventListener('click', () => shareContent(document.getElementById('report-view-title').textContent, document.getElementById('report-view-content').innerText));
    document.getElementById('ficha-share-btn').addEventListener('click', () => shareContent(document.getElementById('ficha-view-title').textContent, document.getElementById('ficha-view-content').innerText));

    document.getElementById('print-btn').addEventListener('click', () => window.print());
    document.getElementById('report-print-btn').addEventListener('click', () => window.print());
    document.getElementById('ficha-print-btn').addEventListener('click', () => window.print());
}